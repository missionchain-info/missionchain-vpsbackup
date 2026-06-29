/**
 * MissionChain Contract Addresses
 *
 * BSC Testnet: FULL REDEPLOY 2026-04-29 per Tokenomics Excel (23 contracts)
 *   - All Apr 14 / Apr 26 / Apr 28 v3 contracts ORPHANED
 *   - P1 fix: NFTStaking now requires lockManager (on-chain locked-MIC check)
 *   - P2 fix: LockManager.createScheduleWithStart blocks future startTime
 * BSC Mainnet: populated after audit + mainnet deploy.
 */
export declare const ADDRESSES: {
    readonly bscTestnet: {
        readonly MockUSDT: "0x6d1A913665F26903C7d296d946B8D8527D6937B0";
        readonly MICToken: "0x2Ab08b1DC87D1f0778D2190c25B42735348aD50D";
        readonly LockManager: "0xB23B802536735cCEB74BcE6B6dbe815CA0e7f4fa";
        readonly CommunityNFT: "0x6a1D509aE75f5E8794b79C823Fa3408535df07ee";
        readonly MFPNFT: "0x011bF0cABB645F175Be4FF637Bf2D935545068c0";
        readonly DAOGovernor: "0xADF25b45d369Ef6d6f42268233F41F9A18b653da";
        readonly ManagementPool: "0x08Fe2b1BCB12498302c488b723FEE39B16b229CB";
        readonly TreasuryManager: "0x4F373B5904402873Fb2000506Db2a4eE9366E411";
        readonly LiquidityPool: "0x62611ac2cD32a9B1DEabb5A659c8cd1052C24e77";
        readonly RevenueRouter: "0xe6Ac647a2FEeF86AE55A6732FFA8Dd9cEF21C7A2";
        readonly SeedBudget: "0x618140893169ba589B67989fdbcb0550054fD044";
        readonly ClaimRewards: "0x875C8335A43BD0A1f1000a9AF2FaE86b5D1ed8DD";
        readonly PeriodicRewards: "0x7b44a2fB033c5a9CEe7e25BA41A8365cf17fC089";
        readonly LuckyDraw: "0xF7De11Aa40698cE3ffF4A5dcC013Af383726e137";
        readonly IncentivePool: "0xD7a9F7Dd41b76c289c42d80aa506410E11a0f19a";
        readonly RewardDistributor: "0x1Aa12B0dD34378df799bE923F293335EDE383E94";
        readonly ReferralRegistry: "0xa4a4d1f68760CEe7BE76500A682d60c4110705d9";
        readonly SeedSale: "0xf3C3f88b434035484cEf6daF99Ed967489D2c7cC";
        readonly PreSale: "0xC9f4a0bfc3665b61A631561D1b34EcA7644377FC";
        readonly StewardCouncil: "0x2fbA13aF4F0674c9c8854e9cD525A207b470dC4B";
        readonly LiquidityPoolV5: "0x5dE24d7c0c9D581CaDf5d058b086F158Ee88b86b";
        readonly ListingReserveVault: "0xD6E88De8DE02b39faA27AE95eD5A18A1Ad203242";
        readonly SeedBudgetV5b: "0xA2Ba0302b6fdfcBF3517F658ee74e2C22A033Ba5";
        readonly OperationalSalaryPoolV2: "0x676679C15eb9f1F34150C347f2D61b13a4135090";
        readonly ManagementBonusPoolV2: "0xFe900A02570a3d8cB8E3A5fb42A93E3419CfD810";
        readonly ReservedExpensesPoolV2: "0x210E18F84DBeF30Dde56eCED82fbB50f25D39689";
        readonly MICELicense: "0x0639B154e7C6f5176A871972A5a95B425C7a4fF2";
        readonly AirdropDistributor: "0xEAF7eC7f4c0cc96D196661a713920eF0DE2Fa178";
        readonly EmissionController: "0x1D6295eFee081D43fd728613D263f9dB565c3e3D";
        readonly MiningPool: "0xc7b1c4507d1B4BcE4537070ebE9B61194aFdEf40";
        readonly NFTStaking: "0x99C8CA07E704E3137A637DE8eFec519d12359624";
        readonly FoundersVault: "0x5378e6Fe05F06471e7fA2E3eEf515AfF829e3830";
    };
    readonly bsc: {
        readonly MockUSDT: string;
        readonly MICToken: "0x0000000000000000000000000000000000000000";
        readonly LockManager: "0x0000000000000000000000000000000000000000";
        readonly CommunityNFT: "0x0000000000000000000000000000000000000000";
        readonly MFPNFT: "0x0000000000000000000000000000000000000000";
        readonly DAOGovernor: "0x0000000000000000000000000000000000000000";
        readonly ManagementPool: "0x0000000000000000000000000000000000000000";
        readonly TreasuryManager: "0x0000000000000000000000000000000000000000";
        readonly LiquidityPool: "0x0000000000000000000000000000000000000000";
        readonly RevenueRouter: "0x0000000000000000000000000000000000000000";
        readonly SeedBudget: "0x0000000000000000000000000000000000000000";
        readonly ClaimRewards: "0x0000000000000000000000000000000000000000";
        readonly PeriodicRewards: "0x0000000000000000000000000000000000000000";
        readonly LuckyDraw: "0x0000000000000000000000000000000000000000";
        readonly IncentivePool: "0x0000000000000000000000000000000000000000";
        readonly RewardDistributor: "0x0000000000000000000000000000000000000000";
        readonly ReferralRegistry: "0x0000000000000000000000000000000000000000";
        readonly SeedSale: "0x0000000000000000000000000000000000000000";
        readonly PreSale: "0x0000000000000000000000000000000000000000";
        readonly MICELicense: "0x0000000000000000000000000000000000000000";
        readonly AirdropDistributor: "0x0000000000000000000000000000000000000000";
        readonly EmissionController: "0x0000000000000000000000000000000000000000";
        readonly MiningPool: "0x0000000000000000000000000000000000000000";
        readonly NFTStaking: "0x0000000000000000000000000000000000000000";
        readonly FoundersVault: "0x0000000000000000000000000000000000000000";
        readonly USDT: "0x55d398326f99059fF775485246999027B3197955";
    };
};
export type NetworkName = keyof typeof ADDRESSES;
export type ContractName = keyof (typeof ADDRESSES)["bscTestnet"];
