/**
 * MissionChain Contract Addresses — MAINNET ONLY
 *
 * Phase 0 Genesis MAINNET deploy 2026-05-06 — 16 contracts on BSC chainid 56.
 * Phase 1+ contracts (PreSale, MICELicense, NFTStaking, etc.) NOT YET DEPLOYED.
 * UI hides Phase 1+ entries via menu-config until deployed.
 *
 * SEED V5c/V7 cutover 2026-06-23 — V5b/V2 trio + V6 deprecated; V5c trio + V7 active.
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
    SeedSale:                "0xe4C1B4fBE009245eBB6B3a4F76DcAAE445F60905", // → V7 (was V6 0x7ce5…)
    SeedBudget:              "0x33ec0A97029adde1A7e0f78E3B8f414Ec56527ef", // → V5c (was zero address)

    // Phase 1 expansion + Phase 2 + Phase 3 — NOT YET DEPLOYED.
    // UI entries hidden via menu-config until deployed.
    ManagementPool:     "0x0000000000000000000000000000000000000000",
    LiquidityPool:      "0x0000000000000000000000000000000000000000",
    RevenueRouter:      "0x0000000000000000000000000000000000000000",
    ClaimRewards:       "0x0000000000000000000000000000000000000000",
    PeriodicRewards:    "0x0000000000000000000000000000000000000000",
    LuckyDraw:          "0x0000000000000000000000000000000000000000",
    IncentivePool:      "0x0000000000000000000000000000000000000000",
    RewardDistributor:  "0x0000000000000000000000000000000000000000",
    ReferralRegistry:   "0x0000000000000000000000000000000000000000",
    PreSale:            "0x0000000000000000000000000000000000000000",
    MICELicense:        "0x0000000000000000000000000000000000000000",
    EmissionController: "0x0000000000000000000000000000000000000000",
    MiningPool:         "0x0000000000000000000000000000000000000000",
    NFTStaking:         "0x0000000000000000000000000000000000000000",
    P2PEscrowMFP:       "0xcff25169c783B84eFBa746eF4A51271764f24b8B", // Phase 1 deploy 2026-05-10, fee 1.5%
  },
} as const;

export type NetworkName = keyof typeof ADDRESSES;
export type ContractName = keyof (typeof ADDRESSES)["bsc"];
/** Network-agnostic shape: same keys as bsc, values widened to plain string. */
export type AddressMap = { readonly [K in ContractName]: string };
