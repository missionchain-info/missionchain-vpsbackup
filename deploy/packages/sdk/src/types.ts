// Shared TypeScript types for MissionChain

export interface User {
  id: string
  userId: string
  wallet: string
  referrer?: string
  kycStatus: 'none' | 'pending' | 'approved' | 'rejected'
  createdAt: string
}

export interface MICELicense {
  tokenId: bigint
  owner: string
  purchaseDate: number
  expiryDate: number
  price: bigint
  active: boolean
}

export interface StakingPosition {
  id: bigint
  staker: string
  amount: bigint
  nftTier: NFTTier
  lockPeriod: LockPeriod
  startTime: number
  effectiveWeight: bigint
}

export type NFTTier = 'MFP' | 'Luminary' | 'Maker' | 'Builder' | 'None'
export type LockPeriod = 30 | 90 | 180 | 360

export interface VestingSchedule {
  id: string
  category: string
  totalAmount: bigint
  claimed: bigint
  claimable: bigint
  nextUnlock: number
  monthlyRate: number
}

export interface ReferralInfo {
  code: string
  f1Count: number
  f2Count: number
  totalEarnings: bigint
  pendingEarnings: bigint
}

export interface EmissionData {
  currentRate: bigint
  totalEmitted: bigint
  poolRemaining: bigint
  daysSinceLaunch: number
  demandFactor: number
  /** Coverage regulator L(H). Replaced the ROI regulator on 2026-08-05. */
  coverageFactor: number
  /** Liquidity coverage H, in days. Target 110. */
  coverageDays: number
  /** Trend damper G — capped at 1.0, so it can only slow issuance. */
  trendFactor: number
  /** Adoption factor A(N) = min(1, sqrt(N / 10,000)). */
  adoptionFactor: number
  /** True while the 50%-of-P0 brake holds L(H) at its floor. */
  brakeEngaged: boolean
}

// NFT tier multipliers were removed here in 2026-08. Nothing applies an NFT
// multiplier on-chain: MICStaking weights by time-lock alone. Reward-pool weighting
// is off-chain policy and lives with the reward engine, not in shared types.

// Lock period multipliers
export const LOCK_MULTIPLIERS: Record<LockPeriod, number> = {
  30: 1,
  90: 1.25,
  180: 1.5,
  360: 2,
}
