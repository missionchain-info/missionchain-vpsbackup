import { JsonRpcProvider, Contract, ZeroAddress, id } from 'ethers'
import { getActiveAddresses } from '@missionchain/sdk'

/**
 * Three-way reconciliation of the Steward Council.
 *
 * The council exists in three places and they are not the same thing:
 *
 *   1. `stewardCouncilMember` (database) — what the admin console and the member app show.
 *   2. `StewardCouncil` contract        — identity and active flag, on chain.
 *   3. `DAOGovernor` BTC_MEMBER_ROLE    — who may actually call `propose()` and vote.
 *
 * (1) and (2) are kept in step already: POST /admin/steward-council writes the contract
 * first and aborts if it reverts. (3) is the one nothing has ever written — on 2026-08-10
 * all five DAOGovernor seats held the zero address while four council members sat in the
 * other two lists, so the Proposals tab had no one who could raise a proposal.
 *
 * This module only READS. Seating DAOGovernor is `setTemporaryMembers`, which replaces all
 * five seats at once and rejects the zero address — not something to fire automatically off
 * an admin click. It belongs in `scripts/set-dao-btc-members.ts`, run deliberately.
 */

const COUNCIL_ABI = [
  'function getActiveMembers() view returns (address[])',
  'function memberCount() view returns (uint256)',
  'function members(address) view returns (string memberId, string role, string rightLabel, string note, bool active)',
]

const GOVERNOR_ABI = [
  'function hasRole(bytes32,address) view returns (bool)',
  'function daoActive() view returns (bool)',
  'function btcMembers(uint256) view returns (address)',
  'function proposalCount() view returns (uint256)',
]

const BTC_MEMBER_ROLE = id('BTC_MEMBER')
const SEAT_COUNT = 5

export interface CouncilRow {
  wallet: string
  memberId: string | null
  role: string | null
  inDatabase: boolean
  dbActive: boolean
  onCouncilContract: boolean
  councilActive: boolean
  canPropose: boolean
  /** Empty when the three sources agree for this wallet. */
  issues: string[]
}

export interface CouncilReconciliation {
  rows: CouncilRow[]
  governor: {
    address: string
    daoActive: boolean
    proposalCount: number
    seats: string[]
    filledSeats: number
    seatCount: number
  }
  councilContract: { address: string; activeMembers: number; totalMembers: number }
  /** Highest-severity summary, for the banner. */
  status: 'ok' | 'drift' | 'blocked'
  headline: string
}

export async function reconcileCouncil(
  provider: JsonRpcProvider,
  dbMembers: Array<{ wallet: string; memberId: string; role: string; active: boolean }>
): Promise<CouncilReconciliation> {
  const A: any = getActiveAddresses()
  const council = new Contract(A.StewardCouncil, COUNCIL_ABI, provider)
  const gov = new Contract(A.DAOGovernor, GOVERNOR_ABI, provider)

  const [activeOnChain, totalOnChain, daoActive, proposalCount] = await Promise.all([
    council.getActiveMembers() as Promise<string[]>,
    council.memberCount() as Promise<bigint>,
    gov.daoActive() as Promise<boolean>,
    gov.proposalCount().catch(() => 0n) as Promise<bigint>,
  ])

  const seats: string[] = []
  for (let i = 0; i < SEAT_COUNT; i++) {
    seats.push(await (gov.btcMembers(i) as Promise<string>).catch(() => ZeroAddress))
  }

  const activeSet = new Set(activeOnChain.map((w) => w.toLowerCase()))
  const dbByWallet = new Map(dbMembers.map((m) => [m.wallet.toLowerCase(), m]))

  // Every wallet mentioned anywhere — a wallet seated on the governor but absent from the
  // council is just as much a mismatch as the reverse, and only a union catches both.
  const all = new Set<string>([
    ...dbByWallet.keys(),
    ...activeSet,
    ...seats.filter((s) => s !== ZeroAddress).map((s) => s.toLowerCase()),
  ])

  const rows: CouncilRow[] = []
  for (const w of all) {
    const db = dbByWallet.get(w)
    const onCouncil = activeSet.has(w) || (await council.members(w).then((m: any) => !!m.memberId).catch(() => false))
    const councilActive = activeSet.has(w)
    const canPropose = await (gov.hasRole(BTC_MEMBER_ROLE, w) as Promise<boolean>).catch(() => false)

    const issues: string[] = []
    if (db?.active && !councilActive) issues.push('Có trong hệ thống nhưng KHÔNG hoạt động trên StewardCouncil')
    if (!db && councilActive) issues.push('Đang hoạt động trên chain nhưng KHÔNG có trong hệ thống')
    if (councilActive && !canPropose) issues.push('Là thành viên Council nhưng KHÔNG đề xuất được (thiếu ghế DAOGovernor)')
    if (canPropose && !councilActive) issues.push('Đề xuất được nhưng KHÔNG còn là thành viên Council đang hoạt động')

    rows.push({
      wallet: w,
      memberId: db?.memberId ?? null,
      role: db?.role ?? null,
      inDatabase: !!db,
      dbActive: !!db?.active,
      onCouncilContract: onCouncil,
      councilActive,
      canPropose,
      issues,
    })
  }
  rows.sort((a, b) => b.issues.length - a.issues.length || (a.memberId ?? '').localeCompare(b.memberId ?? ''))

  const filledSeats = seats.filter((s) => s !== ZeroAddress).length
  const noneCanPropose = rows.every((r) => !r.canPropose)

  let status: CouncilReconciliation['status'] = 'ok'
  let headline = 'Ba nguồn khớp nhau.'
  if (noneCanPropose) {
    status = 'blocked'
    headline =
      'Không ai đề xuất được. Cả 5 ghế DAOGovernor đang trống — thành viên Council không gọi được propose(). ' +
      'Chạy scripts/set-dao-btc-members.ts để cấp ghế.'
  } else if (rows.some((r) => r.issues.length > 0)) {
    status = 'drift'
    headline = 'Có sai lệch giữa hệ thống, StewardCouncil và DAOGovernor — xem cột Vấn đề.'
  }

  return {
    rows,
    governor: {
      address: A.DAOGovernor,
      daoActive,
      proposalCount: Number(proposalCount),
      seats,
      filledSeats,
      seatCount: SEAT_COUNT,
    },
    councilContract: {
      address: A.StewardCouncil,
      activeMembers: activeOnChain.length,
      totalMembers: Number(totalOnChain),
    },
    status,
    headline,
  }
}
