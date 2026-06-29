import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("LockManager", function () {
  let lockManager: any;
  let owner: any, saleContract: any, user1: any;

  const SIX_MONTHS = 6 * 30 * 24 * 3600; // ~15,552,000 seconds
  const ONE_MONTH = 30 * 24 * 3600;
  const AMOUNT = ethers.parseEther("1000000"); // 1M MIC

  beforeEach(async () => {
    [owner, saleContract, user1] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("LockManager");
    lockManager = await Factory.deploy();

    const SCHEDULE_CREATOR = await lockManager.SCHEDULE_CREATOR_ROLE();
    await lockManager.grantRole(SCHEDULE_CREATOR, saleContract.address);
  });

  describe("createSchedule", () => {
    it("should create a vesting schedule", async () => {
      await lockManager.connect(saleContract).createSchedule(
        user1.address, AMOUNT, SIX_MONTHS, 1000, 250
      );
      const schedules = await lockManager.getSchedules(user1.address);
      expect(schedules.length).to.equal(1);
      expect(schedules[0].totalAmount).to.equal(AMOUNT);
    });

    it("should revert if not SCHEDULE_CREATOR_ROLE", async () => {
      await expect(
        lockManager.connect(user1).createSchedule(user1.address, AMOUNT, SIX_MONTHS, 1000, 250)
      ).to.be.reverted;
    });
  });

  describe("lockedOf — before cliff", () => {
    it("should lock 100% before cliff", async () => {
      await lockManager.connect(saleContract).createSchedule(
        user1.address, AMOUNT, SIX_MONTHS, 1000, 250
      );
      expect(await lockManager.lockedOf(user1.address)).to.equal(AMOUNT);
    });
  });

  describe("lockedOf — at cliff", () => {
    it("should unlock cliff% at cliff time", async () => {
      await lockManager.connect(saleContract).createSchedule(
        user1.address, AMOUNT, SIX_MONTHS, 1000, 250
      );
      await time.increase(SIX_MONTHS);
      // 10% unlocked = 100K, locked = 900K
      const locked = await lockManager.lockedOf(user1.address);
      expect(locked).to.equal(ethers.parseEther("900000"));
    });
  });

  describe("lockedOf — monthly unlock after cliff", () => {
    it("should unlock 2.5%/month after cliff", async () => {
      await lockManager.connect(saleContract).createSchedule(
        user1.address, AMOUNT, SIX_MONTHS, 1000, 250
      );
      // 6 months cliff + 1 month = 12.5% unlocked (10% cliff + 2.5%)
      await time.increase(SIX_MONTHS + ONE_MONTH);
      const locked = await lockManager.lockedOf(user1.address);
      expect(locked).to.equal(ethers.parseEther("875000")); // 87.5% still locked
    });
  });

  describe("lockedOf — fully vested", () => {
    it("should be 0 after full vesting (42 months for PreSale)", async () => {
      await lockManager.connect(saleContract).createSchedule(
        user1.address, AMOUNT, SIX_MONTHS, 1000, 250
      );
      // 6 months cliff + 36 months (2.5%/month × 36 = 90%) = 100% total
      await time.increase(SIX_MONTHS + 36 * ONE_MONTH);
      expect(await lockManager.lockedOf(user1.address)).to.equal(0);
    });
  });

  describe("multiple schedules", () => {
    it("should sum locked amounts from all schedules", async () => {
      const amount2 = ethers.parseEther("500000");
      await lockManager.connect(saleContract).createSchedule(
        user1.address, AMOUNT, SIX_MONTHS, 1000, 250
      );
      await lockManager.connect(saleContract).createSchedule(
        user1.address, amount2, SIX_MONTHS, 1000, 250
      );
      const locked = await lockManager.lockedOf(user1.address);
      expect(locked).to.equal(AMOUNT + amount2);
    });
  });
});
