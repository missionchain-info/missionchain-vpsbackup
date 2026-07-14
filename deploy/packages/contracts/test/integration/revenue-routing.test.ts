import { expect } from "chai";
import { ethers } from "hardhat";
import {
  PreSale,
  MICToken,
  LockManager,
  CommunityNFT,
  ReferralRegistry,
  RevenueRouter,
  MockUSDT,
} from "../../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

// ─── Constants ────────────────────────────────────────────────────────────────
const USDT_6 = 1_000_000n; // 1 USDT in 6-decimal

// Purchase: $5,000 Luminary package
const PURCHASE_USDT = 5_000n * USDT_6; // 5_000_000_000 (6-dec)

// Referral split: 10% total (F1=7%, F2=3%) of $5,000 = $500
const REFERRAL_TOTAL = (PURCHASE_USDT * 1000n) / 10000n; // $500
const F1_USDT        = (PURCHASE_USDT * 700n)  / 10000n; // $350 = 350_000_000
const F2_USDT        = (PURCHASE_USDT * 300n)  / 10000n; // $150 = 150_000_000

// Net to RevenueRouter after referral deduction: 90% of $5,000 = $4,500
const NET_USDT = PURCHASE_USDT - REFERRAL_TOTAL; // 4_500_000_000

// RevenueRouter splits of $4,500:
//   Marketing  (35%):  $1,575 = 1_575_000_000
//   Management (7.5%): $337.50 = 337_500_000
//   Treasury  (12.5%): $562.50 = 562_500_000
//   Staking    (5%):   $225   = 225_000_000
//   Liquidity  (40%):  $1,800 = 1_800_000_000
const EXPECTED_MARKETING  = (NET_USDT * 3500n) / 10000n; // 1_575_000_000
const EXPECTED_MANAGEMENT = (NET_USDT * 750n)  / 10000n; // 337_500_000
const EXPECTED_TREASURY   = (NET_USDT * 1250n) / 10000n; // 562_500_000
const EXPECTED_STAKING    = (NET_USDT * 500n)  / 10000n; // 225_000_000
// Liquidity absorbs any rounding dust
const EXPECTED_LIQUIDITY  =
  NET_USDT - EXPECTED_MARKETING - EXPECTED_MANAGEMENT - EXPECTED_TREASURY - EXPECTED_STAKING;
// = 1_800_000_000

const ALLOCATION = 315_000_000n * 10n ** 18n; // 315M MIC (18-dec)

// ─── Fixture ──────────────────────────────────────────────────────────────────

interface Fixture {
  preSale:          PreSale;
  micToken:         MICToken;
  lockManager:      LockManager;
  communityNFT:     CommunityNFT;
  referralRegistry: ReferralRegistry;
  revenueRouter:    RevenueRouter;
  usdt:             MockUSDT;
  admin:            SignerWithAddress;
  buyer:            SignerWithAddress;
  f1:               SignerWithAddress;
  f2:               SignerWithAddress;
  // RevenueRouter recipient wallets (EOA — simple balance checks)
  marketing:        SignerWithAddress;
  management:       SignerWithAddress;
  treasury:         SignerWithAddress;
  reservedStaking:  SignerWithAddress;
  liquidity:        SignerWithAddress;
}

