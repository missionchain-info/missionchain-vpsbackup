import { expect } from "chai";
import { ethers } from "hardhat";
import {
  PreSale,
  MICToken,
  LockManager,
  CommunityNFTv2,
  ReferralRegistry,
  RevenueRouter,
  MockUSDT,
  MockRewardReceiver,
} from "../../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

// ─── Constants ────────────────────────────────────────────────────────────────
// 1 USDT. BSC-USD is an 18-decimal token; the name is kept so the diff stays small.
const USDT_6 = 10n ** 18n;

// Purchase: $5,000 Luminary package
const PURCHASE_USDT = 5_000n * USDT_6;

// Revenue model V2 (2026-07): the sale sends the FULL GROSS to RevenueRouter, which splits
// 6 ways — every % is of GROSS, nothing is taken off the top:
//   Referral   10%  → ReferralRegistry ($500)   → F1 7% ($350) + F2 3% ($150)
//   Marketing  25%  → RewardDistributorV2       ($1,250)
//   Management  7.5%                            ($375)
//   Treasury   12.5%                            ($625)
//   Staking     5%                              ($250)
//   Liquidity  40%  (absorbs rounding dust)     ($2,000)
const EXPECTED_REFERRAL   = (PURCHASE_USDT * 1000n) / 10000n; 
const EXPECTED_MARKETING  = (PURCHASE_USDT * 2500n) / 10000n; 
const EXPECTED_MANAGEMENT = (PURCHASE_USDT * 750n)  / 10000n; 
const EXPECTED_TREASURY   = (PURCHASE_USDT * 1250n) / 10000n; 
const EXPECTED_STAKING    = (PURCHASE_USDT * 500n)  / 10000n; 
const EXPECTED_LIQUIDITY  =
  PURCHASE_USDT - EXPECTED_REFERRAL - EXPECTED_MARKETING
  - EXPECTED_MANAGEMENT - EXPECTED_TREASURY - EXPECTED_STAKING; 

const F1_USDT = (PURCHASE_USDT * 700n) / 10000n; // $350
const F2_USDT = (PURCHASE_USDT * 300n) / 10000n; // $150

const ALLOCATION = 315_000_000n * 10n ** 18n; // 315M MIC (18-dec)

// ─── Fixture ──────────────────────────────────────────────────────────────────

interface Fixture {
  preSale:          PreSale;
  micToken:         MICToken;
  lockManager:      LockManager;
  communityNFT:     CommunityNFTv2;
  referralRegistry: ReferralRegistry;
  revenueRouter:    RevenueRouter;
  usdt:             MockUSDT;
  admin:            SignerWithAddress;
  buyer:            SignerWithAddress;
  f1:               SignerWithAddress;
  f2:               SignerWithAddress;
  // Router sinks — CONTRACTS: the router calls receiveAndDistribute()/receiveUSDT()
  // on them, so EOAs cannot stand in.
  marketing:        MockRewardReceiver;
  management:       MockRewardReceiver;
  treasury:         MockRewardReceiver;
  reservedStaking:  MockRewardReceiver;
  liquidity:        MockRewardReceiver;
  miPool:           MockRewardReceiver;   // Milestones & Incentives (referral overflow sink)
}

