/**
 * Old Investors relayer — server-side wallet that signs adminGrantOldInvestor() txs
 * on behalf of pending OldInvestorRequest rows after their 24h cooldown elapses,
 * or immediately when authorized admin clicks "Chuyển ngay".
 *
 * Security: relies on DEPLOYER_PK in .env (= authorized admin_ROLE wallet).
 * Acceptable for testnet; on mainnet, switch to manual-click execution flow.
 */
import { JsonRpcProvider, Contract, Wallet, parseUnits } from 'ethers'
import type { FastifyInstance } from 'fastify'
import { getActiveAddresses } from '@missionchain/sdk'

const BSC_MAINNET_RPC = 'https://bsc-dataseed.binance.org/'

// SeedSale (mainnet 2026-05-06) — see reference_phase0_mainnet_deploy.md
const SEED_SALE_ADDRESS = getActiveAddresses().SeedSale

const SEED_SALE_ABI = [
  'function adminGrantOldInvestor(address recipient, uint256 micAmount, uint256 startTime)',
  'function oldInvestorsGranted() view returns (uint256)',
  'function lastAdminGrantAt(address) view returns (uint256)',
  'function ADMIN_GRANT_COOLDOWN() view returns (uint256)',
] as const

function getRpcUrl(): string {
  return process.env.BSC_RPC_URL || BSC_MAINNET_RPC
}

/**
 * Build a ready-to-send signer wired to BSC RPC. Returns null if no PK configured.
 */
export function getRelayerSigner(): { wallet: Wallet; provider: JsonRpcProvider } | null {
  const rawPk = process.env.DEPLOYER_PK?.trim()
  if (!rawPk) return null
  const pk = rawPk.startsWith('0x') ? rawPk : '0x' + rawPk
  const provider = new JsonRpcProvider(getRpcUrl())
  const wallet = new Wallet(pk, provider)
  return { wallet, provider }
}

/**
 * Execute a pending OldInvestorRequest on-chain via the relayer wallet.
 * Caller indicates who triggered it: 'CRON' for auto-execute, or a wallet address
 * for "Chuyển ngay" calls.
 *
 * Idempotent: if the request has already moved past PENDING, returns the existing row.
 * On contract revert, marks executeError on the request and re-throws so the cron
 * can decide whether to retry next cycle.
 */
export async function executeOldInvestorRequest(
  app: FastifyInstance,
  requestId: string,
  triggeredBy: 'CRON' | string,
): Promise<{
  id: string
  status: string
  txHash: string | null
  blockNumber: number | null
  executedAt: Date | null
  executedBy: string | null
}> {
  // Snapshot the row
  const row = await app.prisma.oldInvestorRequest.findUnique({ where: { id: requestId } })
  if (!row) throw new Error('Request not found')
  if (row.status !== 'PENDING') {
    return {
      id: row.id,
      status: row.status,
      txHash: row.txHash,
      blockNumber: row.blockNumber,
      executedAt: row.executedAt,
      executedBy: row.executedBy,
    }
  }

  const signer = getRelayerSigner()
  if (!signer) throw new Error('Relayer wallet not configured (DEPLOYER_PK missing)')
  const seedSale = new Contract(SEED_SALE_ADDRESS, SEED_SALE_ABI, signer.wallet)

  const recipient = row.recipient
  const micAmountWei = parseUnits(row.micAmount.toString(), 18)
  const startTimeSec = BigInt(Math.floor(row.startTime.getTime() / 1000))

  let txHash: string | null = null
  let blockNumber: number | null = null
  try {
    const tx = await seedSale.adminGrantOldInvestor(recipient, micAmountWei, startTimeSec)
    const receipt = await tx.wait(2)
    if (!receipt || receipt.status !== 1) {
      throw new Error('Transaction reverted on-chain')
    }
    txHash = receipt.hash
    blockNumber = Number(receipt.blockNumber || 0)
  } catch (e: any) {
    const errMsg = e?.shortMessage || e?.reason || e?.message || 'Unknown error'
    // Persist last error so the UI / cron operator can see why it's stuck
    await app.prisma.oldInvestorRequest.update({
      where: { id: requestId },
      data: { executeError: String(errMsg).slice(0, 500) },
    })
    throw e
  }

  // Mark DONE
  const updated = await app.prisma.oldInvestorRequest.update({
    where: { id: requestId },
    data: {
      status: 'DONE',
      executedAt: new Date(),
      executedBy: triggeredBy,
      txHash,
      blockNumber: blockNumber ?? null,
      executeError: null,
    },
  })

  return {
    id: updated.id,
    status: updated.status,
    txHash: updated.txHash,
    blockNumber: updated.blockNumber,
    executedAt: updated.executedAt,
    executedBy: updated.executedBy,
  }
}

/**
 * Cron tick: find PENDING requests whose cooldownEnd has passed, execute them
 * sequentially. Stops on contract-cooldown revert (lets next tick retry).
 */
export async function runOldInvestorCronTick(app: FastifyInstance): Promise<void> {
  const ready = await app.prisma.oldInvestorRequest.findMany({
    where: {
      status: 'PENDING',
      cooldownEnd: { lte: new Date() },
    },
    orderBy: { cooldownEnd: 'asc' },
    take: 10,
  })

  if (ready.length === 0) return

  for (const r of ready) {
    try {
      await executeOldInvestorRequest(app, r.id, 'CRON')
      app.log.info(
        { requestId: r.id, recipient: r.recipient, micAmount: r.micAmount.toString() },
        'OldInvestor cron executed',
      )
    } catch (e: any) {
      // Most common: contract 24h cooldown on relayer wallet — leave PENDING for next tick
      app.log.warn(
        { requestId: r.id, err: e?.shortMessage || e?.message },
        'OldInvestor cron retry deferred',
      )
      // If the relayer hits per-wallet cooldown, no point trying more rows this tick
      const msg = String(e?.shortMessage || e?.message || '')
      if (msg.includes('cooldown')) break
    }
  }
}

/**
 * Start a setInterval that runs the cron tick every 60s while the API is up.
 * Returns a cleanup function (for tests / graceful shutdown).
 */
export function startOldInvestorCron(app: FastifyInstance, intervalMs = 60_000): () => void {
  let running = false
  const id = setInterval(async () => {
    if (running) return // skip if previous tick is still in flight
    running = true
    try {
      await runOldInvestorCronTick(app)
    } catch (e: any) {
      app.log.error({ err: e }, 'OldInvestor cron tick crashed')
    } finally {
      running = false
    }
  }, intervalMs)
  app.log.info({ intervalMs }, 'OldInvestor cron started')
  return () => clearInterval(id)
}
