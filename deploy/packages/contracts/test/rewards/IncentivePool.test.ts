import { expect } from "chai";
import { ethers } from "hardhat";
import { IncentivePool, MockUSDT } from "../../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("IncentivePool", function () {
  let pool: IncentivePool;
  let usdt: MockUSDT;
  let admin: SignerWithAddress;
  let distributor: SignerWithAddress; // holds DISTRIBUTOR_ROLE (RewardDistributor)
  let stranger: SignerWithAddress;
  let recipient1: SignerWithAddress;
  let recipient2: SignerWithAddress;
  let recipient3: SignerWithAddress;

  const DISTRIBUTOR_ROLE  = ethers.keccak256(ethers.toUtf8Bytes("DISTRIBUTOR_ROLE"));
  const DEFAULT_ADMIN_ROLE = ethers.ZeroHash;

  // Helper: mint USDT to distributor and approve IncentivePool to pull
  async function mintAndApprove(from: SignerWithAddress, amount: bigint) {
    await usdt.mint(from.address, amount);
    await usdt.connect(from).approve(await pool.getAddress(), ethers.MaxUint256);
  }

  beforeEach(async () => {
    [admin, distributor, stranger, recipient1, recipient2, recipient3] =
      await ethers.getSigners();

    // Deploy MockUSDT
    const MockUSDTFactory = await ethers.getContractFactory("MockUSDT");
    usdt = await MockUSDTFactory.deploy();

    // Deploy IncentivePool
    const IncentivePoolFactory = await ethers.getContractFactory("IncentivePool");
    pool = await IncentivePoolFactory.deploy(
      await usdt.getAddress(),
      admin.address,
    );

    // Grant DISTRIBUTOR_ROLE to distributor signer
    await pool.connect(admin).grantRole(DISTRIBUTOR_ROLE, distributor.address);

    // Fund distributor with USDT
    await mintAndApprove(distributor, 1_000_000n * 10n ** 6n); // 1M USDT
  });

  // ─────────────────────────────────────────────────────────
  // Constructor
  // ─────────────────────────────────────────────────────────
  describe("Constructor", () => {
    it("stores usdt address", async () => {
      expect(await pool.usdt()).to.equal(await usdt.getAddress());
    });

    it("grants DEFAULT_ADMIN_ROLE to admin", async () => {
      expect(await pool.hasRole(DEFAULT_ADMIN_ROLE, admin.address)).to.be.true;
    });

    it("starts with zero balance", async () => {
      expect(await pool.currentBalance()).to.equal(0n);
    });
  });

  // ─────────────────────────────────────────────────────────
  // receiveUSDT
  // ─────────────────────────────────────────────────────────
  describe("receiveUSDT", () => {
    it("accumulates USDT from distributor", async () => {
      const amount = 1_000n * 10n ** 6n; // 1,000 USDT
      await pool.connect(distributor).receiveUSDT(amount);
      expect(await pool.currentBalance()).to.equal(amount);
    });

    it("multiple deposits accumulate correctly", async () => {
      const amount = 500n * 10n ** 6n; // 500 USDT
      await pool.connect(distributor).receiveUSDT(amount);
      await pool.connect(distributor).receiveUSDT(amount);
      expect(await pool.currentBalance()).to.equal(amount * 2n);
    });

    it("emits USDTReceived event", async () => {
      const amount = 1_000n * 10n ** 6n;
      await expect(pool.connect(distributor).receiveUSDT(amount))
        .to.emit(pool, "USDTReceived")
        .withArgs(amount);
    });

    it("reverts if amount is zero", async () => {
      await expect(
        pool.connect(distributor).receiveUSDT(0n)
      ).to.be.revertedWith("IncentivePool: zero amount");
    });

    it("reverts if caller does not have DISTRIBUTOR_ROLE", async () => {
      const amount = 1_000n * 10n ** 6n;
      await usdt.mint(stranger.address, amount);
      await usdt.connect(stranger).approve(await pool.getAddress(), amount);
      await expect(
        pool.connect(stranger).receiveUSDT(amount)
      ).to.be.revertedWithCustomError(pool, "AccessControlUnauthorizedAccount");
    });

    it("pulls USDT from caller into contract", async () => {
      const amount = 2_000n * 10n ** 6n;
      const distributorBefore = await usdt.balanceOf(distributor.address);
      await pool.connect(distributor).receiveUSDT(amount);
      expect(await usdt.balanceOf(distributor.address)).to.equal(distributorBefore - amount);
      expect(await usdt.balanceOf(await pool.getAddress())).to.equal(amount);
    });
  });

  // ─────────────────────────────────────────────────────────
  // distribute
  // ─────────────────────────────────────────────────────────
  describe("distribute", () => {
    const poolAmount = 10_000n * 10n ** 6n; // 10,000 USDT

    beforeEach(async () => {
      // Fund the pool first
      await pool.connect(distributor).receiveUSDT(poolAmount);
    });

    it("admin distributes to a single recipient", async () => {
      const amount = 1_000n * 10n ** 6n;
      const before = await usdt.balanceOf(recipient1.address);
      await pool.connect(admin).distribute([recipient1.address], [amount]);
      expect(await usdt.balanceOf(recipient1.address)).to.equal(before + amount);
    });

    it("admin distributes to multiple recipients", async () => {
      const amounts = [
        1_000n * 10n ** 6n,
        2_000n * 10n ** 6n,
        500n  * 10n ** 6n,
      ];
      const r1Before = await usdt.balanceOf(recipient1.address);
      const r2Before = await usdt.balanceOf(recipient2.address);
      const r3Before = await usdt.balanceOf(recipient3.address);

      await pool.connect(admin).distribute(
        [recipient1.address, recipient2.address, recipient3.address],
        amounts,
      );

      expect(await usdt.balanceOf(recipient1.address)).to.equal(r1Before + amounts[0]);
      expect(await usdt.balanceOf(recipient2.address)).to.equal(r2Before + amounts[1]);
      expect(await usdt.balanceOf(recipient3.address)).to.equal(r3Before + amounts[2]);
    });

    it("reduces currentBalance after distribution", async () => {
      const amount = 3_000n * 10n ** 6n;
      await pool.connect(admin).distribute([recipient1.address], [amount]);
      expect(await pool.currentBalance()).to.equal(poolAmount - amount);
    });

    it("emits Distributed event", async () => {
      const amount = 1_000n * 10n ** 6n;
      await expect(
        pool.connect(admin).distribute([recipient1.address], [amount])
      )
        .to.emit(pool, "Distributed")
        .withArgs(1, amount);
    });

    it("reverts if total exceeds balance", async () => {
      const tooMuch = poolAmount + 1n;
      await expect(
        pool.connect(admin).distribute([recipient1.address], [tooMuch])
      ).to.be.revertedWith("IncentivePool: insufficient balance");
    });

    it("reverts if recipients and amounts arrays have different lengths", async () => {
      await expect(
        pool.connect(admin).distribute(
          [recipient1.address, recipient2.address],
          [1_000n * 10n ** 6n],
        )
      ).to.be.revertedWith("IncentivePool: length mismatch");
    });

    it("reverts if arrays are empty", async () => {
      await expect(
        pool.connect(admin).distribute([], [])
      ).to.be.revertedWith("IncentivePool: empty arrays");
    });

    it("reverts if caller is not admin", async () => {
      await expect(
        pool.connect(stranger).distribute([recipient1.address], [1_000n * 10n ** 6n])
      ).to.be.revertedWithCustomError(pool, "AccessControlUnauthorizedAccount");
    });

    it("reverts if distributor tries to distribute (not admin)", async () => {
      await expect(
        pool.connect(distributor).distribute([recipient1.address], [1_000n * 10n ** 6n])
      ).to.be.revertedWithCustomError(pool, "AccessControlUnauthorizedAccount");
    });

    it("full distribution empties the pool", async () => {
      const amounts = [poolAmount / 2n, poolAmount / 2n];
      await pool.connect(admin).distribute(
        [recipient1.address, recipient2.address],
        amounts,
      );
      expect(await pool.currentBalance()).to.equal(0n);
      expect(await usdt.balanceOf(await pool.getAddress())).to.equal(0n);
    });
  });

  // ─────────────────────────────────────────────────────────
  // currentBalance view
  // ─────────────────────────────────────────────────────────
  describe("currentBalance", () => {
    it("returns zero initially", async () => {
      expect(await pool.currentBalance()).to.equal(0n);
    });

    it("reflects accumulated deposits", async () => {
      const a1 = 700n * 10n ** 6n;
      const a2 = 300n * 10n ** 6n;
      await pool.connect(distributor).receiveUSDT(a1);
      await pool.connect(distributor).receiveUSDT(a2);
      expect(await pool.currentBalance()).to.equal(a1 + a2);
    });

    it("reflects balance after partial distribution", async () => {
      const deposit = 5_000n * 10n ** 6n;
      const payout  = 1_500n * 10n ** 6n;
      await pool.connect(distributor).receiveUSDT(deposit);
      await pool.connect(admin).distribute([recipient1.address], [payout]);
      expect(await pool.currentBalance()).to.equal(deposit - payout);
    });
  });
});
