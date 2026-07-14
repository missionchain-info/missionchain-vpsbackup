/**
 * SeedSale Event Sync — polls SeedSale (V7 active 2026-06-23, was V6) .SeedPurchase
 * events and backfills missing Purchase records in the DB.
 *
 * SAFETY NET for Layer A (FE → POST /sales/seed/record-onchain). Even if FE
 * call fails (network drop, browser closed, JWT missing/expired), this service
 * picks up the on-chain event and persists basic Purchase + user.seedPurchased
 * flag. NFT records are minted via the FE-driven endpoint when available;
 * if not, the Purchase still surfaces in My SEED Orders.
 *
 * Idempotent: Purchase.txHash is unique → safe to re-run.
 */
import { Contract, JsonRpcProvider, formatUnits, formatEther, type EventLog, type Log } from 'ethers'
import type { PrismaClient } from '@missionchain/db'

const POLL_INTERVAL_MS = 300_000     // 5 minutes — rate-limit safe on BSC testnet
const BATCH_BLOCKS = 10         // public RPCs throttle aggressively
const LOOKBACK_BLOCKS  = 200         // first-run lookback if no cursor
const CONTRACT_NAME    = 'SeedSale'  // V5c/V7 cutover Jun 23, 2026 — cursor stable across V6→V7 swap

const RPC_ENDPOINTS = [
  'https://bsc-dataseed.binance.org/',
  'https://bsc-dataseed1.binance.org/',
  'https://bsc.publicnode.com',
  'https://bsc.publicnode.com',
]

const SEED_ABI = [
  'event SeedPurchase(address indexed buyer, uint256 indexed packageIndex, uint256 priceUsdt, uint256 micAmount, uint256 nftCount)',
]

// Canonical package names (must mirror SEED_PACKAGES in routes/sales.ts)
const PACKAGE_NAMES = ['Early Bird', 'Founding I', 'Founding II', 'Founding III']

export class SeedEventSync {
  private timer: ReturnType<typeof setInterval> | null = null
  private processing = false

  constructor(
    private readonly prisma: PrismaClient,
    private readonly seedSaleAddress: string,
    private readonly rpcUrl: string,
  ) {}

  start(): void {
    console.log(`[SeedSync] Starting (poll ${POLL_INTERVAL_MS}ms, batch ${BATCH_BLOCKS} blocks)`)
    this.poll().catch((err) => console.error('[SeedSync] Initial poll error:', err))
    this.timer = setInterval(() => {
      this.poll().catch((err) => console.error('[SeedSync] Poll error:', err))
    }, POLL_INTERVAL_MS)
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  private async tryRpc<T>(fn: (provider: JsonRpcProvider) => Promise<T>): Promise<T> {
    const endpoints = [this.rpcUrl, ...RPC_ENDPOINTS.filter((u) => u !== this.rpcUrl)]
    let lastErr: any
    for (const url of endpoints) {
      try {
        const provider = new JsonRpcProvider(url)
        return await fn(provider)
      } catch (err: any) {
        lastErr = err
        const msg = err?.message || ''
        const code = err?.code || ''
        const isRateLimit =
          code === 'BAD_DATA' ||
          code === 'UNKNOWN_ERROR' ||
          code === 'NETWORK_ERROR' ||
          code === 'TIMEOUT' ||
          /rate limit|limit exceeded|too many requests|429/i.test(msg)
        if (isRateLimit) continue
        throw err
      }
    }
    throw lastErr
  }

  private async poll(): Promise<void> {
    if (this.processing) return
    this.processing = true
    try {
      const currentBlock = await this.tryRpc((p) => p.getBlockNumber())

      const cursor = await this.prisma.syncCursor.findUnique({
        where: { contractName: CONTRACT_NAME },
      })
      let fromBlock = cursor
        ? cursor.lastBlock + 1
        : Math.max(0, currentBlock - LOOKBACK_BLOCKS)

      if (fromBlock > currentBlock) return

      // Catch-up loop: process all chunks from cursor to head in one poll
      // (free RPC caps getLogs at ~10 blocks; loop so we never fall behind).
      while (fromBlock <= currentBlock) {
      const toBlock = Math.min(currentBlock, fromBlock + BATCH_BLOCKS - 1)

      const events = await this.tryRpc(async (p) => {
        const seed = new Contract(this.seedSaleAddress, SEED_ABI, p)
        return await seed.queryFilter(
          seed.filters.SeedPurchase(),
          fromBlock,
          toBlock,
        ) as (EventLog | Log)[]
      })

      let inserted = 0
      for (const ev of events) {
        const log = ev as EventLog
        if (!log.args) continue
        const buyer = (log.args.buyer as string).toLowerCase()
        const pkgIndex = Number(log.args.packageIndex as bigint)
        const usdtAmount = Number(formatUnits(log.args.priceUsdt as bigint, 6))
        const micAmount = Number(formatEther(log.args.micAmount as bigint))
        const nftCount = Number(log.args.nftCount as bigint)
        const packageName = PACKAGE_NAMES[pkgIndex] ?? `Package ${pkgIndex}`

        // Ensure user exists (auto-create minimal record)
        await this.prisma.user.upsert({
          where: { wallet: buyer },
          create: {
            wallet: buyer,
            userId: `auto_${buyer.slice(2, 10)}`,
            termsAccepted: true,
          },
          update: {},
        })

        const userRec = await this.prisma.user.findUnique({
          where: { wallet: buyer },
          select: { referrer: true },
        })

        const result = await this.prisma.purchase.upsert({
          where: { txHash: log.transactionHash },
          create: {
            wallet: buyer,
            type: 'SEED',
            packageName,
            usdtAmount,
            micAmount,
            status: 'CONFIRMED',
            txHash: log.transactionHash,
            blockNumber: log.blockNumber,
            referrerWallet: userRec?.referrer ?? null,
          },
          update: {},
        })

        await this.prisma.user.update({
          where: { wallet: buyer },
          data: {
            seedPurchased: true,
            mfpCount: { increment: nftCount },
          },
        }).catch(() => { /* ignore */ })

        inserted++
        console.log(`[SeedSync] Synced tx ${log.transactionHash.slice(0, 10)}... buyer=${buyer.slice(0, 10)}... usdt=${usdtAmount} mic=${micAmount} mfp=${nftCount} (purchase ${result.id})`)
      }

      await this.prisma.syncCursor.upsert({
        where: { contractName: CONTRACT_NAME },
        create: { contractName: CONTRACT_NAME, lastBlock: toBlock },
        update: { lastBlock: toBlock },
      })

      if (inserted > 0 || events.length > 0) {
        console.log(`[SeedSync] Block ${fromBlock}..${toBlock} — ${events.length} events, ${inserted} synced`)
      }

      fromBlock = toBlock + 1
      await new Promise((r) => setTimeout(r, 150)) // throttle between chunks
      } // end catch-up while loop
    } finally {
      this.processing = false
    }
  }
}
