/**
 * MissionChain Contract Addresses — MAINNET ONLY
 *
 * Phase 0 Genesis MAINNET deploy 2026-05-06 — 16 contracts on BSC chainid 56.
 * PreSale Phase-1 set deployed 2026-08-08 — 12 contracts, PreSale holds 315,000,000 MIC
 * with active = false. MICELicense / EmissionController / MiningPool / NFTStaking remain
 * unset; the UI hides those entries via menu-config until they are.
 *
 * SEED is on its third contract: V7 halted (6-decimal prices), V8 deployed but never
 * activated (no whitelist), V9 live and gated. Read SeedSaleV9 — never V7 or V8.
 *
 * Testnet support fully removed May 6, 2026 — code is mainnet-only henceforth.
 * For development/test work, use a forked mainnet via hardhat or anvil locally.
 */

export const ADDRESSES = {
  bsc: {
    USDT:                    "0x55d398326f99059fF775485246999027B3197955", // BEP-20 USDT
    MockUSDT:                "0x55d398326f99059fF775485246999027B3197955", // alias of USDT for shape compat
    MICToken:                "0xf27ec0c311728b923b22828002c992c799326182",
    LockManager:             "0x6bE58BCe62f526E7751e121CDBa1eb22873471A0",
    MFPNFT:                  "0xAE6F32A6fdf80F5e54ba85441386dBA6a381f565",
    CommunityNFT:            "0x2828C97397be51FCCa5D8D99a0c5126F11A15149",
    StewardCouncil:          "0x87723621D50fcc6f6db25d73031E44Bee4081B19",
    DAOGovernor:             "0xDCD65DC97b0A147BeCf542E22a5C218C006231cC",
    TreasuryManager:         "0x1ed5C848D1244a618Bd95Ff92d4f8C2356d3a42F",

    // ─── V5c trio + V7 (ACTIVE) — deployed 2026-06-22, cutover 2026-06-23 ───
    SeedBudgetV5c:             "0x33ec0A97029adde1A7e0f78E3B8f414Ec56527ef",
    OperationalSalaryPoolV3:   "0xB2f318b07B7501f6A03b53066610032418F66b85",
    ManagementBonusPoolV3:     "0x2bfA50146C01d6c4BFA4A2550385988C2619f033",
    ReservedExpensesPoolV3:    "0xe04519547F051AE4388FcdE571EA2301dD9e3495",

    /**
     * SeedSaleV9 — 18-decimal pricing AND an enforced whitelist. This is the SEED round
     * to read and to point the app at. Deployed 2026-08-09, holds 181,558,850 MIC,
     * ships with active = false and whitelistRequired = true.
     */
    SeedSaleV9:                "0x5216c5C69FB899CC3De8Aa94165363153B5B589d",

    /**
     * ⛔ Deployed 2026-08-08, NEVER activated, now empty — do NOT link.
     * Fixed V7's decimals but carries no whitelist, so activating it would sell MIC at
     * $0.0025 to anyone while the Pre-Sale asks $0.005. Superseded by SeedSaleV9.
     */
    SeedSaleV8:                "0xD855076f200dFa2526303c2242E49DFcB3635B50",

    /**
     * ⛔ HALTED 2026-08-08, tx 0xc931ff25…72613a — do NOT reactivate, do NOT link.
     * Priced in 6 decimals against 18-decimal BSC-USD: package 3 sold 4,000,000 MIC and
     * 20 MFP for 0.00000001 USDT. Caught with totalSold still 0, so nothing was taken.
     * Replaced by SeedSaleV8.
     */
    SeedSaleV7:                "0xe4C1B4fBE009245eBB6B3a4F76DcAAE445F60905",

    // ─── DEPRECATED 2026-06-23 (replaced by V5c trio + V7) — kept for legacy reference ───
    SeedBudgetV5b:           "0xf7a839A271d8F5A7b19a42eCD7f7E604A3dcEC1a", // DEPRECATED 2026-06-23 (replaced by V5c trio)
    OperationalSalaryPoolV2: "0xf3fDaD73CCf9Ccf1D42fc4d772efad9BB7E17576", // DEPRECATED 2026-06-23 (replaced by OperationalSalaryPoolV3)
    ManagementBonusPoolV2:   "0x71E3D41F2d5464576fA7aCfd42bcEAA2c1E0578B", // DEPRECATED 2026-06-23 (replaced by ManagementBonusPoolV3)
    ReservedExpensesPoolV2:  "0xC92963834a5F992b6599aD19eF18061594C23154", // DEPRECATED 2026-06-23 (replaced by ReservedExpensesPoolV3)
    SeedSaleV6:              "0x7ce5AcDC5DACf59aaB130C963ac461f902A5e5A0", // DEPRECATED 2026-06-23 (paused, replaced by SeedSaleV7)

    LiquidityPoolV5:         "0x37091454eB49179D3aFF12402980F63cFC3e050a",
    ListingReserveVault:     "0x2EE1b6B7108851BB721cA1c9B8aCEf76e70C8f16",
    FoundersVault:           "0x142167334Ad8da6790353dC54c42651F9F416b67",
    AirdropDistributor:      "0x9Bdd75b6aDf5BA674F74C49601AF7D82d3672EF9",

    // Aliases — UPDATED 2026-06-23 to point at active V5c/V7
    SeedSale:                "0x5216c5C69FB899CC3De8Aa94165363153B5B589d", // → V9 (was V7 0xe4C1…, halted)
    SeedBudget:              "0x33ec0A97029adde1A7e0f78E3B8f414Ec56527ef", // → V5c (was zero address)

    // ─── Phase-1 PreSale set — DEPLOYED 2026-08-08 ───
    // Anything still at the zero address below belongs to a later batch and is hidden by
    // menu-config until it lands.
    ManagementPool:     "0x20C08cb2552E51AA3fA1450FD6811112f8c95cfb",
    LiquidityPool:      "0x0F01332d5F8b31175D72CdE0aF18cb0E70417763",
    RevenueRouter:      "0xf86b0cF9ce21250429b522Ed62a5B6b549539672",
    ClaimRewards:       "0x0000000000000000000000000000000000000000",

    // ─── PreSale Phase-1 set — filled in by scripts/deploy-presale-phase1.ts ───
    // These are the V2 successors actually being deployed; the un-suffixed keys above
    // are the superseded originals. Apps must read THESE, not the old names.
    CommunityNFTv2:        "0x28263C00C371A6DE9592E2477f2813408F337E96",
    ClaimRewardsV2:        "0x1F38FD97a656d80bF873ca2B9262D9EB337E6866",
    RewardDistributorV2:   "0xDB4Cc75cdD3081557cB68d6dF456df3a1C31cab3",
    ListingReserve:        "0x9e4f9472E3526635d0001f6986D5daBca72b7D7D",
    NFTRewardPoolWeekly:   "0x187b221C47b976b39E40F46470f0252f4194B676",
    NFTRewardPoolMonthly:  "0x8ce8c0fAe3C9E5FE54b49e3654EA9B9ef862CefC",
    PeriodicRewards:    "0x0000000000000000000000000000000000000000",
    LuckyDraw:          "0x1e3644b764136A3cE572eEe7858208897CFA839d",
    IncentivePool:      "0x0000000000000000000000000000000000000000",
    RewardDistributor:  "0x0000000000000000000000000000000000000000",
    ReferralRegistry:   "0x2a8C0c5c7414fD4f879ba34883652f306403f0f9",
    PreSale:            "0xC4A6cd57DE0619daCDfD190E9A4D9682Ed78BE23",
    MICELicense:        "0x4d5147aC4aa44eFc1Ae6196FcE4c87567aA4BD8c",
    EmissionController: "0x37f38f383b4065BA58C7A6Fc1a91d2dF4f9f86F0",
    MiningPool:         "0x9178292E960cb17380dd329866e725e33200e04f",
    NFTStaking:         "0x4eae6376501E975CbF207473E3277417495fd3fE",
    // The SWAP pool. MICELicense prices its MIC burn off this contract's min(spot, TWAP7d),
    // and the mining keeper pokes it, so both go quiet while it reads zero.
    // Deployed 2026-08-10 with the MICE round. The pool is dormant until seeded — it
    // quotes no price and refuses every trade, so anything reading it stays inert.
    // Claim-based, replacing the push-only pair deployed earlier the same day. Holders
    // pull their own MIC; the old pair held nothing and is now unreferenced.
    CommunityNFTRewardPool: "0xae26BA0f1c639beA93e5a4dD9313F5765A29Ee5a",
    MFPRewardPool:          "0xFb79deC4F0CDe13A667018e567dD636255D61d6d",
    LiquidityPoolV6:    "0xf6AB7103d1072416366D34Ce5E8A41074feCC98e",
    P2PEscrowMFP:       "0xcff25169c783B84eFBa746eF4A51271764f24b8B", // Phase 1 deploy 2026-05-10, fee 1.5%
  },
} as const;

export type NetworkName = keyof typeof ADDRESSES;
export type ContractName = keyof (typeof ADDRESSES)["bsc"];
/** Network-agnostic shape: same keys as bsc, values widened to plain string. */
export type AddressMap = { readonly [K in ContractName]: string };
