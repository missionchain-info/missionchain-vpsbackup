import { expect } from "chai";
import { ethers } from "hardhat";
import { LiquidityPool, MockUSDT, MICToken } from "../../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("LiquidityPool", function () {
  let pool: LiquidityPool;
  let usdt: MockUSDT;
  let mic: MICToken;

  let admin: SignerWithAddress;
  let distributor: SignerWithAddress;
  let depositor: SignerWithAddress;
  let stranger: SignerWithAddress;
  let recipient: SignerWithAddress;

  const DISTRIBUTOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("DISTRIBUTOR_ROLE"));
  const DEPOSITOR_ROLE   = ethers.keccak256(ethers.toUtf8Bytes("DEPOSITOR_ROLE"));
  const DEFAULT_ADMIN_ROLE = ethers.ZeroHash;

  // USDT: 6 decimals
  const USDT_DEC = 6n;
  const toUSDT = (n: number) => BigInt(n) * 10n ** USDT_DEC;

  // MIC: 18 decimals
  const MIC_DEC = 18n;
  const toMIC = (n: number) => BigInt(n) * 10n ** MIC_DEC;

  // 105M MIC locked at deploy for DEX/CEX listing
  const LOCKED_MIC = toMIC(105_000_000);

  beforeEach(async () => {
    [admin, distributor, depositor, stranger, recipient] = await ethers.getSigners();

    // Deploy MockUSDT
    const USDT = await ethers.getContractFactory("MockUSDT");
    usdt = await USDT.deploy();

    // Deploy MICToken (treasury = admin initially)
    const MIC = await ethers.getContractFactory("MICToken");
    mic = await MIC.deploy(admin.address);

    // Deploy LiquidityPool
    const LPFactory = await ethers.getContractFactory("LiquidityPool");
    pool = await LPFactory.deploy(
      await usdt.getAddress(),
      await mic.getAddress(),
      admin.address
    );

    // Grant roles
    await pool.connect(admin).grantRole(DISTRIBUTOR_ROLE, distributor.address);
    await pool.connect(admin).grantRole(DEPOSITOR_ROLE, depositor.address);

    // Mint USDT to distributor and approve pool
    await usdt.mint(distributor.address, toUSDT(1_000_000));
    await usdt.connect(distributor).approve(await pool.getAddress(), ethers.MaxUint256);

    // Transfer 105M MIC to pool (simulating deploy-time lock)
    // MICToken mints 1.05B (15%) to treasury (admin) at deploy
    await mic.connect(admin).transfer(await pool.getAddress(), LOCKED_MIC);

    // Give depositor some MIC to deposit
    await mic.connect(admin).transfer(depositor.address, toMIC(1_000_000));
    await mic.connect(depositor).approve(await pool.getAddress(), ethers.MaxUint256);
  });

  // ─────────────────────────────────────────────────────────
  // Constructor & Initial State
  // ─────────────────────────────────────────────────────────
  describe("Constructor", () => {
    it("should set usdt address", async () => {
      expect(await pool.usdt()).to.equal(await usdt.getAddress());
    });

    it("should set mic address", async () => {
      expect(await pool.mic()).to.equal(await mic.getAddress());
    });

    it("should grant DEFAULT_ADMIN_ROLE to admin", async () => {
      expect(await pool.hasRole(DEFAULT_ADMIN_ROLE, admin.address)).to.be.true;
    });

    it("should revert on zero usdt address", async () => {
      const Factory = await ethers.getContractFactory("LiquidityPool");
      await expect(
        Factory.deploy(ethers.ZeroAddress, await mic.getAddress(), admin.address)
      ).to.be.revertedWith("LiquidityPool: zero usdt");
    });

    it("should revert on zero mic address", async () => {
      const Factory = await ethers.getContractFactory("LiquidityPool");
      await expect(
        Factory.deploy(await usdt.getAddress(), ethers.ZeroAddress, admin.address)
      ).to.be.revertedWith("LiquidityPool: zero mic");
    });

    it("should revert on zero admin address", async () => {
      const Factory = await ethers.getContractFactory("LiquidityPool");
      await expect(
        Factory.deploy(await usdt.getAddress(), await mic.getAddress(), ethers.ZeroAddress)
      ).to.be.revertedWith("LiquidityPool: zero admin");
    });
  });

  // ─────────────────────────────────────────────────────────
  // receiveUSDT — Called by RevenueRouter / SeedBudget
  // ─────────────────────────────────────────────────────────
  describe("receiveUSDT", () => {
    it("should accumulate USDT in the contract", async () => {
      const amount = toUSDT(10_000);
      await pool.connect(distributor).receiveUSDT(amount);
      expect(await pool.usdtBalance()).to.equal(amount);
    });

    it("should pull USDT from caller", async () => {
      const amount = toUSDT(5_000);
      const distBalBefore = await usdt.balanceOf(distributor.address);
      await pool.connect(distributor).receiveUSDT(amount);
      const distBalAfter = await usdt.balanceOf(distributor.address);
      expect(distBalBefore - distBalAfter).to.equal(amount);
    });

    it("should accumulate across multiple deposits", async () => {
      await pool.connect(distributor).receiveUSDT(toUSDT(3_000));
      await pool.connect(distributor).receiveUSDT(toUSDT(7_000));
      expect(await pool.usdtBalance()).to.equal(toUSDT(10_000));
    });

    it("should update totalUSDTReceived", async () => {
      await pool.connect(distributor).receiveUSDT(toUSDT(1_000));
      await pool.connect(distributor).receiveUSDT(toUSDT(2_000));
      expect(await pool.totalUSDTReceived()).to.equal(toUSDT(3_000));
    });

    it("should emit USDTReceived event", async () => {
      const amount = toUSDT(1_000);
      await expect(pool.connect(distributor).receiveUSDT(amount))
        .to.emit(pool, "USDTReceived")
        .withArgs(distributor.address, amount);
    });

    it("should revert if called by non-DISTRIBUTOR_ROLE", async () => {
      await expect(
        pool.connect(stranger).receiveUSDT(toUSDT(100))
      ).to.be.reverted;
    });

    it("should revert on zero amount", async () => {
      await expect(
        pool.connect(distributor).receiveUSDT(0)
      ).to.be.revertedWith("LiquidityPool: zero amount");
    });
  });

  // ─────────────────────────────────────────────────────────
  // depositMIC — Reserved Staking admin buys MIC from DEX, deposits here
  // ─────────────────────────────────────────────────────────
  describe("depositMIC", () => {
    it("should accumulate MIC in the contract (on top of locked MIC)", async () => {
      const depositAmt = toMIC(50_000);
      const micBalBefore = await pool.micBalance();
      await pool.connect(depositor).depositMIC(depositAmt);
      expect(await pool.micBalance()).to.equal(micBalBefore + depositAmt);
    });

    it("should pull MIC from caller", async () => {
      const amount = toMIC(100_000);
      const depositorBalBefore = await mic.balanceOf(depositor.address);
      await pool.connect(depositor).depositMIC(amount);
      const depositorBalAfter = await mic.balanceOf(depositor.address);
      expect(depositorBalBefore - depositorBalAfter).to.equal(amount);
    });

    it("should accumulate across multiple deposits", async () => {
      const micBalBefore = await pool.micBalance();
      await pool.connect(depositor).depositMIC(toMIC(200_000));
      await pool.connect(depositor).depositMIC(toMIC(300_000));
      expect(await pool.micBalance()).to.equal(micBalBefore + toMIC(500_000));
    });

    it("should update totalMICDeposited", async () => {
      await pool.connect(depositor).depositMIC(toMIC(100_000));
      await pool.connect(depositor).depositMIC(toMIC(50_000));
      expect(await pool.totalMICDeposited()).to.equal(toMIC(150_000));
    });

    it("should emit MICDeposited event", async () => {
      const amount = toMIC(50_000);
      await expect(pool.connect(depositor).depositMIC(amount))
        .to.emit(pool, "MICDeposited")
        .withArgs(depositor.address, amount);
    });

    it("should revert if called by non-DEPOSITOR_ROLE", async () => {
      await expect(
        pool.connect(stranger).depositMIC(toMIC(100))
      ).to.be.reverted;
    });

    it("should revert on zero amount", async () => {
      await expect(
        pool.connect(depositor).depositMIC(0)
      ).to.be.revertedWith("LiquidityPool: zero amount");
    });
  });

  // ─────────────────────────────────────────────────────────
  // withdrawUSDT — DAO-only (24h timelock in prod, admin here)
  // ─────────────────────────────────────────────────────────
  describe("withdrawUSDT", () => {
    beforeEach(async () => {
      await pool.connect(distributor).receiveUSDT(toUSDT(50_000));
    });

    it("should allow admin to withdraw USDT", async () => {
      const amount = toUSDT(10_000);
      const balBefore = await usdt.balanceOf(recipient.address);
      await pool.connect(admin).withdrawUSDT(recipient.address, amount);
      const balAfter = await usdt.balanceOf(recipient.address);
      expect(balAfter - balBefore).to.equal(amount);
    });

    it("should reduce usdtBalance after withdrawal", async () => {
      const before = await pool.usdtBalance();
      const amount = toUSDT(10_000);
      await pool.connect(admin).withdrawUSDT(recipient.address, amount);
      expect(await pool.usdtBalance()).to.equal(before - amount);
    });

    it("should emit USDTWithdrawn event", async () => {
      const amount = toUSDT(5_000);
      await expect(pool.connect(admin).withdrawUSDT(recipient.address, amount))
        .to.emit(pool, "USDTWithdrawn")
        .withArgs(recipient.address, amount);
    });

    it("should revert if non-admin tries to withdraw USDT", async () => {
      await expect(
        pool.connect(stranger).withdrawUSDT(recipient.address, toUSDT(100))
      ).to.be.reverted;
    });

    it("should revert on zero recipient", async () => {
      await expect(
        pool.connect(admin).withdrawUSDT(ethers.ZeroAddress, toUSDT(100))
      ).to.be.revertedWith("LiquidityPool: zero recipient");
    });

    it("should revert on zero amount", async () => {
      await expect(
        pool.connect(admin).withdrawUSDT(recipient.address, 0)
      ).to.be.revertedWith("LiquidityPool: zero amount");
    });

    it("should revert if amount exceeds balance", async () => {
      const balance = await pool.usdtBalance();
      await expect(
        pool.connect(admin).withdrawUSDT(recipient.address, balance + 1n)
      ).to.be.revertedWith("LiquidityPool: insufficient USDT");
    });
  });

  // ─────────────────────────────────────────────────────────
  // withdrawMICForCEX — DAO structural vote (7d timelock in prod)
  // ─────────────────────────────────────────────────────────
  describe("withdrawMICForCEX", () => {
    it("should allow admin to withdraw MIC for CEX listing", async () => {
      const amount = toMIC(10_000_000);
      const balBefore = await mic.balanceOf(recipient.address);
      await pool.connect(admin).withdrawMICForCEX(recipient.address, amount);
      const balAfter = await mic.balanceOf(recipient.address);
      expect(balAfter - balBefore).to.equal(amount);
    });

    it("should reduce micBalance after withdrawal", async () => {
      const before = await pool.micBalance();
      const amount = toMIC(5_000_000);
      await pool.connect(admin).withdrawMICForCEX(recipient.address, amount);
      expect(await pool.micBalance()).to.equal(before - amount);
    });

    it("should emit MICWithdrawnForCEX event", async () => {
      const amount = toMIC(1_000_000);
      await expect(pool.connect(admin).withdrawMICForCEX(recipient.address, amount))
        .to.emit(pool, "MICWithdrawnForCEX")
        .withArgs(recipient.address, amount);
    });

    it("should revert if non-admin tries to withdraw MIC", async () => {
      await expect(
        pool.connect(stranger).withdrawMICForCEX(recipient.address, toMIC(100))
      ).to.be.reverted;
    });

    it("should revert on zero recipient", async () => {
      await expect(
        pool.connect(admin).withdrawMICForCEX(ethers.ZeroAddress, toMIC(100))
      ).to.be.revertedWith("LiquidityPool: zero recipient");
    });

    it("should revert on zero amount", async () => {
      await expect(
        pool.connect(admin).withdrawMICForCEX(recipient.address, 0)
      ).to.be.revertedWith("LiquidityPool: zero amount");
    });

    it("should revert if amount exceeds MIC balance", async () => {
      const balance = await pool.micBalance();
      await expect(
        pool.connect(admin).withdrawMICForCEX(recipient.address, balance + 1n)
      ).to.be.revertedWith("LiquidityPool: insufficient MIC");
    });

    it("should allow partial withdrawal of locked MIC (multiple CEX listings)", async () => {
      const half = LOCKED_MIC / 2n;
      await pool.connect(admin).withdrawMICForCEX(recipient.address, half);
      expect(await pool.micBalance()).to.equal(LOCKED_MIC - half);
    });
  });

  // ─────────────────────────────────────────────────────────
  // View Functions
  // ─────────────────────────────────────────────────────────
  describe("View Functions", () => {
    it("usdtBalance() should reflect USDT held in contract", async () => {
      expect(await pool.usdtBalance()).to.equal(0n);
      await pool.connect(distributor).receiveUSDT(toUSDT(1_000));
      expect(await pool.usdtBalance()).to.equal(toUSDT(1_000));
    });

    it("micBalance() should reflect MIC held in contract (including locked)", async () => {
      // Initially holds LOCKED_MIC transferred in beforeEach
      expect(await pool.micBalance()).to.equal(LOCKED_MIC);
    });

    it("micBalance() should include both locked MIC and deposited MIC", async () => {
      const depositAmt = toMIC(100_000);
      await pool.connect(depositor).depositMIC(depositAmt);
      expect(await pool.micBalance()).to.equal(LOCKED_MIC + depositAmt);
    });

    it("totalUSDTReceived should track cumulative inflows (not affected by withdrawals)", async () => {
      await pool.connect(distributor).receiveUSDT(toUSDT(5_000));
      await pool.connect(admin).withdrawUSDT(recipient.address, toUSDT(2_000));
      await pool.connect(distributor).receiveUSDT(toUSDT(3_000));
      expect(await pool.totalUSDTReceived()).to.equal(toUSDT(8_000));
    });

    it("totalMICDeposited should track cumulative MIC deposits (not withdrawals)", async () => {
      await pool.connect(depositor).depositMIC(toMIC(200_000));
      await pool.connect(admin).withdrawMICForCEX(recipient.address, toMIC(50_000));
      await pool.connect(depositor).depositMIC(toMIC(100_000));
      expect(await pool.totalMICDeposited()).to.equal(toMIC(300_000));
    });
  });

  // ─────────────────────────────────────────────────────────
  // Access Control
  // ─────────────────────────────────────────────────────────
  describe("Access Control", () => {
    it("admin should be able to grant DISTRIBUTOR_ROLE", async () => {
      expect(await pool.hasRole(DISTRIBUTOR_ROLE, distributor.address)).to.be.true;
    });

    it("admin should be able to grant DEPOSITOR_ROLE", async () => {
      expect(await pool.hasRole(DEPOSITOR_ROLE, depositor.address)).to.be.true;
    });

    it("admin should be able to revoke DISTRIBUTOR_ROLE", async () => {
      await pool.connect(admin).revokeRole(DISTRIBUTOR_ROLE, distributor.address);
      await expect(
        pool.connect(distributor).receiveUSDT(toUSDT(100))
      ).to.be.reverted;
    });

    it("admin should be able to revoke DEPOSITOR_ROLE", async () => {
      await pool.connect(admin).revokeRole(DEPOSITOR_ROLE, depositor.address);
      await expect(
        pool.connect(depositor).depositMIC(toMIC(100))
      ).to.be.reverted;
    });

    it("stranger cannot call withdrawUSDT", async () => {
      await pool.connect(distributor).receiveUSDT(toUSDT(1_000));
      await expect(
        pool.connect(stranger).withdrawUSDT(recipient.address, toUSDT(100))
      ).to.be.reverted;
    });

    it("stranger cannot call withdrawMICForCEX", async () => {
      await expect(
        pool.connect(stranger).withdrawMICForCEX(recipient.address, toMIC(100))
      ).to.be.reverted;
    });
  });

  // ─────────────────────────────────────────────────────────
  // Multiple Deposits Accumulate
  // ─────────────────────────────────────────────────────────
  describe("Multiple Deposits Accumulate", () => {
    it("should correctly accumulate USDT from many deposits", async () => {
      for (let i = 0; i < 5; i++) {
        await pool.connect(distributor).receiveUSDT(toUSDT(1_000));
      }
      expect(await pool.usdtBalance()).to.equal(toUSDT(5_000));
      expect(await pool.totalUSDTReceived()).to.equal(toUSDT(5_000));
    });

    it("should correctly accumulate MIC from many deposits", async () => {
      const micBalBefore = await pool.micBalance();
      for (let i = 0; i < 5; i++) {
        await pool.connect(depositor).depositMIC(toMIC(100_000));
      }
      expect(await pool.micBalance()).to.equal(micBalBefore + toMIC(500_000));
      expect(await pool.totalMICDeposited()).to.equal(toMIC(500_000));
    });

    it("should allow interleaved USDT and MIC operations", async () => {
      await pool.connect(distributor).receiveUSDT(toUSDT(10_000));
      await pool.connect(depositor).depositMIC(toMIC(200_000));
      await pool.connect(admin).withdrawUSDT(recipient.address, toUSDT(3_000));
      await pool.connect(distributor).receiveUSDT(toUSDT(5_000));

      expect(await pool.usdtBalance()).to.equal(toUSDT(12_000));
      expect(await pool.totalUSDTReceived()).to.equal(toUSDT(15_000));
      expect(await pool.micBalance()).to.equal(LOCKED_MIC + toMIC(200_000));
    });
  });
});
