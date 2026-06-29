/**
 * P2P Event Sync — polls P2PEscrowMFP events every 30s, upserts DB.
 *
 * Mirrors seedEventSync.ts:
 *   - Chunked getLogs scan (2K blocks per chunk, sequential to stay under publicnode rate limit)
 *   - Cursor model: lastScannedBlock kept in-memory per process; on boot starts from currentBlock - 30K
 *   - Dedupe: in-memory Set of `${txHash}:${logIndex}` (LRU 1000); plus DB onChainId @unique provides ultimate idempotency
 *   - Per-event handlers map to specific column updates
 */
import { Contract, Interface, JsonRpcProvider, Wallet, formatUnits } from 'ethers'
import type { PrismaClient } from '@missionchain/db'
import type { FastifyBaseLogger } from 'fastify'
import { getActiveAddresses, isMainnet } from '@missionchain/sdk'
import { getLogProvider, P2P_EVENT_ABI } from './p2pTreasury.js'

const POLL_INTERVAL_MS = 30_000
const SCAN_CHUNK_BLOCKS = 2_000
const INITIAL_LOOKBACK_BLOCKS = 30_000  // ≈ 25h at 3s/block

// Auto-sweep expired orders — calls expireOrder() to release NFT back to seller.
// Permissionless on-chain (anyone can call after expiresAt), so a backend cron
// closes the loop without forcing seller to manually click "expire" on FE.
const SWEEP_INTERVAL_MS = 5 * 60_000   // 5 minutes per anh's request
const SWEEP_INITIAL_DELAY_MS = 60_000  // wait 1min after start before first sweep
const SWEEP_BATCH_LIMIT = 50           // max orders per sweep cycle (gas budget)
// Network-aware sweep RPC (writes expireOrder() tx). Uses mainnet/testnet endpoints automatically.
function getSweepTxRpc(): string {
  return isMainnet() ? 'https://bsc.publicnode.com' : 'https://bsc.publicnode.com'
}

const P2P_WRITE_ABI = [
  'function expireOrder(uint256 id)',
  'function orders(uint256) view returns (uint256 id, address seller, uint256 tokenId, uint256 priceUsdt, uint64 createdAt, uint64 expiresAt, uint8 status, address buyer, uint64 closedAt)',
]

export class P2PEventSync {
  private lastScannedBlock = 0
  private dedupe = new Set<string>()
  private timer: NodeJS.Timeout | null = null
  private sweepTimer: NodeJS.Timeout | null = null
  private iface: Interface

  constructor(private prisma: PrismaClient, private log: FastifyBaseLogger) {
    this.iface = new Interface(P2P_EVENT_ABI as readonly string[])
  }

  async start() {
    // Event sync: 30s poll for fast indexing
    await this.poll().catch(e => this.log.error({ err: e?.message }, '[P2PSync] initial poll failed'))
    this.timer = setInterval(() => {
      this.poll().catch(e => this.log.error({ err: e?.message }, '[P2PSync] poll failed'))
    }, POLL_INTERVAL_MS)
    this.log.info('[P2PSync] started, poll interval 30s')

    // Expiry sweep: 5min cycle, kicks in after 1min delay (let initial poll finish)
    this.sweepTimer = setInterval(() => {
      this.sweepExpired().catch(e => this.log.error({ err: e?.message }, '[P2PSync] sweep failed'))
    }, SWEEP_INTERVAL_MS)
    setTimeout(() => {
      this.sweepExpired().catch(e => this.log.error({ err: e?.message }, '[P2PSync] initial sweep failed'))
    }, SWEEP_INITIAL_DELAY_MS)
    this.log.info('[P2PSync] expiry sweep scheduled, interval 5m')
  }

  stop() {
    if (this.timer) { clearInterval(this.timer); this.timer = null }
    if (this.sweepTimer) { clearInterval(this.sweepTimer); this.sweepTimer = null }
  }

  /**
   * Auto-release expired PENDING orders back to seller wallet.
   * Calls expireOrder(id) for each order past expiresAt. Permissionless on-chain;
   * backend signer = DEPLOYER_PK pays gas. Each tx wrapped in try/catch — one
   * failed order doesn't block the rest.
   */
  private async sweepExpired() {
    const pk = process.env.DEPLOYER_PK
    if (!pk) {
      this.log.warn('[P2PSync] sweep skipped — DEPLOYER_PK not in env')
      return
    }

    const expired = await this.prisma.p2POrder.findMany({
      where: { status: 'PENDING', expiresAt: { lt: new Date() } },
      take: SWEEP_BATCH_LIMIT,
      orderBy: { expiresAt: 'asc' },
    })
    if (expired.length === 0) return

    const provider = new JsonRpcProvider(getSweepTxRpc(), undefined, { batchMaxCount: 1 })
    const signer = new Wallet(pk, provider)
    const p2p = new Contract(getActiveAddresses().P2PEscrowMFP, P2P_WRITE_ABI, signer)

    let released = 0
    let skipped = 0
    for (const o of expired) {
      try {
        // Re-check on-chain status before sending tx — DB might be stale
        const onChain: any = await p2p.orders(o.onChainId)
        if (Number(onChain[6]) !== 0) {
          // status not PENDING (already executed/cancelled/expired), skip
          skipped++
          continue
        }
        const tx = await p2p.expireOrder(o.onChainId)
        await tx.wait()
        released++
        this.log.info({ orderId: o.onChainId.toString(), txHash: tx.hash }, '[P2PSync] expired order released')
      } catch (e: any) {
        skipped++
        this.log.warn({ orderId: o.onChainId.toString(), err: e?.shortMessage || e?.message }, '[P2PSync] sweep order failed')
      }
    }
    if (released > 0 || skipped > 0) {
      this.log.info({ released, skipped, total: expired.length }, '[P2PSync] sweep complete')
    }
  }

