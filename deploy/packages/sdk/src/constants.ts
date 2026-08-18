/**
 * MissionChain SDK — Shared Constants
 *
 * All BigInt values use 18-decimal MIC precision (or 6-decimal USDT where noted).
 * Source of truth: missionchain/deploy master docs + approved business decisions.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Token Supply (18-dec)
// ─────────────────────────────────────────────────────────────────────────────

export const TOTAL_SUPPLY  = 7_000_000_000n * 10n ** 18n;  // 7B MIC hard cap
export const PRE_ISSUED    = 1_050_000_000n * 10n ** 18n;  // 15% pre-minted
export const MINING_POOL   = 5_950_000_000n * 10n ** 18n;  // 85% progressive emission

// ─────────────────────────────────────────────────────────────────────────────
// Decimals
// ─────────────────────────────────────────────────────────────────────────────

export const MIC_DECIMALS  = 18;

/**
 * BSC-USD (`0x55d398326f99059fF775485246999027B3197955`) is an **18-decimal** token.
 *
 * It is not the 6-decimal USDT familiar from Ethereum, and this constant said `6` until
 * 2026-08-08. Everything downstream inherited the error: prices were built with
 * `parseUnits(x, 6)`, so a $500 listing asked for 0.0000000005 USDT, and balances were
 * read with `formatUnits(x, 6)`, so every dollar figure on the dashboard was off by a
 * factor of a trillion. On-chain it was worse — `PreSale` would have sold its entire
 * 315,000,000 MIC allocation for 0.000001575 USDT, and the live `SeedSaleV7` had to be
 * halted on mainnet the same day.
 *
 * Always use this constant. Never write the digit.
 */
export const USDT_DECIMALS = 18;

// ─────────────────────────────────────────────────────────────────────────────
// Sale Prices — USDT units per 1 MIC, at USDT_DECIMALS
// ─────────────────────────────────────────────────────────────────────────────

/** $0.0025 per MIC — SEED Round price */
export const SEED_PRICE    = 2_500_000_000_000_000n;
/** $0.005 per MIC — Pre-Sale price */
export const PRESALE_PRICE = 5_000_000_000_000_000n;
/** $0.01 per MIC — DEX/CEX listing reference price in USDT 6-dec units */
export const LISTING_PRICE = 10000n;

// ─────────────────────────────────────────────────────────────────────────────
// Pre-Issued Allocations (18-dec)
// ─────────────────────────────────────────────────────────────────────────────

export const ALLOC_SEED_ROUND    =  227_500_000n * 10n ** 18n;  // 3.25% (75M Strategic Partner Grant + 152.5M Public Sale)
export const ALLOC_SEED_PUBLIC   =  152_500_000n * 10n ** 18n;  // Public Sale only (SeedSale.sol ALLOCATION); $381,250 cap @ $0.0025
export const ALLOC_SEED_GRANT    =   75_000_000n * 10n ** 18n;  // Strategic Partner Grant — admin-issued, NOT for sale
export const ALLOC_PRESALE       =  315_000_000n * 10n ** 18n;  // 4.50%
export const ALLOC_DEX_LISTING   =  105_000_000n * 10n ** 18n;  // 1.50%
export const ALLOC_FOUNDERS      =  280_000_000n * 10n ** 18n;  // 4.00%
export const ALLOC_COMMUNITY     =  105_000_000n * 10n ** 18n;  // 1.50%
export const ALLOC_AIRDROPS      =   17_500_000n * 10n ** 18n;  // 0.25%

// Mining emission split (BPS out of 10000)
export const EMISSION_BPS_MINERS    = 6000; // 60% → MiningPool
export const EMISSION_BPS_STAKING   = 2500; // 25% → MIC Staking
export const EMISSION_BPS_DAO       = 1000; // 10% → DAO Treasury
export const EMISSION_BPS_COMMUNITY =  500; //  5% → Community NFT Reward Pool

// ─────────────────────────────────────────────────────────────────────────────
// Vesting Schedules
// ─────────────────────────────────────────────────────────────────────────────

const SECONDS_PER_DAY = 86400;

