/**
 * Founders & Management relayer — server-side wallet that signs distributeFounder() txs
 * on behalf of pending FounderRequest rows after their 48h cooldown elapses,
 * or immediately when Owner clicks "Execute Now".
 *
 * Mirror of oldInvestorRelayer.ts; pool = 280M MIC; vesting = 24m cliff + 10% + 2.5%/m
 * (handled inside FoundersVault.distributeFounder).
 */
import { JsonRpcProvider, Contract, Wallet, parseUnits } from 'ethers'
import type { FastifyInstance } from 'fastify'
import { getActiveAddresses } from '@missionchain/sdk'

const BSC_MAINNET_RPC = 'https://bsc-dataseed.binance.org/'

// FoundersVault — 280M MIC + 1,250 MFP cap (mainnet 2026-05-06)
const FOUNDERS_VAULT_ADDRESS = getActiveAddresses().FoundersVault

const FOUNDERS_VAULT_ABI = [
  'function distributeFounder(address recipient, uint256 micAmount, uint256 mfpCount, string role)',
  'function totalMicDistributed() view returns (uint256)',
  'function FOUNDERS_ALLOCATION() view returns (uint256)',
  'function micDistributedTo(address) view returns (uint256)',
] as const

function getRpcUrl(): string {
  return process.env.BSC_RPC_URL || BSC_MAINNET_RPC
}

export function getFounderRelayerSigner(): { wallet: Wallet; provider: JsonRpcProvider } | null {
  const rawPk = process.env.DEPLOYER_PK?.trim()
  if (!rawPk) return null
  const pk = rawPk.startsWith('0x') ? rawPk : '0x' + rawPk
  const provider = new JsonRpcProvider(getRpcUrl())
  const wallet = new Wallet(pk, provider)
  return { wallet, provider }
}

export async function executeFounderRequest(
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
  const row = await app.prisma.founderRequest.findUnique({ where: { id: requestId } })
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

  const signer = getFounderRelayerSigner()
  if (!signer) throw new Error('Relayer wallet not configured (DEPLOYER_PK missing)')
  const vault = new Contract(FOUNDERS_VAULT_ADDRESS, FOUNDERS_VAULT_ABI, signer.wallet)

  const recipient = row.recipient
  const micAmountWei = parseUnits(row.micAmount.toString(), 18)
  // mfpCount = 0 (Founders MFP grants are handled separately via Grant Mint, per anh's spec)
  const role = row.role || 'Founder'

  let txHash: string | null = null
  let blockNumber: number | null = null
  try {
    const tx = await vault.distributeFounder(recipient, micAmountWei, 0n, role)
    const receipt = await tx.wait(2)
    if (!receipt || receipt.status !== 1) {
      throw new Error('Transaction reverted on-chain')
    }
    txHash = receipt.hash
    blockNumber = Number(receipt.blockNumber || 0)
  } catch (e: any) {
    const errMsg = e?.shortMessage || e?.reason || e?.message || 'Unknown error'
    await app.prisma.founderRequest.update({
      where: { id: requestId },
      data: { executeError: String(errMsg).slice(0, 500) },
    })
    throw e
  }

  const updated = await app.prisma.founderRequest.update({
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

export async function runFounderCronTick(app: FastifyInstance): Promise<void> {
  const ready = await app.prisma.founderRequest.findMany({
    where: { status: 'PENDING', cooldownEnd: { lte: new Date() } },
    orderBy: { cooldownEnd: 'asc' },
    take: 10,
  })
  if (ready.length === 0) return

  for (const r of ready) {
    try {
      await executeFounderRequest(app, r.id, 'CRON')
      app.log.info(
        { requestId: r.id, recipient: r.recipient, micAmount: r.micAmount.toString() },
        'Founder cron executed',
      )
    } catch (e: any) {
      app.log.warn(
        { requestId: r.id, err: e?.shortMessage || e?.message },
        'Founder cron retry deferred',
      )
    }
  }
}

export function startFounderCron(app: FastifyInstance, intervalMs = 60_000): () => void {
  let running = false
  const id = setInterval(async () => {
    if (running) return
    running = true
    try {
      await runFounderCronTick(app)
    } catch (e: any) {
      app.log.error({ err: e }, 'Founder cron tick crashed')
    } finally {
      running = false
    }
  }, intervalMs)
  app.log.info({ intervalMs }, 'Founder cron started')
  return () => clearInterval(id)
}
