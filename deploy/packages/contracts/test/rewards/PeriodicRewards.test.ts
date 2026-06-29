import { expect } from "chai";
import { ethers } from "hardhat";
import { PeriodicRewards, MockUSDT } from "../../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("PeriodicRewards", function () {
  let rewards: PeriodicRewards;
  let usdt: MockUSDT;
  let admin: SignerWithAddress;
  let distributor: SignerWithAddress; // authorized distributor (e.g. RewardDistributor)
  let stranger: SignerWithAddress;
  let recipient1: SignerWithAddress;
  let recipient2: SignerWithAddress;
  let recipient3: SignerWithAddress;

  const DISTRIBUTOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("DISTRIBUTOR_ROLE"));
  const DEFAULT_ADMIN_ROLE = ethers.ZeroHash;

  // PeriodicRewards now handles 100% monthly (no weekly split)
  const BPS_MONTHLY = 10000n;

  // Helper: mint USDT and approve the contract
  async function mintAndApprove(from: SignerWithAddress, amount: bigint) {
    await usdt.mint(from.address, amount);
    await usdt.connect(from).approve(await rewards.getAddress(), ethers.MaxUint256);
  }

  beforeEach(async () => {
    [admin, distributor, stranger, recipient1, recipient2, recipient3] =
      await ethers.getSigners();

    // Deploy MockUSDT
    const MockUSDTFactory = await ethers.getContractFactory("MockUSDT");
    usdt = await MockUSDTFactory.deploy();

    // Deploy PeriodicRewards
    const PeriodicRewardsFactory = await ethers.getContractFactory("PeriodicRewards");
    rewards = await PeriodicRewardsFactory.deploy(
      await usdt.getAddress(),
      admin.address,
    );

    // Grant DISTRIBUTOR_ROLE to authorized account
    await rewards.connect(admin).grantRole(DISTRIBUTOR_ROLE, distributor.address);

    // Give distributor some USDT and approve
    await mintAndApprove(distributor, 1_000_000n * 10n ** 6n);
  });

  // ─────────────────────────────────────────────────────────
  // Constructor
  // ─────────────────────────────────────────────────────────
  describe("Constructor", () => {
    it("sets correct usdt address", async () => {
      expect(await rewards.usdt()).to.equal(await usdt.getAddress());
    });

    it("grants DEFAULT_ADMIN_ROLE to admin", async () => {
      expect(await rewards.hasRole(DEFAULT_ADMIN_ROLE, admin.address)).to.be.true;
    });

    it("monthlyBalance starts at zero", async () => {
      expect(await rewards.monthlyBalance()).to.equal(0n);
    });

    it("reverts on zero usdt address", async () => {
      const Factory = await ethers.getContractFactory("PeriodicRewards");
      await expect(
        Factory.deploy(ethers.ZeroAddress, admin.address)
      ).to.be.revertedWith("PeriodicRewards: zero address");
    });

    it("reverts on zero admin address", async () => {
      const Factory = await ethers.getContractFactory("PeriodicRewards");
      await expect(
        Factory.deploy(await usdt.getAddress(), ethers.ZeroAddress)
      ).to.be.revertedWith("PeriodicRewards: zero address");
    });
  });

  // ─────────────────────────────────────────────────────────
  // receiveUSDT — 100% goes to monthly pool
  // ─────────────────────────────────────────────────────────
  describe("receiveUSDT", () => {
    it("puts 100% of received USDT into monthly pool", async () => {
      const amount = 10_000n * 10n ** 6n;

      await rewards.connect(distributor).receiveUSDT(amount);

      expect(await rewards.monthlyBalance()).to.equal(amount);
    });

    it("all USDT arrives in contract", async () => {
      const amount = 10_000n * 10n ** 6n;
      await rewards.connect(distributor).receiveUSDT(amount);

      const contractBalance = await usdt.balanceOf(await rewards.getAddress());
      expect(contractBalance).to.equal(amount);
      expect(await rewards.monthlyBalance()).to.equal(amount);
    });

    it("accumulates across multiple calls", async () => {
      const amount = 5_000n * 10n ** 6n;

      await rewards.connect(distributor).receiveUSDT(amount);
      await rewards.connect(distributor).receiveUSDT(amount);

      expect(await rewards.monthlyBalance()).to.equal(amount * 2n);
    });

    it("emits USDTReceived event", async () => {
      const amount = 10_000n * 10n ** 6n;

      await expect(rewards.connect(distributor).receiveUSDT(amount))
        .to.emit(rewards, "USDTReceived")
        .withArgs(amount, amount);
    });

    it("reverts if amount is zero", async () => {
      await expect(
        rewards.connect(distributor).receiveUSDT(0n)
      ).to.be.revertedWith("PeriodicRewards: zero amount");
    });

    it("reverts if caller lacks DISTRIBUTOR_ROLE", async () => {
      const amount = 10_000n * 10n ** 6n;
      await mintAndApprove(stranger, amount);
      await expect(
        rewards.connect(stranger).receiveUSDT(amount)
      ).to.be.revertedWithCustomError(rewards, "AccessControlUnauthorizedAccount");
    });
  });

  // ─────────────────────────────────────────────────────────
  // distributeMonthly
  // ─────────────────────────────────────────────────────────
  describe("distributeMonthly", () => {
    const FUND = 10_000n * 10n ** 6n; // 10,000 USDT in contract

    beforeEach(async () => {
      await rewards.connect(distributor).receiveUSDT(FUND);
    });

    it("distributes monthly amounts to recipients", async () => {
      const monthly = await rewards.monthlyBalance(); // 10,000 USDT (100%)

      // Split across 2 recipients
      const amt1 = monthly / 2n;
      const amt2 = monthly - amt1;

      const before1 = await usdt.balanceOf(recipient1.address);
      const before2 = await usdt.balanceOf(recipient2.address);

      await rewards.connect(admin).distributeMonthly(
        [recipient1.address, recipient2.address],
        [amt1, amt2],
      );

      expect(await usdt.balanceOf(recipient1.address)).to.equal(before1 + amt1);
      expect(await usdt.balanceOf(recipient2.address)).to.equal(before2 + amt2);
    });

    it("decreases monthlyBalance after distribution", async () => {
      const monthly = await rewards.monthlyBalance();
      const amt = monthly / 2n;

      await rewards.connect(admin).distributeMonthly([recipient1.address], [amt]);

      expect(await rewards.monthlyBalance()).to.equal(monthly - amt);
    });

    it("emits MonthlyDistributed event", async () => {
      const monthly = await rewards.monthlyBalance();
      await expect(
        rewards.connect(admin).distributeMonthly([recipient1.address], [monthly])
      )
        .to.emit(rewards, "MonthlyDistributed")
        .withArgs(monthly);
    });

    it("reverts if total amounts exceed monthlyBalance", async () => {
      const monthly = await rewards.monthlyBalance();
      const tooMuch = monthly + 1n;

      await expect(
        rewards.connect(admin).distributeMonthly([recipient1.address], [tooMuch])
      ).to.be.revertedWith("PeriodicRewards: insufficient monthly balance");
    });

    it("reverts if arrays have mismatched lengths", async () => {
      await expect(
        rewards.connect(admin).distributeMonthly(
          [recipient1.address, recipient2.address],
          [1000n],
        )
      ).to.be.revertedWith("PeriodicRewards: length mismatch");
    });

    it("reverts if recipients array is empty", async () => {
      await expect(
        rewards.connect(admin).distributeMonthly([], [])
      ).to.be.revertedWith("PeriodicRewards: empty arrays");
    });

    it("reverts if caller lacks DEFAULT_ADMIN_ROLE", async () => {
      const monthly = await rewards.monthlyBalance();
      await expect(
        rewards.connect(stranger).distributeMonthly([recipient1.address], [monthly])
      ).to.be.revertedWithCustomError(rewards, "AccessControlUnauthorizedAccount");
    });

    it("distributes 5-tier allocation (10/18/22/25/25%)", async () => {
      const monthly = await rewards.monthlyBalance(); // 10,000 USDT

      // 5 tiers: 10%, 18%, 22%, 25%, 25%
      const tier1 = (monthly * 1000n) / BPS_MONTHLY; // 10%
      const tier2 = (monthly * 1800n) / BPS_MONTHLY; // 18%
      const tier3 = (monthly * 2200n) / BPS_MONTHLY; // 22%
      const tier4 = (monthly * 2500n) / BPS_MONTHLY; // 25%
      const tier5 = monthly - tier1 - tier2 - tier3 - tier4; // 25% (remainder)

      const recipients = [
        recipient1.address,
        recipient2.address,
        recipient3.address,
        admin.address,
        distributor.address,
      ];
      const amounts = [tier1, tier2, tier3, tier4, tier5];

      await rewards.connect(admin).distributeMonthly(recipients, amounts);

      expect(await rewards.monthlyBalance()).to.equal(0n);
    });
  });

  // ─────────────────────────────────────────────────────────
  // View Functions
  // ─────────────────────────────────────────────────────────
  describe("View Functions", () => {
    it("monthlyBalance reflects current pool state", async () => {
      expect(await rewards.monthlyBalance()).to.equal(0n);

      const amount = 4_000n * 10n ** 6n;
      await rewards.connect(distributor).receiveUSDT(amount);

      expect(await rewards.monthlyBalance()).to.equal(amount);
    });

    it("balance decreases correctly after distribution", async () => {
      const amount = 10_000n * 10n ** 6n;
      await rewards.connect(distributor).receiveUSDT(amount);

      const monthly = await rewards.monthlyBalance();

      // Distribute all of monthly
      await rewards.connect(admin).distributeMonthly([recipient1.address], [monthly]);
      expect(await rewards.monthlyBalance()).to.equal(0n);
    });
  });

  // ─────────────────────────────────────────────────────────
  // Access Control
  // ─────────────────────────────────────────────────────────
  describe("Access Control", () => {
    it("admin can grant DISTRIBUTOR_ROLE", async () => {
      await rewards.connect(admin).grantRole(DISTRIBUTOR_ROLE, stranger.address);
      expect(await rewards.hasRole(DISTRIBUTOR_ROLE, stranger.address)).to.be.true;
    });

    it("stranger cannot grant DISTRIBUTOR_ROLE", async () => {
      await expect(
        rewards.connect(stranger).grantRole(DISTRIBUTOR_ROLE, stranger.address)
      ).to.be.revertedWithCustomError(rewards, "AccessControlUnauthorizedAccount");
    });

    it("admin can revoke DISTRIBUTOR_ROLE", async () => {
      await rewards.connect(admin).revokeRole(DISTRIBUTOR_ROLE, distributor.address);
      expect(await rewards.hasRole(DISTRIBUTOR_ROLE, distributor.address)).to.be.false;
    });

    it("revoked distributor cannot call receiveUSDT", async () => {
      await rewards.connect(admin).revokeRole(DISTRIBUTOR_ROLE, distributor.address);
      await expect(
        rewards.connect(distributor).receiveUSDT(1000n)
      ).to.be.revertedWithCustomError(rewards, "AccessControlUnauthorizedAccount");
    });
  });
});
