/**
 * Reward Engine — shared tier tables.
 *
 * Single source of truth for the rank/weight numbers the engine multiplies money by.
 * Kept in one file on purpose: these values appear in the White Paper, on the NFT
 * artwork and in the contracts, and they must not drift apart again.
 */

// ─── Community Growth Award (GV) ranks — White Paper §B.5.1 ──────────────────
// `rate` is a percentage of group volume. Thresholds are cumulative USDT.

export interface GvRank {
  readonly name: string
  readonly threshold: number // USDT, inclusive lower bound
  readonly rate: number // percent
}

export const GV_RANKS: readonly GvRank[] = [
  { name: 'Believer', threshold: 0, rate: 0 },
  { name: 'Builder', threshold: 5_000, rate: 3 },
  { name: 'Connector', threshold: 20_000, rate: 5 },
  { name: 'Champion', threshold: 50_000, rate: 7 },
  { name: 'Ambassador', threshold: 150_000, rate: 8 },
  { name: 'Legend', threshold: 500_000, rate: 9 },
] as const

/** Highest rank whose threshold the volume reaches. */
export function gvRankFor(totalGvUsdt: number): GvRank {
  let rank = GV_RANKS[0]
  for (const r of GV_RANKS) if (totalGvUsdt >= r.threshold) rank = r
  return rank
}

// ─── NFT weights ─────────────────────────────────────────────────────────────
// Basis points, 10000 = ×1. These MUST match CommunityNFTv2 (multBuilder /
// multMaker / multLuminary) and the Owner-confirmed MFP weight of ×10.
//
// ⚠️ CommunityNFTv2 exposes tierMultiplier() and the admin can change it via
// setMultipliers(). Treat the on-chain value as authoritative: the snapshot step
// reads it from the contract and only falls back to these defaults offline.

export const TIER = { BUILDER: 1, MAKER: 2, LUMINARY: 3 } as const
export type CommunityTier = (typeof TIER)[keyof typeof TIER]

export const DEFAULT_TIER_WEIGHT_BPS: Record<CommunityTier, number> = {
  [TIER.BUILDER]: 10_000, // ×1.0
  [TIER.MAKER]: 25_000, // ×2.5
  [TIER.LUMINARY]: 50_000, // ×5.0
}

/** MFP — Mission Founders Pass. Owner-confirmed ×10 (2026-08-03). */
export const MFP_WEIGHT_BPS = 100_000

// ─── Pool split (NFTRewardPool.communityBps) ─────────────────────────────────
// Weekly 5.5% of gross = Community NFT 5% + MFP 0.5% → community share 9091 bps.
// Monthly 8%  of gross = Community NFT 7.5% + MFP 0.5% → community share 9375 bps.
export const WEEKLY_COMMUNITY_BPS = 9091
export const MONTHLY_COMMUNITY_BPS = 9375