async function deployFixture(): Promise<Fixture> {
  const [
    admin,
    buyer,
    f1,
    f2,
    marketing,
    management,
    treasury,
    reservedStaking,
    liquidity,
  ] = await ethers.getSigners();

  // ── MockUSDT ──────────────────────────────────────────────────────────────
  const USDTFactory = await ethers.getContractFactory("MockUSDT");
  const usdt = await USDTFactory.deploy() as unknown as MockUSDT;

  // ── MICToken ──────────────────────────────────────────────────────────────
  const MICFactory = await ethers.getContractFactory("MICToken");
  const micToken = await MICFactory.deploy(admin.address) as unknown as MICToken;

  // ── LockManager ───────────────────────────────────────────────────────────
  const LMFactory = await ethers.getContractFactory("LockManager");
  const lockManager = await LMFactory.deploy() as unknown as LockManager;

  // ── CommunityNFT ──────────────────────────────────────────────────────────
  const CNFTFactory = await ethers.getContractFactory("CommunityNFT");
  const communityNFT = await CNFTFactory.deploy(
    "https://meta.missionchain.io/cnft/",
    admin.address,
  ) as unknown as CommunityNFT;

  // ── ReferralRegistry ──────────────────────────────────────────────────────
  const RegFactory = await ethers.getContractFactory("ReferralRegistry");
  const referralRegistry = await RegFactory.deploy(
    await usdt.getAddress(),
    admin.address,
  ) as unknown as ReferralRegistry;

  // ── RevenueRouter — uses EOA addresses for pool recipients ────────────────
  const RouterFactory = await ethers.getContractFactory("RevenueRouter");
  const revenueRouter = await RouterFactory.deploy(
    await usdt.getAddress(),
    marketing.address,
    management.address,
    treasury.address,
    reservedStaking.address,
    liquidity.address,
    admin.address,
  ) as unknown as RevenueRouter;

  // ── PreSale ───────────────────────────────────────────────────────────────
  const PSFactory = await ethers.getContractFactory("PreSale");
  const preSale = await PSFactory.deploy(
    await usdt.getAddress(),
    await micToken.getAddress(),
    await lockManager.getAddress(),
    await communityNFT.getAddress(),
    await referralRegistry.getAddress(),
    await revenueRouter.getAddress(),
    admin.address,
  ) as unknown as PreSale;

  // ── Wire roles ────────────────────────────────────────────────────────────
  // LockManager: grant SCHEDULE_CREATOR_ROLE to PreSale
  const SCHEDULE_CREATOR_ROLE = await lockManager.SCHEDULE_CREATOR_ROLE();
  await lockManager.connect(admin).grantRole(SCHEDULE_CREATOR_ROLE, await preSale.getAddress());

  // CommunityNFT: grant MINTER_ROLE to PreSale
  const MINTER_ROLE = await communityNFT.MINTER_ROLE();
  await communityNFT.connect(admin).grantRole(MINTER_ROLE, await preSale.getAddress());

  // ReferralRegistry: grant CALLER_ROLE to PreSale (and admin for setup)
  const CALLER_ROLE = await referralRegistry.CALLER_ROLE();
  await referralRegistry.connect(admin).grantRole(CALLER_ROLE, await preSale.getAddress());
  await referralRegistry.connect(admin).grantRole(CALLER_ROLE, admin.address);

  // RevenueRouter: grant DISTRIBUTOR_ROLE to PreSale
  const DISTRIBUTOR_ROLE = await revenueRouter.DISTRIBUTOR_ROLE();
  await revenueRouter.connect(admin).grantRole(DISTRIBUTOR_ROLE, await preSale.getAddress());

  // MICToken: set LockManager and transfer allocation to PreSale
  await micToken.connect(admin).setLockManager(await lockManager.getAddress());
  await micToken.connect(admin).transfer(await preSale.getAddress(), ALLOCATION);

  // ── Activate sale ─────────────────────────────────────────────────────────
  await preSale.connect(admin).setActive(true);

  // ── Set up referral chain: f2 ← f1 ← buyer ───────────────────────────────
  // f1's referrer is f2
  await referralRegistry.connect(admin).setReferrer(f1.address, f2.address);
  // buyer's referrer is f1
  await referralRegistry.connect(admin).setReferrer(buyer.address, f1.address);

  // ── Mint USDT for buyer and approve PreSale ───────────────────────────────
  await usdt.mint(buyer.address, PURCHASE_USDT * 2n);
  await usdt.connect(buyer).approve(await preSale.getAddress(), ethers.MaxUint256);

  return {
    preSale, micToken, lockManager, communityNFT, referralRegistry, revenueRouter,
    usdt, admin, buyer, f1, f2,
    marketing, management, treasury, reservedStaking, liquidity,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Integration — Revenue Routing 35/7.5/12.5/5/40", function () {

  describe("$5K Luminary purchase — full routing with F1+F2 referral", () => {
    let f: Fixture;
    let txReceipt: Awaited<ReturnType<typeof f.preSale.buy>>;

    before(async () => {
      f = await deployFixture();

      // Snapshot balances BEFORE purchase
      // (done inline per assertion below for clarity)

      txReceipt = await f.preSale.connect(f.buyer).buy(PURCHASE_USDT, 3);
    });

    // ── Referral payouts ──────────────────────────────────────────────────

    it("F1 receives 7% of purchase = $350 USDT", async () => {
      expect(await f.usdt.balanceOf(f.f1.address)).to.equal(F1_USDT);
    });

    it("F2 receives 3% of purchase = $150 USDT", async () => {
      expect(await f.usdt.balanceOf(f.f2.address)).to.equal(F2_USDT);
    });

    // ── RevenueRouter splits ──────────────────────────────────────────────

    it("Marketing (RewardDistributor) receives 35% of net $4,500 = $1,575", async () => {
      expect(await f.usdt.balanceOf(f.marketing.address)).to.equal(EXPECTED_MARKETING);
    });

    it("Management (ManagementPool) receives 7.5% of net $4,500 = $337.50", async () => {
      // $337.50 = 337_500_000 in 6-decimal USDT
      expect(await f.usdt.balanceOf(f.management.address)).to.equal(EXPECTED_MANAGEMENT);
    });

    it("Treasury (TreasuryManager) receives 12.5% of net $4,500 = $562.50", async () => {
      expect(await f.usdt.balanceOf(f.treasury.address)).to.equal(EXPECTED_TREASURY);
    });

    it("Reserved Staking (admin wallet) receives 5% of net $4,500 = $225", async () => {
      expect(await f.usdt.balanceOf(f.reservedStaking.address)).to.equal(EXPECTED_STAKING);
    });

    it("Liquidity Pool receives 40% of net $4,500 = $1,800 (absorbs rounding dust)", async () => {
      expect(await f.usdt.balanceOf(f.liquidity.address)).to.equal(EXPECTED_LIQUIDITY);
    });

    // ── Conservation check ────────────────────────────────────────────────

    it("total USDT distributed equals full purchase amount (no leakage)", async () => {
      const f1Balance          = await f.usdt.balanceOf(f.f1.address);
      const f2Balance          = await f.usdt.balanceOf(f.f2.address);
      const marketingBalance   = await f.usdt.balanceOf(f.marketing.address);
      const managementBalance  = await f.usdt.balanceOf(f.management.address);
      const treasuryBalance    = await f.usdt.balanceOf(f.treasury.address);
      const stakingBalance     = await f.usdt.balanceOf(f.reservedStaking.address);
      const liquidityBalance   = await f.usdt.balanceOf(f.liquidity.address);

      const totalOut = f1Balance + f2Balance + marketingBalance + managementBalance
        + treasuryBalance + stakingBalance + liquidityBalance;

      expect(totalOut).to.equal(PURCHASE_USDT);
    });

    it("PreSale contract holds 0 USDT after purchase (all forwarded)", async () => {
      expect(await f.usdt.balanceOf(await f.preSale.getAddress())).to.equal(0n);
    });

    it("RevenueRouter contract holds 0 USDT after distribution (all forwarded)", async () => {
      expect(await f.usdt.balanceOf(await f.revenueRouter.getAddress())).to.equal(0n);
    });

    it("ReferralRegistry contract holds 0 USDT after distribution (all forwarded)", async () => {
      expect(await f.usdt.balanceOf(await f.referralRegistry.getAddress())).to.equal(0n);
    });

    // ── MIC delivery ──────────────────────────────────────────────────────

    it("buyer receives 1,000,000 MIC (Luminary package)", async () => {
      const expectedMIC = 1_000_000n * 10n ** 18n;
      expect(await f.micToken.balanceOf(f.buyer.address)).to.equal(expectedMIC);
    });

    it("buyer MIC is fully locked via LockManager immediately after purchase", async () => {
      const expectedMIC = 1_000_000n * 10n ** 18n;
      expect(await f.lockManager.lockedOf(f.buyer.address)).to.equal(expectedMIC);
    });

    // ── Event verification ────────────────────────────────────────────────

    it("emits PreSalePurchase event with correct args", async () => {
      const expectedMIC = 1_000_000n * 10n ** 18n;
      await expect(txReceipt)
        .to.emit(f.preSale, "PreSalePurchase")
        .withArgs(f.buyer.address, PURCHASE_USDT, expectedMIC, 3n);
    });

    it("emits RevenueDistributed event with net $4,500", async () => {
      await expect(txReceipt)
        .to.emit(f.revenueRouter, "RevenueDistributed")
        .withArgs(await f.preSale.getAddress(), NET_USDT);
    });

    it("emits ReferralRegistry RewardDistributed event with correct F1/F2 amounts", async () => {
      await expect(txReceipt)
        .to.emit(f.referralRegistry, "RewardDistributed")
        .withArgs(f.buyer.address, f.f1.address, F1_USDT, f.f2.address, F2_USDT);
    });
  });

  // ─── Exact numeric verification ──────────────────────────────────────────

  describe("Exact numeric assertions (6-decimal USDT)", () => {
    let f: Fixture;

    before(async () => {
      f = await deployFixture();
      await f.preSale.connect(f.buyer).buy(PURCHASE_USDT, 3);
    });

    it("EXPECTED_MARKETING  = 1_575_000_000 (1,575.000000 USDT)", async () => {
      expect(EXPECTED_MARKETING).to.equal(1_575_000_000n);
      expect(await f.usdt.balanceOf(f.marketing.address)).to.equal(1_575_000_000n);
    });

    it("EXPECTED_MANAGEMENT = 337_500_000 (337.500000 USDT)", async () => {
      expect(EXPECTED_MANAGEMENT).to.equal(337_500_000n);
      expect(await f.usdt.balanceOf(f.management.address)).to.equal(337_500_000n);
    });

    it("EXPECTED_TREASURY   = 562_500_000 (562.500000 USDT)", async () => {
      expect(EXPECTED_TREASURY).to.equal(562_500_000n);
      expect(await f.usdt.balanceOf(f.treasury.address)).to.equal(562_500_000n);
    });

    it("EXPECTED_STAKING    = 225_000_000 (225.000000 USDT)", async () => {
      expect(EXPECTED_STAKING).to.equal(225_000_000n);
      expect(await f.usdt.balanceOf(f.reservedStaking.address)).to.equal(225_000_000n);
    });

    it("EXPECTED_LIQUIDITY  = 1_800_000_000 (1,800.000000 USDT)", async () => {
      expect(EXPECTED_LIQUIDITY).to.equal(1_800_000_000n);
      expect(await f.usdt.balanceOf(f.liquidity.address)).to.equal(1_800_000_000n);
    });

    it("F1_USDT = 350_000_000 (350.000000 USDT)", async () => {
      expect(F1_USDT).to.equal(350_000_000n);
      expect(await f.usdt.balanceOf(f.f1.address)).to.equal(350_000_000n);
    });

    it("F2_USDT = 150_000_000 (150.000000 USDT)", async () => {
      expect(F2_USDT).to.equal(150_000_000n);
      expect(await f.usdt.balanceOf(f.f2.address)).to.equal(150_000_000n);
    });
  });

  // ─── No referrer case — 100% to RevenueRouter ────────────────────────────

  describe("$5K purchase with NO referrer — 100% routes to RevenueRouter", () => {
    let f: Fixture;
    let noReferrerBuyer: Awaited<ReturnType<typeof ethers.getSigner>>;

    before(async () => {
      f = await deployFixture();
      // Use a fresh signer with no referrer set
      const signers = await ethers.getSigners();
      noReferrerBuyer = signers[9]; // safe index not used in fixture

      await f.usdt.mint(noReferrerBuyer.address, PURCHASE_USDT);
      await f.usdt.connect(noReferrerBuyer).approve(await f.preSale.getAddress(), ethers.MaxUint256);
      await f.preSale.connect(noReferrerBuyer).buy(PURCHASE_USDT, 3);
    });

    it("Marketing receives 35% of full $5,000 = $1,750 (no referral deduction)", async () => {
      const expected = (PURCHASE_USDT * 3500n) / 10000n; // 1_750_000_000
      expect(await f.usdt.balanceOf(f.marketing.address)).to.equal(expected);
    });

    it("Liquidity receives 40% of full $5,000 = $2,000", async () => {
      const toMarketing  = (PURCHASE_USDT * 3500n) / 10000n;
      const toManagement = (PURCHASE_USDT * 750n)  / 10000n;
      const toTreasury   = (PURCHASE_USDT * 1250n) / 10000n;
      const toStaking    = (PURCHASE_USDT * 500n)  / 10000n;
      const toLiquidity  = PURCHASE_USDT - toMarketing - toManagement - toTreasury - toStaking;
      expect(await f.usdt.balanceOf(f.liquidity.address)).to.equal(toLiquidity);
    });

    it("F1 and F2 addresses receive nothing", async () => {
      expect(await f.usdt.balanceOf(f.f1.address)).to.equal(0n);
      expect(await f.usdt.balanceOf(f.f2.address)).to.equal(0n);
    });

    it("PreSale holds 0 USDT", async () => {
      expect(await f.usdt.balanceOf(await f.preSale.getAddress())).to.equal(0n);
    });
  });
});
