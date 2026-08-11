/**
 * On-chain admin writes — server-side relayer for admin actions on
 * StewardCouncil + OperationalSalaryPoolV3 contracts (V3 cutover Jun 23, 2026).
 *
 * Pattern: route handlers call submit*() helpers, which use DEPLOYER_PK
 * to send + wait + return tx receipt. DB write happens AFTER on-chain
 * success — if tx reverts, route returns 502 and DB stays clean.
 *
 * This replaces the previous "DB-first + nextStep" flow that left DB
 * ahead of on-chain when admins skipped the manual MetaMask sign step.
 */
import { JsonRpcProvider, Contract, Wallet } from 'ethers'
import { getActiveAddresses } from '@missionchain/sdk'

const BSC_MAINNET_RPC = 'https://bsc-dataseed.binance.org/'

const STEWARD_COUNCIL_ABI = [
  'function addMember(address wallet, string memberId, string role, string rightLabel, string note) external',
  'function updateMember(address wallet, string role, string rightLabel, string note) external',
  'function setActive(address wallet, bool active) external',
  'function removeMember(address wallet) external',
] as const

const OPERATIONAL_POOL_ABI = [
  'function enrollMember(address wallet, uint16 sharePctBps, uint128 weeklyMaxoutUsdt) external',
  'function updateMember(address wallet, uint16 newSharePctBps, uint128 newWeeklyMaxoutUsdt) external',
  'function removeMember(address wallet) external',
] as const

function getRpcUrl(): string {
  // BSC_RPC_URL points at publicnode, which answers eth_getTransactionReceipt with
  // "Archive requests require a personal token". That breaks confirmation, not sending:
  // on 2026-08-09 a council removeMember went through on-chain and the receipt lookup
  // then failed, so the API reported a failure, skipped the database write, and left the
  // row on a member the contract had already dropped. Prefer the archive-capable key.
  return process.env.INDEXER_RPC_URL || process.env.BSC_RPC_URL || BSC_MAINNET_RPC
}

function getSigner(): Wallet {
  const rawPk = process.env.DEPLOYER_PK?.trim()
  if (!rawPk) throw new Error('DEPLOYER_PK env not set — admin on-chain writes disabled')
  const pk = rawPk.startsWith('0x') ? rawPk : '0x' + rawPk
  const provider = new JsonRpcProvider(getRpcUrl())
  return new Wallet(pk, provider)
}

function councilContract(): Contract {
  const addr = getActiveAddresses().StewardCouncil
  return new Contract(addr, STEWARD_COUNCIL_ABI, getSigner())
}

function operationalPoolContract(): Contract {
  const addr = getActiveAddresses().OperationalSalaryPoolV3
  return new Contract(addr, OPERATIONAL_POOL_ABI, getSigner())
}

export interface TxResult {
  txHash: string
  blockNumber: number
}

async function sendAndWait(
  txPromise: Promise<{ hash: string; wait: (n?: number) => Promise<{ status: number | null; blockNumber: number; hash: string } | null> }>,
): Promise<TxResult> {
  const tx = await txPromise

  // Once the transaction is broadcast the write has happened; only the confirmation is
  // still in doubt. Treating a failed receipt lookup as a failed write is what made a
  // completed removeMember look like an error and left the database out of step with the
  // contract. Carry the hash so the caller can say what was actually sent.
  try {
    const receipt = await tx.wait(1)
    if (!receipt) throw new Error('no receipt')
    if (receipt.status !== 1) {
      const err: any = new Error(`Tx ${tx.hash} reverted on-chain`)
      err.txHash = tx.hash
      err.reverted = true
      throw err
    }
    return { txHash: receipt.hash, blockNumber: Number(receipt.blockNumber) }
  } catch (e: any) {
    if (e?.reverted) throw e
    const err: any = new Error(
      `Tx ${tx.hash} was broadcast but its receipt could not be read: ${e?.shortMessage || e?.message}`,
    )
    err.txHash = tx.hash
    err.unconfirmed = true
    throw err
  }
}

// ─── StewardCouncil ────────────────────────────────────────────────────

export async function submitAddCouncilMember(args: {
  wallet: string
  memberId: string
  role: string
  rightLabel: string
  note: string
}): Promise<TxResult> {
  const c = councilContract()
  return sendAndWait(c.addMember(args.wallet, args.memberId, args.role, args.rightLabel, args.note))
}

export async function submitUpdateCouncilMember(args: {
  wallet: string
  role: string
  rightLabel: string
  note: string
}): Promise<TxResult> {
  const c = councilContract()
  return sendAndWait(c.updateMember(args.wallet, args.role, args.rightLabel, args.note))
}

export async function submitSetCouncilActive(args: {
  wallet: string
  active: boolean
}): Promise<TxResult> {
  const c = councilContract()
  return sendAndWait(c.setActive(args.wallet, args.active))
}

export async function submitRemoveCouncilMember(wallet: string): Promise<TxResult> {
  const c = councilContract()
  return sendAndWait(c.removeMember(wallet))
}

// ─── OperationalSalaryPoolV3 ──────────────────────────────────────────

export async function submitEnrollOperational(args: {
  wallet: string
  sharePctBps: number
  weeklyMaxoutUsdt: number
}): Promise<TxResult> {
  const c = operationalPoolContract()
  // weeklyMaxoutUsdt API value is plain USDT (e.g. 5000), contract expects 1e6 base units (USDT, 18 decimals (BSC-USD))
  const maxoutBaseUnits = BigInt(args.weeklyMaxoutUsdt) * 10n ** 6n
  return sendAndWait(c.enrollMember(args.wallet, args.sharePctBps, maxoutBaseUnits))
}

export async function submitUpdateOperational(args: {
  wallet: string
  newSharePctBps: number
  newWeeklyMaxoutUsdt: number
}): Promise<TxResult> {
  const c = operationalPoolContract()
  const maxoutBaseUnits = BigInt(args.newWeeklyMaxoutUsdt) * 10n ** 6n
  return sendAndWait(c.updateMember(args.wallet, args.newSharePctBps, maxoutBaseUnits))
}

export async function submitRemoveOperational(wallet: string): Promise<TxResult> {
  const c = operationalPoolContract()
  return sendAndWait(c.removeMember(wallet))
}

// ─── Error helper ──────────────────────────────────────────────────────

export function extractRevertReason(e: unknown): string {
  const err = e as { shortMessage?: string; reason?: string; message?: string }
  return err?.shortMessage || err?.reason || err?.message || 'Unknown on-chain error'
}
