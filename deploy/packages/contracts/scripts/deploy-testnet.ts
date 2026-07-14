/**
 * MissionChain — Full Deploy Script (Testnet / Local Hardhat)
 *
 * Run on local hardhat fork:
 *   npx hardhat run scripts/deploy-testnet.ts --network hardhat
 *
 * Run on BSC testnet (requires DEPLOYER_KEY in .env):
 *   npx hardhat run scripts/deploy-testnet.ts --network bscTestnet
 *
 * Phases A–I follow BUILD-DEPLOY §3.4 ordering.
 * Saves deployment addresses to: deployments/testnet.json
 */

import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import { deployContract, execTx, logSection } from "./helpers/deploy-utils";

// ─────────────────────────────────────────────────────────────────────────────
// MIC amounts (18-dec)
// ─────────────────────────────────────────────────────────────────────────────
const MIC_SEED       = ethers.parseEther("227500000");  // 227.5M — SEED Round
const MIC_PRESALE    = ethers.parseEther("315000000");  // 315M   — Pre-Sale
const MIC_LIQUIDITY  = ethers.parseEther("105000000");  // 105M   — DEX/CEX Listing (locked in LiquidityPool)
const MIC_FOUNDERS   = ethers.parseEther("280000000");  // 280M   — Founders & Mgmt
const MIC_COMMUNITY  = ethers.parseEther("105000000");  // 105M   — Community Funds
const MIC_AIRDROPS   = ethers.parseEther("17500000");   // 17.5M  — Incentives & Airdrops

// Vesting params (matching LockManager.createSchedule signature)
// cliff in seconds, cliffBps (10% = 1000), monthlyBps
const VEST_6M_CLIFF_BPS   = 1000; // 10%
const VEST_6M_MONTHLY_BPS = 250;  // 2.5%
const VEST_24M_CLIFF_BPS  = 1000; // 10%
const VEST_COMMUNITY_MONTHLY_BPS = 25; // 0.25%
const SECONDS_PER_DAY = 86400;
const CLIFF_6M  = 180 * SECONDS_PER_DAY;
const CLIFF_24M = 720 * SECONDS_PER_DAY;

// Initial MIC price for MICE licensing ($0.001 = 1000 USDT-6dec per MIC unit)
// MIC price expressed in USDT with 6-dec precision per 1 MIC (18-dec).
// $0.0025 at launch → stored as 2500 (representing $0.0025 per MIC in 6-dec USDT units)
const INITIAL_MIC_PRICE_USDT = 2500n; // $0.0025 — matches SEED price as initial MICE pricing reference

