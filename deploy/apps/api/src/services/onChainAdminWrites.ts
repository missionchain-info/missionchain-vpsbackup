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
import { buildSignerProvider } from './blockchain.js'

const BSC_MAINNET_RPC = 'https://bsc-dataseed.binance.org/'

const STEWARD_COUNCIL_ABI = [
  'function addMember(address wallet, string memberId, string role, string rightLabel, string note) external',
  'function updateMember(address wallet, string role, string rightLabel, string note) external',
  'function setActive(address wallet, bool active) external',
  'function removeMember(address wallet) external',
] as const

const STEWARD_COUNCIL_READ_ABI = [
  'function getActiveMembers() view returns (address[])',
] as const

const DAO_GOVERNOR_ABI = [
  'function setTemporaryMembers(address[5] members) external',
  'function daoActive() view returns (bool)',
  'function btcMembers(uint256) view returns (address)',
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
  const provider = buildSignerProvider()
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

// ─── DAOGovernor seat sync ────────────────────────────────────────────
//
// StewardCouncil and DAOGovernor keep SEPARATE member lists. The admin console only ever
// wrote to StewardCouncil, so on 2026-08-11 the council held 5 members while DAOGovernor
// had never granted BTC_MEMBER_ROLE to anyone -- 0 of 5. Meanwhile the API told the
// frontend that governance was "3 of 5 votes, one vote per member". Any proposal raised
// then could never have reached quorum, because nobody was eligible to vote.
//
// This makes StewardCouncil the single list the Owner maintains, and mirrors it down.
//
// It is deliberately a Phase 1 bridge. DAOGovernor will later be constituted in its own
// right, with its own rules and a seat count that is not 5, and StewardCouncil stands down
// then. That handover is the Owner's decision, announced by the Owner -- nothing here
// infers it and nothing here should act as though it can. The only thing this code reads
// is `daoActive`, which is a flag the Owner has already flipped on chain, and its answer
// to that flag is to stop, not to adapt.
//
// So: fail loudly and do nothing, rather than half-apply, whenever the shapes stop
// matching what Phase 1 assumed.

export type GovernorSyncResult =
  | { synced: true; txHash: string; members: string[] }
  | { synced: false; reason: string }

/**
 * Mirror the current StewardCouncil seats into DAOGovernor.
 *
 * Never throws: a council write that already succeeded must not be reported as a failure
 * because the mirror could not follow. The caller surfaces `reason` instead.
 */
export async function syncDaoGovernorSeats(): Promise<GovernorSyncResult> {
  try {
    const A = getActiveAddresses() as Record<string, string>
    const signer = getSigner()

    if (!A.DAOGovernor || !A.StewardCouncil) {
      return { synced: false, reason: 'DAOGovernor or StewardCouncil is not deployed on this network.' }
    }

    const governor = new Contract(A.DAOGovernor, DAO_GOVERNOR_ABI, signer)

    // Phase 2 revokes the Owner's admin role, so setTemporaryMembers reverts by design.
    if (await governor.daoActive()) {
      return {
        synced: false,
        reason: 'DAOGovernor has transitioned to DAO mode — seats can now only change through a governance vote.',
      }
    }

    const council = new Contract(A.StewardCouncil, STEWARD_COUNCIL_READ_ABI, signer)
    const seats = ((await council.getActiveMembers()) as string[]).map((a) => a.toLowerCase())

    // setTemporaryMembers takes address[5] exactly -- it cannot express four or six.
    if (seats.length !== 5) {
      return {
        synced: false,
        reason: `DAOGovernor needs exactly 5 seats and the council currently has ${seats.length}. `
          + 'Governance voting stays closed until the council is back to 5.',
      }
    }

    // Skip a pointless transaction when the two lists already agree.
    const current: string[] = []
    for (let i = 0; i < 5; i++) current.push(String(await governor.btcMembers(i)).toLowerCase())
    if (current.join(',') === seats.join(',')) {
      return { synced: false, reason: 'DAOGovernor already holds these 5 seats — nothing to send.' }
    }

    const result = await sendAndWait(governor.setTemporaryMembers(seats))
    return { synced: true, txHash: result.txHash, members: seats }
  } catch (e: any) {
    return {
      synced: false,
      reason: `Could not mirror the seats into DAOGovernor: ${e?.shortMessage || e?.message || 'unknown error'}`,
    }
  }
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
