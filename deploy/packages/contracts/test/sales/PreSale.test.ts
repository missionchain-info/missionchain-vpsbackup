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
import { time } from "@nomicfoundation/hardhat-network-helpers";

// ─── Package spec ──────────────────────────────────────────────────────────────
// packageIndex 0 = no package (min $25)
// packageIndex 1 = Builder   — $1,000 USDT / 200,000 MIC / Builder NFT  (60d)
// packageIndex 2 = Maker     — $2,500 USDT / 500,000 MIC / Maker NFT   (90d)
// packageIndex 3 = Luminary  — $5,000 USDT / 1,000,000 MIC / Luminary NFT (180d)
//
// MIC conversion: 1 USDT (6-dec) = 200 MIC (18-dec)
//   formula: usdtAmount * 200 * 1e12
//
// Revenue model V2 (2026-07) — PreSale sends the FULL GROSS to RevenueRouter, which splits
// 6 ways on GROSS: Referral 10% → ReferralRegistry · Marketing 25% · Management 7.5% ·
// Treasury 12.5% · Staking 5% · Liquidity 40% (absorbs dust).
// PreSale then calls registry.distributeReferral() which pays F1 7% / F2 3% out of the
// registry's own balance; any unspent share overflows to Milestones & Incentives.
//
// ALLOCATION: 315,000,000 MIC = 315_000_000e18
// HARD_CAP:   $1,575,000 USDT = 1_575_000 ether (18-dec)

const USDT_6  = 10n ** 18n;             // 1 USDT. BSC-USD is 18 decimals, not 6 —
                                        // the name is kept so the diff stays readable.
const MIC_18  = 10n ** 18n;             // 1 MIC in 18-decimal

const MIN_USDT    = 25n     * USDT_6;    //  $25
const PKG1_USDT   = 1_000n  * USDT_6;   //  $1,000
const PKG2_USDT   = 2_500n  * USDT_6;   //  $2,500
const PKG3_USDT   = 5_000n  * USDT_6;   //  $5,000

const MIN_MIC     = 5_000n    * MIC_18;
const PKG1_MIC    = 200_000n  * MIC_18;
const PKG2_MIC    = 500_000n  * MIC_18;
const PKG3_MIC    = 1_000_000n * MIC_18;

const ALLOCATION  = 315_000_000n * MIC_18;
const HARD_CAP    = 1_575_000n * USDT_6;

const BUILDER_TIER  = 1n;
const MAKER_TIER    = 2n;
const LUMINARY_TIER = 3n;

// ─── Router gross BPS (of 10000) ──────────────────────────────────────────────
const BPS_REFERRAL   = 1000n; // 10%
const BPS_MARKETING  = 2500n; // 25%
const BPS_MANAGEMENT = 750n;  // 7.5%
const BPS_TREASURY   = 1250n; // 12.5%
const BPS_STAKING    = 500n;  // 5%

/// Marketing slice of a GROSS purchase amount.
const marketingOf = (gross: bigint) => (gross * BPS_MARKETING) / 10_000n;

/// Liquidity slice — the router gives liquidity the remainder, so it absorbs rounding dust.
const liquidityOf = (gross: bigint) =>
  gross
  - (gross * BPS_REFERRAL)   / 10_000n
  - (gross * BPS_MARKETING)  / 10_000n
  - (gross * BPS_MANAGEMENT) / 10_000n
  - (gross * BPS_TREASURY)   / 10_000n
  - (gross * BPS_STAKING)    / 10_000n;

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
  f1:               SignerWithAddress;   // F1 referrer for buyer
  f2:               SignerWithAddress;   // F2 referrer (f1's referrer)
  other:            SignerWithAddress;   // buyer with no referrer
  // RevenueRouter recipients — CONTRACTS, not EOAs: the router calls
  // receiveAndDistribute()/receiveUSDT() on them, so they must implement the interface.
  marketing:        MockRewardReceiver;
  management:       MockRewardReceiver;
  treasury:         MockRewardReceiver;
  reservedStaking:  MockRewardReceiver;
  liquidity:        MockRewardReceiver;
  // Milestones & Incentives sink for unspent referral (registry overflow target)
  miPool:           MockRewardReceiver;
}

