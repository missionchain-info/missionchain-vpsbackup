/**
 * Who may take part in DAO Governance, and with what weight.
 *
 * One function, asked everywhere. The point is the phase change: today only Steward Council
 * members vote, and tomorrow MFP-NFT holders and stakers join them at different levels, with
 * the conditions set by the phase-1 Council. If each screen asks "is this wallet on the
 * Council?" in its own way, that change means editing every screen — and the failure mode is
 * silent, because a screen that forgets to update simply keeps letting the wrong people in
 * or out without complaining.
 *
 * So callers never ask about Council membership. They ask this.
 *
 * The threshold is likewise always a SHARE of the eligible set, never a fixed count. A
 * hard-coded "3 approvals" was correct only while the Council had exactly five members; the
 * day a sixth joined it would have quietly become 50%. `approvalsRequired()` is the only
 * place that arithmetic lives.
 */
import type { FastifyInstance } from 'fastify'

/** Governance threshold, in basis points of the eligible population. */
export const THRESHOLD_BPS = 6000

export type EligibilityTier = 'COUNCIL' | 'MFP_HOLDER' | 'STAKER' | 'NONE'

export type Eligibility = {
  wallet: string
  canPropose: boolean
  canVote: boolean
  /** Votes this wallet carries. One member, one vote in phase 1. */
  weight: number
  tier: EligibilityTier
  /** Plain sentence for the UI when someone is not eligible. */
  reason: string
}

const NOT_ELIGIBLE = (wallet: string, reason: string): Eligibility => ({
  wallet,
  canPropose: false,
  canVote: false,
  weight: 0,
  tier: 'NONE',
  reason,
})

/**
 * Phase 1: the Steward Council is the DAO.
 *
 * Phase 2 extends this function — MFP-NFT holders and stakers meeting a duration and amount
 * the Council sets — and nothing that calls it needs to change.
 */
export async function eligibilityOf(app: FastifyInstance, wallet: string): Promise<Eligibility> {
  const w = String(wallet || '').toLowerCase()
  if (!/^0x[0-9a-f]{40}$/.test(w)) {
    return NOT_ELIGIBLE(w, 'Not a wallet address.')
  }

  const member = await app.prisma.stewardCouncilMember.findUnique({ where: { wallet: w } })
  if (!member) {
    return NOT_ELIGIBLE(w, 'Only Steward Council members take part in governance during phase 1.')
  }
  if (!member.active) {
    return NOT_ELIGIBLE(w, 'This Council seat is inactive.')
  }

  return {
    wallet: w,
    canPropose: true,
    canVote: true,
    weight: 1,
    tier: 'COUNCIL',
    reason: 'Active Steward Council member.',
  }
}

/** Size of the eligible population right now — the denominator for every threshold. */
export async function eligibleCount(app: FastifyInstance): Promise<number> {
  return app.prisma.stewardCouncilMember.count({ where: { active: true } })
}

/**
 * Approvals needed to carry a decision.
 *
 * Rounded up, and never below one: a 60% threshold over a single-member Council must still
 * require that member's approval rather than passing on zero votes.
 */
export function approvalsRequired(eligible: number, thresholdBps: number = THRESHOLD_BPS): number {
  if (eligible <= 0) return 0
  return Math.max(1, Math.ceil((eligible * thresholdBps) / 10_000))
}

/** Everyone who may vote — used to show a voter list and to compute turnout. */
export async function eligibleWallets(app: FastifyInstance): Promise<string[]> {
  const rows = await app.prisma.stewardCouncilMember.findMany({
    where: { active: true },
    select: { wallet: true },
  })
  return rows.map((r) => r.wallet.toLowerCase())
}
