import { expect } from "chai";
import { ethers, network } from "hardhat";
import { RevenueRouter, MockUSDT } from "../../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("RevenueRouter", function () {
  let router: RevenueRouter;
  let usdt: MockUSDT;
  let admin: SignerWithAddress;
  let distributor: SignerWithAddress; // authorized sale contract
  let stranger: SignerWithAddress;
  let marketing: any;                 // RewardDistributorV2 (router CALLS receiveAndDistribute)
  let referral: SignerWithAddress;    // ReferralRegistry (push)
  let management: any;                // pools — router CALLS receiveUSDT (split internally)
  let treasury: any;
  let reservedStaking: any;
  let liquidity: any;

  const DISTRIBUTOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("DISTRIBUTOR_ROLE"));
  const DEFAULT_ADMIN_ROLE = ethers.ZeroHash;

  // BPS of GROSS (100% input). Referral is fixed; the 5 below sum to 9000.
  const BPS_REFERRAL    = 1000n; // 10% (fixed)
  const BPS_MARKETING   = 2500n; // 25%
  const BPS_MANAGEMENT  = 750n;  // 7.5%
  const BPS_TREASURY    = 1250n; // 12.5%
  const BPS_STAKING     = 500n;  // 5%
  const BPS_LIQUIDITY   = 4000n; // 40%
  const BPS_TOTAL       = 10000n;

  const THIRTY_DAYS = 30 * 24 * 60 * 60;

  async function increaseTime(seconds: number) {
    await network.provider.send("evm_increaseTime", [seconds]);
    await network.provider.send("evm_mine", []);
  }

  beforeEach(async () => {
    [admin, distributor, stranger, referral] = await ethers.getSigners();

    // Deploy MockUSDT
    const MockUSDTFactory = await ethers.getContractFactory("MockUSDT");
    usdt = await MockUSDTFactory.deploy();

    // Marketing + the 4 infra pools are CONTRACTS — the router calls receiveAndDistribute /
    // receiveUSDT on them (they split internally). Only referral is a push (EOA here).
    const MockRcv = await ethers.getContractFactory("MockRewardReceiver");
    marketing       = await MockRcv.deploy(await usdt.getAddress());
    management      = await MockRcv.deploy(await usdt.getAddress());
    treasury        = await MockRcv.deploy(await usdt.getAddress());
    reservedStaking = await MockRcv.deploy(await usdt.getAddress());
    liquidity       = await MockRcv.deploy(await usdt.getAddress());

    // Deploy RevenueRouter (6-way: referral + marketing + 4 pools)
    const RouterFactory = await ethers.getContractFactory("RevenueRouter");
    router = await RouterFactory.deploy(
      await usdt.getAddress(),
      referral.address,                    // ReferralRegistry (push)
      await marketing.getAddress(),        // RewardDistributorV2 (call)
      await management.getAddress(),
      await treasury.getAddress(),
      await reservedStaking.getAddress(),
      await liquidity.getAddress(),
      admin.address,
    );

    // Grant DISTRIBUTOR_ROLE to authorized sale contract
    await router.connect(admin).grantRole(DISTRIBUTOR_ROLE, distributor.address);

    // Mint USDT to distributor for testing
    await usdt.mint(distributor.address, 1_000_000n * 10n ** 6n); // 1M USDT

    // Approve router to pull from distributor
    await usdt.connect(distributor).approve(await router.getAddress(), ethers.MaxUint256);
  });

  // ─────────────────────────────────────────────────────────
  // Constructor
  // ─────────────────────────────────────────────────────────
  describe("Constructor", () => {
    it("sets correct BPS values", async () => {
      expect(await router.bpsMarketing()).to.equal(BPS_MARKETING);
      expect(await router.bpsManagement()).to.equal(BPS_MANAGEMENT);
      expect(await router.bpsTreasury()).to.equal(BPS_TREASURY);
      expect(await router.bpsStaking()).to.equal(BPS_STAKING);
      expect(await router.bpsLiquidity()).to.equal(BPS_LIQUIDITY);
    });

    it("sets correct recipient addresses", async () => {
      expect(await router.referral()).to.equal(referral.address);
      expect(await router.marketing()).to.equal(await marketing.getAddress());
      expect(await router.management()).to.equal(await management.getAddress());
      expect(await router.treasury()).to.equal(await treasury.getAddress());
      expect(await router.reservedStaking()).to.equal(await reservedStaking.getAddress());
      expect(await router.liquidity()).to.equal(await liquidity.getAddress());
    });

    it("grants DEFAULT_ADMIN_ROLE to admin", async () => {
      expect(await router.hasRole(DEFAULT_ADMIN_ROLE, admin.address)).to.be.true;
    });

    it("adjustable BPS sum to 9000 (+ fixed referral 1000 = 10000)", async () => {
      const total =
        (await router.bpsMarketing()) +
        (await router.bpsManagement()) +
        (await router.bpsTreasury()) +
        (await router.bpsStaking()) +
        (await router.bpsLiquidity());
      expect(total).to.equal(9000n);
      expect(await router.BPS_REFERRAL()).to.equal(BPS_REFERRAL);
      expect(total + (await router.BPS_REFERRAL())).to.equal(BPS_TOTAL);
    });
  });

  // ─────────────────────────────────────────────────────────
  // receiveAndDistribute
  // ─────────────────────────────────────────────────────────
  describe("receiveAndDistribute", () => {
    it("splits 10,000 USDT exactly across 6 destinations (gross %)", async () => {
      const amount = 10_000n * 10n ** 6n; // 10,000 USDT (6 decimals)

      await router.connect(distributor).receiveAndDistribute(amount);

      const expectedReferral   = (amount * BPS_REFERRAL)   / BPS_TOTAL; // 1,000 (10%)
      const expectedMarketing  = (amount * BPS_MARKETING)  / BPS_TOTAL; // 2,500 (25%)
      const expectedManagement = (amount * BPS_MANAGEMENT) / BPS_TOTAL; // 750
      const expectedTreasury   = (amount * BPS_TREASURY)   / BPS_TOTAL; // 1,250
      const expectedStaking    = (amount * BPS_STAKING)    / BPS_TOTAL; // 500
      const expectedLiquidity  = amount - expectedReferral - expectedMarketing - expectedManagement - expectedTreasury - expectedStaking; // 4,000

      expect(await usdt.balanceOf(referral.address)).to.equal(expectedReferral);      // push
      expect(await marketing.received()).to.equal(expectedMarketing);                 // call
      expect(await management.received()).to.equal(expectedManagement);
      expect(await treasury.received()).to.equal(expectedTreasury);
      expect(await reservedStaking.received()).to.equal(expectedStaking);
      expect(await liquidity.received()).to.equal(expectedLiquidity);
    });

    it("no dust left in router after distribution", async () => {
      const amount = 10_000n * 10n ** 6n;
      await router.connect(distributor).receiveAndDistribute(amount);
      expect(await usdt.balanceOf(await router.getAddress())).to.equal(0n);
    });

    it("handles amounts that do not divide evenly — last pool (liquidity) absorbs remainder", async () => {
      // 1 USDT = 1_000_000 units (6 decimals)
      // 1_000_003 units — does not divide evenly by 10000
      const amount = 1_000_003n;

      await router.connect(distributor).receiveAndDistribute(amount);

      const eRef = (amount * BPS_REFERRAL) / BPS_TOTAL;
      const e4 = (amount * BPS_MARKETING) / BPS_TOTAL;
      const e3 = (amount * BPS_MANAGEMENT) / BPS_TOTAL;
      const e2 = (amount * BPS_TREASURY) / BPS_TOTAL;
      const e1 = (amount * BPS_STAKING) / BPS_TOTAL;
      const expectedLiquid = amount - eRef - e4 - e3 - e2 - e1;

      expect(await liquidity.received()).to.equal(expectedLiquid);
      // Confirm no dust in router
      expect(await usdt.balanceOf(await router.getAddress())).to.equal(0n);
    });

    it("emits RevenueDistributed event", async () => {
      const amount = 10_000n * 10n ** 6n;
      await expect(router.connect(distributor).receiveAndDistribute(amount))
        .to.emit(router, "RevenueDistributed")
        .withArgs(distributor.address, amount);
    });

    it("reverts if amount is zero", async () => {
      await expect(
        router.connect(distributor).receiveAndDistribute(0n)
      ).to.be.revertedWith("RevenueRouter: zero amount");
    });

    it("reverts if caller does not have DISTRIBUTOR_ROLE", async () => {
      const amount = 10_000n * 10n ** 6n;
      await usdt.mint(stranger.address, amount);
      await usdt.connect(stranger).approve(await router.getAddress(), amount);
      await expect(
        router.connect(stranger).receiveAndDistribute(amount)
      ).to.be.revertedWithCustomError(router, "AccessControlUnauthorizedAccount");
    });

    it("multiple distributions accumulate correctly", async () => {
      const amount = 5_000n * 10n ** 6n;

      await router.connect(distributor).receiveAndDistribute(amount);
      await router.connect(distributor).receiveAndDistribute(amount);

      const totalSent = amount * 2n;
      const expectedMarketing = (totalSent * BPS_MARKETING) / BPS_TOTAL;
      expect(await marketing.received()).to.equal(expectedMarketing);
    });
  });

  // ─────────────────────────────────────────────────────────
  // BPS Adjustment
  // ─────────────────────────────────────────────────────────
  describe("adjustBPS", () => {
    // Defaults: Marketing 2500 · Mgmt 750 · Treasury 1250 · Staking 500 · Liquidity 4000 (sum 9000)
    it("DAO can adjust BPS within +-500 per pool", async () => {
      // Increase marketing by 500, decrease liquidity by 500
      await router.connect(admin).adjustBPS(3000, 750, 1250, 500, 3500);

      expect(await router.bpsMarketing()).to.equal(3000n);
      expect(await router.bpsLiquidity()).to.equal(3500n);
    });

    it("reverts if any pool changes by more than 500 BPS", async () => {
      // marketing change: 2500 -> 3001 = +501, exceeds limit
      await expect(
        router.connect(admin).adjustBPS(3001, 750, 1250, 500, 3499)
      ).to.be.revertedWith("RevenueRouter: BPS change too large");
    });

    it("reverts if adjustable total != 9000", async () => {
      // sum = 2500 + 750 + 1250 + 500 + 3999 = 8999
      await expect(
        router.connect(admin).adjustBPS(2500, 750, 1250, 500, 3999)
      ).to.be.revertedWith("RevenueRouter: adjustable BPS must be 9000");
    });

    it("enforces 30-day cooldown between adjustments", async () => {
      await router.connect(admin).adjustBPS(3000, 750, 1250, 500, 3500);
      // Immediate second adjustment should fail
      await expect(
        router.connect(admin).adjustBPS(2500, 750, 1250, 500, 4000)
      ).to.be.revertedWith("RevenueRouter: cooldown active");
    });

    it("allows second adjustment after 30-day cooldown passes", async () => {
      await router.connect(admin).adjustBPS(3000, 750, 1250, 500, 3500);

      await increaseTime(THIRTY_DAYS + 1);

      await router.connect(admin).adjustBPS(2500, 750, 1250, 500, 4000);
      expect(await router.bpsMarketing()).to.equal(2500n);
      expect(await router.bpsLiquidity()).to.equal(4000n);
    });

    it("reverts if caller is not admin", async () => {
      await expect(
        router.connect(stranger).adjustBPS(3000, 750, 1250, 500, 3500)
      ).to.be.revertedWithCustomError(router, "AccessControlUnauthorizedAccount");
    });

    it("emits BPSAdjusted event", async () => {
      await expect(router.connect(admin).adjustBPS(3000, 750, 1250, 500, 3500))
        .to.emit(router, "BPSAdjusted")
        .withArgs(3000, 750, 1250, 500, 3500);
    });

    it("allows decrease by exactly 500 BPS", async () => {
      // marketing: 2500 -> 2000 = -500, liquidity: 4000 -> 4500 = +500
      await router.connect(admin).adjustBPS(2000, 750, 1250, 500, 4500);
      expect(await router.bpsMarketing()).to.equal(2000n);
      expect(await router.bpsLiquidity()).to.equal(4500n);
    });

    it("reverts if decrease exceeds 500 BPS", async () => {
      // marketing: 2500 -> 1999 = -501
      await expect(
        router.connect(admin).adjustBPS(1999, 750, 1250, 500, 4501)
      ).to.be.revertedWith("RevenueRouter: BPS change too large");
    });
  });

  // ─────────────────────────────────────────────────────────
  // Recipient Address Updates
  // ─────────────────────────────────────────────────────────
  describe("setRecipients", () => {
    it("admin can update marketing address", async () => {
      await router.connect(admin).setMarketing(stranger.address);
      expect(await router.marketing()).to.equal(stranger.address);
    });

    it("admin can update management address", async () => {
      await router.connect(admin).setManagement(stranger.address);
      expect(await router.management()).to.equal(stranger.address);
    });

    it("admin can update treasury address", async () => {
      await router.connect(admin).setTreasury(stranger.address);
      expect(await router.treasury()).to.equal(stranger.address);
    });

    it("admin can update reservedStaking address", async () => {
      await router.connect(admin).setReservedStaking(stranger.address);
      expect(await router.reservedStaking()).to.equal(stranger.address);
    });

    it("admin can update liquidity address", async () => {
      await router.connect(admin).setLiquidity(stranger.address);
      expect(await router.liquidity()).to.equal(stranger.address);
    });

    it("reverts if non-admin tries to update marketing", async () => {
      await expect(
        router.connect(stranger).setMarketing(stranger.address)
      ).to.be.revertedWithCustomError(router, "AccessControlUnauthorizedAccount");
    });

    it("reverts on zero address for marketing", async () => {
      await expect(
        router.connect(admin).setMarketing(ethers.ZeroAddress)
      ).to.be.revertedWith("RevenueRouter: zero address");
    });

    it("reverts on zero address for management", async () => {
      await expect(
        router.connect(admin).setManagement(ethers.ZeroAddress)
      ).to.be.revertedWith("RevenueRouter: zero address");
    });

    it("reverts on zero address for treasury", async () => {
      await expect(
        router.connect(admin).setTreasury(ethers.ZeroAddress)
      ).to.be.revertedWith("RevenueRouter: zero address");
    });

    it("reverts on zero address for reservedStaking", async () => {
      await expect(
        router.connect(admin).setReservedStaking(ethers.ZeroAddress)
      ).to.be.revertedWith("RevenueRouter: zero address");
    });

    it("reverts on zero address for liquidity", async () => {
      await expect(
        router.connect(admin).setLiquidity(ethers.ZeroAddress)
      ).to.be.revertedWith("RevenueRouter: zero address");
    });

    it("emits RecipientUpdated event on marketing change", async () => {
      await expect(router.connect(admin).setMarketing(stranger.address))
        .to.emit(router, "RecipientUpdated")
        .withArgs("marketing", stranger.address);
    });
  });
});