async function deployFixture(): Promise<Fixture> {
  const [
    admin,
    buyer,
    f1,
    f2,
    other,
  ] = await ethers.getSigners();

  // ── MockUSDT ──────────────────────────────────────────────────────────────
  const USDT = await ethers.getContractFactory("MockUSDT");
  const usdt = await USDT.deploy() as unknown as MockUSDT;

  // ── MICToken ──────────────────────────────────────────────────────────────
  const MICFactory = await ethers.getContractFactory("MICToken");
  const micToken = await MICFactory.deploy(admin.address) as unknown as MICToken;

  // ── LockManager ───────────────────────────────────────────────────────────
  const LMFactory = await ethers.getContractFactory("LockManager");
  const lockManager = await LMFactory.deploy() as unknown as LockManager;

  // ── CommunityNFTv2 (ERC-721 serial — what the Phase-1 deploy actually ships) ─
  const CNFTFactory = await ethers.getContractFactory("CommunityNFTv2");
  const communityNFT = await CNFTFactory.deploy(
    admin.address,
  ) as unknown as CommunityNFTv2;

  // ── ReferralRegistry ──────────────────────────────────────────────────────
  const RegFactory = await ethers.getContractFactory("ReferralRegistry");
  const referralRegistry = await RegFactory.deploy(
    await usdt.getAddress(),
    admin.address,
  ) as unknown as ReferralRegistry;

  // ── Router sinks — contracts (router CALLS them), plus the M&I overflow sink ─
  const MRFactory = await ethers.getContractFactory("MockRewardReceiver");
  const newSink = async () =>
    await MRFactory.deploy(await usdt.getAddress()) as unknown as MockRewardReceiver;
  const marketing       = await newSink();
  const management      = await newSink();
  const treasury        = await newSink();
  const reservedStaking = await newSink();
  const liquidity       = await newSink();
  const miPool          = await newSink();

  // ── RevenueRouter — 8 args, referral slice goes to the registry ───────────
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

  // ── Grant roles ───────────────────────────────────────────────────────────
  // LockManager: SCHEDULE_CREATOR_ROLE → preSale
  const SCHEDULE_CREATOR_ROLE = await lockManager.SCHEDULE_CREATOR_ROLE();
  await lockManager.connect(admin).grantRole(SCHEDULE_CREATOR_ROLE, await preSale.getAddress());

  // CommunityNFT: MINTER_ROLE → preSale
  const MINTER_ROLE = await communityNFT.MINTER_ROLE();
  await communityNFT.connect(admin).grantRole(MINTER_ROLE, await preSale.getAddress());

  // ReferralRegistry: CALLER_ROLE → preSale; unspent referral overflows to M&I
  const CALLER_ROLE = await referralRegistry.CALLER_ROLE();
  await referralRegistry.connect(admin).grantRole(CALLER_ROLE, await preSale.getAddress());
  await referralRegistry.connect(admin).setIncentivePool(await miPool.getAddress());

  // RevenueRouter: DISTRIBUTOR_ROLE → preSale
  const DISTRIBUTOR_ROLE = await revenueRouter.DISTRIBUTOR_ROLE();
  await revenueRouter.connect(admin).grantRole(DISTRIBUTOR_ROLE, await preSale.getAddress());

  // ── Fund PreSale with 315M MIC ─────────────────────────────────────────────
  await micToken.connect(admin).transfer(await preSale.getAddress(), ALLOCATION);

  // ── Activate sale ─────────────────────────────────────────────────────────
  await preSale.connect(admin).setActive(true);

  // ── Set up referral chain: f2 → f1 → buyer ────────────────────────────────
  // f1's referrer is f2
  await referralRegistry.connect(admin).grantRole(CALLER_ROLE, admin.address);
  await referralRegistry.connect(admin).setReferrer(f1.address, f2.address);
  // buyer's referrer is f1
  await referralRegistry.connect(admin).setReferrer(buyer.address, f1.address);

  // ── Mint USDT for buyers ──────────────────────────────────────────────────
  const large = 100_000n * USDT_6;
  await usdt.mint(buyer.address,  large);
  await usdt.mint(other.address,  large);
  await usdt.connect(buyer).approve( await preSale.getAddress(), ethers.MaxUint256);
  await usdt.connect(other).approve( await preSale.getAddress(), ethers.MaxUint256);

  return {
    preSale, micToken, lockManager, communityNFT, referralRegistry, revenueRouter,
    usdt, admin, buyer, f1, f2, other,
    marketing, management, treasury, reservedStaking, liquidity, miPool,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("PreSale", function () {

  // ─── Constructor ────────────────────────────────────────────────────────────

  describe("Constructor", () => {
    let f: Fixture;
    beforeEach(async () => { f = await deployFixture(); });

    it("stores usdt address", async () => {
      expect(await f.preSale.usdt()).to.equal(await f.usdt.getAddress());
    });

    it("stores micToken address", async () => {
      expect(await f.preSale.micToken()).to.equal(await f.micToken.getAddress());
    });

    it("stores lockManager address", async () => {
      expect(await f.preSale.lockManager()).to.equal(await f.lockManager.getAddress());
    });

    it("stores communityNFT address", async () => {
      expect(await f.preSale.communityNFT()).to.equal(await f.communityNFT.getAddress());
    });

    it("stores referralRegistry address", async () => {
      expect(await f.preSale.referralRegistry()).to.equal(await f.referralRegistry.getAddress());
    });

    it("stores revenueRouter address", async () => {
      expect(await f.preSale.revenueRouter()).to.equal(await f.revenueRouter.getAddress());
    });

    it("grants DEFAULT_ADMIN_ROLE to admin", async () => {
      const role = await f.preSale.DEFAULT_ADMIN_ROLE();
      expect(await f.preSale.hasRole(role, f.admin.address)).to.be.true;
    });

    it("sets ALLOCATION constant to 315M MIC", async () => {
      expect(await f.preSale.ALLOCATION()).to.equal(ALLOCATION);
    });

    it("sets HARD_CAP constant to $1.575M USDT", async () => {
      expect(await f.preSale.HARD_CAP()).to.equal(HARD_CAP);
    });

    it("sale starts inactive (active = false)", async () => {
      const [admin] = await ethers.getSigners();
      const PSFactory = await ethers.getContractFactory("PreSale");
      const fresh = await PSFactory.deploy(
        await f.usdt.getAddress(),
        await f.micToken.getAddress(),
        await f.lockManager.getAddress(),
        await f.communityNFT.getAddress(),
        await f.referralRegistry.getAddress(),
        await f.revenueRouter.getAddress(),
        admin.address,
      );
      expect(await fresh.active()).to.be.false;
    });

    it("reverts if usdt is zero address", async () => {
      const [admin] = await ethers.getSigners();
      const PSFactory = await ethers.getContractFactory("PreSale");
      await expect(PSFactory.deploy(
        ethers.ZeroAddress,
        await f.micToken.getAddress(),
        await f.lockManager.getAddress(),
        await f.communityNFT.getAddress(),
        await f.referralRegistry.getAddress(),
        await f.revenueRouter.getAddress(),
        admin.address,
      )).to.be.revertedWith("PS: zero usdt");
    });

    it("reverts if micToken is zero address", async () => {
      const [admin] = await ethers.getSigners();
      const PSFactory = await ethers.getContractFactory("PreSale");
      await expect(PSFactory.deploy(
        await f.usdt.getAddress(),
        ethers.ZeroAddress,
        await f.lockManager.getAddress(),
        await f.communityNFT.getAddress(),
        await f.referralRegistry.getAddress(),
        await f.revenueRouter.getAddress(),
        admin.address,
      )).to.be.revertedWith("PS: zero micToken");
    });

    it("reverts if lockManager is zero address", async () => {
      const [admin] = await ethers.getSigners();
      const PSFactory = await ethers.getContractFactory("PreSale");
      await expect(PSFactory.deploy(
        await f.usdt.getAddress(),
        await f.micToken.getAddress(),
        ethers.ZeroAddress,
        await f.communityNFT.getAddress(),
        await f.referralRegistry.getAddress(),
        await f.revenueRouter.getAddress(),
        admin.address,
      )).to.be.revertedWith("PS: zero lockManager");
    });

    it("reverts if communityNFT is zero address", async () => {
      const [admin] = await ethers.getSigners();
      const PSFactory = await ethers.getContractFactory("PreSale");
      await expect(PSFactory.deploy(
        await f.usdt.getAddress(),
        await f.micToken.getAddress(),
        await f.lockManager.getAddress(),
        ethers.ZeroAddress,
        await f.referralRegistry.getAddress(),
        await f.revenueRouter.getAddress(),
        admin.address,
      )).to.be.revertedWith("PS: zero communityNFT");
    });

    it("reverts if referralRegistry is zero address", async () => {
      const [admin] = await ethers.getSigners();
      const PSFactory = await ethers.getContractFactory("PreSale");
      await expect(PSFactory.deploy(
        await f.usdt.getAddress(),
        await f.micToken.getAddress(),
        await f.lockManager.getAddress(),
        await f.communityNFT.getAddress(),
        ethers.ZeroAddress,
        await f.revenueRouter.getAddress(),
        admin.address,
      )).to.be.revertedWith("PS: zero referralRegistry");
    });

    it("reverts if revenueRouter is zero address", async () => {
      const [admin] = await ethers.getSigners();
      const PSFactory = await ethers.getContractFactory("PreSale");
      await expect(PSFactory.deploy(
        await f.usdt.getAddress(),
        await f.micToken.getAddress(),
        await f.lockManager.getAddress(),
        await f.communityNFT.getAddress(),
        await f.referralRegistry.getAddress(),
        ethers.ZeroAddress,
        admin.address,
      )).to.be.revertedWith("PS: zero revenueRouter");
    });
  });

  // ─── Buy — minimum ($25, no package) ─────────────────────────────────────────

  describe("buy — minimum $25 (packageIndex=0, no NFT)", () => {
    let f: Fixture;
    beforeEach(async () => { f = await deployFixture(); });

    it("transfers correct MIC to buyer", async () => {
      const before = await f.micToken.balanceOf(f.other.address);
      await f.preSale.connect(f.other).buy(MIN_USDT, 0);
      expect(await f.micToken.balanceOf(f.other.address) - before).to.equal(MIN_MIC);
    });

    it("buyer loses correct USDT", async () => {
      const before = await f.usdt.balanceOf(f.other.address);
      await f.preSale.connect(f.other).buy(MIN_USDT, 0);
      expect(before - await f.usdt.balanceOf(f.other.address)).to.equal(MIN_USDT);
    });

    it("100% of GROSS USDT is routed: marketing 25%, liquidity 40%", async () => {
      await f.preSale.connect(f.other).buy(MIN_USDT, 0);

      expect(await f.marketing.received()).to.equal(marketingOf(MIN_USDT));
      expect(await f.liquidity.received()).to.equal(liquidityOf(MIN_USDT));
    });

    it("no NFT minted for packageIndex=0", async () => {
      await f.preSale.connect(f.other).buy(MIN_USDT, 0);
      // No package → no mint at all, so the global serial counter stays at 0.
      expect(await f.communityNFT.totalSerials()).to.equal(0n);
    });

    it("PreSale contract keeps 0 USDT after buy", async () => {
      await f.preSale.connect(f.other).buy(MIN_USDT, 0);
      expect(await f.usdt.balanceOf(await f.preSale.getAddress())).to.equal(0n);
    });

    it("creates vesting schedule for buyer", async () => {
      await f.preSale.connect(f.other).buy(MIN_USDT, 0);
      const schedules = await f.lockManager.getSchedules(f.other.address);
      expect(schedules.length).to.equal(1);
      expect(schedules[0].totalAmount).to.equal(MIN_MIC);
      expect(schedules[0].cliffDuration).to.equal(180n * 24n * 3600n); // 180 days
      expect(schedules[0].cliffUnlockBps).to.equal(1000n);   // 10%
      expect(schedules[0].monthlyUnlockBps).to.equal(250n);  // 2.5%
    });

    it("increments totalSold by MIC amount", async () => {
      await f.preSale.connect(f.other).buy(MIN_USDT, 0);
      expect(await f.preSale.totalSold()).to.equal(MIN_MIC);
    });

    it("emits PreSalePurchase event", async () => {
      await expect(f.preSale.connect(f.other).buy(MIN_USDT, 0))
        .to.emit(f.preSale, "PreSalePurchase")
        .withArgs(f.other.address, MIN_USDT, MIN_MIC, 0n);
    });
  });

  // ─── Buy — Package 1: Builder ($1,000) ────────────────────────────────────────

  describe("buy — Package 1 Builder ($1,000)", () => {
    let f: Fixture;
    beforeEach(async () => { f = await deployFixture(); });

    it("transfers 200,000 MIC to buyer", async () => {
      const before = await f.micToken.balanceOf(f.other.address);
      await f.preSale.connect(f.other).buy(PKG1_USDT, 1);
      expect(await f.micToken.balanceOf(f.other.address) - before).to.equal(PKG1_MIC);
    });

    it("mints Builder NFT to buyer", async () => {
      await f.preSale.connect(f.other).buy(PKG1_USDT, 1);
      const balance = await f.communityNFT.activeCountOf(f.other.address, BUILDER_TIER);
      expect(balance).to.equal(1n);
    });

    it("no Maker or Luminary NFT minted", async () => {
      await f.preSale.connect(f.other).buy(PKG1_USDT, 1);
      expect(await f.communityNFT.activeCountOf(f.other.address, MAKER_TIER)).to.equal(0n);
      expect(await f.communityNFT.activeCountOf(f.other.address, LUMINARY_TIER)).to.equal(0n);
    });

    it("creates vesting schedule with correct parameters", async () => {
      await f.preSale.connect(f.other).buy(PKG1_USDT, 1);
      const schedules = await f.lockManager.getSchedules(f.other.address);
      expect(schedules.length).to.equal(1);
      expect(schedules[0].totalAmount).to.equal(PKG1_MIC);
    });

    it("emits PreSalePurchase with packageIndex=1", async () => {
      await expect(f.preSale.connect(f.other).buy(PKG1_USDT, 1))
        .to.emit(f.preSale, "PreSalePurchase")
        .withArgs(f.other.address, PKG1_USDT, PKG1_MIC, 1n);
    });
  });

  // ─── Buy — Package 2: Maker ($2,500) ─────────────────────────────────────────

  describe("buy — Package 2 Maker ($2,500)", () => {
    let f: Fixture;
    beforeEach(async () => { f = await deployFixture(); });

    it("transfers 500,000 MIC to buyer", async () => {
      const before = await f.micToken.balanceOf(f.other.address);
      await f.preSale.connect(f.other).buy(PKG2_USDT, 2);
      expect(await f.micToken.balanceOf(f.other.address) - before).to.equal(PKG2_MIC);
    });

    it("mints Maker NFT to buyer", async () => {
      await f.preSale.connect(f.other).buy(PKG2_USDT, 2);
      const balance = await f.communityNFT.activeCountOf(f.other.address, MAKER_TIER);
      expect(balance).to.equal(1n);
    });

    it("no Builder or Luminary NFT minted", async () => {
      await f.preSale.connect(f.other).buy(PKG2_USDT, 2);
      expect(await f.communityNFT.activeCountOf(f.other.address, BUILDER_TIER)).to.equal(0n);
      expect(await f.communityNFT.activeCountOf(f.other.address, LUMINARY_TIER)).to.equal(0n);
    });

    it("emits PreSalePurchase with packageIndex=2", async () => {
      await expect(f.preSale.connect(f.other).buy(PKG2_USDT, 2))
        .to.emit(f.preSale, "PreSalePurchase")
        .withArgs(f.other.address, PKG2_USDT, PKG2_MIC, 2n);
    });
  });

  // ─── Buy — Package 3: Luminary ($5,000) ──────────────────────────────────────

  describe("buy — Package 3 Luminary ($5,000)", () => {
    let f: Fixture;
    beforeEach(async () => { f = await deployFixture(); });

    it("transfers 1,000,000 MIC to buyer", async () => {
      const before = await f.micToken.balanceOf(f.other.address);
      await f.preSale.connect(f.other).buy(PKG3_USDT, 3);
      expect(await f.micToken.balanceOf(f.other.address) - before).to.equal(PKG3_MIC);
    });

    it("mints Luminary NFT to buyer", async () => {
      await f.preSale.connect(f.other).buy(PKG3_USDT, 3);
      const balance = await f.communityNFT.activeCountOf(f.other.address, LUMINARY_TIER);
      expect(balance).to.equal(1n);
    });

    it("no Builder or Maker NFT minted", async () => {
      await f.preSale.connect(f.other).buy(PKG3_USDT, 3);
      expect(await f.communityNFT.activeCountOf(f.other.address, BUILDER_TIER)).to.equal(0n);
      expect(await f.communityNFT.activeCountOf(f.other.address, MAKER_TIER)).to.equal(0n);
    });

    it("emits PreSalePurchase with packageIndex=3", async () => {
      await expect(f.preSale.connect(f.other).buy(PKG3_USDT, 3))
        .to.emit(f.preSale, "PreSalePurchase")
        .withArgs(f.other.address, PKG3_USDT, PKG3_MIC, 3n);
    });
  });

  // ─── Referral: F1+F2 present ──────────────────────────────────────────────────

  describe("Referral — buyer has F1+F2 referral chain", () => {
    let f: Fixture;
    beforeEach(async () => { f = await deployFixture(); });

    it("F1 receives 7% of total USDT", async () => {
      const before = await f.usdt.balanceOf(f.f1.address);
      await f.preSale.connect(f.buyer).buy(PKG1_USDT, 1);
      const expected = (PKG1_USDT * 700n) / 10000n; // 7%
      expect(await f.usdt.balanceOf(f.f1.address) - before).to.equal(expected);
    });

    it("F2 receives 3% of total USDT", async () => {
      const before = await f.usdt.balanceOf(f.f2.address);
      await f.preSale.connect(f.buyer).buy(PKG1_USDT, 1);
      const expected = (PKG1_USDT * 300n) / 10000n; // 3%
      expect(await f.usdt.balanceOf(f.f2.address) - before).to.equal(expected);
    });

    it("Marketing still receives 25% of GROSS — referral is not taken off the top", async () => {
      await f.preSale.connect(f.buyer).buy(PKG1_USDT, 1);
      expect(await f.marketing.received()).to.equal(marketingOf(PKG1_USDT));
    });

    it("nothing overflows to M&I when both F1 and F2 are paid", async () => {
      await f.preSale.connect(f.buyer).buy(PKG1_USDT, 1);
      expect(await f.miPool.received()).to.equal(0n);
    });

    it("ReferralRegistry retains 0 USDT after the payout", async () => {
      await f.preSale.connect(f.buyer).buy(PKG1_USDT, 1);
      expect(await f.usdt.balanceOf(await f.referralRegistry.getAddress())).to.equal(0n);
    });

    it("PreSale keeps 0 USDT after buy with referral", async () => {
      await f.preSale.connect(f.buyer).buy(PKG1_USDT, 1);
      expect(await f.usdt.balanceOf(await f.preSale.getAddress())).to.equal(0n);
    });

    it("buyer still receives full MIC amount regardless of referral", async () => {
      const before = await f.micToken.balanceOf(f.buyer.address);
      await f.preSale.connect(f.buyer).buy(PKG1_USDT, 1);
      expect(await f.micToken.balanceOf(f.buyer.address) - before).to.equal(PKG1_MIC);
    });
  });

  // ─── Referral: no referrer → whole 10% slice overflows to M&I ───────────────

  describe("No referrer — referral 10% overflows to Milestones & Incentives", () => {
    let f: Fixture;
    beforeEach(async () => { f = await deployFixture(); });

    it("marketing still receives 25% of gross", async () => {
      await f.preSale.connect(f.other).buy(PKG1_USDT, 1);
      expect(await f.marketing.received()).to.equal(marketingOf(PKG1_USDT));
    });

    it("the full 10% referral slice lands in the M&I pool", async () => {
      await f.preSale.connect(f.other).buy(PKG1_USDT, 1);
      expect(await f.miPool.received()).to.equal((PKG1_USDT * BPS_REFERRAL) / 10_000n);
    });

    it("F1 and F2 addresses receive nothing", async () => {
      const f1Before = await f.usdt.balanceOf(f.f1.address);
      const f2Before = await f.usdt.balanceOf(f.f2.address);
      await f.preSale.connect(f.other).buy(PKG1_USDT, 1);
      expect(await f.usdt.balanceOf(f.f1.address)).to.equal(f1Before);
      expect(await f.usdt.balanceOf(f.f2.address)).to.equal(f2Before);
    });
  });

  // ─── Revert cases ────────────────────────────────────────────────────────────

  describe("Revert cases", () => {
    let f: Fixture;
    beforeEach(async () => { f = await deployFixture(); });

    it("reverts if sale is not active", async () => {
      await f.preSale.connect(f.admin).setActive(false);
      await expect(f.preSale.connect(f.other).buy(MIN_USDT, 0))
        .to.be.revertedWith("PS: not active");
    });

    it("reverts if usdtAmount is zero", async () => {
      await expect(f.preSale.connect(f.other).buy(0n, 0))
        .to.be.revertedWith("PS: zero amount");
    });

    it("reverts if amount is below $25 minimum (packageIndex=0)", async () => {
      await expect(f.preSale.connect(f.other).buy(24n * USDT_6, 0))
        .to.be.revertedWith("PS: below minimum");
    });

    it("reverts if amount is below $1,000 for Builder package (packageIndex=1)", async () => {
      await expect(f.preSale.connect(f.other).buy(999n * USDT_6, 1))
        .to.be.revertedWith("PS: below package min");
    });

    it("reverts if amount is below $2,500 for Maker package (packageIndex=2)", async () => {
      await expect(f.preSale.connect(f.other).buy(2499n * USDT_6, 2))
        .to.be.revertedWith("PS: below package min");
    });

    it("reverts if amount is below $5,000 for Luminary package (packageIndex=3)", async () => {
      await expect(f.preSale.connect(f.other).buy(4999n * USDT_6, 3))
        .to.be.revertedWith("PS: below package min");
    });

    it("reverts if packageIndex is invalid (> 3)", async () => {
      await expect(f.preSale.connect(f.other).buy(MIN_USDT, 4))
        .to.be.revertedWith("PS: invalid package");
    });

    it("reverts if hard cap would be exceeded", async () => {
      // Mint extra USDT so buyer can attempt to exceed hard cap
      await f.usdt.mint(f.other.address, HARD_CAP + 1_000n * USDT_6);
      await f.usdt.connect(f.other).approve(await f.preSale.getAddress(), ethers.MaxUint256);

      // A single purchase exceeding HARD_CAP must revert
      await expect(f.preSale.connect(f.other).buy(HARD_CAP + USDT_6, 0))
        .to.be.revertedWith("PS: hard cap reached");
    });

    it("reverts if allocation would be exceeded", async () => {
      // ALLOCATION = 315M MIC, HARD_CAP = $1.575M USDT (exactly covers allocation)
      // Buy exactly HARD_CAP to exhaust allocation
      const [, , , , , , , , , , extraBuyer] = await ethers.getSigners();
      await f.usdt.mint(f.other.address, HARD_CAP);
      await f.usdt.connect(f.other).approve(await f.preSale.getAddress(), ethers.MaxUint256);
      await f.usdt.mint(extraBuyer.address, 2n * HARD_CAP);
      await f.usdt.connect(extraBuyer).approve(await f.preSale.getAddress(), ethers.MaxUint256);

      // Exhaust the allocation
      await f.preSale.connect(f.other).buy(HARD_CAP, 0);

      // Any further purchase should fail (allocation exhausted OR hard cap)
      await expect(f.preSale.connect(extraBuyer).buy(MIN_USDT, 0))
        .to.be.reverted;
    });
  });

  // ─── Vesting schedule details ─────────────────────────────────────────────────

  describe("Vesting schedule", () => {
    let f: Fixture;
    beforeEach(async () => { f = await deployFixture(); });

    it("schedule has 6-month cliff (180 days)", async () => {
      await f.preSale.connect(f.other).buy(PKG2_USDT, 2);
      const [sched] = await f.lockManager.getSchedules(f.other.address);
      expect(sched.cliffDuration).to.equal(BigInt(180 * 24 * 3600));
    });

    it("schedule has 10% cliff unlock (1000 BPS)", async () => {
      await f.preSale.connect(f.other).buy(PKG2_USDT, 2);
      const [sched] = await f.lockManager.getSchedules(f.other.address);
      expect(sched.cliffUnlockBps).to.equal(1000n);
    });

    it("schedule has 2.5% monthly unlock (250 BPS)", async () => {
      await f.preSale.connect(f.other).buy(PKG2_USDT, 2);
      const [sched] = await f.lockManager.getSchedules(f.other.address);
      expect(sched.monthlyUnlockBps).to.equal(250n);
    });

    it("schedule totalAmount matches MIC received", async () => {
      await f.preSale.connect(f.other).buy(PKG2_USDT, 2);
      const [sched] = await f.lockManager.getSchedules(f.other.address);
      expect(sched.totalAmount).to.equal(PKG2_MIC);
    });

    it("MIC is fully locked immediately after purchase", async () => {
      await f.preSale.connect(f.other).buy(PKG2_USDT, 2);
      const locked = await f.lockManager.lockedOf(f.other.address);
      expect(locked).to.equal(PKG2_MIC);
    });

    it("multiple buys accumulate schedules", async () => {
      await f.preSale.connect(f.other).buy(PKG1_USDT, 1);
      await f.preSale.connect(f.other).buy(PKG1_USDT, 1);
      const schedules = await f.lockManager.getSchedules(f.other.address);
      expect(schedules.length).to.equal(2);
    });
  });

  // ─── totalSold tracking ───────────────────────────────────────────────────────

  describe("totalSold tracking", () => {
    let f: Fixture;
    beforeEach(async () => { f = await deployFixture(); });

    it("totalSold accumulates across purchases", async () => {
      await f.preSale.connect(f.other).buy(MIN_USDT, 0);
      await f.preSale.connect(f.other).buy(PKG1_USDT, 1);
      expect(await f.preSale.totalSold()).to.equal(MIN_MIC + PKG1_MIC);
    });
  });

  // ─── Admin ────────────────────────────────────────────────────────────────────

  describe("Admin — setActive", () => {
    let f: Fixture;
    beforeEach(async () => { f = await deployFixture(); });

    it("admin can deactivate sale", async () => {
      await f.preSale.connect(f.admin).setActive(false);
      expect(await f.preSale.active()).to.be.false;
    });

    it("admin can reactivate sale", async () => {
      await f.preSale.connect(f.admin).setActive(false);
      await f.preSale.connect(f.admin).setActive(true);
      expect(await f.preSale.active()).to.be.true;
    });

    it("non-admin cannot call setActive", async () => {
      await expect(f.preSale.connect(f.other).setActive(false))
        .to.be.reverted;
    });

    it("emits SaleActivated event", async () => {
      await expect(f.preSale.connect(f.admin).setActive(false))
        .to.emit(f.preSale, "SaleActivated")
        .withArgs(false);
    });
  });

  // ── Recovering what never sold ──────────────────────────────────────────
  //
  // Until this was added, buy() was the ONLY way MIC could leave, and the contract is
  // funded with 315,000,000. A round that does not sell out would have stranded the
  // rest for good — the failure that cost 105,000,000 MIC in TreasuryManager v1.

  describe("Unsold remainder — Steward Council", () => {
    const DAO_ROLE = ethers.keccak256(ethers.toUtf8Bytes("DAO_ROLE"));
    let f: Fixture;
    beforeEach(async () => {
      f = await deployFixture();
      // In production DAO_ROLE goes to DAOGovernor, whose propose/approve/execute flow
      // carries the 3-of-5 quorum and the category timelock. Here the admin stands in.
      await f.preSale.connect(f.admin).grantRole(DAO_ROLE, f.admin.address);
    });

    it("returns the unsold remainder once the sale is stopped", async () => {
      await f.preSale.connect(f.admin).setActive(true);
      await f.preSale.connect(f.admin).setActive(false);
      const held = await f.micToken.balanceOf(await f.preSale.getAddress());
      expect(held).to.be.gt(0n);

      const before = await f.micToken.balanceOf(f.admin.address);
      await f.preSale.connect(f.admin).withdrawUnsoldMIC(f.admin.address, held);
      expect(await f.micToken.balanceOf(await f.preSale.getAddress())).to.equal(0n);
      expect(await f.micToken.balanceOf(f.admin.address) - before).to.equal(held);
    });

    // ── Ba trạng thái checklist deploy yêu cầu ──────────────────────────

    it("refuses before the sale has EVER been opened — the day-one hole", async () => {
      // `active` is false at deploy too. Gating on !active alone would have let the
      // Council empty a round that never opened. Caught by the final deploy checklist.
      // The shared fixture opens the sale, so this needs a virgin deployment.
      const fresh: any = await (await ethers.getContractFactory("PreSale")).deploy(
        await f.usdt.getAddress(),
        await f.micToken.getAddress(),
        await f.lockManager.getAddress(),
        await f.communityNFT.getAddress(),
        await f.referralRegistry.getAddress(),
        await f.revenueRouter.getAddress(),
        f.admin.address,
      );
      await fresh.connect(f.admin).grantRole(DAO_ROLE, f.admin.address);
      await f.micToken.connect(f.admin).transfer(await fresh.getAddress(), 1_000n);

      expect(await fresh.everActivated()).to.equal(false);
      expect(await fresh.active()).to.equal(false);
      await expect(fresh.connect(f.admin).withdrawUnsoldMIC(f.admin.address, 1n))
        .to.be.revertedWith("PS: locked 180 days unless the sale has run and been stopped");
      await expect(fresh.connect(f.admin).burnUnsoldMIC(1n))
        .to.be.revertedWith("PS: locked 180 days unless the sale has run and been stopped");
    });

    it("opens once the sale has actually run and then been stopped", async () => {
      await f.preSale.connect(f.admin).setActive(true);
      expect(await f.preSale.everActivated()).to.equal(true);
      await f.preSale.connect(f.admin).setActive(false);
      const held = await f.micToken.balanceOf(await f.preSale.getAddress());
      await f.preSale.connect(f.admin).withdrawUnsoldMIC(f.admin.address, held / 2n);
      expect(await f.micToken.balanceOf(await f.preSale.getAddress())).to.equal(held - held / 2n);
    });

    it("everActivated latches — switching the sale off never clears it", async () => {
      await f.preSale.connect(f.admin).setActive(true);
      await f.preSale.connect(f.admin).setActive(false);
      await f.preSale.connect(f.admin).setActive(true);
      await f.preSale.connect(f.admin).setActive(false);
      expect(await f.preSale.everActivated()).to.equal(true);
    });

    it("refuses while the sale runs and the six months have not passed", async () => {
      await f.preSale.connect(f.admin).setActive(true);
      await expect(f.preSale.connect(f.admin).withdrawUnsoldMIC(f.admin.address, 1n))
        .to.be.revertedWith("PS: locked 180 days unless the sale has run and been stopped");
    });

    it("cannot take more MIC than the contract holds", async () => {
      await f.preSale.connect(f.admin).setActive(true);
      await f.preSale.connect(f.admin).setActive(false);
      const held = await f.micToken.balanceOf(await f.preSale.getAddress());
      await expect(f.preSale.connect(f.admin).withdrawUnsoldMIC(f.admin.address, held + 1n))
        .to.be.revertedWith("PS: insufficient MIC");
    });

    it("is Council-only", async () => {
      await f.preSale.connect(f.admin).setActive(true);
      await f.preSale.connect(f.admin).setActive(false);
      await expect(f.preSale.connect(f.other).withdrawUnsoldMIC(f.other.address, 1n)).to.be.reverted;
    });

    it("leaves buyers unaffected — a purchase still works after a partial withdrawal", async () => {
      await f.preSale.connect(f.admin).setActive(true);
      await f.preSale.connect(f.admin).setActive(false);
      const held = await f.micToken.balanceOf(await f.preSale.getAddress());
      await f.preSale.connect(f.admin).withdrawUnsoldMIC(f.admin.address, held / 2n);
      await f.preSale.connect(f.admin).setActive(true);
      await expect(f.preSale.connect(f.other).buy(MIN_USDT, 0)).to.not.be.reverted;
    });
  });

  describe("rescueToken", () => {
    let f: Fixture;
    beforeEach(async () => { f = await deployFixture(); });

    it("recovers a token sent here by mistake", async () => {
      const stray = await (await ethers.getContractFactory("MockUSDT")).deploy();
      await stray.mint(await f.preSale.getAddress(), 500n * USDT_6);
      await f.preSale.connect(f.admin).rescueToken(await stray.getAddress(), f.admin.address, 500n * USDT_6);
      expect(await stray.balanceOf(f.admin.address)).to.equal(500n * USDT_6);
    });

    it("refuses MIC — that has its own gated path", async () => {
      await expect(f.preSale.connect(f.admin).rescueToken(await f.micToken.getAddress(), f.admin.address, 1n))
        .to.be.revertedWith("PS: use withdrawUnsoldMIC");
    });

    it("is admin-only", async () => {
      const stray = await (await ethers.getContractFactory("MockUSDT")).deploy();
      await stray.mint(await f.preSale.getAddress(), 10n * USDT_6);
      await expect(f.preSale.connect(f.other).rescueToken(await stray.getAddress(), f.other.address, 10n * USDT_6))
        .to.be.reverted;
    });
  });


  describe("Unsold remainder — six-month Council window", () => {
    const DAO_ROLE = ethers.keccak256(ethers.toUtf8Bytes("DAO_ROLE"));
    const SIX_MONTHS = 180 * 24 * 60 * 60;
    let f: Fixture;
    beforeEach(async () => {
      f = await deployFixture();
      await f.preSale.connect(f.admin).grantRole(DAO_ROLE, f.admin.address);
    });

    it("opens six months after the sale starts, without stopping the sale", async () => {
      await f.preSale.connect(f.admin).setActive(true);
      await time.increase(SIX_MONTHS);
      const held = await f.micToken.balanceOf(await f.preSale.getAddress());
      await f.preSale.connect(f.admin).withdrawUnsoldMIC(f.admin.address, held / 2n);
      expect(await f.micToken.balanceOf(await f.preSale.getAddress())).to.equal(held - held / 2n);
    });

    it("burns part of the remainder and shrinks total supply", async () => {
      await time.increase(SIX_MONTHS);
      const held = await f.micToken.balanceOf(await f.preSale.getAddress());
      const supplyBefore = await f.micToken.totalSupply();
      await f.preSale.connect(f.admin).burnUnsoldMIC(held / 4n);
      expect(await f.micToken.totalSupply()).to.equal(supplyBefore - held / 4n);
      expect(await f.micToken.balanceOf(await f.preSale.getAddress())).to.equal(held - held / 4n);
    });

    it("burning is Council-gated and time-gated exactly like the withdrawal", async () => {
      await f.preSale.connect(f.admin).setActive(true);
      await expect(f.preSale.connect(f.admin).burnUnsoldMIC(1n))
        .to.be.revertedWith("PS: locked 180 days unless the sale has run and been stopped");
      await expect(f.preSale.connect(f.other).burnUnsoldMIC(1n)).to.be.reverted;
    });

    it("cannot burn more than it holds", async () => {
      await time.increase(SIX_MONTHS);
      const held = await f.micToken.balanceOf(await f.preSale.getAddress());
      await expect(f.preSale.connect(f.admin).burnUnsoldMIC(held + 1n))
        .to.be.revertedWith("PS: insufficient MIC");
    });

    it("reports the remainder and the unlock date for the admin console", async () => {
      const held = await f.micToken.balanceOf(await f.preSale.getAddress());
      expect(await f.preSale.unsoldMIC()).to.equal(held);
      expect(await f.preSale.unsoldUnlockAt())
        .to.equal((await f.preSale.saleStart()) + BigInt(SIX_MONTHS));
    });
  });

});