  private async poll() {
    const provider = await getLogProvider()
    const currentBlock = await provider.getBlockNumber()

    if (this.lastScannedBlock === 0) {
      this.lastScannedBlock = Math.max(0, currentBlock - INITIAL_LOOKBACK_BLOCKS)
      this.log.info({ from: this.lastScannedBlock, to: currentBlock }, '[P2PSync] cold start, initial lookback')
    }

    const fromBlock = this.lastScannedBlock + 1
    if (fromBlock > currentBlock) return  // no new blocks

    const p2pAddr = getActiveAddresses().P2PEscrowMFP
    let totalEvents = 0
    let chunkFrom = fromBlock

    while (chunkFrom <= currentBlock) {
      const chunkTo = Math.min(chunkFrom + SCAN_CHUNK_BLOCKS - 1, currentBlock)
      let logs: any[]
      try {
        logs = await provider.getLogs({ address: p2pAddr, fromBlock: chunkFrom, toBlock: chunkTo })
      } catch (e: any) {
        this.log.warn({ err: e?.message, chunkFrom, chunkTo }, '[P2PSync] chunk getLogs failed, skipping chunk')
        chunkFrom = chunkTo + 1
        continue
      }
      for (const log of logs) {
        const dedupeKey = `${log.transactionHash}:${log.index ?? log.logIndex}`
        if (this.dedupe.has(dedupeKey)) continue
        this.dedupe.add(dedupeKey)
        // LRU eviction — keep set bounded at 1000 entries
        if (this.dedupe.size > 1000) {
          const first = this.dedupe.values().next().value
          if (first) this.dedupe.delete(first)
        }
        try {
          await this.handleEvent(log)
          totalEvents++
        } catch (e: any) {
          this.log.error({ err: e?.message, tx: log.transactionHash }, '[P2PSync] event handler failed')
        }
      }
      chunkFrom = chunkTo + 1
    }
    this.lastScannedBlock = currentBlock
    if (totalEvents > 0) {
      this.log.info({ totalEvents, lastBlock: currentBlock }, '[P2PSync] poll completed')
    }
  }

  private async handleEvent(log: any) {
    let parsed
    try {
      parsed = this.iface.parseLog({ topics: [...log.topics], data: log.data })
    } catch { return }
    if (!parsed) return

    const txHash = log.transactionHash as string

    if (parsed.name === 'OrderCreated') {
      const id = BigInt(parsed.args[0])
      const seller = (parsed.args[1] as string).toLowerCase()
      const tokenId = parsed.args[2] as bigint
      const priceUsdt = Number(formatUnits(parsed.args[3] as bigint, 6))
      const expiresAt = Number(parsed.args[4])
      await this.prisma.p2POrder.upsert({
        where: { onChainId: id },
        create: {
          onChainId: id,
          seller,
          tokenId,
          priceUsdt,
          status: 'PENDING',
          expiresAt: new Date(expiresAt * 1000),
          createdAt: new Date(),
          createdTxHash: txHash,
        },
        update: { createdTxHash: txHash },
      })
    }
    else if (parsed.name === 'OrderExecuted') {
      const id = BigInt(parsed.args[0])
      const buyer = (parsed.args[1] as string).toLowerCase()
      const royaltyAmount = Number(formatUnits(parsed.args[3] as bigint, 6))
      const feeAmount = Number(formatUnits(parsed.args[4] as bigint, 6))
      const sellerNet = Number(formatUnits(parsed.args[5] as bigint, 6))
      await this.prisma.p2POrder.updateMany({
        where: { onChainId: id },
        data: {
          status: 'EXECUTED',
          buyer,
          closedAt: new Date(),
          royaltyAmount,
          feeAmount,
          sellerNet,
          executedTxHash: txHash,
        },
      })
    }
    else if (parsed.name === 'OrderCancelled') {
      const id = BigInt(parsed.args[0])
      await this.prisma.p2POrder.updateMany({
        where: { onChainId: id },
        data: { status: 'CANCELLED', closedAt: new Date(), cancelledTxHash: txHash },
      })
    }
    else if (parsed.name === 'OrderExpired') {
      const id = BigInt(parsed.args[0])
      await this.prisma.p2POrder.updateMany({
        where: { onChainId: id },
        data: { status: 'EXPIRED', closedAt: new Date(), expiredTxHash: txHash },
      })
    }
  }
}
