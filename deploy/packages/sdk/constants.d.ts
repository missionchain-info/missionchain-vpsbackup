/**
 * MissionChain SDK — Shared Constants
 *
 * All BigInt values use 18-decimal MIC precision (or 6-decimal USDT where noted).
 * Source of truth: missionchain/deploy master docs + approved business decisions.
 */
export declare const TOTAL_SUPPLY: bigint;
export declare const PRE_ISSUED: bigint;
export declare const MINING_POOL: bigint;
export declare const MIC_DECIMALS = 18;
export declare const USDT_DECIMALS = 6;
/** $0.0025 per MIC — SEED Round price in USDT 6-dec units */
export declare const SEED_PRICE = 2500n;
/** $0.005 per MIC — Pre-Sale price in USDT 6-dec units */
export declare const PRESALE_PRICE = 5000n;
/** $0.01 per MIC — DEX/CEX listing reference price in USDT 6-dec units */
export declare const LISTING_PRICE = 10000n;
export declare const ALLOC_SEED_ROUND: bigint;
export declare const ALLOC_SEED_PUBLIC: bigint;
export declare const ALLOC_SEED_GRANT: bigint;
export declare const ALLOC_PRESALE: bigint;
export declare const ALLOC_DEX_LISTING: bigint;
export declare const ALLOC_FOUNDERS: bigint;
export declare const ALLOC_COMMUNITY: bigint;
export declare const ALLOC_AIRDROPS: bigint;
export declare const EMISSION_BPS_MINERS = 6000;
export declare const EMISSION_BPS_STAKING = 2500;
export declare const EMISSION_BPS_DAO = 1000;
export declare const EMISSION_BPS_COMMUNITY = 500;
export declare const VESTING: {
    /** SEED Round: 6-month cliff → 10% unlock → 2.5%/month */
    readonly SEED: {
        readonly cliff: number;
        readonly cliffBps: 1000;
        readonly monthlyBps: 250;
    };
    /** Pre-Sale: 6-month cliff → 10% unlock → 2.5%/month */
    readonly PRESALE: {
        readonly cliff: number;
        readonly cliffBps: 1000;
        readonly monthlyBps: 250;
    };
    /** Founders & Mgmt: 24-month cliff → 10% unlock → 2.5%/month */
    readonly FOUNDERS: {
        readonly cliff: number;
        readonly cliffBps: 1000;
        readonly monthlyBps: 250;
    };
    /** Community Funds (+Churches): 24-month cliff → 10% unlock → 2.5%/month */
    readonly COMMUNITY: {
        readonly cliff: number;
        readonly cliffBps: 1000;
        readonly monthlyBps: 250;
    };
    /** Incentives & Airdrops: 6-month cliff → 10% unlock → 2.5%/month */
    readonly AIRDROPS: {
        readonly cliff: number;
        readonly cliffBps: 1000;
        readonly monthlyBps: 250;
    };
};
/** Initial daily emission: E₀ ≈ 22,907,500 MIC/day (18-dec) */
export declare const E0_DAILY: bigint;
/** Half-life: 180 days */
export declare const HALF_LIFE_DAYS = 180;
/** WarmUp period: 30 days */
export declare const WARMUP_DAYS = 30;
export declare const MICE_MAX_SUPPLY = 100000;
export declare const MICE_DURATION_DAYS = 360;
export declare const MICE_ROUNDS_COUNT = 5;
export declare const MICE_PER_ROUND = 20000;
/** MICE pricing per round — price in USD (as integer cents × 100) */
export declare const MICE_ROUND_PRICES_USD: readonly [100, 200, 300, 400, 500];
/** MICE revenue split (BPS out of 10000) — 50% MIC burned + 50% USDT to RevenueRouter */
export declare const MICE_MIC_BURN_BPS = 5000;
export declare const MICE_USDT_ROUTE_BPS = 5000;
/** @deprecated NFT multipliers no longer used in staking. Only for reward distribution. */
export declare const NFT_MULTIPLIER: {
    readonly NONE: 5000;
    readonly BUILDER: 10000;
    readonly MAKER: 25000;
    readonly LUMINARY: 50000;
    readonly MFP: 100000;
};
/** @deprecated Staking caps no longer enforced. MICStaking has no tier-based caps. */
export declare const NFT_STAKING_CAP: {
    readonly BUILDER: bigint;
    readonly MAKER: bigint;
    readonly LUMINARY: bigint;
    readonly MFP: bigint;
};
/** Time-lock multipliers (BPS) */
export declare const TIMELOCK_MULTIPLIER: {
    readonly DAYS_30: 10000;
    readonly DAYS_90: 12500;
    readonly DAYS_180: 15000;
    readonly DAYS_360: 20000;
};
/**
 * Locked MIC Staking Requirements
 * When useLockedMic = true (staking vesting/locked tokens):
 * - Minimum stake lock period: 360 days (same as vesting semantics)
 * - Full time-lock multiplier applied (no reduction) — no NFT multiplier involved
 * - Rewards are unlocked and freely transferable
 * - NFT SYSTEM COMPLETELY SEPARATE: no NFT involvement in staking
 */
export declare const LOCKED_MIC_MIN_LOCK_DAYS = 360;
/** F1 referral: 7% of USDT — Pre-Sale & MICE only */
export declare const REFERRAL_F1_BPS = 700;
/** F2 referral: 3% of USDT */
export declare const REFERRAL_F2_BPS = 300;
export declare const CHAINS: {
    readonly BSC_MAINNET: 56;
    readonly BSC_TESTNET: 97;
};
export declare const CONTRACTS: {
    readonly MIC_TOKEN: string;
    readonly MICE_LICENSE: string;
    readonly MFP_NFT: string;
    readonly COMMUNITY_NFT: string;
    readonly STAKING: string;
    readonly SEED_SALE: string;
    readonly PRESALE: string;
    readonly EMISSION: string;
    readonly LOCK_MANAGER: string;
    readonly GOVERNANCE: string;
    readonly TREASURY: string;
    readonly REVENUE_ROUTER: string;
    readonly REWARD_DISTRIBUTOR: string;
    readonly LIQUIDITY_POOL: string;
};
/** @deprecated Use TOTAL_SUPPLY (BigInt) for on-chain math */
export declare const TOKENOMICS: {
    readonly TOTAL_SUPPLY: 7000000000;
    readonly PRE_ISSUED: 1050000000;
    readonly MINING_POOL: 5950000000;
    readonly SEED_PRICE: 0.0025;
    readonly PRESALE_PRICE: 0.005;
    readonly LISTING_PRICE: 0.01;
    readonly MICE_MAX_SUPPLY: 100000;
    readonly MICE_DURATION_DAYS: 360;
    readonly HALF_LIFE_DAYS: 180;
    readonly E0_DAILY: 22907500;
};
