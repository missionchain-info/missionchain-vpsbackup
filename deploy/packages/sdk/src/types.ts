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

export type NFTTier = 'MFP' | 'Platinum' | 'Gold' | 'Silver' | 'None'
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
  roiRegulator: number
}

// NFT Tier multipliers
export const NFT_MULTIPLIERS: Record<NFTTier, number> = {
  MFP: 10,
  Platinum: 5,
  Gold: 2.5,
  Silver: 1,
  None: 0.5,
}

// Lock period multipliers
export const LOCK_MULTIPLIERS: Record<LockPeriod, number> = {
  30: 1,
  90: 1.25,
  180: 1.5,
  360: 2,
}
