import { expect } from "chai";
import { ethers, network } from "hardhat";
import { RewardDistributor, MockUSDT } from "../../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("RewardDistributor", function () {
  let distributor: RewardDistributor;
  let usdt: MockUSDT;
  let admin: SignerWithAddress;
  let revenueRouter: SignerWithAddress; // holds DISTRIBUTOR_ROLE
  let stranger: SignerWithAddress;
  let claimRewards: SignerWithAddress;
  let periodicRewards: SignerWithAddress;
  let luckyDraw: SignerWithAddress;
  let incentivePool: SignerWithAddress;

  const DISTRIBUTOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("DISTRIBUTOR_ROLE"));
  const DEFAULT_ADMIN_ROLE = ethers.ZeroHash;

  // BPS constants (must sum to 10000)
  const BPS_CLAIM      = 6857n; // Referral 10% + Community Builder 5% + GV 9% = 24% of 35%
  const BPS_PERIODIC   = 2143n; // Monthly NFT Pool 7.5% of 35%
  const BPS_LUCKY      = 286n;  // 1% of 35%
  const BPS_INCENTIVE  = 714n;  // 2.5% of 35%
  const BPS_TOTAL      = 10_000n;

  const FOURTEEN_DAYS = 14 * 24 * 60 * 60;

  async function increaseTime(seconds: number) {
    await network.provider.send("evm_increaseTime", [seconds]);
    await network.provider.send("evm_mine", []);
  }

  beforeEach(async () => {
    [admin, revenueRouter, stranger, claimRewards, periodicRewards, luckyDraw, incentivePool] =
      await ethers.getSigners();

    // Deploy MockUSDT
    const MockUSDTFactory = await ethers.getContractFactory("MockUSDT");
    usdt = await MockUSDTFactory.deploy();

    // Deploy RewardDistributor
    const DistributorFactory = await ethers.getContractFactory("RewardDistributor");
    distributor = await DistributorFactory.deploy(
      await usdt.getAddress(),
      claimRewards.address,
      periodicRewards.address,
      luckyDraw.address,
      incentivePool.address,
      admin.address,
    );

    // Grant DISTRIBUTOR_ROLE to revenueRouter
    await distributor.connect(admin).grantRole(DISTRIBUTOR_ROLE, revenueRouter.address);

    // Mint USDT to revenueRouter for testing
    await usdt.mint(revenueRouter.address, 1_000_000n * 10n ** 6n); // 1M USDT

    // Approve distributor to pull from revenueRouter
    await usdt.connect(revenueRouter).approve(await distributor.getAddress(), ethers.MaxUint256);
  });

  // ─────────────────────────────────────────────────────────
  // Constructor
  // ─────────────────────────────────────────────────────────
  describe("Constructor", () => {
    it("sets correct BPS values", async () => {
      expect(await distributor.bpsClaim()).to.equal(BPS_CLAIM);
      expect(await distributor.bpsPeriodic()).to.equal(BPS_PERIODIC);
      expect(await distributor.bpsLucky()).to.equal(BPS_LUCKY);
      expect(await distributor.bpsIncentive()).to.equal(BPS_INCENTIVE);
    });

    it("BPS total equals 10000", async () => {
      const total =
        (await distributor.bpsClaim()) +
        (await distributor.bpsPeriodic()) +
        (await distributor.bpsLucky()) +
        (await distributor.bpsIncentive());
      expect(total).to.equal(BPS_TOTAL);
    });

    it("sets correct recipient addresses", async () => {
      expect(await distributor.claimRewards()).to.equal(claimRewards.address);
      expect(await distributor.periodicRewards()).to.equal(periodicRewards.address);
      expect(await distributor.luckyDraw()).to.equal(luckyDraw.address);
      expect(await distributor.incentivePool()).to.equal(incentivePool.address);
    });

    it("grants DEFAULT_ADMIN_ROLE to admin", async () => {
      expect(await distributor.hasRole(DEFAULT_ADMIN_ROLE, admin.address)).to.be.true;
    });

    it("stores usdt address correctly", async () => {
      expect(await distributor.usdt()).to.equal(await usdt.getAddress());
    });
  });

  // ─────────────────────────────────────────────────────────
  // receiveAndDistribute
  // ─────────────────────────────────────────────────────────
  describe("receiveAndDistribute", () => {
    it("splits 10,000 USDT correctly across 4 recipients", async () => {
      const amount = 10_000n * 10n ** 6n; // 10,000 USDT (6 decimals)

      const claimBefore    = await usdt.balanceOf(claimRewards.address);
      const periodicBefore = await usdt.balanceOf(periodicRewards.address);
      const luckyBefore    = await usdt.balanceOf(luckyDraw.address);
      const incentiveBefore = await usdt.balanceOf(incentivePool.address);

      await distributor.connect(revenueRouter).receiveAndDistribute(amount);

      const expectedClaim    = (amount * BPS_CLAIM) / BPS_TOTAL;
      const expectedPeriodic = (amount * BPS_PERIODIC) / BPS_TOTAL;
      const expectedLucky    = (amount * BPS_LUCKY) / BPS_TOTAL;
      // Last recipient (incentivePool) absorbs remainder
      const expectedIncentive = amount - expectedClaim - expectedPeriodic - expectedLucky;

      expect(await usdt.balanceOf(claimRewards.address)).to.equal(claimBefore + expectedClaim);
      expect(await usdt.balanceOf(periodicRewards.address)).to.equal(periodicBefore + expectedPeriodic);
      expect(await usdt.balanceOf(luckyDraw.address)).to.equal(luckyBefore + expectedLucky);
      expect(await usdt.balanceOf(incentivePool.address)).to.equal(incentiveBefore + expectedIncentive);
    });

    it("no dust left in RewardDistributor contract after distribution", async () => {
      const amount = 10_000n * 10n ** 6n;
      await distributor.connect(revenueRouter).receiveAndDistribute(amount);
      expect(await usdt.balanceOf(await distributor.getAddress())).to.equal(0n);
    });

    it("BPS math is exact — last recipient (incentivePool) gets remainder", async () => {
      // 1_000_003 units does not divide evenly by 10000
      const amount = 1_000_003n;

      const incentiveBefore = await usdt.balanceOf(incentivePool.address);
      await distributor.connect(revenueRouter).receiveAndDistribute(amount);

      const toClaim    = (amount * BPS_CLAIM) / BPS_TOTAL;
      const toPeriodic = (amount * BPS_PERIODIC) / BPS_TOTAL;
      const toLucky    = (amount * BPS_LUCKY) / BPS_TOTAL;
      const toIncentive = amount - toClaim - toPeriodic - toLucky;

      expect(await usdt.balanceOf(incentivePool.address)).to.equal(incentiveBefore + toIncentive);
      // No dust in contract
      expect(await usdt.balanceOf(await distributor.getAddress())).to.equal(0n);
    });

    it("emits RewardDistributed event", async () => {
      const amount = 10_000n * 10n ** 6n;
      await expect(distributor.connect(revenueRouter).receiveAndDistribute(amount))
        .to.emit(distributor, "RewardDistributed")
        .withArgs(revenueRouter.address, amount);
    });

    it("reverts if amount is zero", async () => {
      await expect(
        distributor.connect(revenueRouter).receiveAndDistribute(0n)
      ).to.be.revertedWith("RewardDistributor: zero amount");
    });

    it("reverts if caller does not have DISTRIBUTOR_ROLE", async () => {
      const amount = 10_000n * 10n ** 6n;
      await usdt.mint(stranger.address, amount);
      await usdt.connect(stranger).approve(await distributor.getAddress(), amount);
      await expect(
        distributor.connect(stranger).receiveAndDistribute(amount)
      ).to.be.revertedWithCustomError(distributor, "AccessControlUnauthorizedAccount");
    });

    it("multiple distributions accumulate correctly", async () => {
      const amount = 5_000n * 10n ** 6n;
      const claimBefore = await usdt.balanceOf(claimRewards.address);

      await distributor.connect(revenueRouter).receiveAndDistribute(amount);
      await distributor.connect(revenueRouter).receiveAndDistribute(amount);

      const totalSent = amount * 2n;
      const expectedClaim = (totalSent * BPS_CLAIM) / BPS_TOTAL;
      expect(await usdt.balanceOf(claimRewards.address)).to.equal(claimBefore + expectedClaim);
    });
  });

  // ─────────────────────────────────────────────────────────
  // BPS Adjustment (DAO)
  // ─────────────────────────────────────────────────────────
  describe("adjustBPS", () => {
    it("DAO can adjust BPS within +-200 per pool", async () => {
      // Increase bpsClaim by 200, decrease bpsIncentive by 200
      // 6143 + 200 = 6343; 714 - 200 = 514; 6343 + 2857 + 286 + 514 = 10000
      await distributor.connect(admin).adjustBPS(6343, 2857, 286, 514);

      expect(await distributor.bpsClaim()).to.equal(6343n);
      expect(await distributor.bpsIncentive()).to.equal(514n);
    });

    it("allows exact +-200 BPS boundary", async () => {
      // Decrease bpsClaim by 200: 6143 - 200 = 5943; add to incentive: 714 + 200 = 914
      await distributor.connect(admin).adjustBPS(5943, 2857, 286, 914);
      expect(await distributor.bpsClaim()).to.equal(5943n);
      expect(await distributor.bpsIncentive()).to.equal(914n);
    });

    it("reverts if any pool changes by more than 200 BPS", async () => {
      // bpsClaim change: 6143 -> 6344 = +201, exceeds +-200
      await expect(
        distributor.connect(admin).adjustBPS(6344, 2857, 286, 513)
      ).to.be.revertedWith("RewardDistributor: BPS change too large");
    });

    it("reverts if new total != 10000", async () => {
      // sum = 6143 + 2857 + 286 + 713 = 9999
      await expect(
        distributor.connect(admin).adjustBPS(6143, 2857, 286, 713)
      ).to.be.revertedWith("RewardDistributor: total BPS must be 10000");
    });

    it("enforces 14-day cooldown between adjustments", async () => {
      // First adjustment (valid)
      await distributor.connect(admin).adjustBPS(6343, 2857, 286, 514);

      // Immediate second adjustment should fail
      await expect(
        distributor.connect(admin).adjustBPS(6143, 2857, 286, 714)
      ).to.be.revertedWith("RewardDistributor: cooldown active");
    });

    it("allows second adjustment after 14-day cooldown passes", async () => {
      await distributor.connect(admin).adjustBPS(6343, 2857, 286, 514);

      await increaseTime(FOURTEEN_DAYS + 1);

      await distributor.connect(admin).adjustBPS(6143, 2857, 286, 714);
      expect(await distributor.bpsClaim()).to.equal(6143n);
      expect(await distributor.bpsIncentive()).to.equal(714n);
    });

    it("reverts if caller is not admin", async () => {
      await expect(
        distributor.connect(stranger).adjustBPS(6143, 2857, 286, 714)
      ).to.be.revertedWithCustomError(distributor, "AccessControlUnauthorizedAccount");
    });

    it("emits BPSAdjusted event", async () => {
      await expect(distributor.connect(admin).adjustBPS(6343, 2857, 286, 514))
        .to.emit(distributor, "BPSAdjusted")
        .withArgs(6343, 2857, 286, 514);
    });
  });

  // ─────────────────────────────────────────────────────────
  // Recipient Address Updates
  // ─────────────────────────────────────────────────────────
  describe("setRecipients", () => {
    it("admin can update claimRewards address", async () => {
      await distributor.connect(admin).setClaimRewards(stranger.address);
      expect(await distributor.claimRewards()).to.equal(stranger.address);
    });

    it("admin can update periodicRewards address", async () => {
      await distributor.connect(admin).setPeriodicRewards(stranger.address);
      expect(await distributor.periodicRewards()).to.equal(stranger.address);
    });

    it("admin can update luckyDraw address", async () => {
      await distributor.connect(admin).setLuckyDraw(stranger.address);
      expect(await distributor.luckyDraw()).to.equal(stranger.address);
    });

    it("admin can update incentivePool address", async () => {
      await distributor.connect(admin).setIncentivePool(stranger.address);
      expect(await distributor.incentivePool()).to.equal(stranger.address);
    });

    it("reverts if non-admin tries to update claimRewards", async () => {
      await expect(
        distributor.connect(stranger).setClaimRewards(stranger.address)
      ).to.be.revertedWithCustomError(distributor, "AccessControlUnauthorizedAccount");
    });

    it("reverts on zero address for claimRewards", async () => {
      await expect(
        distributor.connect(admin).setClaimRewards(ethers.ZeroAddress)
      ).to.be.revertedWith("RewardDistributor: zero address");
    });

    it("reverts on zero address for periodicRewards", async () => {
      await expect(
        distributor.connect(admin).setPeriodicRewards(ethers.ZeroAddress)
      ).to.be.revertedWith("RewardDistributor: zero address");
    });

    it("reverts on zero address for luckyDraw", async () => {
      await expect(
        distributor.connect(admin).setLuckyDraw(ethers.ZeroAddress)
      ).to.be.revertedWith("RewardDistributor: zero address");
    });

    it("reverts on zero address for incentivePool", async () => {
      await expect(
        distributor.connect(admin).setIncentivePool(ethers.ZeroAddress)
      ).to.be.revertedWith("RewardDistributor: zero address");
    });

    it("emits RecipientUpdated event on claimRewards change", async () => {
      await expect(distributor.connect(admin).setClaimRewards(stranger.address))
        .to.emit(distributor, "RecipientUpdated")
        .withArgs("claimRewards", stranger.address);
    });

    it("emits RecipientUpdated event on periodicRewards change", async () => {
      await expect(distributor.connect(admin).setPeriodicRewards(stranger.address))
        .to.emit(distributor, "RecipientUpdated")
        .withArgs("periodicRewards", stranger.address);
    });

    it("emits RecipientUpdated event on luckyDraw change", async () => {
      await expect(distributor.connect(admin).setLuckyDraw(stranger.address))
        .to.emit(distributor, "RecipientUpdated")
        .withArgs("luckyDraw", stranger.address);
    });

    it("emits RecipientUpdated event on incentivePool change", async () => {
      await expect(distributor.connect(admin).setIncentivePool(stranger.address))
        .to.emit(distributor, "RecipientUpdated")
        .withArgs("incentivePool", stranger.address);
    });
  });

  // ─────────────────────────────────────────────────────────
  // Access Control — Additional Checks
  // ─────────────────────────────────────────────────────────
  describe("Access Control", () => {
    it("DISTRIBUTOR_ROLE can be granted and revoked by admin", async () => {
      expect(await distributor.hasRole(DISTRIBUTOR_ROLE, revenueRouter.address)).to.be.true;

      await distributor.connect(admin).revokeRole(DISTRIBUTOR_ROLE, revenueRouter.address);
      expect(await distributor.hasRole(DISTRIBUTOR_ROLE, revenueRouter.address)).to.be.false;
    });

    it("revoked DISTRIBUTOR_ROLE cannot call receiveAndDistribute", async () => {
      const amount = 10_000n * 10n ** 6n;
      await distributor.connect(admin).revokeRole(DISTRIBUTOR_ROLE, revenueRouter.address);

      await expect(
        distributor.connect(revenueRouter).receiveAndDistribute(amount)
      ).to.be.revertedWithCustomError(distributor, "AccessControlUnauthorizedAccount");
    });
  });
});
