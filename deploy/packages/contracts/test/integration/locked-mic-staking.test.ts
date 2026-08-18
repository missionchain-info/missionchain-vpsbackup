import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

/**
 * Integration Test: MICToken + LockManager + NFTStaking
 *
 * Validates the full locked MIC staking flow:
 * 1. User receives MIC tokens via purchase (tokens in wallet, locked via LockManager)
 * 2. User stakes locked MIC into NFTStaking (allowed because NFTStaking is approvedStakingContract)
 * 3. Vesting continues — LockManager still tracks the schedule
 * 4. User unstakes — tokens return to wallet, still locked if vesting not complete
 * 5. After vesting completes — tokens fully transferable
 */
describe("Integration: Locked MIC Staking", function () {
  let micToken: any;
  let lockManager: any;
  let nftStaking: any;
  let owner: any, treasury: any, buyer: any, other: any;

  const TOTAL_SUPPLY_CAP = ethers.parseEther("7000000000");
  const PRE_ISSUED = ethers.parseEther("1050000000");
  const SIX_MONTHS = 6 * 30 * 24 * 3600;
  const ONE_MONTH = 30 * 24 * 3600;
  const PURCHASE_AMOUNT = ethers.parseEther("1000000"); // 1M MIC

  // LockPeriod enum indices
  const LP_30D = 0;
  const LP_360D = 3;
  const THREE_SIXTY_DAYS = 360 * 24 * 3600;
  // Locked (vesting) MIC may only be staked at the 360-day lock period — the contract
  // enforces this so vesting tokens can't be cycled through short staking terms.

  // Vesting params: 10% cliff at 6 months, 2.5%/month after
  const CLIFF_UNLOCK_BPS = 1000; // 10%
  const MONTHLY_UNLOCK_BPS = 250; // 2.5%

  beforeEach(async function () {
    [owner, treasury, buyer, other] = await ethers.getSigners();

    // Deploy MICToken
    const MICFactory = await ethers.getContractFactory("MICToken");
    micToken = await MICFactory.deploy(treasury.address);

    // Deploy LockManager
    const LMFactory = await ethers.getContractFactory("LockManager");
    lockManager = await LMFactory.deploy();

    // Deploy NFTStaking
    const StakingFactory = await ethers.getContractFactory("NFTStaking");
    nftStaking = await StakingFactory.deploy(await micToken.getAddress(), treasury.address);

    // Wire up: set LockManager on MICToken
    await micToken.connect(treasury).setLockManager(await lockManager.getAddress());

    // Approve NFTStaking as staking contract (allows locked MIC transfers)
    await micToken.connect(treasury).setApprovedStakingContract(await nftStaking.getAddress(), true);

    // Grant SCHEDULE_CREATOR_ROLE to owner (simulating sale contract)
    const SCHEDULE_CREATOR = await lockManager.SCHEDULE_CREATOR_ROLE();
    await lockManager.grantRole(SCHEDULE_CREATOR, owner.address);

    // Simulate purchase: transfer MIC to buyer + create lock schedule
    await micToken.connect(treasury).transfer(buyer.address, PURCHASE_AMOUNT);
    await lockManager.createSchedule(
      buyer.address, PURCHASE_AMOUNT, SIX_MONTHS, CLIFF_UNLOCK_BPS, MONTHLY_UNLOCK_BPS
    );
  });

  /**
   * The contract's circuit breaker caps unstaking at 10% of the pool per day, so a lone
   * staker can never withdraw their own position. Park 9× the buyer's amount in the pool
   * (from treasury's unlocked MIC) so the buyer's unstake stays within the daily limit.
   */
  async function fillPoolForUnstake(buyerAmount: bigint) {
    const whaleAmount = buyerAmount * 9n;
    await micToken.connect(treasury).approve(await nftStaking.getAddress(), whaleAmount);
    await nftStaking.connect(treasury).stake(whaleAmount, LP_30D, false);
  }

  describe("Setup verification", function () {
    it("buyer has MIC in wallet but 100% locked", async function () {
      expect(await micToken.balanceOf(buyer.address)).to.equal(PURCHASE_AMOUNT);
      expect(await micToken.lockedBalanceOf(buyer.address)).to.equal(PURCHASE_AMOUNT);
      expect(await micToken.availableBalanceOf(buyer.address)).to.equal(0);
    });

    it("LockManager tracks the schedule", async function () {
      const schedules = await lockManager.getSchedules(buyer.address);
      expect(schedules.length).to.equal(1);
      expect(schedules[0].totalAmount).to.equal(PURCHASE_AMOUNT);
      expect(schedules[0].cliffUnlockBps).to.equal(CLIFF_UNLOCK_BPS);
      expect(schedules[0].monthlyUnlockBps).to.equal(MONTHLY_UNLOCK_BPS);
    });

    it("getScheduleAt works correctly", async function () {
      const s = await lockManager.getScheduleAt(buyer.address, 0);
      expect(s.totalAmount).to.equal(PURCHASE_AMOUNT);
    });

    it("getScheduleAt reverts on out of bounds", async function () {
      await expect(lockManager.getScheduleAt(buyer.address, 1)).to.be.revertedWith("LM: index out of bounds");
    });

    it("buyer cannot transfer locked MIC", async function () {
      await expect(
        micToken.connect(buyer).transfer(other.address, ethers.parseEther("1"))
      ).to.be.revertedWith("MIC: transfer exceeds unlocked balance");
    });
  });

  describe("Locked MIC → NFTStaking", function () {
    it("buyer can stake locked MIC into NFTStaking", async function () {
      const stakeAmount = ethers.parseEther("10000"); // 10K MIC

      // Approve NFTStaking to spend buyer's MIC
      await micToken.connect(buyer).approve(await nftStaking.getAddress(), stakeAmount);

      // Stake with useLockedMic = true — LockPeriod.Days360 is mandatory for locked MIC
      await nftStaking.connect(buyer).stake(stakeAmount, LP_360D, true);

      // Verify: MIC moved to staking contract
      expect(await micToken.balanceOf(buyer.address)).to.equal(PURCHASE_AMOUNT - stakeAmount);
      expect(await nftStaking.totalStakedAmount()).to.equal(stakeAmount);

      // Verify stake info
      const stakeIds = await nftStaking.getUserStakes(buyer.address);
      expect(stakeIds.length).to.equal(1);

      const stakeInfo = await nftStaking.stakes(stakeIds[0]);
      expect(stakeInfo.amount).to.equal(stakeAmount);
      expect(stakeInfo.active).to.be.true;
      // useLockedMic is stored but not directly readable from the public stakes mapping
      // as it returns positional values — we verify via the Staked event
    });

    it("Staked event records useLockedMic = true", async function () {
      const stakeAmount = ethers.parseEther("5000");
      await micToken.connect(buyer).approve(await nftStaking.getAddress(), stakeAmount);

      await expect(nftStaking.connect(buyer).stake(stakeAmount, LP_360D, true))
        .to.emit(nftStaking, "Staked")
        .withArgs(buyer.address, 0, stakeAmount, 0, LP_360D, true); // tier=NoNFT(0), lock=Days360(3), useLockedMic=true
    });

    it("locked MIC can also be staked with useLockedMic = false (flag is just metadata)", async function () {
      const stakeAmount = ethers.parseEther("5000");
      await micToken.connect(buyer).approve(await nftStaking.getAddress(), stakeAmount);

      // The transfer succeeds because NFTStaking is an approvedStakingContract
      // regardless of the useLockedMic flag
      await nftStaking.connect(buyer).stake(stakeAmount, LP_30D, false);
      expect(await nftStaking.totalStakedAmount()).to.equal(stakeAmount);
    });
  });

  describe("Unstake → tokens return to wallet", function () {
    let stakeAmount: bigint;

    beforeEach(async function () {
      stakeAmount = ethers.parseEther("10000");
      await fillPoolForUnstake(stakeAmount);
      await micToken.connect(buyer).approve(await nftStaking.getAddress(), stakeAmount);
      await nftStaking.connect(buyer).stake(stakeAmount, LP_360D, true); // 360-day lock (mandatory for locked MIC)
    });

    it("cannot unstake before lock period", async function () {
      await expect(
        nftStaking.connect(buyer).unstake(1)
      ).to.be.revertedWith("Staking: still locked");
    });

    it("cannot unstake at 6 months — the staking lock is 360 days", async function () {
      await time.increase(SIX_MONTHS);
      await expect(
        nftStaking.connect(buyer).unstake(1)
      ).to.be.revertedWith("Staking: still locked");
    });

    it("unstake after the 360-day lock returns MIC to wallet (partially vested)", async function () {
      // Fast forward 360 days (staking lock period)
      await time.increase(THREE_SIXTY_DAYS);

      await nftStaking.connect(buyer).unstake(1);

      // MIC returned to buyer wallet
      expect(await micToken.balanceOf(buyer.address)).to.equal(PURCHASE_AMOUNT);

      // Vesting has progressed: 360d = 180d cliff + 6 monthly steps
      //   → 10% cliff + 6 × 2.5% = 25% unlocked, 75% still locked
      const unlocked = (PURCHASE_AMOUNT * 2500n) / 10_000n; // 250,000 MIC
      expect(await micToken.lockedBalanceOf(buyer.address)).to.equal(PURCHASE_AMOUNT - unlocked);

      // Can transfer up to the unlocked amount…
      await micToken.connect(buyer).transfer(other.address, unlocked);
      expect(await micToken.balanceOf(other.address)).to.equal(unlocked);

      // …but not one wei more
      await expect(
        micToken.connect(buyer).transfer(other.address, 1n)
      ).to.be.revertedWith("MIC: transfer exceeds unlocked balance");
    });
  });

  describe("Vesting progression during staking", function () {
    it("LockManager vesting continues while MIC is staked", async function () {
      const stakeAmount = ethers.parseEther("10000");
      await micToken.connect(buyer).approve(await nftStaking.getAddress(), stakeAmount);
      await nftStaking.connect(buyer).stake(stakeAmount, LP_360D, true);

      // Fast forward 6 months (past cliff)
      await time.increase(SIX_MONTHS);

      // LockManager still tracks the original schedule — vesting progresses
      // lockedOf reflects: 90% locked (10% unlocked at cliff)
      const locked = await lockManager.lockedOf(buyer.address);
      expect(locked).to.equal(ethers.parseEther("900000")); // 90% of 1M

      // After 1 more month: 87.5% locked
      await time.increase(ONE_MONTH);
      const lockedAfter = await lockManager.lockedOf(buyer.address);
      expect(lockedAfter).to.equal(ethers.parseEther("875000"));
    });

    it("full vesting while staked → tokens fully transferable after unstake", async function () {
      const stakeAmount = ethers.parseEther("10000");
      await fillPoolForUnstake(stakeAmount);   // whale takes stakeId 0, buyer gets stakeId 1
      await micToken.connect(buyer).approve(await nftStaking.getAddress(), stakeAmount);
      await nftStaking.connect(buyer).stake(stakeAmount, LP_360D, true);

      // Fast forward past full vesting (6mo cliff + 36mo monthly = 42 months)
      await time.increase(SIX_MONTHS + 36 * ONE_MONTH);

      // LockManager: fully vested
      expect(await lockManager.lockedOf(buyer.address)).to.equal(0);

      // Unstake
      await nftStaking.connect(buyer).unstake(1);

      // All MIC now freely transferable
      const balance = await micToken.balanceOf(buyer.address);
      expect(await micToken.availableBalanceOf(buyer.address)).to.equal(balance);

      // Can transfer everything
      await micToken.connect(buyer).transfer(other.address, balance);
      expect(await micToken.balanceOf(other.address)).to.equal(balance);
    });
  });

  describe("Multiple schedules + staking", function () {
    it("two schedules, partial stake, correct locked calculation", async function () {
      // Second purchase: 500K MIC with same vesting
      const amount2 = ethers.parseEther("500000");
      await micToken.connect(treasury).transfer(buyer.address, amount2);
      await lockManager.createSchedule(buyer.address, amount2, SIX_MONTHS, CLIFF_UNLOCK_BPS, MONTHLY_UNLOCK_BPS);

      // Total: 1.5M MIC, all locked
      const totalMIC = PURCHASE_AMOUNT + amount2;
      expect(await micToken.balanceOf(buyer.address)).to.equal(totalMIC);
      expect(await lockManager.lockedOf(buyer.address)).to.equal(totalMIC);
      expect(await lockManager.scheduleCount(buyer.address)).to.equal(2);

      // Stake 200K from locked balance
      const stakeAmount = ethers.parseEther("200000");
      await micToken.connect(buyer).approve(await nftStaking.getAddress(), stakeAmount);
      await nftStaking.connect(buyer).stake(stakeAmount, LP_360D, true);

      // Wallet: 1.3M, LockManager still tracks 1.5M locked (schedule doesn't change)
      expect(await micToken.balanceOf(buyer.address)).to.equal(totalMIC - stakeAmount);
      expect(await lockManager.lockedOf(buyer.address)).to.equal(totalMIC);
    });
  });

  describe("Non-approved contract cannot receive locked MIC", function () {
    it("transfer to random address fails when locked", async function () {
      await expect(
        micToken.connect(buyer).transfer(other.address, ethers.parseEther("1"))
      ).to.be.revertedWith("MIC: transfer exceeds unlocked balance");
    });

    it("transfer to NFTStaking succeeds (approved staking contract)", async function () {
      const amount = ethers.parseEther("1000");
      await micToken.connect(buyer).approve(await nftStaking.getAddress(), amount);
      await nftStaking.connect(buyer).stake(amount, LP_360D, true);
      expect(await nftStaking.totalStakedAmount()).to.equal(amount);
    });
  });
});