export const VESTING = {
  /** SEED Round: 6-month cliff → 10% unlock → 2.5%/month */
  SEED: {
    cliff:      180 * SECONDS_PER_DAY,
    cliffBps:   1000,  // 10%
    monthlyBps: 250,   // 2.5%
  },
  /** Pre-Sale: 6-month cliff → 10% unlock → 2.5%/month */
  PRESALE: {
    cliff:      180 * SECONDS_PER_DAY,
    cliffBps:   1000,
    monthlyBps: 250,
  },
  /** Founders & Mgmt: 24-month cliff → 10% unlock → 2.5%/month */
  FOUNDERS: {
    cliff:      720 * SECONDS_PER_DAY,
    cliffBps:   1000,
    monthlyBps: 250,
  },
  /** Community Funds (+Churches): 24-month cliff → 10% unlock → 2.5%/month */
  COMMUNITY: {
    cliff:      720 * SECONDS_PER_DAY,
    cliffBps:   1000,
    monthlyBps: 250,    // 2.5%
  },
  /** Incentives & Airdrops: 6-month cliff → 10% unlock → 2.5%/month */
  AIRDROPS: {
    cliff:      180 * SECONDS_PER_DAY,
    cliffBps:   1000,
    monthlyBps: 250,
  },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Emission Engine
// ─────────────────────────────────────────────────────────────────────────────

/** Initial daily emission: E₀ ≈ 22,907,500 MIC/day (18-dec) */
export const E0_DAILY     = 22_907_500n * 10n ** 18n;
/** Half-life: 180 days */
export const HALF_LIFE_DAYS = 180;
/** WarmUp period: 30 days */
export const WARMUP_DAYS    = 30;

// ─────────────────────────────────────────────────────────────────────────────
// MICE License
// ─────────────────────────────────────────────────────────────────────────────

export const MICE_MAX_SUPPLY    = 100_000;
export const MICE_DURATION_DAYS = 360;
export const MICE_ROUNDS_COUNT  = 5;
export const MICE_PER_ROUND     = 20_000;

/** MICE pricing per round — price in USD (as integer cents × 100) */
export const MICE_ROUND_PRICES_USD = [100, 200, 300, 400, 500] as const;

/** MICE revenue split (BPS out of 10000) — 50% MIC burned + 50% USDT to RevenueRouter */
export const MICE_MIC_BURN_BPS  = 5000; // 50%
export const MICE_USDT_ROUTE_BPS = 5000; // 50%

// ─────────────────────────────────────────────────────────────────────────────
// ARCHITECTURE CHANGE (April 2026): Staking & NFT Are Now Completely Separate
// ─────────────────────────────────────────────────────────────────────────────
//
// MICStaking System:
// - Pure MIC staking (NO NFT involvement)
// - Anyone stakes any amount
// - Reward multiplier = time-lock only (30d=1×, 90d=1.25×, 180d=1.5×, 360d=2×)
// - Locked MIC can stake (full rate, rewards unlocked, min 360d lock)
// - NO tier caps
//
// NFT System (now separate):
// - Multipliers ONLY for USDT reward distribution (Weekly, Monthly, Lucky Draw)
// - NOT used in MICStaking contract
// - Tiers still exist for reward distribution purposes only
//
// DAO (MFP-NFT only):
// - MFP-NFT + 100K staked MIC + lock ≥360d required for DAO voting
//
// Legacy constants kept for reference and reward distribution logic only.
// ─────────────────────────────────────────────────────────────────────────────

/** @deprecated NFT multipliers no longer used in staking. Only for reward distribution. */
// NFT_MULTIPLIER was removed in 2026-08 — deprecated, no importers, and no
// on-chain code applies an NFT multiplier.

/** @deprecated Staking caps no longer enforced. MICStaking has no tier-based caps. */
export const NFT_STAKING_CAP = {
  BUILDER:  10_000n * 10n ** 18n,    // (DEPRECATED — no longer enforced in MICStaking)
  MAKER:    25_000n * 10n ** 18n,    // (DEPRECATED — no longer enforced in MICStaking)
  LUMINARY: 50_000n * 10n ** 18n,    // (DEPRECATED — no longer enforced in MICStaking)
  MFP:     100_000n * 10n ** 18n,    // (DEPRECATED — no longer enforced in MICStaking)
} as const;

/** Time-lock multipliers (BPS) */
export const TIMELOCK_MULTIPLIER = {
  DAYS_30:  10000, // ×1.0
  DAYS_90:  12500, // ×1.25
  DAYS_180: 15000, // ×1.5
  DAYS_360: 20000, // ×2.0
} as const;

/**
 * Locked MIC Staking Requirements
 * When useLockedMic = true (staking vesting/locked tokens):
 * - Minimum stake lock period: 360 days (same as vesting semantics)
 * - Full time-lock multiplier applied (no reduction) — no NFT multiplier involved
 * - Rewards are unlocked and freely transferable
 * - NFT SYSTEM COMPLETELY SEPARATE: no NFT involvement in staking
 */
export const LOCKED_MIC_MIN_LOCK_DAYS = 360;

// ─────────────────────────────────────────────────────────────────────────────
// Referral Program
// ─────────────────────────────────────────────────────────────────────────────

/** F1 referral: 7% of USDT — Pre-Sale & MICE only */
export const REFERRAL_F1_BPS = 700;
/** F2 referral: 3% of USDT */
export const REFERRAL_F2_BPS = 300;

// ─────────────────────────────────────────────────────────────────────────────
// Chain IDs
// ─────────────────────────────────────────────────────────────────────────────

// Mainnet-only as of 2026-05-06; testnet constant removed.
export const CHAINS = {
  BSC_MAINNET: 56,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Legacy env-var contract addresses (kept for backward compatibility)
// Prefer ADDRESSES from addresses.ts for typed access.
// ─────────────────────────────────────────────────────────────────────────────

export const CONTRACTS = {
  MIC_TOKEN:          process.env.NEXT_PUBLIC_MIC_TOKEN           || "0x0000000000000000000000000000000000000000",
  MICE_LICENSE:       process.env.NEXT_PUBLIC_MICE_LICENSE        || "0x0000000000000000000000000000000000000000",
  MFP_NFT:            process.env.NEXT_PUBLIC_MFP_NFT             || "0x0000000000000000000000000000000000000000",
  COMMUNITY_NFT:      process.env.NEXT_PUBLIC_COMMUNITY_NFT       || "0x0000000000000000000000000000000000000000",
  STAKING:            process.env.NEXT_PUBLIC_STAKING             || "0x0000000000000000000000000000000000000000",
  SEED_SALE:          process.env.NEXT_PUBLIC_SEED_SALE           || "0x0000000000000000000000000000000000000000",
  PRESALE:            process.env.NEXT_PUBLIC_PRESALE             || "0x0000000000000000000000000000000000000000",
  EMISSION:           process.env.NEXT_PUBLIC_EMISSION            || "0x0000000000000000000000000000000000000000",
  LOCK_MANAGER:       process.env.NEXT_PUBLIC_LOCK_MANAGER        || "0x0000000000000000000000000000000000000000",
  GOVERNANCE:         process.env.NEXT_PUBLIC_GOVERNANCE          || "0x0000000000000000000000000000000000000000",
  TREASURY:           process.env.NEXT_PUBLIC_TREASURY            || "0x0000000000000000000000000000000000000000",
  REVENUE_ROUTER:     process.env.NEXT_PUBLIC_REVENUE_ROUTER      || "0x0000000000000000000000000000000000000000",
  REWARD_DISTRIBUTOR: process.env.NEXT_PUBLIC_REWARD_DISTRIBUTOR  || "0x0000000000000000000000000000000000000000",
  LIQUIDITY_POOL:     process.env.NEXT_PUBLIC_LIQUIDITY_POOL      || "0x0000000000000000000000000000000000000000",
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Legacy numeric tokenomics (kept for backward compatibility)
// Prefer typed BigInt constants above for on-chain use.
// ─────────────────────────────────────────────────────────────────────────────

/** @deprecated Use TOTAL_SUPPLY (BigInt) for on-chain math */
export const TOKENOMICS = {
  TOTAL_SUPPLY:       7_000_000_000,
  PRE_ISSUED:         1_050_000_000,
  MINING_POOL:        5_950_000_000,
  SEED_PRICE:         0.0025,
  PRESALE_PRICE:      0.005,
  LISTING_PRICE:      0.01,
  MICE_MAX_SUPPLY:    100_000,
  MICE_DURATION_DAYS: 360,
  HALF_LIFE_DAYS:     180,
  E0_DAILY:           22_907_500,
} as const;

/**
 * MIC price shown across the apps while no market price exists yet.
 *
 * PreSale went live on mainnet 2026-08-08 at 200 MIC per USDT, so the current round
 * prices MIC at $0.005 — SEED's $0.0025 is the previous round and no longer the headline
 * figure. Before this constant existed the number lived in five places at three different
 * values (0.0025, 0.005, 0.0085), so the dashboard, the rounds API and the admin stats
 * page each quoted a different price for the same token. Import this; do not retype it.
 *
 * Replace with a real market read once SWAP is live.
 */
export const MIC_DISPLAY_PRICE_USD = 0.005;
export const MIC_DISPLAY_PRICE_SOURCE = "Pre-Sale Round";

/**
 * Package tables — the canonical mapping from the on-chain `packageIndex` to a name.
 *
 * The sale contracts emit an index, not a name, so anything rebuilding a purchase from
 * chain events has to map it back. Keeping one table here stops the API and the indexer
 * from disagreeing about what "package 2" was called.
 */
export const SEED_PACKAGE_NAMES = [
  "EARLY BIRD",
  "FOUNDING PARTNER I",
  "FOUNDING PARTNER II",
  "FOUNDING PARTNER III",
] as const;

export const PRESALE_PACKAGE_NAMES = [
  "Minimum",
  "Package Builder",
  "Package Maker",
  "Package Luminary",
] as const;

export function seedPackageName(index: number): string {
  return SEED_PACKAGE_NAMES[index] ?? `Package ${index}`;
}

export function preSalePackageName(index: number): string {
  return PRESALE_PACKAGE_NAMES[index] ?? `Package ${index}`;
}
