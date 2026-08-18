/**
 * Reward Engine — Community NFT milestone awards.
 *
 * White Paper §E.6.1.A — COUNT-BASED, and the cycle repeats:
 *
 *     introduce  3 F1 who each bought ≥ $100  →  1 × Builder
 *     introduce  5 F1 who each bought ≥ $100  →  1 × Maker
 *     introduce 10 F1 who each bought ≥ $100  →  1 × Luminary
 *     (counter resets, a new circle restarts)
 *
 * So a full circle of 10 qualifying F1 yields one of each tier, then the counter goes
 * back to zero and the member can earn the set again.
 *
 * ⚠️ This is deliberately NOT volume-based. An earlier draft (and a stale comment in
 * ClaimRewardsV2) described "$2,500 / $5,000 / $10,000 cumulative sales" — that version
 * was rejected on 2026-08-03 because it duplicates the Community Growth Award rank bonus,
 * which already pays NFTs for network *volume*. Milestone rewards *breadth* (how many
 * real people you bring in); rank rewards *depth* (how much volume they generate).
 *
 * Only F1 counts — direct referrals. F2 does not, unlike GV.
 *
 * "Admin-activated": this module only proposes. Minting is irreversible, so an admin
 * approves before `ClaimRewardsV2.mintMilestoneNFT` is ever called.
 */

import { TIER, type CommunityTier } from './tiers'
import { countsTowardGv } from './gv'

/** An F1 must have bought at least this much (cumulative) to count toward a circle. */
export const QUALIFYING_PURCHASE_USDT = 100

export interface Milestone {
  /** Index passed to ClaimRewardsV2.mintMilestoneNFT — must stay 0,1,2. */
  readonly index: 0 | 1 | 2
  /** Qualifying F1 needed within the current circle. */
  readonly requiredF1: number
  readonly tier: CommunityTier
  readonly tierName: string
}

export const MILESTONES: readonly Milestone[] = [
  { index: 0, requiredF1: 3, tier: TIER.BUILDER, tierName: 'Builder' },
  { index: 1, requiredF1: 5, tier: TIER.MAKER, tierName: 'Maker' },
  { index: 2, requiredF1: 10, tier: TIER.LUMINARY, tierName: 'Luminary' },
] as const

/** Completing this many qualifying F1 closes one circle and resets the counter. */
export const CIRCLE_SIZE = MILESTONES[MILESTONES.length - 1].requiredF1 // 10

/** A purchase as indexed from chain. Only PRESALE/MICE count — same rule as GV. */
export interface SaleRow {
  buyer: string
  /** PRESALE | MICE | SEED — SEED is ignored. */
  type: string
  /** USDT amount. For MICE this is the USDT half only. */
  usdtAmount: number
}

export interface MilestoneEarned {
  milestone: Milestone
  /** How many times this tier has been earned across all completed + current circles. */
  timesEarned: number
}

export interface MilestoneProposal {
  wallet: string
  /** Direct referrals who each reached the $100 threshold. */
  qualifyingF1: number
  /** Fully completed circles of 10. */
  completedCircles: number
  /** Tiers earned but not yet minted, expanded one entry per NFT owed. */
  pending: Milestone[]
}

/**
 * Count each wallet's F1 referrals who have bought at least $100 in total.
 *
 * Cumulative per person, not per transaction: someone who buys $60 twice has invested
 * $120 and counts, which matches how a member would describe "I brought in a buyer".
 *
 * @param referrerOf wallet → its referrer.
 * @param sales      every indexed purchase.
 */
export function qualifyingF1Counts(
  referrerOf: Map<string, string | null>,
  sales: SaleRow[],
): Map<string, number> {
  // Roll purchases up per buyer first, so the $100 bar applies to the person.
  const spentByBuyer = new Map<string, number>()
  for (const s of sales) {
    if (!countsTowardGv(s.type)) continue // SEED excluded
    if (!(s.usdtAmount > 0)) continue
    spentByBuyer.set(s.buyer, (spentByBuyer.get(s.buyer) ?? 0) + s.usdtAmount)
  }

  const counts = new Map<string, number>()
  for (const [buyer, spent] of spentByBuyer) {
    if (spent < QUALIFYING_PURCHASE_USDT) continue
    const f1Upline = referrerOf.get(buyer) ?? null
    if (!f1Upline || f1Upline === buyer) continue
    counts.set(f1Upline, (counts.get(f1Upline) ?? 0) + 1)
  }
  return counts
}

/**
 * How many times each tier has been earned for a given qualifying-F1 count.
 *
 * Every completed circle of 10 grants all three tiers once. Progress inside the current
 * circle grants whichever thresholds it has passed.
 */
export function milestonesEarned(qualifyingF1: number): MilestoneEarned[] {
  const completed = Math.floor(qualifyingF1 / CIRCLE_SIZE)
  const inCircle = qualifyingF1 % CIRCLE_SIZE
  return MILESTONES.map((m) => ({
    milestone: m,
    timesEarned: completed + (inCircle >= m.requiredF1 ? 1 : 0),
  })).filter((e) => e.timesEarned > 0)
}

/**
 * Propose milestone NFTs that are earned but not yet minted.
 *
 * @param counts       wallet → qualifying F1 count (from qualifyingF1Counts).
 * @param alreadyMinted wallet → milestone index → how many already minted on-chain.
 *                      Comes from the ledger; this is what makes reruns safe.
 */
export function proposeMilestones(
  counts: Map<string, number>,
  alreadyMinted: Map<string, Map<number, number>> = new Map(),
): MilestoneProposal[] {
  const out: MilestoneProposal[] = []

  for (const [wallet, qualifyingF1] of counts) {
    const minted = alreadyMinted.get(wallet) ?? new Map<number, number>()
    const pending: Milestone[] = []

    for (const { milestone, timesEarned } of milestonesEarned(qualifyingF1)) {
      const owed = timesEarned - (minted.get(milestone.index) ?? 0)
      for (let i = 0; i < owed; i++) pending.push(milestone)
    }

    if (pending.length > 0) {
      out.push({
        wallet,
        qualifyingF1,
        completedCircles: Math.floor(qualifyingF1 / CIRCLE_SIZE),
        pending,
      })
    }
  }

  // Deterministic order so the same inputs always produce the same approval list.
  return out.sort((a, b) => (a.wallet < b.wallet ? -1 : a.wallet > b.wallet ? 1 : 0))
}
