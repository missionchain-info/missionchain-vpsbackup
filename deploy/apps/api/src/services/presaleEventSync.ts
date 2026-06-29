/**
 * PreSale Event Sync — focused cron that polls PreSale.PreSalePurchase events
 * and backfills any missing Purchase records in the DB.
 *
 * This is a SAFETY NET for Layer A (FE → POST /record-onchain). Even if FE call
 * fails (network drop, browser closed, JWT issue), this service will pick up
 * the on-chain event and persist it within ~1 minute.
 *
 * Why a dedicated service instead of enabling full EventIndexer?
 *  - Full indexer scans ~10 contracts → high RPC load → rate limits on testnet
 *  - This service only polls PreSale (1 contract, 1 event)
 *  - Conservative batch (500 blocks) and interval (60s) to stay under limits
 *
 * Idempotent: Purchase.txHash is unique → safe to re-run.
 */
import { Contract, JsonRpcProvider, formatUnits, type EventLog, type Log } from 'ethers'
import type { PrismaClient } from '@missionchain/db'

const POLL_INTERVAL_MS = 300_000     // 5 minutes (rate-limit safe on BSC testnet)
const BATCH_BLOCKS     = 100         // small batch — public RPCs throttle aggressively
const LOOKBACK_BLOCKS  = 200         // first-run lookback if no cursor
const CONTRACT_NAME    = 'PreSale'

// Multiple RPC endpoints for failover. Any failure → try next.
const RPC_ENDPOINTS = [
  'https://bsc-dataseed.binance.org/',
  'https://bsc-dataseed1.binance.org/',
  'https://bsc.publicnode.com',
  'https://bsc.publicnode.com',
]

const PRESALE_ABI = [
  'event PreSalePurchase(address indexed buyer, uint256 usdtAmount, uint256 micAmount, uint256 packageIndex)',
]

const PACKAGE_NAMES = ['Minimum', 'Package Builder', 'Package Maker', 'Package Luminary']
const NFT_BONUS = [null, 'Builder', 'Maker', 'Luminary']

export class PreSaleEventSync {
  private timer: ReturnType<typeof setInterval> | null = null
  private processing = false

  constructor(
    private readonly prisma: PrismaClient,
    private readonly presaleAddress: string,
    private readonly rpcUrl: string,
  ) {}

  start(): void {
    console.log(`[PreSaleSync] Starting (poll ${POLL_INTERVAL_MS}ms, batch ${BATCH_BLOCKS} blocks)`)
    // Run once immediately, then schedule
    this.poll().catch((err) => console.error('[PreSaleSync] Initial poll error:', err))
    this.timer = setInterval(() => {
      this.poll().catch((err) => console.error('[PreSaleSync] Poll error:', err))
    }, POLL_INTERVAL_MS)
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  private async tryRpc<T>(fn: (provider: JsonRpcProvider) => Promise<T>): Promise<T> {
    // Try primary RPC first, then failover
    const endpoints = [this.rpcUrl, ...RPC_ENDPOINTS.filter((u) => u !== this.rpcUrl)]
    let lastErr: any
    for (const url of endpoints) {
      try {
        const provider = new JsonRpcProvider(url)
        return await fn(provider)
      } catch (err: any) {
        lastErr = err
        // Rate limit, RPC error, network error → try next endpoint
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

      // Get cursor
      const cursor = await this.prisma.syncCursor.findUnique({
        where: { contractName: CONTRACT_NAME },
      })
      const fromBlock = cursor
        ? cursor.lastBlock + 1
        : Math.max(0, currentBlock - LOOKBACK_BLOCKS)

      if (fromBlock > currentBlock) return // no new blocks

      const toBlock = Math.min(currentBlock, fromBlock + BATCH_BLOCKS - 1)

      const events = await this.tryRpc(async (p) => {
        const presale = new Contract(this.presaleAddress, PRESALE_ABI, p)
        return await presale.queryFilter(
          presale.filters.PreSalePurchase(),
          fromBlock,
          toBlock,
        ) as (EventLog | Log)[]
      })

      let inserted = 0
      for (const ev of events) {
        const log = ev as EventLog
        if (!log.args) continue
        const buyer = (log.args.buyer as string).toLowerCase()
        const usdtAmount = Number(formatUnits(log.args.usdtAmount as bigint, 6))
        const micAmount = Number(formatUnits(log.args.micAmount as bigint, 18))
        const pkgIndex = Number(log.args.packageIndex as bigint)
        const packageName = PACKAGE_NAMES[pkgIndex] ?? 'Minimum'
        const nftBonusType = NFT_BONUS[pkgIndex] ?? null

        // Ensure user exists (auto-create minimal record for unknown wallets)
        await this.prisma.user.upsert({
          where: { wallet: buyer },
          create: {
            wallet: buyer,
            userId: `auto_${buyer.slice(2, 10)}`,
            termsAccepted: true,
          },
          update: {},
        })

        // Lookup referrer
        const userRec = await this.prisma.user.findUnique({
          where: { wallet: buyer },
          select: { referrer: true },
        })

        // Idempotent insert (txHash unique → no duplicates)
        const result = await this.prisma.purchase.upsert({
          where: { txHash: log.transactionHash },
          create: {
            wallet: buyer,
            type: 'PRESALE',
            packageName,
            usdtAmount,
            micAmount,
            status: 'CONFIRMED',
            txHash: log.transactionHash,
            blockNumber: log.blockNumber,
            referrerWallet: userRec?.referrer ?? null,
            nftBonusType,
          },
          update: {},
        })

        // Set preSalePurchased flag
        await this.prisma.user.update({
          where: { wallet: buyer },
          data: { preSalePurchased: true },
        }).catch(() => { /* ignore */ })

        inserted++
        console.log(`[PreSaleSync] Synced tx ${log.transactionHash.slice(0, 10)}... buyer=${buyer.slice(0, 10)}... usdt=${usdtAmount} mic=${micAmount} (purchase ${result.id})`)
      }

      // Update cursor
      await this.prisma.syncCursor.upsert({
        where: { contractName: CONTRACT_NAME },
        create: { contractName: CONTRACT_NAME, lastBlock: toBlock },
        update: { lastBlock: toBlock },
      })

      if (inserted > 0 || events.length > 0) {
        console.log(`[PreSaleSync] Block ${fromBlock}..${toBlock} — ${events.length} events, ${inserted} synced`)
      }
    } finally {
      this.processing = false
    }
  }
}
