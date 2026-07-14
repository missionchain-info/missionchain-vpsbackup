/**
 * Mission Chain API — Shared Request/Response Types
 */

// ─── Auth ────────────────────────────────────────────────────────────

export interface CheckUserIdQuery {
  userId: string
}

export interface CheckUserIdResponse {
  available: boolean
}

export interface CheckReferrerQuery {
  ref: string
}

export interface CheckReferrerResponse {
  valid: boolean
  name?: string
}

export interface RegisterBody {
  wallet: string
  userId: string
  referrer?: string
  termsAccepted: boolean
}

export interface RegisterResponse {
  success: boolean
  nonce: string
}

export interface NonceQuery {
  wallet: string
}

export interface NonceResponse {
  nonce: string
}

export interface VerifyBody {
  wallet: string
  signature: string
}

export interface VerifyResponse {
  jwt: string
  user: {
    id: string
    userId: string
    wallet: string
  }
}

// ─── Token / Wallet ──────────────────────────────────────────────────

export interface TokenBalanceResponse {
  balance: string
  locked: string
  available: string
}

// ─── Staking ─────────────────────────────────────────────────────────

export interface StakeInfoResponse {
  stakeId: number
  amount: string
  weightedAmount: string
  tier: string
  lockPeriod: number
  startTime: number
  unlockTime: number
  active: boolean
}

// ─── Mining ──────────────────────────────────────────────────────────

export interface MiningInfoResponse {
  pending: string
  hindex: string
  dailyEmission: string
  activeMice: number
}

// ─── Referral ────────────────────────────────────────────────────────

export interface ReferralInfoResponse {
  referrer: string | null
  f1Count: number
  f2Count: number
  gvTotal: string
  gvRank: string
}

// ─── DAO ─────────────────────────────────────────────────────────────

export interface ProposalInfoResponse {
  proposalId: number
  proposer: string
  title: string
  description: string
  category: string
  status: string
  forVotes: string
  againstVotes: string
  createdAt: string
  expiresAt: string
  executedAt: string | null
}

// ─── NFT Holdings ────────────────────────────────────────────────────

export interface NFTHoldingsResponse {
  mfp: number
  community: {
    builder: number
    maker: number
    luminary: number
  }
}

// ─── MICE ────────────────────────────────────────────────────────────

export interface MICEInfoResponse {
  totalSold: number
  currentRound: number
  currentPrice: number
  maxSupply: number
}

// ─── Sales ───────────────────────────────────────────────────────────

export interface SaleInfoResponse {
  seed: {
    raised: string
    remaining: string
  }
  preSale: {
    raised: string
    remaining: string
  }
}

// ─── Emission ────────────────────────────────────────────────────────

export interface EmissionInfoResponse {
  currentRate: string
  totalEmitted: string
  daysSinceStart: number
  poolRemaining: string
}

// ─── Health ──────────────────────────────────────────────────────────

export interface HealthResponse {
  status: 'ok' | 'degraded'
  timestamp: number
  services: {
    database: boolean
    blockchain: boolean
  }
}

// ─── Error ───────────────────────────────────────────────────────────

export interface ErrorResponse {
  message: string
  statusCode?: number
}