async function deployFixture(): Promise<Fixture> {
  const [admin, buyer, f1, f2] = await ethers.getSigners();

  // ── MockUSDT ──────────────────────────────────────────────────────────────
  const USDTFactory = await ethers.getContractFactory("MockUSDT");
  const usdt = await USDTFactory.deploy() as unknown as MockUSDT;

  // ── MICToken ──────────────────────────────────────────────────────────────
  const MICFactory = await ethers.getContractFactory("MICToken");
  const micToken = await MICFactory.deploy(admin.address) as unknown as MICToken;

  // ── LockManager ───────────────────────────────────────────────────────────
  const LMFactory = await ethers.getContractFactory("LockManager");
  const lockManager = await LMFactory.deploy() as unknown as LockManager;

  // ── CommunityNFTv2 ────────────────────────────────────────────────────────
  const CNFTFactory = await ethers.getContractFactory("CommunityNFTv2");
  const communityNFT = await CNFTFactory.deploy(admin.address) as unknown as CommunityNFTv2;

  // ── ReferralRegistry ──────────────────────────────────────────────────────
  const RegFactory = await ethers.getContractFactory("ReferralRegistry");
  const referralRegistry = await RegFactory.deploy(
    await usdt.getAddress(),
    admin.address,
  ) as unknown as ReferralRegistry;

  // ── Router sinks ──────────────────────────────────────────────────────────
  const MRFactory = await ethers.getContractFactory("MockRewardReceiver");
  const newSink = async () =>
    await MRFactory.deploy(await usdt.getAddress()) as unknown as MockRewardReceiver;
  const marketing       = await newSink();
  const management      = await newSink();
  const treasury        = await newSink();
  const reservedStaking = await newSink();
  const liquidity       = await newSink();
  const miPool          = await newSink();

  // ── RevenueRouter — 8 args, referral slice pushed to the registry ─────────
  const RouterFactory = await ethers.getContractFactory("RevenueRouter");
  const revenueRouter = await RouterFactory.deploy(
    await usdt.getAddress(),
    await referralRegistry.getAddress(),
    await marketing.getAddress(),
    await management.getAddress(),
    await treasury.getAddress(),
    await reservedStaking.getAddress(),
    await liquidity.getAddress(),
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
  const SCHEDULE_CREATOR_ROLE = await lockManager.SCHEDULE_CREATOR_ROLE();
  await lockManager.connect(admin).grantRole(SCHEDULE_CREATOR_ROLE, await preSale.getAddress());

  const MINTER_ROLE = await communityNFT.MINTER_ROLE();
  await communityNFT.connect(admin).grantRole(MINTER_ROLE, await preSale.getAddress());

  const CALLER_ROLE = await referralRegistry.CALLER_ROLE();
  await referralRegistry.connect(admin).grantRole(CALLER_ROLE, await preSale.getAddress());
  await referralRegistry.connect(admin).grantRole(CALLER_ROLE, admin.address);
  await referralRegistry.connect(admin).setIncentivePool(await miPool.getAddress());

  const DISTRIBUTOR_ROLE = await revenueRouter.DISTRIBUTOR_ROLE();
  await revenueRouter.connect(admin).grantRole(DISTRIBUTOR_ROLE, await preSale.getAddress());

  // MICToken: set LockManager and transfer allocation to PreSale
  await micToken.connect(admin).setLockManager(await lockManager.getAddress());
  await micToken.connect(admin).transfer(await preSale.getAddress(), ALLOCATION);

  // ── Activate sale ─────────────────────────────────────────────────────────
  await preSale.connect(admin).setActive(true);

  // ── Set up referral chain: f2 ← f1 ← buyer ───────────────────────────────
  await referralRegistry.connect(admin).setReferrer(f1.address, f2.address);
  await referralRegistry.connect(admin).setReferrer(buyer.address, f1.address);

  // ── Mint USDT for buyer and approve PreSale ───────────────────────────────
  await usdt.mint(buyer.address, PURCHASE_USDT * 2n);
  await usdt.connect(buyer).approve(await preSale.getAddress(), ethers.MaxUint256);

  return {
    preSale, micToken, lockManager, communityNFT, referralRegistry, revenueRouter,
    usdt, admin, buyer, f1, f2,
    marketing, management, treasury, reservedStaking, liquidity, miPool,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Integration — Revenue Routing 10/25/7.5/12.5/5/40 (all % of GROSS)", function () {

  describe("$5K Luminary purchase — full routing with F1+F2 referral", () => {
    let f: Fixture;
    let txReceipt: Awaited<ReturnType<typeof f.preSale.buy>>;

    before(async () => {
      f = await deployFixture();
      txReceipt = await f.preSale.connect(f.buyer).buy(PURCHASE_USDT, 3);
    });

    // ── Referral payouts ──────────────────────────────────────────────────

    it("F1 receives 7% of purchase = $350 USDT", async () => {
      expect(await f.usdt.balanceOf(f.f1.address)).to.equal(F1_USDT);
    });

    it("F2 receives 3% of purchase = $150 USDT", async () => {
      expect(await f.usdt.balanceOf(f.f2.address)).to.equal(F2_USDT);
    });

    it("F1 + F2 together consume the entire 10% referral slice (no overflow)", async () => {
      expect(F1_USDT + F2_USDT).to.equal(EXPECTED_REFERRAL);
      expect(await f.miPool.received()).to.equal(0n);
    });

    // ── RevenueRouter splits ──────────────────────────────────────────────

    it("Marketing (RewardDistributorV2) receives 25% of gross $5,000 = $1,250", async () => {
      expect(await f.marketing.received()).to.equal(EXPECTED_MARKETING);
    });

    it("Management (ManagementPool) receives 7.5% of gross = $375", async () => {
      expect(await f.management.received()).to.equal(EXPECTED_MANAGEMENT);
    });

    it("Treasury (TreasuryManager) receives 12.5% of gross = $625", async () => {
      expect(await f.treasury.received()).to.equal(EXPECTED_TREASURY);
    });

    it("Listing Reserve receives 5% of gross = $250", async () => {
      expect(await f.reservedStaking.received()).to.equal(EXPECTED_STAKING);
    });

    it("Liquidity Pool receives 40% of gross = $2,000 (absorbs rounding dust)", async () => {
      expect(await f.liquidity.received()).to.equal(EXPECTED_LIQUIDITY);
    });

    // ── Conservation check ────────────────────────────────────────────────

    it("total USDT distributed equals full purchase amount (no leakage)", async () => {
      const totalOut =
        await f.usdt.balanceOf(f.f1.address)
        + await f.usdt.balanceOf(f.f2.address)
        + await f.marketing.received()
        + await f.management.received()
        + await f.treasury.received()
        + await f.reservedStaking.received()
        + await f.liquidity.received()
        + await f.miPool.received();

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

    it("emits RevenueDistributed with the GROSS $5,000 (not a net amount)", async () => {
      await expect(txReceipt)
        .to.emit(f.revenueRouter, "RevenueDistributed")
        .withArgs(await f.preSale.getAddress(), PURCHASE_USDT);
    });

    it("emits ReferralRegistry RewardDistributed event with correct F1/F2 amounts", async () => {
      await expect(txReceipt)
        .to.emit(f.referralRegistry, "RewardDistributed")
        .withArgs(f.buyer.address, f.f1.address, F1_USDT, f.f2.address, F2_USDT);
    });
  });

  // ─── Exact numeric verification ──────────────────────────────────────────

  describe("Exact numeric assertions (18-decimal USDT)", () => {
    let f: Fixture;

    before(async () => {
      f = await deployFixture();
      await f.preSale.connect(f.buyer).buy(PURCHASE_USDT, 3);
    });

    it("EXPECTED_MARKETING = $1,250", async () => {
      expect(EXPECTED_MARKETING).to.equal(1_250n * USDT_6);
      expect(await f.marketing.received()).to.equal(1_250n * USDT_6);
    });

    it("EXPECTED_MANAGEMENT = $375", async () => {
      expect(EXPECTED_MANAGEMENT).to.equal(375n * USDT_6);
      expect(await f.management.received()).to.equal(375n * USDT_6);
    });

    it("EXPECTED_TREASURY = $625", async () => {
      expect(EXPECTED_TREASURY).to.equal(625n * USDT_6);
      expect(await f.treasury.received()).to.equal(625n * USDT_6);
    });

    it("EXPECTED_STAKING = $250", async () => {
      expect(EXPECTED_STAKING).to.equal(250n * USDT_6);
      expect(await f.reservedStaking.received()).to.equal(250n * USDT_6);
    });

    it("EXPECTED_LIQUIDITY = $2,000", async () => {
      expect(EXPECTED_LIQUIDITY).to.equal(2_000n * USDT_6);
      expect(await f.liquidity.received()).to.equal(2_000n * USDT_6);
    });

    it("F1_USDT = $350", async () => {
      expect(F1_USDT).to.equal(350n * USDT_6);
      expect(await f.usdt.balanceOf(f.f1.address)).to.equal(350n * USDT_6);
    });

    it("F2_USDT = $150", async () => {
      expect(F2_USDT).to.equal(150n * USDT_6);
      expect(await f.usdt.balanceOf(f.f2.address)).to.equal(150n * USDT_6);
    });
  });

  // ─── No referrer — referral 10% overflows to Milestones & Incentives ─────

  describe("$5K purchase with NO referrer — the 10% referral slice overflows to M&I", () => {
    let f: Fixture;
    let noReferrerBuyer: Awaited<ReturnType<typeof ethers.getSigner>>;

    before(async () => {
      f = await deployFixture();
      const signers = await ethers.getSigners();
      noReferrerBuyer = signers[9]; // safe index not used in fixture

      await f.usdt.mint(noReferrerBuyer.address, PURCHASE_USDT);
      await f.usdt.connect(noReferrerBuyer).approve(await f.preSale.getAddress(), ethers.MaxUint256);
      await f.preSale.connect(noReferrerBuyer).buy(PURCHASE_USDT, 3);
    });

    it("Marketing still receives 25% of gross $5,000 = $1,250", async () => {
      expect(await f.marketing.received()).to.equal(EXPECTED_MARKETING);
    });

    it("Liquidity still receives 40% of gross = $2,000", async () => {
      expect(await f.liquidity.received()).to.equal(EXPECTED_LIQUIDITY);
    });

    it("the entire 10% ($500) lands in the M&I pool", async () => {
      expect(await f.miPool.received()).to.equal(EXPECTED_REFERRAL);
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
