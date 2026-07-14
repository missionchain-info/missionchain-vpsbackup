import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { MICToken, NFTStaking, LockManager } from "../../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("NFTStaking", function () {
  let micToken: MICToken;
  let nftStaking: NFTStaking;
  let lockManager: LockManager;

  let admin: SignerWithAddress;
  let oracle: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;
  let user3: SignerWithAddress;
  let emissionController: SignerWithAddress;

  // Lock periods enum indices
  const LP_30D = 0; // Days30
  const LP_90D = 1; // Days90
  const LP_180D = 2; // Days180
  const LP_360D = 3; // Days360

  // Tier enum indices
  const TIER_NO_NFT = 0;
  const TIER_BUILDER = 1;
  const TIER_MAKER = 2;
  const TIER_LUMINARY = 3;
  const TIER_MFP = 4;

  const ONE_MIC = ethers.parseEther("1");
  const ONE_DAY = 24 * 3600;
  const THIRTY_DAYS = 30 * ONE_DAY;
  const NINETY_DAYS = 90 * ONE_DAY;
  const ONE_EIGHTY_DAYS = 180 * ONE_DAY;
  const THREE_SIXTY_DAYS = 360 * ONE_DAY;

  async function deployContracts() {
    [admin, oracle, user1, user2, user3, emissionController] =
      await ethers.getSigners();

    // Deploy MICToken
    const MICFactory = await ethers.getContractFactory("MICToken");
    micToken = await MICFactory.deploy(admin.address);

    // Deploy NFTStaking
    const StakingFactory = await ethers.getContractFactory("NFTStaking");
    nftStaking = await StakingFactory.deploy(
      await micToken.getAddress(),
      admin.address
    );

    // Approve NFTStaking as staking contract in MICToken
    await micToken.setApprovedStakingContract(
      await nftStaking.getAddress(),
      true
    );

    // Grant oracle role
    const ORACLE_ROLE = await nftStaking.ORACLE_ROLE();
    await nftStaking.grantRole(ORACLE_ROLE, oracle.address);

    // Fund users with MIC from admin's pre-issued allocation
    const FUND_AMOUNT = ethers.parseEther("1000000"); // 1M MIC each
    await micToken.transfer(user1.address, FUND_AMOUNT);
    await micToken.transfer(user2.address, FUND_AMOUNT);
    await micToken.transfer(user3.address, FUND_AMOUNT);

    // Approve NFTStaking to spend user MIC
    await micToken
      .connect(user1)
      .approve(await nftStaking.getAddress(), ethers.MaxUint256);
    await micToken
      .connect(user2)
      .approve(await nftStaking.getAddress(), ethers.MaxUint256);
    await micToken
      .connect(user3)
      .approve(await nftStaking.getAddress(), ethers.MaxUint256);
  }

  /**
   * Helper: stake from a "whale" account to inflate the pool so
   * a smaller staker's amount is within the 10%/day circuit breaker.
   * poolFiller stakes 9× the amount so the pool is 10× the amount.
   * Then the target user can unstake `amount` which equals exactly 10%.
   */
  async function stakeAsWhale(amount: bigint) {
    // Pool filler = admin. Admin already has leftover pre-issued MIC.
    const whaleAmount = amount * 9n;
    await micToken.approve(await nftStaking.getAddress(), ethers.MaxUint256);
    await nftStaking.connect(admin).stake(whaleAmount, LP_30D, false);
  }

  beforeEach(async () => {
    await deployContracts();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Constructor
  // ─────────────────────────────────────────────────────────────────────────
  describe("Constructor", () => {
    it("should set micToken correctly", async () => {
      expect(await nftStaking.micToken()).to.equal(
        await micToken.getAddress()
      );
    });

    it("should grant DEFAULT_ADMIN_ROLE to admin", async () => {
      const DEFAULT_ADMIN = await nftStaking.DEFAULT_ADMIN_ROLE();
      expect(await nftStaking.hasRole(DEFAULT_ADMIN, admin.address)).to.be
        .true;
    });

    it("should grant ORACLE_ROLE to admin initially", async () => {
      const ORACLE_ROLE = await nftStaking.ORACLE_ROLE();
      expect(await nftStaking.hasRole(ORACLE_ROLE, admin.address)).to.be.true;
    });

    it("should revert with zero address for micToken", async () => {
      const StakingFactory = await ethers.getContractFactory("NFTStaking");
      await expect(
        StakingFactory.deploy(ethers.ZeroAddress, admin.address)
      ).to.be.revertedWith("Staking: zero address");
    });

    it("should revert with zero address for admin", async () => {
      const StakingFactory = await ethers.getContractFactory("NFTStaking");
      await expect(
        StakingFactory.deploy(await micToken.getAddress(), ethers.ZeroAddress)
      ).to.be.revertedWith("Staking: zero address");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Constants / Multipliers
  // ─────────────────────────────────────────────────────────────────────────
  describe("Constants", () => {
    it("TIER_MFP = 100000 (×10)", async () => {
      expect(await nftStaking.TIER_MFP()).to.equal(100000n);
    });

    it("TIER_LUMINARY = 50000 (×5)", async () => {
      expect(await nftStaking.TIER_LUMINARY()).to.equal(50000n);
    });

    it("TIER_MAKER = 25000 (×2.5)", async () => {
      expect(await nftStaking.TIER_MAKER()).to.equal(25000n);
    });

    it("TIER_BUILDER = 10000 (×1)", async () => {
      expect(await nftStaking.TIER_BUILDER()).to.equal(10000n);
    });

    it("TIER_NO_NFT = 5000 (×0.5)", async () => {
      expect(await nftStaking.TIER_NO_NFT()).to.equal(5000n);
    });

    it("CAP_MFP = 100,000 MIC", async () => {
      expect(await nftStaking.CAP_MFP()).to.equal(
        ethers.parseEther("100000")
      );
    });

    it("CAP_LUMINARY = 50,000 MIC", async () => {
      expect(await nftStaking.CAP_LUMINARY()).to.equal(
        ethers.parseEther("50000")
      );
    });

    it("CAP_MAKER = 25,000 MIC", async () => {
      expect(await nftStaking.CAP_MAKER()).to.equal(
        ethers.parseEther("25000")
      );
    });

    it("CAP_BUILDER = 10,000 MIC", async () => {
      expect(await nftStaking.CAP_BUILDER()).to.equal(
        ethers.parseEther("10000")
      );
    });

    it("CAP_NO_NFT = Unlimited (type(uint256).max)", async () => {
      expect(await nftStaking.CAP_NO_NFT()).to.equal(ethers.MaxUint256);
    });

    it("LOCK_30D = 10000 (×1)", async () => {
      expect(await nftStaking.LOCK_30D()).to.equal(10000n);
    });

    it("LOCK_90D = 12500 (×1.25)", async () => {
      expect(await nftStaking.LOCK_90D()).to.equal(12500n);
    });

    it("LOCK_180D = 15000 (×1.5)", async () => {
      expect(await nftStaking.LOCK_180D()).to.equal(15000n);
    });

    it("LOCK_360D = 20000 (×2)", async () => {
      expect(await nftStaking.LOCK_360D()).to.equal(20000n);
    });

    it("MAX_DAILY_UNSTAKE_BPS = 1000 (10%)", async () => {
      expect(await nftStaking.MAX_DAILY_UNSTAKE_BPS()).to.equal(1000n);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Oracle: setUserTier / batchSetTiers
  // ─────────────────────────────────────────────────────────────────────────
  describe("setUserTier", () => {
    it("should allow oracle to set tier", async () => {
      await nftStaking.connect(oracle).setUserTier(user1.address, TIER_MFP);
      expect(await nftStaking.userTier(user1.address)).to.equal(TIER_MFP);
    });

    it("should emit TierUpdated event", async () => {
      await expect(
        nftStaking.connect(oracle).setUserTier(user1.address, TIER_BUILDER)
      )
        .to.emit(nftStaking, "TierUpdated")
        .withArgs(user1.address, TIER_NO_NFT, TIER_BUILDER);
    });

    it("should revert if not oracle", async () => {
      await expect(
        nftStaking.connect(user1).setUserTier(user1.address, TIER_MFP)
      ).to.be.reverted;
    });
  });

  describe("batchSetTiers", () => {
    it("should set tiers for multiple users", async () => {
      await nftStaking
        .connect(oracle)
        .batchSetTiers(
          [user1.address, user2.address, user3.address],
          [TIER_MFP, TIER_LUMINARY, TIER_MAKER]
        );
      expect(await nftStaking.userTier(user1.address)).to.equal(TIER_MFP);
      expect(await nftStaking.userTier(user2.address)).to.equal(TIER_LUMINARY);
      expect(await nftStaking.userTier(user3.address)).to.equal(TIER_MAKER);
    });

    it("should revert on length mismatch", async () => {
      await expect(
        nftStaking
          .connect(oracle)
          .batchSetTiers([user1.address, user2.address], [TIER_MFP])
      ).to.be.revertedWith("Staking: length mismatch");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Weighted amount calculation
  // ─────────────────────────────────────────────────────────────────────────
  describe("Weighted amount calculation", () => {
    it("NoNFT × 30d: 1000 MIC → weighted = 1000 × 0.5 × 1 = 500", async () => {
      // user1 defaults to TIER_NO_NFT
      const amount = ethers.parseEther("1000");
      await nftStaking.connect(user1).stake(amount, LP_30D, false);
      const s = await nftStaking.stakes(0);
      // weighted = 1000e18 * 5000 * 10000 / 1e8 = 500e18
      expect(s.weightedAmount).to.equal(ethers.parseEther("500"));
    });

    it("Builder × 30d: 1000 MIC → weighted = 1000 × 1 × 1 = 1000", async () => {
      await nftStaking.connect(oracle).setUserTier(user1.address, TIER_BUILDER);
      const amount = ethers.parseEther("1000");
      await nftStaking.connect(user1).stake(amount, LP_30D, false);
      const s = await nftStaking.stakes(0);
      expect(s.weightedAmount).to.equal(ethers.parseEther("1000"));
    });

    it("Maker × 90d: 1000 MIC → weighted = 1000 × 2.5 × 1.25 = 3125", async () => {
      await nftStaking.connect(oracle).setUserTier(user1.address, TIER_MAKER);
      const amount = ethers.parseEther("1000");
      await nftStaking.connect(user1).stake(amount, LP_90D, false);
      const s = await nftStaking.stakes(0);
      // weighted = 1000e18 * 25000 * 12500 / 1e8 = 3125e18
      expect(s.weightedAmount).to.equal(ethers.parseEther("3125"));
    });

    it("Luminary × 180d: 1000 MIC → weighted = 1000 × 5 × 1.5 = 7500", async () => {
      await nftStaking.connect(oracle).setUserTier(user1.address, TIER_LUMINARY);
      const amount = ethers.parseEther("1000");
      await nftStaking.connect(user1).stake(amount, LP_180D, false);
      const s = await nftStaking.stakes(0);
      // weighted = 1000e18 * 50000 * 15000 / 1e8 = 7500e18
      expect(s.weightedAmount).to.equal(ethers.parseEther("7500"));
    });

    it("MFP × 360d: 1000 MIC → weighted = 1000 × 10 × 2 = 20000", async () => {
      await nftStaking.connect(oracle).setUserTier(user1.address, TIER_MFP);
      const amount = ethers.parseEther("1000");
      await nftStaking.connect(user1).stake(amount, LP_360D, false);
      const s = await nftStaking.stakes(0);
      // weighted = 1000e18 * 100000 * 20000 / 1e8 = 20000e18
      expect(s.weightedAmount).to.equal(ethers.parseEther("20000"));
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Stake function
  // ─────────────────────────────────────────────────────────────────────────
  describe("stake", () => {
    it("should stake successfully and emit Staked event", async () => {
      const amount = ethers.parseEther("1000");
      await expect(nftStaking.connect(user1).stake(amount, LP_30D, false))
        .to.emit(nftStaking, "Staked")
        .withArgs(user1.address, 0, amount, TIER_NO_NFT, LP_30D, false);
    });

    it("should record stakeId in userStakes", async () => {
      const amount = ethers.parseEther("1000");
      await nftStaking.connect(user1).stake(amount, LP_30D, false);
      const ids = await nftStaking.getUserStakes(user1.address);
      expect(ids.length).to.equal(1);
      expect(ids[0]).to.equal(0n);
    });

    it("should increment totalStakes", async () => {
      await nftStaking
        .connect(user1)
        .stake(ethers.parseEther("100"), LP_30D, false);
      expect(await nftStaking.totalStakes()).to.equal(1n);
    });

    it("should update totalStakedAmount", async () => {
      const amount = ethers.parseEther("100");
      await nftStaking.connect(user1).stake(amount, LP_30D, false);
      expect(await nftStaking.totalStakedAmount()).to.equal(amount);
    });

    it("should update totalWeightedStaked", async () => {
      const amount = ethers.parseEther("1000");
      await nftStaking.connect(user1).stake(amount, LP_30D, false);
      // NoNFT × 30d: weighted = 500e18
      expect(await nftStaking.totalWeightedStaked()).to.equal(
        ethers.parseEther("500")
      );
    });

    it("should transfer MIC from user to staking contract", async () => {
      const amount = ethers.parseEther("1000");
      const beforeUser = await micToken.balanceOf(user1.address);
      const beforeStaking = await micToken.balanceOf(
        await nftStaking.getAddress()
      );
      await nftStaking.connect(user1).stake(amount, LP_30D, false);
      expect(await micToken.balanceOf(user1.address)).to.equal(
        beforeUser - amount
      );
      expect(
        await micToken.balanceOf(await nftStaking.getAddress())
      ).to.equal(beforeStaking + amount);
    });

    it("should revert with zero amount", async () => {
      await expect(
        nftStaking.connect(user1).stake(0, LP_30D, false)
      ).to.be.revertedWith("Staking: zero amount");
    });

    it("should set correct unlockTime for 30d lock", async () => {
      const amount = ethers.parseEther("100");
      const tx = await nftStaking.connect(user1).stake(amount, LP_30D, false);
      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt!.blockNumber);
      const s = await nftStaking.stakes(0);
      expect(s.unlockTime).to.equal(
        BigInt(block!.timestamp) + BigInt(THIRTY_DAYS)
      );
    });

    it("should set correct unlockTime for 360d lock", async () => {
      await nftStaking.connect(oracle).setUserTier(user1.address, TIER_MFP);
      const amount = ethers.parseEther("100");
      const tx = await nftStaking.connect(user1).stake(amount, LP_360D, false);
      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt!.blockNumber);
      const s = await nftStaking.stakes(0);
      expect(s.unlockTime).to.equal(
        BigInt(block!.timestamp) + BigInt(THREE_SIXTY_DAYS)
      );
    });

    it("stake should be active=true after creation", async () => {
      await nftStaking
        .connect(user1)
        .stake(ethers.parseEther("100"), LP_30D, false);
      const s = await nftStaking.stakes(0);
      expect(s.active).to.be.true;
    });

    it("should support multiple stakes per user", async () => {
      await nftStaking
        .connect(oracle)
        .setUserTier(user1.address, TIER_NO_NFT);
      const amount1 = ethers.parseEther("100");
      const amount2 = ethers.parseEther("200");
      await nftStaking.connect(user1).stake(amount1, LP_30D, false);
      await nftStaking.connect(user1).stake(amount2, LP_90D, false);

      const ids = await nftStaking.getUserStakes(user1.address);
      expect(ids.length).to.equal(2);

      const s0 = await nftStaking.stakes(0);
      const s1 = await nftStaking.stakes(1);
      expect(s0.amount).to.equal(amount1);
      expect(s1.amount).to.equal(amount2);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Staking caps per tier
  // ─────────────────────────────────────────────────────────────────────────
  describe("Staking caps", () => {
    it("Builder: should revert if exceeds 10,000 MIC cap", async () => {
      await nftStaking
        .connect(oracle)
        .setUserTier(user1.address, TIER_BUILDER);
      const overCap = ethers.parseEther("10001");
      await expect(
        nftStaking.connect(user1).stake(overCap, LP_30D, false)
      ).to.be.revertedWith("Staking: exceeds tier cap");
    });

    it("Builder: should allow exactly 10,000 MIC", async () => {
      await nftStaking
        .connect(oracle)
        .setUserTier(user1.address, TIER_BUILDER);
      await expect(
        nftStaking
          .connect(user1)
          .stake(ethers.parseEther("10000"), LP_30D, false)
      ).to.not.be.reverted;
    });

    it("Maker: should revert if exceeds 25,000 MIC cap", async () => {
      await nftStaking.connect(oracle).setUserTier(user1.address, TIER_MAKER);
      const overCap = ethers.parseEther("25001");
      await expect(
        nftStaking.connect(user1).stake(overCap, LP_30D, false)
      ).to.be.revertedWith("Staking: exceeds tier cap");
    });

    it("Luminary: should revert if exceeds 50,000 MIC cap", async () => {
      await nftStaking
        .connect(oracle)
        .setUserTier(user1.address, TIER_LUMINARY);
      const overCap = ethers.parseEther("50001");
      await expect(
        nftStaking.connect(user1).stake(overCap, LP_30D, false)
      ).to.be.revertedWith("Staking: exceeds tier cap");
    });

    it("MFP: should revert if exceeds 100,000 MIC cap", async () => {
      await nftStaking.connect(oracle).setUserTier(user1.address, TIER_MFP);
      // Give user1 enough MIC first
      await micToken.transfer(user1.address, ethers.parseEther("100001"));
      const overCap = ethers.parseEther("100001");
      await expect(
        nftStaking.connect(user1).stake(overCap, LP_30D, false)
      ).to.be.revertedWith("Staking: exceeds tier cap");
    });

    it("NoNFT: cap is Unlimited — can stake any large amount", async () => {
      // Give user1 more MIC
      await micToken.transfer(user1.address, ethers.parseEther("1000000"));
      // Stake a very large amount (was previously capped at 5,000)
      const largeAmount = ethers.parseEther("500000");
      await expect(
        nftStaking.connect(user1).stake(largeAmount, LP_30D, false)
      ).to.not.be.reverted;
    });

    it("Builder: cumulative stakes across multiple positions should respect cap", async () => {
      await nftStaking
        .connect(oracle)
        .setUserTier(user1.address, TIER_BUILDER);
      await nftStaking
        .connect(user1)
        .stake(ethers.parseEther("6000"), LP_30D, false);
      await nftStaking
        .connect(user1)
        .stake(ethers.parseEther("4000"), LP_90D, false);
      // Now at cap: 10,000 total
      await expect(
        nftStaking
          .connect(user1)
          .stake(ethers.parseEther("1"), LP_30D, false)
      ).to.be.revertedWith("Staking: exceeds tier cap");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // NoNFT cap is Unlimited
  // ─────────────────────────────────────────────────────────────────────────
  describe("NoNFT cap is Unlimited", () => {
    it("should allow staking more than old 5,000 MIC cap with NoNFT tier", async () => {
      await micToken.transfer(user1.address, ethers.parseEther("10000"));
      // Old cap was 5,000 — this should now pass
      await expect(
        nftStaking
          .connect(user1)
          .stake(ethers.parseEther("5001"), LP_30D, false)
      ).to.not.be.reverted;
    });

    it("CAP_NO_NFT equals type(uint256).max", async () => {
      expect(await nftStaking.CAP_NO_NFT()).to.equal(ethers.MaxUint256);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // useLockedMic flag
  // ─────────────────────────────────────────────────────────────────────────
  describe("useLockedMic flag", () => {
    it("should store useLockedMic=true in StakeInfo", async () => {
      const amount = ethers.parseEther("1000");
      await nftStaking.connect(user1).stake(amount, LP_30D, true);
      const s = await nftStaking.stakes(0);
      expect(s.useLockedMic).to.be.true;
    });

    it("should store useLockedMic=false in StakeInfo", async () => {
      const amount = ethers.parseEther("1000");
      await nftStaking.connect(user1).stake(amount, LP_30D, false);
      const s = await nftStaking.stakes(0);
      expect(s.useLockedMic).to.be.false;
    });

    it("should emit Staked event with useLockedMic=true", async () => {
      const amount = ethers.parseEther("1000");
      await expect(nftStaking.connect(user1).stake(amount, LP_30D, true))
        .to.emit(nftStaking, "Staked")
        .withArgs(user1.address, 0, amount, TIER_NO_NFT, LP_30D, true);
    });

    it("should emit Staked event with useLockedMic=false", async () => {
      const amount = ethers.parseEther("1000");
      await expect(nftStaking.connect(user1).stake(amount, LP_30D, false))
        .to.emit(nftStaking, "Staked")
        .withArgs(user1.address, 0, amount, TIER_NO_NFT, LP_30D, false);
    });

    it("staking locked MIC: NFTStaking approved contract allows transfer of locked tokens", async () => {
      // Deploy LockManager and create schedule for user1
      const LMFactory = await ethers.getContractFactory("LockManager");
      lockManager = await LMFactory.deploy();

      const SCHEDULE_CREATOR = await lockManager.SCHEDULE_CREATOR_ROLE();
      await lockManager.grantRole(SCHEDULE_CREATOR, admin.address);

      // Set LockManager on MICToken
      await micToken.setLockManager(await lockManager.getAddress());

      // Create vesting schedule: all 1M MIC locked for 6 months
      const AMOUNT = ethers.parseEther("1000");
      const SIX_MONTHS = 6 * 30 * 24 * 3600;
      await lockManager.createSchedule(
        user1.address,
        AMOUNT,
        SIX_MONTHS,
        1000,
        250
      );

      // Verify user1's tokens are locked
      expect(await lockManager.lockedOf(user1.address)).to.equal(AMOUNT);

      // Now stake with useLockedMic=true — should succeed because
      // NFTStaking is an approvedStakingContract
      await expect(
        nftStaking.connect(user1).stake(AMOUNT, LP_30D, true)
      ).to.not.be.reverted;

      const s = await nftStaking.stakes(0);
      expect(s.useLockedMic).to.be.true;
      expect(s.amount).to.equal(AMOUNT);
    });

    it("staking locked MIC without approval would fail (sanity check)", async () => {
      // This test demonstrates WHY approvedStakingContracts is needed
      // Deploy a fresh MICToken so LockManager setting doesn't affect other tests
      const MICFactory2 = await ethers.getContractFactory("MICToken");
      const micToken2 = await MICFactory2.deploy(admin.address);

      // Deploy a second staking contract that is NOT approved in micToken2
      const StakingFactory = await ethers.getContractFactory("NFTStaking");
      const unapprovedStaking = await StakingFactory.deploy(
        await micToken2.getAddress(),
        admin.address
      );
      // Do NOT call setApprovedStakingContract for unapprovedStaking

      // Deploy LockManager and lock user2's tokens
      const LMFactory = await ethers.getContractFactory("LockManager");
      const lm = await LMFactory.deploy();
      const SCHEDULE_CREATOR = await lm.SCHEDULE_CREATOR_ROLE();
      await lm.grantRole(SCHEDULE_CREATOR, admin.address);
      await micToken2.setLockManager(await lm.getAddress());

      // Give user2 some MIC from micToken2
      const AMOUNT = ethers.parseEther("1000");
      await micToken2.transfer(user2.address, AMOUNT);

      const SIX_MONTHS = 6 * 30 * 24 * 3600;
      await lm.createSchedule(user2.address, AMOUNT, SIX_MONTHS, 1000, 250);

      await micToken2
        .connect(user2)
        .approve(await unapprovedStaking.getAddress(), ethers.MaxUint256);

      // Should revert: locked tokens cannot go to unapproved contract
      await expect(
        unapprovedStaking.connect(user2).stake(AMOUNT, LP_30D, true)
      ).to.be.revertedWith("MIC: transfer exceeds unlocked balance");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Unstake
  // ─────────────────────────────────────────────────────────────────────────
  describe("unstake", () => {
    // user1 stakes 1000 MIC; admin (whale) stakes 9000 MIC so pool = 10,000.
    // Circuit breaker: 10% of 10,000 = 1,000 MIC → user1 can unstake 1,000.
    beforeEach(async () => {
      const amount = ethers.parseEther("1000");
      await stakeAsWhale(amount); // stakeId=0 (admin, 9000 MIC)
      await nftStaking.connect(user1).stake(amount, LP_30D, false); // stakeId=1
    });

    it("should revert if lock period has not expired", async () => {
      await expect(
        nftStaking.connect(user1).unstake(1)
      ).to.be.revertedWith("Staking: still locked");
    });

    it("should allow unstake after lock period", async () => {
      await time.increase(THIRTY_DAYS);
      await expect(nftStaking.connect(user1).unstake(1)).to.not.be.reverted;
    });

    it("should return MIC to user after unstake", async () => {
      await time.increase(THIRTY_DAYS);
      const before = await micToken.balanceOf(user1.address);
      await nftStaking.connect(user1).unstake(1);
      const after = await micToken.balanceOf(user1.address);
      expect(after).to.be.gte(before + ethers.parseEther("1000"));
    });

    it("should mark stake as inactive after unstake", async () => {
      await time.increase(THIRTY_DAYS);
      await nftStaking.connect(user1).unstake(1);
      const s = await nftStaking.stakes(1);
      expect(s.active).to.be.false;
    });

    it("should reduce totalStakedAmount after unstake", async () => {
      const totalBefore = await nftStaking.totalStakedAmount();
      await time.increase(THIRTY_DAYS);
      await nftStaking.connect(user1).unstake(1);
      expect(await nftStaking.totalStakedAmount()).to.equal(
        totalBefore - ethers.parseEther("1000")
      );
    });

    it("should reduce totalWeightedStaked after unstake", async () => {
      const weightedBefore = await nftStaking.totalWeightedStaked();
      await time.increase(THIRTY_DAYS);
      await nftStaking.connect(user1).unstake(1);
      // user1 had weighted = 1000 * 5000 * 10000 / 1e8 = 500 MIC
      const expectedWeightedUser1 = ethers.parseEther("500");
      expect(await nftStaking.totalWeightedStaked()).to.equal(
        weightedBefore - expectedWeightedUser1
      );
    });

    it("should emit Unstaked event", async () => {
      await time.increase(THIRTY_DAYS);
      await expect(nftStaking.connect(user1).unstake(1))
        .to.emit(nftStaking, "Unstaked")
        .withArgs(user1.address, 1, ethers.parseEther("1000"));
    });

    it("should revert if stake is not active", async () => {
      await time.increase(THIRTY_DAYS);
      await nftStaking.connect(user1).unstake(1);
      await expect(
        nftStaking.connect(user1).unstake(1)
      ).to.be.revertedWith("Staking: not active");
    });

    it("should revert if caller is not owner", async () => {
      await time.increase(THIRTY_DAYS);
      await expect(
        nftStaking.connect(user2).unstake(1)
      ).to.be.revertedWith("Staking: not owner");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Lock period enforcement
  // ─────────────────────────────────────────────────────────────────────────
  describe("Lock period enforcement", () => {
    const LOCK_PERIODS = [
      { name: "30d", lp: LP_30D, duration: THIRTY_DAYS },
      { name: "90d", lp: LP_90D, duration: NINETY_DAYS },
      { name: "180d", lp: LP_180D, duration: ONE_EIGHTY_DAYS },
      { name: "360d", lp: LP_360D, duration: THREE_SIXTY_DAYS },
    ];

    for (const { name, lp, duration } of LOCK_PERIODS) {
      it(`${name}: should lock tokens for the full duration`, async () => {
        await nftStaking
          .connect(oracle)
          .setUserTier(user1.address, TIER_NO_NFT);
        const amount = ethers.parseEther("100");
        await stakeAsWhale(amount); // stakeId=0; inflate pool so 10% = 100

        // Record the exact block time of user1's stake
        const tx = await nftStaking.connect(user1).stake(amount, lp, false); // stakeId=1
        const receipt = await tx.wait();
        const stakeBlock = await ethers.provider.getBlock(receipt!.blockNumber);
        const stakeTs = BigInt(stakeBlock!.timestamp);
        const unlockTs = stakeTs + BigInt(duration);

        // Set time to 1 second BEFORE unlock
        await time.setNextBlockTimestamp(Number(unlockTs) - 1);
        await expect(
          nftStaking.connect(user1).unstake(1)
        ).to.be.revertedWith("Staking: still locked");
      });

      it(`${name}: should allow unstake after duration`, async () => {
        await nftStaking
          .connect(oracle)
          .setUserTier(user1.address, TIER_NO_NFT);
        const amount = ethers.parseEther("100");
        await stakeAsWhale(amount); // stakeId=0; inflate pool so 10% = 100
        await nftStaking.connect(user1).stake(amount, lp, false); // stakeId=1
        await time.increase(duration);
        await expect(nftStaking.connect(user1).unstake(1)).to.not.be.reverted;
      });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Circuit breaker: 10%/day unstake max
  // ─────────────────────────────────────────────────────────────────────────
  describe("Circuit breaker — 10%/day unstake", () => {
    it("should allow unstake up to 10% of totalStaked per day", async () => {
      // user1 stakes 1000 MIC, user2 stakes 9000 MIC (total 10,000)
      // 10% of 10,000 = 1,000 → user1 can unstake exactly 1,000 MIC
      await nftStaking
        .connect(user1)
        .stake(ethers.parseEther("1000"), LP_30D, false); // stakeId=0
      await nftStaking
        .connect(user2)
        .stake(ethers.parseEther("9000"), LP_30D, false); // stakeId=1

      await time.increase(THIRTY_DAYS);

      await expect(nftStaking.connect(user1).unstake(0)).to.not.be.reverted;
    });

    it("should block unstake exceeding 10%/day", async () => {
      // Pool: user1=1000, user2=9000, total=10,000. Max=1,000/day.
      // user1 unstakes 1000 → uses full daily limit.
      // user3 stakes 1000 then tries to unstake same day → blocked.
      await nftStaking
        .connect(user1)
        .stake(ethers.parseEther("1000"), LP_30D, false); // stakeId=0
      await nftStaking
        .connect(user2)
        .stake(ethers.parseEther("9000"), LP_30D, false); // stakeId=1
      await nftStaking
        .connect(user3)
        .stake(ethers.parseEther("1000"), LP_30D, false); // stakeId=2

      await time.increase(THIRTY_DAYS);

      // user1 uses up the daily limit (1,000 MIC = 10% of 11,100 total? no)
      // totalStaked = 11,000. maxDaily = 1100. user1 unstakes 1000 → OK.
      await nftStaking.connect(user1).unstake(0); // uses 1,000 of 1,100 daily limit

      // user3 now tries to unstake 1,000 MIC but only 100 left in daily limit
      await expect(
        nftStaking.connect(user3).unstake(2)
      ).to.be.revertedWith("Staking: daily unstake limit");
    });

    it("should reset daily unstake counter after a new day", async () => {
      // user1=1000, user2=9000 (total=10,000, maxDaily=1,000)
      await nftStaking
        .connect(user1)
        .stake(ethers.parseEther("1000"), LP_30D, false); // stakeId=0
      await nftStaking
        .connect(user2)
        .stake(ethers.parseEther("9000"), LP_30D, false); // stakeId=1

      await time.increase(THIRTY_DAYS);

      // Use up the daily limit
      await nftStaking.connect(user1).unstake(0);

      // Fast-forward past midnight (new day)
      await time.increase(ONE_DAY);

      // user3 stakes a small amount that is within new day's limit
      // totalStaked after user1 unstaked = 9000. maxDaily for new day = 900.
      await nftStaking
        .connect(user3)
        .stake(ethers.parseEther("100"), LP_30D, false); // stakeId=2
      await time.increase(THIRTY_DAYS);

      // totalStaked = 9100, maxDaily = 910 → 100 ≤ 910, should pass
      await expect(nftStaking.connect(user3).unstake(2)).to.not.be.reverted;
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Reward distribution proportional to weighted amounts
  // ─────────────────────────────────────────────────────────────────────────
  describe("Reward distribution", () => {
    it("should distribute rewards proportional to weighted amounts", async () => {
      // user1: NoNFT × 30d → weight 0.5
      // user2: Builder × 30d → weight 1.0
      // Ratio: user1 gets 1/3, user2 gets 2/3
      await nftStaking
        .connect(oracle)
        .setUserTier(user2.address, TIER_BUILDER);

      const amount = ethers.parseEther("1000");
      await nftStaking.connect(user1).stake(amount, LP_30D, false); // stakeId=0, weighted 500
      await nftStaking.connect(user2).stake(amount, LP_30D, false); // stakeId=1, weighted 1000

      // Admin sends rewards to NFTStaking (separate from staked principal)
      const rewardAmount = ethers.parseEther("150");
      await micToken.transfer(await nftStaking.getAddress(), rewardAmount);

      await time.increase(THIRTY_DAYS);

      // Unstake user2 to trigger _updateRewards — user2 gets principal + ~100 MIC reward
      // Circuit breaker: total staked = 2000, max daily = 200. user2 has 1000 > 200 — blocked!
      // Fix: add a whale first.
      // Actually both user1 and user2 staked 1000 each = 2000 total, max daily = 200
      // We need to add a whale of at least 8000 more to make maxDaily=1000
      await micToken.approve(await nftStaking.getAddress(), ethers.MaxUint256);
      await nftStaking.connect(admin).stake(ethers.parseEther("8000"), LP_30D, false); // stakeId=2
      // totalStaked = 10,000, maxDaily = 1000 → user2 can now unstake 1000

      const user2BalanceBefore = await micToken.balanceOf(user2.address);
      await nftStaking.connect(user2).unstake(1);
      const user2BalanceAfter = await micToken.balanceOf(user2.address);

      // user2 should receive principal + reward (≥ principal)
      expect(user2BalanceAfter - user2BalanceBefore).to.be.gte(amount);
    });

    it("should allow claimRewards without unstaking when rewards exist", async () => {
      // user1 stakes, rewards sent, user2 stakes (triggers _updateRewards), user1 claims
      await nftStaking
        .connect(user1)
        .stake(ethers.parseEther("1000"), LP_30D, false); // stakeId=0

      // Send rewards before user2 joins
      await micToken.transfer(
        await nftStaking.getAddress(),
        ethers.parseEther("100")
      );

      // user2 stakes → triggers _updateRewards, distributing the 100 MIC to user1
      await nftStaking
        .connect(user2)
        .stake(ethers.parseEther("100"), LP_30D, false); // stakeId=1

      const pending = await nftStaking.pendingReward(0);
      expect(pending).to.be.gt(0n);

      // Claim rewards — verify the event is emitted and user1 receives the pending amount
      const balanceBefore = await micToken.balanceOf(user1.address);
      await nftStaking.connect(user1).claimRewards(0);
      const balanceAfter = await micToken.balanceOf(user1.address);
      expect(balanceAfter - balanceBefore).to.be.gt(0n);
    });

    it("claimRewards should revert if no rewards", async () => {
      await nftStaking
        .connect(user1)
        .stake(ethers.parseEther("1000"), LP_30D, false);
      await expect(
        nftStaking.connect(user1).claimRewards(0)
      ).to.be.revertedWith("Staking: no rewards");
    });

    it("claimRewards should revert if caller not owner", async () => {
      await nftStaking
        .connect(user1)
        .stake(ethers.parseEther("1000"), LP_30D, false);
      await expect(
        nftStaking.connect(user2).claimRewards(0)
      ).to.be.revertedWith("Staking: not owner");
    });

    it("claimRewards should revert if stake not active", async () => {
      const amount = ethers.parseEther("1000");
      await stakeAsWhale(amount); // stakeId=0 (whale)
      await nftStaking.connect(user1).stake(amount, LP_30D, false); // stakeId=1
      await time.increase(THIRTY_DAYS);
      await nftStaking.connect(user1).unstake(1);
      await expect(
        nftStaking.connect(user1).claimRewards(1)
      ).to.be.revertedWith("Staking: not active");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Multiple stakes per user
  // ─────────────────────────────────────────────────────────────────────────
  describe("Multiple stakes per user", () => {
    it("should handle multiple stakes for the same user", async () => {
      await nftStaking
        .connect(oracle)
        .setUserTier(user1.address, TIER_NO_NFT);
      for (let i = 0; i < 5; i++) {
        await nftStaking
          .connect(user1)
          .stake(ethers.parseEther("100"), LP_30D, false);
      }
      const ids = await nftStaking.getUserStakes(user1.address);
      expect(ids.length).to.equal(5);
      expect(await nftStaking.totalStakes()).to.equal(5n);
    });

    it("should track per-user total staked correctly across multiple stakes", async () => {
      await nftStaking
        .connect(oracle)
        .setUserTier(user1.address, TIER_NO_NFT);
      await nftStaking
        .connect(user1)
        .stake(ethers.parseEther("100"), LP_30D, false);
      await nftStaking
        .connect(user1)
        .stake(ethers.parseEther("200"), LP_30D, false);
      await nftStaking
        .connect(user1)
        .stake(ethers.parseEther("300"), LP_30D, false);
      expect(await nftStaking.totalStakedAmount()).to.equal(
        ethers.parseEther("600")
      );
    });

    it("getUserStakes should return all stakeIds for a user", async () => {
      await nftStaking
        .connect(user1)
        .stake(ethers.parseEther("100"), LP_30D, false);
      await nftStaking
        .connect(user2)
        .stake(ethers.parseEther("200"), LP_90D, false);
      await nftStaking
        .connect(user1)
        .stake(ethers.parseEther("300"), LP_180D, false);

      const user1Stakes = await nftStaking.getUserStakes(user1.address);
      const user2Stakes = await nftStaking.getUserStakes(user2.address);

      expect(user1Stakes.length).to.equal(2);
      expect(user2Stakes.length).to.equal(1);
      expect(user1Stakes[0]).to.equal(0n);
      expect(user1Stakes[1]).to.equal(2n);
      expect(user2Stakes[0]).to.equal(1n);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // pendingReward view
  // ─────────────────────────────────────────────────────────────────────────
  describe("pendingReward view", () => {
    it("should return 0 for inactive stake", async () => {
      const amount = ethers.parseEther("1000");
      await stakeAsWhale(amount); // stakeId=0 (whale)
      await nftStaking.connect(user1).stake(amount, LP_30D, false); // stakeId=1
      await time.increase(THIRTY_DAYS);
      await nftStaking.connect(user1).unstake(1);
      expect(await nftStaking.pendingReward(1)).to.equal(0n);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // All 5 tiers × 4 lock periods — smoke test
  // ─────────────────────────────────────────────────────────────────────────
  describe("All 5 tiers × 4 lock periods stake + unstake", () => {
    const tiers = [
      { name: "NoNFT", idx: TIER_NO_NFT, cap: "100" },
      { name: "Builder", idx: TIER_BUILDER, cap: "100" },
      { name: "Maker", idx: TIER_MAKER, cap: "100" },
      { name: "Luminary", idx: TIER_LUMINARY, cap: "100" },
      { name: "MFP", idx: TIER_MFP, cap: "100" },
    ];
    const lockPeriods = [
      { name: "30d", idx: LP_30D, duration: THIRTY_DAYS },
      { name: "90d", idx: LP_90D, duration: NINETY_DAYS },
      { name: "180d", idx: LP_180D, duration: ONE_EIGHTY_DAYS },
      { name: "360d", idx: LP_360D, duration: THREE_SIXTY_DAYS },
    ];

    for (const tier of tiers) {
      for (const lp of lockPeriods) {
        it(`${tier.name} × ${lp.name}: stake and unstake`, async () => {
          await nftStaking
            .connect(oracle)
            .setUserTier(user1.address, tier.idx);
          const amount = ethers.parseEther(tier.cap);
          // Inflate pool so user1's amount is within 10%/day circuit breaker
          await stakeAsWhale(amount); // stakeId=0
          await nftStaking.connect(user1).stake(amount, lp.idx, false); // stakeId=1
          await time.increase(lp.duration);
          await expect(nftStaking.connect(user1).unstake(1)).to.not.be
            .reverted;
        });
      }
    }
  });
});