async function main() {
  const [deployer] = await ethers.getSigners();

  logSection("MissionChain — Full Deploy (Testnet)");
  console.log(`Deployer: ${deployer.address}`);
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Balance:  ${ethers.formatEther(balance)} BNB`);

  // Use deployer for all wallet roles on testnet
  const admin            = deployer.address;
  const foundersWallet   = deployer.address;
  const communityWallet  = deployer.address;
  const auditWallet      = deployer.address;
  const daoReserve       = deployer.address;

  // ──────────────────────────────────────────────────────────────────────────
  // Phase A: Core Tokens
  // ──────────────────────────────────────────────────────────────────────────
  logSection("Phase A: Core Tokens");

  // 1. MockUSDT (testnet only)
  const usdt = await deployContract("MockUSDT", []);
  const usdtAddr = await usdt.getAddress();

  // 2. MICToken — treasury = deployer for testnet
  const mic = await deployContract("MICToken", [admin]);
  const micAddr = await mic.getAddress();

  // 3. LockManager
  const lockManager = await deployContract("LockManager", []);
  const lockManagerAddr = await lockManager.getAddress();

  // ──────────────────────────────────────────────────────────────────────────
  // Phase B: NFTs
  // ──────────────────────────────────────────────────────────────────────────
  logSection("Phase B: NFTs");

  // 4. CommunityNFT
  const communityNFT = await deployContract("CommunityNFT", [
    "https://missionchain.io/nft/community/",
    admin,
  ]);
  const communityNFTAddr = await communityNFT.getAddress();

  // 5. MFPNFT
  const mfpNFT = await deployContract("MFPNFT", [
    "https://missionchain.io/nft/mfp/",
    admin,
  ]);
  const mfpNFTAddr = await mfpNFT.getAddress();

  // ──────────────────────────────────────────────────────────────────────────
  // Phase C: Governance
  // ──────────────────────────────────────────────────────────────────────────
  logSection("Phase C: Governance");

  // 6. DAOGovernor
  const daoGovernor = await deployContract("DAOGovernor", [admin]);
  const daoGovernorAddr = await daoGovernor.getAddress();

  // ──────────────────────────────────────────────────────────────────────────
  // Phase D: Revenue & Infrastructure
  // ──────────────────────────────────────────────────────────────────────────
  logSection("Phase D: Revenue & Infrastructure");

  // Leadership wallets for ManagementPool: [Founder, Architect, CTO, SocialMedia, GlobalTraining, TechTeam]
  const leadershipRoles: [string, string, string, string, string, string] = [
    admin, admin, admin, admin, admin, admin,
  ];

  // 7. ManagementPool
  const managementPool = await deployContract("ManagementPool", [
    usdtAddr,
    leadershipRoles,
    admin,
  ]);
  const managementPoolAddr = await managementPool.getAddress();

  // 8. TreasuryManager
  const treasuryManager = await deployContract("TreasuryManager", [
    usdtAddr,
    admin,
  ]);
  const treasuryManagerAddr = await treasuryManager.getAddress();

  // 9. LiquidityPool
  const liquidityPool = await deployContract("LiquidityPool", [
    usdtAddr,
    micAddr,
    admin,
  ]);
  const liquidityPoolAddr = await liquidityPool.getAddress();

  // SeedBudget leadership wallets: [Founder, Architect, CTO, SocialMedia, TechManager, AgentKPI, Bonus]
  const seedLeadershipWallets: [string, string, string, string, string, string, string] = [
    admin, admin, admin, admin, admin, admin, admin,
  ];

  // 11. SeedBudget (deployed before RevenueRouter — referenced by SeedSale)
  const seedBudget = await deployContract("SeedBudget", [
    usdtAddr,
    liquidityPoolAddr,
    auditWallet,
    daoReserve,
    admin,
    seedLeadershipWallets,
  ]);
  const seedBudgetAddr = await seedBudget.getAddress();

  // ──────────────────────────────────────────────────────────────────────────
  // Phase E: Reward System (needed before RevenueRouter)
  // ──────────────────────────────────────────────────────────────────────────
  logSection("Phase E: Reward System");

  // 17. ReferralRegistry — needed before ClaimRewards and sales
  const referralRegistry = await deployContract("ReferralRegistry", [
    usdtAddr,
    admin,
  ]);
  const referralRegistryAddr = await referralRegistry.getAddress();

  // 12. ClaimRewards
  const claimRewards = await deployContract("ClaimRewards", [
    usdtAddr,
    communityNFTAddr,
    referralRegistryAddr,
    admin,
  ]);
  const claimRewardsAddr = await claimRewards.getAddress();

  // 13. PeriodicRewards
  const periodicRewards = await deployContract("PeriodicRewards", [
    usdtAddr,
    admin,
  ]);
  const periodicRewardsAddr = await periodicRewards.getAddress();

  // 14. LuckyDraw
  const luckyDraw = await deployContract("LuckyDraw", [
    usdtAddr,
    admin,
  ]);
  const luckyDrawAddr = await luckyDraw.getAddress();

  // 15. IncentivePool
  const incentivePool = await deployContract("IncentivePool", [
    usdtAddr,
    admin,
  ]);
  const incentivePoolAddr = await incentivePool.getAddress();

  // 16. RewardDistributor
  const rewardDistributor = await deployContract("RewardDistributor", [
    usdtAddr,
    claimRewardsAddr,
    periodicRewardsAddr,
    luckyDrawAddr,
    incentivePoolAddr,
    admin,
  ]);
  const rewardDistributorAddr = await rewardDistributor.getAddress();

  // ──────────────────────────────────────────────────────────────────────────
  // Phase D (continued): RevenueRouter — needs RewardDistributor address
  // ──────────────────────────────────────────────────────────────────────────
  logSection("Phase D (continued): RevenueRouter");

  // 10. RevenueRouter
  const revenueRouter = await deployContract("RevenueRouter", [
    usdtAddr,
    rewardDistributorAddr,   // marketing (35%) → RewardDistributor
    managementPoolAddr,      // management (7.5%)
    treasuryManagerAddr,     // treasury (12.5%)
    admin,                   // reservedStaking (5%) — deployer wallet on testnet
    liquidityPoolAddr,       // liquidity (40%)
    admin,
  ]);
  const revenueRouterAddr = await revenueRouter.getAddress();

  // ──────────────────────────────────────────────────────────────────────────
  // Phase F: Sales
  // ──────────────────────────────────────────────────────────────────────────
  logSection("Phase F: Sales");

  // 18. SeedSale
  const seedSale = await deployContract("SeedSale", [
    usdtAddr,
    micAddr,
    lockManagerAddr,
    mfpNFTAddr,
    seedBudgetAddr,
    admin,
  ]);
  const seedSaleAddr = await seedSale.getAddress();

  // 19. PreSale
  const preSale = await deployContract("PreSale", [
    usdtAddr,
    micAddr,
    lockManagerAddr,
    communityNFTAddr,
    referralRegistryAddr,
    revenueRouterAddr,
    admin,
  ]);
  const preSaleAddr = await preSale.getAddress();

  // 20. MICELicense
  const miceLicense = await deployContract("MICELicense", [
    usdtAddr,
    micAddr,
    referralRegistryAddr,
    revenueRouterAddr,
    admin,
    INITIAL_MIC_PRICE_USDT,
  ]);
  const miceLicenseAddr = await miceLicense.getAddress();

  // 21. AirdropDistributor
  const airdropDistributor = await deployContract("AirdropDistributor", [
    micAddr,
    lockManagerAddr,
    admin,
  ]);
  const airdropDistributorAddr = await airdropDistributor.getAddress();

  // ──────────────────────────────────────────────────────────────────────────
  // Phase G: Mining
  // ──────────────────────────────────────────────────────────────────────────
  logSection("Phase G: Mining");

  // 23. MiningPool
  const miningPool = await deployContract("MiningPool", [micAddr, admin]);
  const miningPoolAddr = await miningPool.getAddress();

  // 24. NFTStaking (now MICStaking — pure MIC staking without NFT involvement)
  // ARCHITECTURE CHANGE (April 2026): Staking and NFT are completely separate.
  // MICStaking: pure MIC staking, no tier caps, time-lock multipliers only.
  // NFT multipliers: ONLY for USDT reward distribution (Weekly, Monthly, Lucky Draw).
  const nftStaking = await deployContract("NFTStaking", [micAddr, admin]);
  const nftStakingAddr = await nftStaking.getAddress();

  // 25. CommunityNFTRewardPool — receives 5% of daily MIC emission from EmissionController
  //     Distributes MIC to Community NFT holders (Builder/Maker/Luminary) via batch transfers
  //     computed off-chain based on tier multiplier × reward duration × participation.
  const communityNFTRewardPool = await deployContract("CommunityNFTRewardPool", [micAddr, admin]);
  const communityNFTRewardPoolAddr = await communityNFTRewardPool.getAddress();

  // 22. EmissionController — needs MICE, MiningPool, NFTStaking, CommunityNFTRewardPool
  const emissionController = await deployContract("EmissionController", [
    micAddr,
    miceLicenseAddr,
    miningPoolAddr,
    nftStakingAddr,
    daoGovernorAddr,              // daoTreasury — receives 10% DAO portion of emissions
    communityNFTRewardPoolAddr,   // communityNFTPool — receives 5% Community NFT Reward
    admin,
  ]);
  const emissionControllerAddr = await emissionController.getAddress();

  // ──────────────────────────────────────────────────────────────────────────
  // Phase H: Wire Roles
  // ──────────────────────────────────────────────────────────────────────────
  logSection("Phase H: Wire Roles");

  // Cast to typed contract instances for role constants
  const micTyped            = await ethers.getContractAt("MICToken",           micAddr);
  const lockManagerTyped    = await ethers.getContractAt("LockManager",        lockManagerAddr);
  const communityNFTTyped   = await ethers.getContractAt("CommunityNFT",       communityNFTAddr);
  const mfpNFTTyped         = await ethers.getContractAt("MFPNFT",             mfpNFTAddr);
  const revenueRouterTyped  = await ethers.getContractAt("RevenueRouter",      revenueRouterAddr);
  const referralTyped       = await ethers.getContractAt("ReferralRegistry",   referralRegistryAddr);
  const rewardDistTyped     = await ethers.getContractAt("RewardDistributor",  rewardDistributorAddr);
  const managementTyped     = await ethers.getContractAt("ManagementPool",     managementPoolAddr);
  const treasuryTyped       = await ethers.getContractAt("TreasuryManager",    treasuryManagerAddr);
  const liquidityTyped      = await ethers.getContractAt("LiquidityPool",      liquidityPoolAddr);
  const seedBudgetTyped     = await ethers.getContractAt("SeedBudget",         seedBudgetAddr);
  const claimRewardsTyped   = await ethers.getContractAt("ClaimRewards",       claimRewardsAddr);
  const periodicTyped       = await ethers.getContractAt("PeriodicRewards",    periodicRewardsAddr);
  const luckyDrawTyped      = await ethers.getContractAt("LuckyDraw",          luckyDrawAddr);
  const incentiveTyped      = await ethers.getContractAt("IncentivePool",      incentivePoolAddr);

  // Fetch role hashes
  const MINTER_ROLE          = await micTyped.MINTER_ROLE();
  const SCHEDULE_CREATOR_ROLE = await lockManagerTyped.SCHEDULE_CREATOR_ROLE();
  const NFT_MINTER_ROLE      = await communityNFTTyped.MINTER_ROLE();
  const MFP_MINTER_ROLE      = await mfpNFTTyped.MINTER_ROLE();
  const ROUTER_DISTRIBUTOR   = await revenueRouterTyped.DISTRIBUTOR_ROLE();
  const REF_CALLER_ROLE      = await referralTyped.CALLER_ROLE();
  const REWARD_DISTRIBUTOR   = await rewardDistTyped.DISTRIBUTOR_ROLE();
  const MGMT_DISTRIBUTOR     = await managementTyped.DISTRIBUTOR_ROLE();
  const TREASURY_DISTRIBUTOR = await treasuryTyped.DISTRIBUTOR_ROLE();
  const LIQUIDITY_DISTRIBUTOR = await liquidityTyped.DISTRIBUTOR_ROLE();
  const SEED_CALLER          = await seedBudgetTyped.CALLER_ROLE();
  const CLAIM_DISTRIBUTOR    = await claimRewardsTyped.DISTRIBUTOR_ROLE();
  const PERIODIC_DISTRIBUTOR = await periodicTyped.DISTRIBUTOR_ROLE();
  const LUCKY_DISTRIBUTOR    = await luckyDrawTyped.DISTRIBUTOR_ROLE();
  const INCENTIVE_DISTRIBUTOR = await incentiveTyped.DISTRIBUTOR_ROLE();

  // MICToken wiring
  await execTx("MICToken: setLockManager",
    micTyped.setLockManager(lockManagerAddr));
  await execTx("MICToken: MINTER_ROLE → EmissionController",
    micTyped.grantRole(MINTER_ROLE, emissionControllerAddr));
  // Approve MICStaking (formerly NFTStaking) to transfer locked MIC tokens.
  // MICStaking is an approvedStakingContract, allowing users to stake their vesting/locked MIC.
  // ARCHITECTURE CHANGE: Locked MIC can participate in PURE MIC staking at full time-lock multiplier (minimum 360d lock required).
  // NFT system is completely separate — no NFT involvement in staking.
  // Staking rewards are unlocked and freely transferable.
  await execTx("MICToken: setApprovedStakingContract(micStaking)",
    micTyped.setApprovedStakingContract(nftStakingAddr, true));

  // LockManager: SCHEDULE_CREATOR_ROLE
  await execTx("LockManager: SCHEDULE_CREATOR → SeedSale",
    lockManagerTyped.grantRole(SCHEDULE_CREATOR_ROLE, seedSaleAddr));
  await execTx("LockManager: SCHEDULE_CREATOR → PreSale",
    lockManagerTyped.grantRole(SCHEDULE_CREATOR_ROLE, preSaleAddr));
  await execTx("LockManager: SCHEDULE_CREATOR → AirdropDistributor",
    lockManagerTyped.grantRole(SCHEDULE_CREATOR_ROLE, airdropDistributorAddr));

  // CommunityNFT: MINTER_ROLE
  await execTx("CommunityNFT: MINTER_ROLE → PreSale",
    communityNFTTyped.grantRole(NFT_MINTER_ROLE, preSaleAddr));
  await execTx("CommunityNFT: MINTER_ROLE → ClaimRewards",
    communityNFTTyped.grantRole(NFT_MINTER_ROLE, claimRewardsAddr));

  // MFPNFT: MINTER_ROLE
  await execTx("MFPNFT: MINTER_ROLE → SeedSale",
    mfpNFTTyped.grantRole(MFP_MINTER_ROLE, seedSaleAddr));

  // RevenueRouter: DISTRIBUTOR_ROLE
  await execTx("RevenueRouter: DISTRIBUTOR_ROLE → PreSale",
    revenueRouterTyped.grantRole(ROUTER_DISTRIBUTOR, preSaleAddr));
  await execTx("RevenueRouter: DISTRIBUTOR_ROLE → MICELicense",
    revenueRouterTyped.grantRole(ROUTER_DISTRIBUTOR, miceLicenseAddr));

  // ReferralRegistry: CALLER_ROLE
  await execTx("ReferralRegistry: CALLER_ROLE → PreSale",
    referralTyped.grantRole(REF_CALLER_ROLE, preSaleAddr));
  await execTx("ReferralRegistry: CALLER_ROLE → MICELicense",
    referralTyped.grantRole(REF_CALLER_ROLE, miceLicenseAddr));

  // RewardDistributor: DISTRIBUTOR_ROLE
  await execTx("RewardDistributor: DISTRIBUTOR_ROLE → RevenueRouter",
    rewardDistTyped.grantRole(REWARD_DISTRIBUTOR, revenueRouterAddr));

  // ManagementPool: DISTRIBUTOR_ROLE
  await execTx("ManagementPool: DISTRIBUTOR_ROLE → RevenueRouter",
    managementTyped.grantRole(MGMT_DISTRIBUTOR, revenueRouterAddr));

  // TreasuryManager: DISTRIBUTOR_ROLE
  await execTx("TreasuryManager: DISTRIBUTOR_ROLE → RevenueRouter",
    treasuryTyped.grantRole(TREASURY_DISTRIBUTOR, revenueRouterAddr));

  // LiquidityPool: DISTRIBUTOR_ROLE
  await execTx("LiquidityPool: DISTRIBUTOR_ROLE → RevenueRouter",
    liquidityTyped.grantRole(LIQUIDITY_DISTRIBUTOR, revenueRouterAddr));
  await execTx("LiquidityPool: DISTRIBUTOR_ROLE → SeedBudget",
    liquidityTyped.grantRole(LIQUIDITY_DISTRIBUTOR, seedBudgetAddr));

  // SeedBudget: CALLER_ROLE
  await execTx("SeedBudget: CALLER_ROLE → SeedSale",
    seedBudgetTyped.grantRole(SEED_CALLER, seedSaleAddr));

  // Sub-reward contracts: DISTRIBUTOR_ROLE → RewardDistributor
  await execTx("ClaimRewards: DISTRIBUTOR_ROLE → RewardDistributor",
    claimRewardsTyped.grantRole(CLAIM_DISTRIBUTOR, rewardDistributorAddr));
  await execTx("PeriodicRewards: DISTRIBUTOR_ROLE → RewardDistributor",
    periodicTyped.grantRole(PERIODIC_DISTRIBUTOR, rewardDistributorAddr));
  await execTx("LuckyDraw: DISTRIBUTOR_ROLE → RewardDistributor",
    luckyDrawTyped.grantRole(LUCKY_DISTRIBUTOR, rewardDistributorAddr));
  await execTx("IncentivePool: DISTRIBUTOR_ROLE → RewardDistributor",
    incentiveTyped.grantRole(INCENTIVE_DISTRIBUTOR, rewardDistributorAddr));

  // ──────────────────────────────────────────────────────────────────────────
  // Phase I: Initial MIC Transfers
  // ──────────────────────────────────────────────────────────────────────────
  logSection("Phase I: Initial MIC Transfers");

  const micToken = await ethers.getContractAt("MICToken", micAddr);

  // SeedSale allocation
  await execTx("227.5M MIC → SeedSale",
    micToken.transfer(seedSaleAddr, MIC_SEED));

  // PreSale allocation
  await execTx("315M MIC → PreSale",
    micToken.transfer(preSaleAddr, MIC_PRESALE));

  // LiquidityPool — DEX/CEX listing allocation (locked in contract)
  await execTx("105M MIC → LiquidityPool (DEX/CEX Listing)",
    micToken.transfer(liquidityPoolAddr, MIC_LIQUIDITY));

  // Founders & Mgmt — with vesting (24-month cliff, 10% unlock, 2.5%/month)
  // Deployer needs SCHEDULE_CREATOR_ROLE to create schedules directly in Phase I
  await execTx("LockManager: grant SCHEDULE_CREATOR to deployer (for Phase I vesting setup)",
    lockManagerTyped.grantRole(SCHEDULE_CREATOR_ROLE, deployer.address));

  await execTx("280M MIC → foundersWallet (direct transfer)",
    micToken.transfer(foundersWallet, MIC_FOUNDERS));
  await execTx("LockManager: createSchedule for foundersWallet (24m cliff, 10%/2.5%)",
    lockManagerTyped.createSchedule(
      foundersWallet,
      MIC_FOUNDERS,
      CLIFF_24M,
      VEST_24M_CLIFF_BPS,
      VEST_6M_MONTHLY_BPS  // 2.5%/month
    ));

  // Community Funds — with vesting (24-month cliff, 10% unlock, 2.5%/month)
  await execTx("105M MIC → communityWallet (direct transfer)",
    micToken.transfer(communityWallet, MIC_COMMUNITY));
  await execTx("LockManager: createSchedule for communityWallet (24m cliff, 10%/2.5%)",
    lockManagerTyped.createSchedule(
      communityWallet,
      MIC_COMMUNITY,
      CLIFF_24M,
      VEST_24M_CLIFF_BPS,
      VEST_COMMUNITY_MONTHLY_BPS  // 2.5%/month
    ));

  // Revoke deployer's temporary SCHEDULE_CREATOR_ROLE
  await execTx("LockManager: revoke SCHEDULE_CREATOR from deployer",
    lockManagerTyped.revokeRole(SCHEDULE_CREATOR_ROLE, deployer.address));

  // AirdropDistributor — Incentives & Airdrops
  await execTx("17.5M MIC → AirdropDistributor",
    micToken.transfer(airdropDistributorAddr, MIC_AIRDROPS));

  // Mint test USDT to deployer (1M USDT, 6-dec)
  const usdtToken = await ethers.getContractAt("MockUSDT", usdtAddr);
  await execTx("1M MockUSDT → deployer (test funds)",
    usdtToken.mint(deployer.address, 1_000_000n * 10n ** 6n));

  // ──────────────────────────────────────────────────────────────────────────
  // Collect addresses
  // ──────────────────────────────────────────────────────────────────────────
  const addresses = {
    MockUSDT:            usdtAddr,
    MICToken:            micAddr,
    LockManager:         lockManagerAddr,
    CommunityNFT:        communityNFTAddr,
    MFPNFT:              mfpNFTAddr,
    DAOGovernor:         daoGovernorAddr,
    ManagementPool:      managementPoolAddr,
    TreasuryManager:     treasuryManagerAddr,
    LiquidityPool:       liquidityPoolAddr,
    RevenueRouter:       revenueRouterAddr,
    SeedBudget:          seedBudgetAddr,
    ClaimRewards:        claimRewardsAddr,
    PeriodicRewards:     periodicRewardsAddr,
    LuckyDraw:           luckyDrawAddr,
    IncentivePool:       incentivePoolAddr,
    RewardDistributor:   rewardDistributorAddr,
    ReferralRegistry:    referralRegistryAddr,
    SeedSale:            seedSaleAddr,
    PreSale:             preSaleAddr,
    MICELicense:         miceLicenseAddr,
    AirdropDistributor:  airdropDistributorAddr,
    EmissionController:      emissionControllerAddr,
    MiningPool:              miningPoolAddr,
    NFTStaking:              nftStakingAddr,
    CommunityNFTRewardPool:  communityNFTRewardPoolAddr,
    // Metadata
    deployer:            deployer.address,
    network:             "hardhat",
    timestamp:           new Date().toISOString(),
  };

  // ──────────────────────────────────────────────────────────────────────────
  // Summary
  // ──────────────────────────────────────────────────────────────────────────
  logSection("DEPLOYMENT COMPLETE");
  for (const [name, addr] of Object.entries(addresses)) {
    if (name === "deployer" || name === "network" || name === "timestamp") continue;
    console.log(`${name.padEnd(22)}: ${addr}`);
  }
  console.log(`\nDeployer  : ${deployer.address}`);
  console.log(`Timestamp : ${addresses.timestamp}`);

  // ──────────────────────────────────────────────────────────────────────────
  // Save to deployments/testnet.json
  // ──────────────────────────────────────────────────────────────────────────
  const deploymentsDir = path.join(__dirname, "..", "deployments");
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }

  const outPath = path.join(deploymentsDir, "testnet.json");
  fs.writeFileSync(outPath, JSON.stringify(addresses, null, 2));
  console.log(`\nAddresses saved to: ${outPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
