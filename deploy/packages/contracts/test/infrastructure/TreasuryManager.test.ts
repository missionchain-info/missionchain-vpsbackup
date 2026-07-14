import { expect } from "chai";
import { ethers } from "hardhat";
import { TreasuryManager, MockUSDT } from "../../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("TreasuryManager", function () {
  let treasury: TreasuryManager;
  let usdt: MockUSDT;

  let admin: SignerWithAddress;
  let distributor: SignerWithAddress;
  let dao: SignerWithAddress;
  let recipient: SignerWithAddress;
  let stranger: SignerWithAddress;

  const DISTRIBUTOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("DISTRIBUTOR_ROLE"));
  const DAO_ROLE         = ethers.keccak256(ethers.toUtf8Bytes("DAO_ROLE"));
  const DEFAULT_ADMIN_ROLE = ethers.ZeroHash;

  // Sub-pool indices
  const POOL_WORLD_DEV  = 0n;
  const POOL_APP_ADDONS = 1n;
  const POOL_RESERVED   = 2n;

  // BPS splits
  const BPS_WORLD_DEV  = 2000n; // 20%
  const BPS_APP_ADDONS = 4000n; // 40%
  // Reserved gets remainder to handle rounding: 40%

  // USDT has 6 decimals
  const USDT_DEC = 6n;
  const toUSDT = (n: number) => BigInt(n) * 10n ** USDT_DEC;

  beforeEach(async () => {
    [admin, distributor, dao, recipient, stranger] = await ethers.getSigners();

    // Deploy MockUSDT
    const USDT = await ethers.getContractFactory("MockUSDT");
    usdt = await USDT.deploy();

    // Deploy TreasuryManager
    const TreasuryManagerFactory = await ethers.getContractFactory("TreasuryManager");
    treasury = await TreasuryManagerFactory.deploy(
      await usdt.getAddress(),
      admin.address
    );

    // Grant roles
    await treasury.connect(admin).grantRole(DISTRIBUTOR_ROLE, distributor.address);
    await treasury.connect(admin).grantRole(DAO_ROLE, dao.address);

    // Mint USDT to distributor and approve treasury
    await usdt.mint(distributor.address, toUSDT(1_000_000));
    await usdt.connect(distributor).approve(await treasury.getAddress(), ethers.MaxUint256);
  });

  // ─────────────────────────────────────────────────────────
  // Constructor & Initial State
  // ─────────────────────────────────────────────────────────
  describe("Constructor", () => {
    it("should set USDT address", async () => {
      expect(await treasury.usdt()).to.equal(await usdt.getAddress());
    });

    it("should grant DEFAULT_ADMIN_ROLE to admin", async () => {
      expect(await treasury.hasRole(DEFAULT_ADMIN_ROLE, admin.address)).to.be.true;
    });

    it("should start with zero sub-pool balances", async () => {
      expect(await treasury.getSubPoolBalance(POOL_WORLD_DEV)).to.equal(0n);
      expect(await treasury.getSubPoolBalance(POOL_APP_ADDONS)).to.equal(0n);
      expect(await treasury.getSubPoolBalance(POOL_RESERVED)).to.equal(0n);
    });

    it("should start with zero totalReceived", async () => {
      expect(await treasury.totalReceived()).to.equal(0n);
    });

    it("should revert on zero usdt address", async () => {
      const Factory = await ethers.getContractFactory("TreasuryManager");
      await expect(
        Factory.deploy(ethers.ZeroAddress, admin.address)
      ).to.be.revertedWith("TreasuryManager: zero usdt");
    });

    it("should revert on zero admin address", async () => {
      const Factory = await ethers.getContractFactory("TreasuryManager");
      await expect(
        Factory.deploy(await usdt.getAddress(), ethers.ZeroAddress)
      ).to.be.revertedWith("TreasuryManager: zero admin");
    });
  });

  // ─────────────────────────────────────────────────────────
  // receiveUSDT — Splits to 3 Sub-pools (20/40/40)
  // ─────────────────────────────────────────────────────────
  describe("receiveUSDT", () => {
    it("should split 10,000 USDT into 3 sub-pools at 20/40/40", async () => {
      const amount = toUSDT(10_000);
      await treasury.connect(distributor).receiveUSDT(amount);

      const expectedWorldDev  = (amount * BPS_WORLD_DEV)  / 10000n; // 2000 USDT
      const expectedAppAddOns = (amount * BPS_APP_ADDONS) / 10000n; // 4000 USDT
      const expectedReserved  = amount - expectedWorldDev - expectedAppAddOns; // 4000 USDT

      expect(await treasury.getSubPoolBalance(POOL_WORLD_DEV)).to.equal(expectedWorldDev);
      expect(await treasury.getSubPoolBalance(POOL_APP_ADDONS)).to.equal(expectedAppAddOns);
      expect(await treasury.getSubPoolBalance(POOL_RESERVED)).to.equal(expectedReserved);
    });

    it("should pull USDT from distributor to contract", async () => {
      const amount = toUSDT(5_000);
      const contractAddr = await treasury.getAddress();
      const balBefore = await usdt.balanceOf(contractAddr);
      await treasury.connect(distributor).receiveUSDT(amount);
      const balAfter = await usdt.balanceOf(contractAddr);
      expect(balAfter - balBefore).to.equal(amount);
    });

    it("should accumulate sub-pool balances across multiple deposits", async () => {
      const amount1 = toUSDT(6_000);
      const amount2 = toUSDT(4_000);
      await treasury.connect(distributor).receiveUSDT(amount1);
      await treasury.connect(distributor).receiveUSDT(amount2);

      const total = amount1 + amount2;
      const expectedWorldDev = (total * BPS_WORLD_DEV) / 10000n;
      expect(await treasury.getSubPoolBalance(POOL_WORLD_DEV)).to.equal(expectedWorldDev);
    });

    it("should update totalReceived correctly", async () => {
      await treasury.connect(distributor).receiveUSDT(toUSDT(3_000));
      await treasury.connect(distributor).receiveUSDT(toUSDT(2_000));
      expect(await treasury.totalReceived()).to.equal(toUSDT(5_000));
    });

    it("should emit USDTReceived event", async () => {
      const amount = toUSDT(1_000);
      const expectedWorldDev  = (amount * BPS_WORLD_DEV)  / 10000n;
      const expectedAppAddOns = (amount * BPS_APP_ADDONS) / 10000n;
      const expectedReserved  = amount - expectedWorldDev - expectedAppAddOns;

      await expect(treasury.connect(distributor).receiveUSDT(amount))
        .to.emit(treasury, "USDTReceived")
        .withArgs(amount, expectedWorldDev, expectedAppAddOns, expectedReserved);
    });

    it("should revert if called by non-DISTRIBUTOR", async () => {
      await expect(
        treasury.connect(stranger).receiveUSDT(toUSDT(100))
      ).to.be.reverted;
    });

    it("should revert on zero amount", async () => {
      await expect(
        treasury.connect(distributor).receiveUSDT(0n)
      ).to.be.revertedWith("TreasuryManager: zero amount");
    });

    it("sum of sub-pool balances should equal total received (no dust loss)", async () => {
      const amount = toUSDT(10_000);
      await treasury.connect(distributor).receiveUSDT(amount);

      const total =
        (await treasury.getSubPoolBalance(POOL_WORLD_DEV)) +
        (await treasury.getSubPoolBalance(POOL_APP_ADDONS)) +
        (await treasury.getSubPoolBalance(POOL_RESERVED));

      expect(total).to.equal(amount);
    });
  });

  // ─────────────────────────────────────────────────────────
  // transfer — Within Limits
  // ─────────────────────────────────────────────────────────
  describe("transfer", () => {
    const DEPOSIT_AMOUNT = toUSDT(100_000); // Large deposit so 5% = 5000 USDT

    beforeEach(async () => {
      await treasury.connect(distributor).receiveUSDT(DEPOSIT_AMOUNT);
    });

    it("should allow admin to transfer up to 5% of sub-pool balance", async () => {
      const balance = await treasury.getSubPoolBalance(POOL_WORLD_DEV);
      const maxTransfer = (balance * 500n) / 10000n; // 5%

      const balBefore = await usdt.balanceOf(recipient.address);
      await treasury.connect(admin).transfer(POOL_WORLD_DEV, recipient.address, maxTransfer);
      const balAfter = await usdt.balanceOf(recipient.address);

      expect(balAfter - balBefore).to.equal(maxTransfer);
    });

    it("should reduce sub-pool balance after transfer", async () => {
      const balance = await treasury.getSubPoolBalance(POOL_APP_ADDONS);
      const transferAmt = (balance * 500n) / 10000n; // 5%

      await treasury.connect(admin).transfer(POOL_APP_ADDONS, recipient.address, transferAmt);
      expect(await treasury.getSubPoolBalance(POOL_APP_ADDONS)).to.equal(balance - transferAmt);
    });

    it("should allow 2 transfers in the same 30-day period", async () => {
      const balance = await treasury.getSubPoolBalance(POOL_RESERVED);
      const transferAmt = (balance * 100n) / 10000n; // 1% (well within 5%)

      await treasury.connect(admin).transfer(POOL_RESERVED, recipient.address, transferAmt);
      await treasury.connect(admin).transfer(POOL_RESERVED, recipient.address, transferAmt);
      expect(await treasury.getCurrentPeriodTransfers(POOL_RESERVED)).to.equal(2n);
    });

    it("should emit Transfer event", async () => {
      const balance = await treasury.getSubPoolBalance(POOL_WORLD_DEV);
      const transferAmt = (balance * 100n) / 10000n; // 1%

      await expect(treasury.connect(admin).transfer(POOL_WORLD_DEV, recipient.address, transferAmt))
        .to.emit(treasury, "Transfer")
        .withArgs(POOL_WORLD_DEV, recipient.address, transferAmt);
    });

    it("should work for all 3 sub-pools independently", async () => {
      for (const pool of [POOL_WORLD_DEV, POOL_APP_ADDONS, POOL_RESERVED]) {
        const balance = await treasury.getSubPoolBalance(pool);
        const transferAmt = (balance * 100n) / 10000n;
        await treasury.connect(admin).transfer(pool, recipient.address, transferAmt);
        expect(await treasury.getCurrentPeriodTransfers(pool)).to.equal(1n);
      }
    });

    // ─── Revert: exceeds 5% ───
    it("should revert if transfer exceeds 5% of sub-pool balance", async () => {
      const balance = await treasury.getSubPoolBalance(POOL_WORLD_DEV);
      const overLimit = (balance * 500n) / 10000n + 1n; // 5% + 1 wei

      await expect(
        treasury.connect(admin).transfer(POOL_WORLD_DEV, recipient.address, overLimit)
      ).to.be.revertedWith("TreasuryManager: exceeds 5% limit");
    });

    // ─── Revert: 3rd transfer in same period ───
    it("should revert on 3rd transfer within the same 30-day period", async () => {
      const balance = await treasury.getSubPoolBalance(POOL_WORLD_DEV);
      const transferAmt = (balance * 100n) / 10000n; // 1%

      await treasury.connect(admin).transfer(POOL_WORLD_DEV, recipient.address, transferAmt);
      await treasury.connect(admin).transfer(POOL_WORLD_DEV, recipient.address, transferAmt);

      await expect(
        treasury.connect(admin).transfer(POOL_WORLD_DEV, recipient.address, transferAmt)
      ).to.be.revertedWith("TreasuryManager: monthly limit reached");
    });

    it("should allow 2 more transfers after period rolls over", async () => {
      const balance = await treasury.getSubPoolBalance(POOL_WORLD_DEV);
      const transferAmt = (balance * 50n) / 10000n; // 0.5%

      // Fill current period
      await treasury.connect(admin).transfer(POOL_WORLD_DEV, recipient.address, transferAmt);
      await treasury.connect(admin).transfer(POOL_WORLD_DEV, recipient.address, transferAmt);

      // Advance time by 30 days
      await ethers.provider.send("evm_increaseTime", [30 * 24 * 60 * 60]);
      await ethers.provider.send("evm_mine", []);

      // Should allow 2 more in new period
      const newBalance = await treasury.getSubPoolBalance(POOL_WORLD_DEV);
      const newTransfer = (newBalance * 50n) / 10000n;
      await treasury.connect(admin).transfer(POOL_WORLD_DEV, recipient.address, newTransfer);
      await treasury.connect(admin).transfer(POOL_WORLD_DEV, recipient.address, newTransfer);
      expect(await treasury.getCurrentPeriodTransfers(POOL_WORLD_DEV)).to.equal(2n);
    });

    it("should revert on zero amount", async () => {
      await expect(
        treasury.connect(admin).transfer(POOL_WORLD_DEV, recipient.address, 0n)
      ).to.be.revertedWith("TreasuryManager: zero amount");
    });

    it("should revert on zero recipient", async () => {
      const balance = await treasury.getSubPoolBalance(POOL_WORLD_DEV);
      const transferAmt = (balance * 100n) / 10000n;
      await expect(
        treasury.connect(admin).transfer(POOL_WORLD_DEV, ethers.ZeroAddress, transferAmt)
      ).to.be.revertedWith("TreasuryManager: zero recipient");
    });

    it("should revert on invalid sub-pool index", async () => {
      await expect(
        treasury.connect(admin).transfer(3n, recipient.address, 1n)
      ).to.be.revertedWith("TreasuryManager: invalid pool");
    });

    it("should revert if non-admin calls transfer", async () => {
      const balance = await treasury.getSubPoolBalance(POOL_WORLD_DEV);
      const transferAmt = (balance * 100n) / 10000n;
      await expect(
        treasury.connect(stranger).transfer(POOL_WORLD_DEV, recipient.address, transferAmt)
      ).to.be.reverted;
    });
  });

  // ─────────────────────────────────────────────────────────
  // emergencyWithdraw — Bypasses Limits
  // ─────────────────────────────────────────────────────────
  describe("emergencyWithdraw", () => {
    const DEPOSIT_AMOUNT = toUSDT(100_000);

    beforeEach(async () => {
      await treasury.connect(distributor).receiveUSDT(DEPOSIT_AMOUNT);
    });

    it("should allow DAO to withdraw entire sub-pool balance (bypasses 5% limit)", async () => {
      const balance = await treasury.getSubPoolBalance(POOL_WORLD_DEV);
      const balBefore = await usdt.balanceOf(recipient.address);
      await treasury.connect(dao).emergencyWithdraw(POOL_WORLD_DEV, recipient.address, balance);
      const balAfter = await usdt.balanceOf(recipient.address);
      expect(balAfter - balBefore).to.equal(balance);
    });

    it("should allow DAO to withdraw after monthly limit is reached", async () => {
      const balance = await treasury.getSubPoolBalance(POOL_WORLD_DEV);
      const smallAmt = (balance * 100n) / 10000n;

      // Exhaust 2 transfers
      await treasury.connect(admin).transfer(POOL_WORLD_DEV, recipient.address, smallAmt);
      await treasury.connect(admin).transfer(POOL_WORLD_DEV, recipient.address, smallAmt);

      // Emergency withdraw still works
      const newBalance = await treasury.getSubPoolBalance(POOL_WORLD_DEV);
      await expect(
        treasury.connect(dao).emergencyWithdraw(POOL_WORLD_DEV, recipient.address, newBalance)
      ).to.not.be.reverted;
    });

    it("should reduce sub-pool balance correctly", async () => {
      const balance = await treasury.getSubPoolBalance(POOL_APP_ADDONS);
      await treasury.connect(dao).emergencyWithdraw(POOL_APP_ADDONS, recipient.address, balance);
      expect(await treasury.getSubPoolBalance(POOL_APP_ADDONS)).to.equal(0n);
    });

    it("should emit EmergencyWithdraw event", async () => {
      const balance = await treasury.getSubPoolBalance(POOL_RESERVED);
      await expect(
        treasury.connect(dao).emergencyWithdraw(POOL_RESERVED, recipient.address, balance)
      )
        .to.emit(treasury, "EmergencyWithdraw")
        .withArgs(POOL_RESERVED, recipient.address, balance);
    });

    it("should revert if called by admin (not DAO_ROLE)", async () => {
      const balance = await treasury.getSubPoolBalance(POOL_WORLD_DEV);
      await expect(
        treasury.connect(admin).emergencyWithdraw(POOL_WORLD_DEV, recipient.address, balance)
      ).to.be.reverted;
    });

    it("should revert if called by stranger", async () => {
      const balance = await treasury.getSubPoolBalance(POOL_WORLD_DEV);
      await expect(
        treasury.connect(stranger).emergencyWithdraw(POOL_WORLD_DEV, recipient.address, balance)
      ).to.be.reverted;
    });

    it("should revert if amount exceeds sub-pool balance", async () => {
      const balance = await treasury.getSubPoolBalance(POOL_WORLD_DEV);
      await expect(
        treasury.connect(dao).emergencyWithdraw(POOL_WORLD_DEV, recipient.address, balance + 1n)
      ).to.be.revertedWith("TreasuryManager: insufficient balance");
    });

    it("should revert on zero recipient", async () => {
      await expect(
        treasury.connect(dao).emergencyWithdraw(POOL_WORLD_DEV, ethers.ZeroAddress, 1n)
      ).to.be.revertedWith("TreasuryManager: zero recipient");
    });

    it("should revert on zero amount", async () => {
      await expect(
        treasury.connect(dao).emergencyWithdraw(POOL_WORLD_DEV, recipient.address, 0n)
      ).to.be.revertedWith("TreasuryManager: zero amount");
    });

    it("should revert on invalid sub-pool index", async () => {
      await expect(
        treasury.connect(dao).emergencyWithdraw(3n, recipient.address, 1n)
      ).to.be.revertedWith("TreasuryManager: invalid pool");
    });
  });

  // ─────────────────────────────────────────────────────────
  // Access Control
  // ─────────────────────────────────────────────────────────
  describe("Access Control", () => {
    it("should grant DISTRIBUTOR_ROLE via admin", async () => {
      expect(await treasury.hasRole(DISTRIBUTOR_ROLE, distributor.address)).to.be.true;
    });

    it("should grant DAO_ROLE via admin", async () => {
      expect(await treasury.hasRole(DAO_ROLE, dao.address)).to.be.true;
    });

    it("should allow admin to revoke DISTRIBUTOR_ROLE", async () => {
      await treasury.connect(admin).revokeRole(DISTRIBUTOR_ROLE, distributor.address);
      await expect(
        treasury.connect(distributor).receiveUSDT(toUSDT(100))
      ).to.be.reverted;
    });

    it("should allow admin to grant DISTRIBUTOR_ROLE to new address", async () => {
      await treasury.connect(admin).grantRole(DISTRIBUTOR_ROLE, stranger.address);
      await usdt.mint(stranger.address, toUSDT(100));
      await usdt.connect(stranger).approve(await treasury.getAddress(), toUSDT(100));
      await expect(
        treasury.connect(stranger).receiveUSDT(toUSDT(100))
      ).to.not.be.reverted;
    });
  });

  // ─────────────────────────────────────────────────────────
  // View Functions
  // ─────────────────────────────────────────────────────────
  describe("View Functions", () => {
    it("getSubPoolBalance should return correct balance per sub-pool", async () => {
      await treasury.connect(distributor).receiveUSDT(toUSDT(10_000));

      const worldDev  = await treasury.getSubPoolBalance(POOL_WORLD_DEV);
      const appAddOns = await treasury.getSubPoolBalance(POOL_APP_ADDONS);
      const reserved  = await treasury.getSubPoolBalance(POOL_RESERVED);

      expect(worldDev).to.equal(toUSDT(2_000));
      expect(appAddOns).to.equal(toUSDT(4_000));
      expect(reserved).to.equal(toUSDT(4_000));
    });

    it("getSubPoolBalance should revert on invalid pool index", async () => {
      await expect(treasury.getSubPoolBalance(3n)).to.be.revertedWith(
        "TreasuryManager: invalid pool"
      );
    });

    it("getCurrentPeriodTransfers should return 0 initially", async () => {
      expect(await treasury.getCurrentPeriodTransfers(POOL_WORLD_DEV)).to.equal(0n);
    });

    it("getCurrentPeriodTransfers should increment after each transfer", async () => {
      await treasury.connect(distributor).receiveUSDT(toUSDT(100_000));
      const balance = await treasury.getSubPoolBalance(POOL_WORLD_DEV);
      const transferAmt = (balance * 100n) / 10000n;

      await treasury.connect(admin).transfer(POOL_WORLD_DEV, recipient.address, transferAmt);
      expect(await treasury.getCurrentPeriodTransfers(POOL_WORLD_DEV)).to.equal(1n);

      await treasury.connect(admin).transfer(POOL_WORLD_DEV, recipient.address, transferAmt);
      expect(await treasury.getCurrentPeriodTransfers(POOL_WORLD_DEV)).to.equal(2n);
    });

    it("getCurrentPeriodTransfers should revert on invalid pool index", async () => {
      await expect(treasury.getCurrentPeriodTransfers(3n)).to.be.revertedWith(
        "TreasuryManager: invalid pool"
      );
    });

    it("getContractBalance should return actual USDT held by contract", async () => {
      const amount = toUSDT(50_000);
      await treasury.connect(distributor).receiveUSDT(amount);
      expect(await treasury.getContractBalance()).to.equal(amount);
    });

    it("totalReceived should track cumulative USDT received", async () => {
      await treasury.connect(distributor).receiveUSDT(toUSDT(10_000));
      await treasury.connect(distributor).receiveUSDT(toUSDT(20_000));
      expect(await treasury.totalReceived()).to.equal(toUSDT(30_000));
    });
  });
});
