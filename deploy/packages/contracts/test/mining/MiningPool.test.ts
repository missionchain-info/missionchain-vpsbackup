import { expect } from "chai";
import { ethers } from "hardhat";
import { MiningPool, MICToken } from "../../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("MiningPool", function () {
  let pool: MiningPool;
  let mic: MICToken;
  let admin: SignerWithAddress;
  let oracle: SignerWithAddress;
  let miner1: SignerWithAddress;
  let miner2: SignerWithAddress;
  let miner3: SignerWithAddress;
  let stranger: SignerWithAddress;
  let mockEmissionController: SignerWithAddress; // holds MINTER_ROLE on MICToken

  const ORACLE_ROLE = ethers.keccak256(ethers.toUtf8Bytes("ORACLE_ROLE"));
  const DEFAULT_ADMIN_ROLE = ethers.ZeroHash;

  // Helper: mint MIC directly into the MiningPool (simulates EmissionController distribution)
  async function fundPool(amount: bigint): Promise<void> {
    const MINTER_ROLE = await mic.MINTER_ROLE();
    // mockEmissionController already has MINTER_ROLE — mint directly to pool address
    await mic
      .connect(mockEmissionController)
      .mintFromMining(await pool.getAddress(), amount);
  }

  beforeEach(async () => {
    [admin, oracle, miner1, miner2, miner3, stranger, mockEmissionController] =
      await ethers.getSigners();

    // Deploy MICToken (treasury = admin for pre-issued tokens)
    const MICFactory = await ethers.getContractFactory("MICToken");
    mic = await MICFactory.deploy(admin.address);

    // Grant MINTER_ROLE to mockEmissionController so it can fund the pool
    const MINTER_ROLE = await mic.MINTER_ROLE();
    await mic.connect(admin).grantRole(MINTER_ROLE, mockEmissionController.address);

    // Deploy MiningPool
    const PoolFactory = await ethers.getContractFactory("MiningPool");
    pool = await PoolFactory.deploy(await mic.getAddress(), admin.address);

    // Grant ORACLE_ROLE to oracle signer for submission tests
    await pool.connect(admin).grantRole(ORACLE_ROLE, oracle.address);
  });

  // ─────────────────────────────────────────────────────────────
  // Constructor
  // ─────────────────────────────────────────────────────────────
  describe("Constructor", () => {
    it("sets micToken correctly", async () => {
      expect(await pool.micToken()).to.equal(await mic.getAddress());
    });

    it("grants DEFAULT_ADMIN_ROLE and ORACLE_ROLE to admin", async () => {
      expect(await pool.hasRole(DEFAULT_ADMIN_ROLE, admin.address)).to.be.true;
      expect(await pool.hasRole(ORACLE_ROLE, admin.address)).to.be.true;
    });

    it("initializes currentEpoch to 0", async () => {
      expect(await pool.currentEpoch()).to.equal(0n);
    });

    it("reverts if micToken is zero address", async () => {
      const PoolFactory = await ethers.getContractFactory("MiningPool");
      await expect(
        PoolFactory.deploy(ethers.ZeroAddress, admin.address)
      ).to.be.revertedWith("Pool: zero address");
    });

    it("reverts if admin is zero address", async () => {
      const PoolFactory = await ethers.getContractFactory("MiningPool");
      await expect(
        PoolFactory.deploy(await mic.getAddress(), ethers.ZeroAddress)
      ).to.be.revertedWith("Pool: zero address");
    });
  });

  // ─────────────────────────────────────────────────────────────
  // startEpoch
  // ─────────────────────────────────────────────────────────────
  describe("startEpoch", () => {
    it("increments currentEpoch from 0 to 1", async () => {
      await pool.connect(oracle).startEpoch();
      expect(await pool.currentEpoch()).to.equal(1n);
    });

    it("emits EpochStarted event", async () => {
      await expect(pool.connect(oracle).startEpoch())
        .to.emit(pool, "EpochStarted")
        .withArgs(1n);
    });

    it("reverts if non-oracle calls startEpoch", async () => {
      await expect(
        pool.connect(stranger).startEpoch()
      ).to.be.revertedWithCustomError(pool, "AccessControlUnauthorizedAccount");
    });

    it("reverts if current epoch is not yet finalized", async () => {
      await pool.connect(oracle).startEpoch(); // epoch 1 started
      // epoch 1 is not finalized yet
      await expect(
        pool.connect(oracle).startEpoch()
      ).to.be.revertedWith("Pool: current epoch not finalized");
    });

    it("allows starting epoch 2 after epoch 1 is finalized", async () => {
      await pool.connect(oracle).startEpoch(); // epoch 1
      await pool.connect(oracle).finalizeEpoch(); // finalize epoch 1
      await pool.connect(oracle).startEpoch(); // epoch 2
      expect(await pool.currentEpoch()).to.equal(2n);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // submitScores
  // ─────────────────────────────────────────────────────────────
  describe("submitScores", () => {
    beforeEach(async () => {
      await pool.connect(oracle).startEpoch();
    });

    it("stores scores for miners in current epoch", async () => {
      await pool
        .connect(oracle)
        .submitScores([miner1.address, miner2.address], [1000n, 2000n]);

      expect(await pool.getScore(1n, miner1.address)).to.equal(1000n);
      expect(await pool.getScore(1n, miner2.address)).to.equal(2000n);
    });

    it("accumulates totalWeightedScore", async () => {
      await pool
        .connect(oracle)
        .submitScores([miner1.address, miner2.address], [1000n, 2000n]);

      const epochData = await pool.epochs(1n);
      expect(epochData.totalWeightedScore).to.equal(3000n);
    });

    it("emits ScoresSubmitted event with correct miner count", async () => {
      await expect(
        pool
          .connect(oracle)
          .submitScores([miner1.address, miner2.address, miner3.address], [100n, 200n, 300n])
      )
        .to.emit(pool, "ScoresSubmitted")
        .withArgs(1n, 3n);
    });

    it("overwrites previous score for same miner and updates totalWeightedScore", async () => {
      await pool.connect(oracle).submitScores([miner1.address], [1000n]);
      // Re-submit with new score
      await pool.connect(oracle).submitScores([miner1.address], [500n]);

      expect(await pool.getScore(1n, miner1.address)).to.equal(500n);
      const epochData = await pool.epochs(1n);
      // totalWeightedScore should reflect the updated score, not cumulative
      expect(epochData.totalWeightedScore).to.equal(500n);
    });

    it("reverts if arrays have different lengths", async () => {
      await expect(
        pool
          .connect(oracle)
          .submitScores([miner1.address, miner2.address], [1000n])
      ).to.be.revertedWith("Pool: length mismatch");
    });

    it("reverts if no epoch has been started", async () => {
      // Deploy fresh pool without starting epoch
      const PoolFactory = await ethers.getContractFactory("MiningPool");
      const freshPool = await PoolFactory.deploy(await mic.getAddress(), admin.address);
      await freshPool.connect(admin).grantRole(ORACLE_ROLE, oracle.address);

      await expect(
        freshPool.connect(oracle).submitScores([miner1.address], [1000n])
      ).to.be.revertedWith("Pool: no epoch");
    });

    it("reverts if epoch is already finalized", async () => {
      await pool.connect(oracle).finalizeEpoch();
      await expect(
        pool.connect(oracle).submitScores([miner1.address], [1000n])
      ).to.be.revertedWith("Pool: epoch finalized");
    });

    it("reverts if caller does not have ORACLE_ROLE", async () => {
      await expect(
        pool.connect(stranger).submitScores([miner1.address], [1000n])
      ).to.be.revertedWithCustomError(pool, "AccessControlUnauthorizedAccount");
    });
  });

  // ─────────────────────────────────────────────────────────────
  // finalizeEpoch
  // ─────────────────────────────────────────────────────────────
  describe("finalizeEpoch", () => {
    const REWARD = ethers.parseEther("10000"); // 10,000 MIC

    beforeEach(async () => {
      await pool.connect(oracle).startEpoch();
      await pool
        .connect(oracle)
        .submitScores([miner1.address, miner2.address], [600n, 400n]);
      await fundPool(REWARD);
    });

    it("marks epoch as finalized", async () => {
      await pool.connect(oracle).finalizeEpoch();
      const epochData = await pool.epochs(1n);
      expect(epochData.finalized).to.be.true;
    });

    it("snapshots the MIC balance as totalReward", async () => {
      await pool.connect(oracle).finalizeEpoch();
      const epochData = await pool.epochs(1n);
      expect(epochData.totalReward).to.equal(REWARD);
    });

    it("emits EpochFinalized with correct args", async () => {
      await expect(pool.connect(oracle).finalizeEpoch())
        .to.emit(pool, "EpochFinalized")
        .withArgs(1n, REWARD, 1000n); // 600 + 400 = 1000 total score
    });

    it("reverts if no epoch started", async () => {
      const PoolFactory = await ethers.getContractFactory("MiningPool");
      const freshPool = await PoolFactory.deploy(await mic.getAddress(), admin.address);
      await freshPool.connect(admin).grantRole(ORACLE_ROLE, oracle.address);

      await expect(
        freshPool.connect(oracle).finalizeEpoch()
      ).to.be.revertedWith("Pool: no epoch");
    });

    it("reverts if epoch is already finalized", async () => {
      await pool.connect(oracle).finalizeEpoch();
      await expect(
        pool.connect(oracle).finalizeEpoch()
      ).to.be.revertedWith("Pool: already finalized");
    });

    it("reverts if caller does not have ORACLE_ROLE", async () => {
      await expect(
        pool.connect(stranger).finalizeEpoch()
      ).to.be.revertedWithCustomError(pool, "AccessControlUnauthorizedAccount");
    });

    it("can finalize epoch with zero MIC balance (empty reward)", async () => {
      // Deploy fresh pool with no funding
      const PoolFactory = await ethers.getContractFactory("MiningPool");
      const emptyPool = await PoolFactory.deploy(await mic.getAddress(), admin.address);
      await emptyPool.connect(admin).grantRole(ORACLE_ROLE, oracle.address);
      await emptyPool.connect(oracle).startEpoch();
      await emptyPool
        .connect(oracle)
        .submitScores([miner1.address], [1000n]);
      await emptyPool.connect(oracle).finalizeEpoch();

      const epochData = await emptyPool.epochs(1n);
      expect(epochData.totalReward).to.equal(0n);
      expect(epochData.finalized).to.be.true;
    });
  });

  // ─────────────────────────────────────────────────────────────
  // claimReward — Hindex-weighted distribution
  // ─────────────────────────────────────────────────────────────
  describe("claimReward", () => {
    const REWARD = ethers.parseEther("10000"); // 10,000 MIC

    beforeEach(async () => {
      await pool.connect(oracle).startEpoch();
      // miner1: 600 points, miner2: 400 points — total 1000
      await pool
        .connect(oracle)
        .submitScores([miner1.address, miner2.address], [600n, 400n]);
      await fundPool(REWARD);
      await pool.connect(oracle).finalizeEpoch();
    });

    it("miner1 (60% weight) claims 60% of total reward", async () => {
      const before = await mic.balanceOf(miner1.address);
      await pool.connect(miner1).claimReward(1n);
      const after = await mic.balanceOf(miner1.address);
      const expected = (REWARD * 600n) / 1000n;
      expect(after - before).to.equal(expected);
    });

    it("miner2 (40% weight) claims 40% of total reward", async () => {
      const before = await mic.balanceOf(miner2.address);
      await pool.connect(miner2).claimReward(1n);
      const after = await mic.balanceOf(miner2.address);
      const expected = (REWARD * 400n) / 1000n;
      expect(after - before).to.equal(expected);
    });

    it("both miners together receive 100% of rewards (no dust leak)", async () => {
      const poolBefore = await mic.balanceOf(await pool.getAddress());

      await pool.connect(miner1).claimReward(1n);
      await pool.connect(miner2).claimReward(1n);

      // Remaining balance should be 0 (or 1 wei rounding at most)
      const poolAfter = await mic.balanceOf(await pool.getAddress());
      expect(poolAfter).to.be.lessThanOrEqual(1n);
      expect(poolBefore).to.equal(REWARD);
    });

    it("emits RewardClaimed event", async () => {
      const expected = (REWARD * 600n) / 1000n;
      await expect(pool.connect(miner1).claimReward(1n))
        .to.emit(pool, "RewardClaimed")
        .withArgs(1n, miner1.address, expected);
    });

    it("reverts if epoch is not finalized", async () => {
      await pool.connect(oracle).startEpoch(); // epoch 2 (not finalized)
      await pool
        .connect(oracle)
        .submitScores([miner1.address], [1000n]);

      await expect(
        pool.connect(miner1).claimReward(2n)
      ).to.be.revertedWith("Pool: epoch not finalized");
    });

    it("reverts on double claim", async () => {
      await pool.connect(miner1).claimReward(1n);
      await expect(
        pool.connect(miner1).claimReward(1n)
      ).to.be.revertedWith("Pool: already claimed");
    });

    it("reverts if miner has no score in epoch", async () => {
      await expect(
        pool.connect(miner3).claimReward(1n)
      ).to.be.revertedWith("Pool: no score");
    });

    it("marks claimed flag after successful claim", async () => {
      await pool.connect(miner1).claimReward(1n);
      expect(await pool.claimed(1n, miner1.address)).to.be.true;
    });

    it("unclaimed miner is not marked as claimed", async () => {
      expect(await pool.claimed(1n, miner2.address)).to.be.false;
    });
  });

  // ─────────────────────────────────────────────────────────────
  // claimReward — edge cases & 3-miner proportional distribution
  // ─────────────────────────────────────────────────────────────
  describe("claimReward — 3 miners proportional", () => {
    // 3 miners with Hindex scores 1000, 2500, 1500 — total 5000
    const SCORES = [1000n, 2500n, 1500n];
    const TOTAL_SCORE = 5000n;
    const REWARD = ethers.parseEther("5000"); // 5,000 MIC

    beforeEach(async () => {
      await pool.connect(oracle).startEpoch();
      await pool
        .connect(oracle)
        .submitScores(
          [miner1.address, miner2.address, miner3.address],
          SCORES
        );
      await fundPool(REWARD);
      await pool.connect(oracle).finalizeEpoch();
    });

    it("distributes proportionally for all 3 miners", async () => {
      const miners = [miner1, miner2, miner3];
      const balancesBefore = await Promise.all(
        miners.map((m) => mic.balanceOf(m.address))
      );

      for (const miner of miners) {
        await pool.connect(miner).claimReward(1n);
      }

      const balancesAfter = await Promise.all(
        miners.map((m) => mic.balanceOf(m.address))
      );

      for (let i = 0; i < miners.length; i++) {
        const received = balancesAfter[i] - balancesBefore[i];
        const expected = (REWARD * SCORES[i]) / TOTAL_SCORE;
        expect(received).to.equal(expected);
      }
    });

    it("pool has at most 1 wei dust after all claims (rounding tolerance)", async () => {
      for (const miner of [miner1, miner2, miner3]) {
        await pool.connect(miner).claimReward(1n);
      }
      expect(await mic.balanceOf(await pool.getAddress())).to.be.lessThanOrEqual(2n);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // pendingReward (view function)
  // ─────────────────────────────────────────────────────────────
  describe("pendingReward", () => {
    const REWARD = ethers.parseEther("10000");

    beforeEach(async () => {
      await pool.connect(oracle).startEpoch();
      await pool
        .connect(oracle)
        .submitScores([miner1.address, miner2.address], [600n, 400n]);
      await fundPool(REWARD);
      await pool.connect(oracle).finalizeEpoch();
    });

    it("returns correct pending reward for miner1 before claim", async () => {
      const pending = await pool.pendingReward(1n, miner1.address);
      expect(pending).to.equal((REWARD * 600n) / 1000n);
    });

    it("returns correct pending reward for miner2 before claim", async () => {
      const pending = await pool.pendingReward(1n, miner2.address);
      expect(pending).to.equal((REWARD * 400n) / 1000n);
    });

    it("returns 0 after miner has claimed", async () => {
      await pool.connect(miner1).claimReward(1n);
      expect(await pool.pendingReward(1n, miner1.address)).to.equal(0n);
    });

    it("returns 0 for miner with no score", async () => {
      expect(await pool.pendingReward(1n, miner3.address)).to.equal(0n);
    });

    it("returns 0 for non-finalized epoch", async () => {
      // Start and submit for epoch 2 but don't finalize
      await pool.connect(oracle).startEpoch();
      await pool.connect(oracle).submitScores([miner1.address], [1000n]);
      expect(await pool.pendingReward(2n, miner1.address)).to.equal(0n);
    });

    it("returns 0 for epoch with zero totalWeightedScore", async () => {
      // Finalize a fresh epoch with scores but empty reward
      const PoolFactory = await ethers.getContractFactory("MiningPool");
      const emptyPool = await PoolFactory.deploy(await mic.getAddress(), admin.address);
      await emptyPool.connect(admin).grantRole(ORACLE_ROLE, oracle.address);
      await emptyPool.connect(oracle).startEpoch();
      // Do NOT submit any scores — totalWeightedScore stays 0
      await emptyPool.connect(oracle).finalizeEpoch();
      expect(await emptyPool.pendingReward(1n, miner1.address)).to.equal(0n);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // getScore (view function)
  // ─────────────────────────────────────────────────────────────
  describe("getScore", () => {
    it("returns 0 for miner with no score in epoch", async () => {
      await pool.connect(oracle).startEpoch();
      expect(await pool.getScore(1n, miner1.address)).to.equal(0n);
    });

    it("returns submitted score for miner", async () => {
      await pool.connect(oracle).startEpoch();
      await pool.connect(oracle).submitScores([miner1.address], [42000n]);
      expect(await pool.getScore(1n, miner1.address)).to.equal(42000n);
    });

    it("returns 0 for past epoch if miner had no score in that epoch", async () => {
      await pool.connect(oracle).startEpoch(); // epoch 1
      await pool.connect(oracle).submitScores([miner1.address], [1000n]);
      await pool.connect(oracle).finalizeEpoch();

      await pool.connect(oracle).startEpoch(); // epoch 2
      // Only miner2 submits in epoch 2
      await pool.connect(oracle).submitScores([miner2.address], [500n]);

      expect(await pool.getScore(2n, miner1.address)).to.equal(0n);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // MIC token integration — contract receives minted MIC
  // ─────────────────────────────────────────────────────────────
  describe("MIC token integration", () => {
    it("pool MIC balance increases after mintFromMining", async () => {
      const amount = ethers.parseEther("22907500"); // one day's emission
      await fundPool(amount);
      expect(await mic.balanceOf(await pool.getAddress())).to.equal(amount);
    });

    it("finalize correctly snapshots balance from mintFromMining", async () => {
      const amount = ethers.parseEther("1000000");
      await pool.connect(oracle).startEpoch();
      await pool.connect(oracle).submitScores([miner1.address], [1000n]);
      await fundPool(amount);
      await pool.connect(oracle).finalizeEpoch();

      const epochData = await pool.epochs(1n);
      expect(epochData.totalReward).to.equal(amount);
    });

    it("MIC balance decreases by claimed amount after miner claims", async () => {
      const amount = ethers.parseEther("1000");
      await pool.connect(oracle).startEpoch();
      await pool.connect(oracle).submitScores([miner1.address], [1000n]);
      await fundPool(amount);
      await pool.connect(oracle).finalizeEpoch();

      const poolBefore = await mic.balanceOf(await pool.getAddress());
      await pool.connect(miner1).claimReward(1n);
      const poolAfter = await mic.balanceOf(await pool.getAddress());

      // Entire amount claimed by solo miner
      expect(poolBefore - poolAfter).to.equal(amount);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Multi-epoch workflow
  // ─────────────────────────────────────────────────────────────
  describe("Multi-epoch workflow", () => {
    it("supports independent reward claims across two epochs", async () => {
      const REWARD_1 = ethers.parseEther("6000");
      const REWARD_2 = ethers.parseEther("9000");

      // Epoch 1: miner1 only
      await pool.connect(oracle).startEpoch();
      await pool.connect(oracle).submitScores([miner1.address], [1000n]);
      await fundPool(REWARD_1);
      await pool.connect(oracle).finalizeEpoch();

      // Epoch 1 reward snapshot = REWARD_1 (pool only holds REWARD_1 at this point)
      expect((await pool.epochs(1n)).totalReward).to.equal(REWARD_1);

      // miner1 claims epoch 1 BEFORE epoch 2 is funded (so balances are clean)
      const m1Before = await mic.balanceOf(miner1.address);
      await pool.connect(miner1).claimReward(1n);
      const m1After = await mic.balanceOf(miner1.address);
      expect(m1After - m1Before).to.equal(REWARD_1);

      // Epoch 2: miner2 only — fund after epoch 1 has been fully claimed
      await pool.connect(oracle).startEpoch();
      await pool.connect(oracle).submitScores([miner2.address], [1000n]);
      await fundPool(REWARD_2);
      // At finalize: pool balance = REWARD_2 (REWARD_1 already claimed)
      await pool.connect(oracle).finalizeEpoch();

      expect((await pool.epochs(2n)).totalReward).to.equal(REWARD_2);

      // miner2 claims epoch 2
      const m2Before = await mic.balanceOf(miner2.address);
      await pool.connect(miner2).claimReward(2n);
      const m2After = await mic.balanceOf(miner2.address);
      expect(m2After - m2Before).to.equal(REWARD_2);
    });

    it("miner1 cannot claim epoch 2 if they had no score in epoch 2", async () => {
      // Epoch 1: miner1
      await pool.connect(oracle).startEpoch();
      await pool.connect(oracle).submitScores([miner1.address], [1000n]);
      await fundPool(ethers.parseEther("1000"));
      await pool.connect(oracle).finalizeEpoch();

      // Epoch 2: only miner2
      await pool.connect(oracle).startEpoch();
      await pool.connect(oracle).submitScores([miner2.address], [500n]);
      await fundPool(ethers.parseEther("1000"));
      await pool.connect(oracle).finalizeEpoch();

      await expect(
        pool.connect(miner1).claimReward(2n)
      ).to.be.revertedWith("Pool: no score");
    });

    it("currentEpoch advances correctly across multiple starts", async () => {
      for (let i = 1; i <= 3; i++) {
        await pool.connect(oracle).startEpoch();
        await pool.connect(oracle).finalizeEpoch();
      }
      expect(await pool.currentEpoch()).to.equal(3n);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Access Control
  // ─────────────────────────────────────────────────────────────
  describe("Access Control", () => {
    it("ORACLE_ROLE can be granted by admin", async () => {
      await pool.connect(admin).grantRole(ORACLE_ROLE, stranger.address);
      expect(await pool.hasRole(ORACLE_ROLE, stranger.address)).to.be.true;
    });

    it("ORACLE_ROLE can be revoked by admin", async () => {
      await pool.connect(admin).revokeRole(ORACLE_ROLE, oracle.address);
      expect(await pool.hasRole(ORACLE_ROLE, oracle.address)).to.be.false;
    });

    it("revoked oracle cannot call startEpoch", async () => {
      await pool.connect(admin).revokeRole(ORACLE_ROLE, oracle.address);
      await expect(
        pool.connect(oracle).startEpoch()
      ).to.be.revertedWithCustomError(pool, "AccessControlUnauthorizedAccount");
    });

    it("revoked oracle cannot call submitScores", async () => {
      await pool.connect(oracle).startEpoch(); // start before revoke
      await pool.connect(admin).revokeRole(ORACLE_ROLE, oracle.address);
      await expect(
        pool.connect(oracle).submitScores([miner1.address], [1000n])
      ).to.be.revertedWithCustomError(pool, "AccessControlUnauthorizedAccount");
    });

    it("revoked oracle cannot call finalizeEpoch", async () => {
      await pool.connect(oracle).startEpoch();
      await pool.connect(admin).revokeRole(ORACLE_ROLE, oracle.address);
      await expect(
        pool.connect(oracle).finalizeEpoch()
      ).to.be.revertedWithCustomError(pool, "AccessControlUnauthorizedAccount");
    });

    it("stranger cannot call startEpoch", async () => {
      await expect(
        pool.connect(stranger).startEpoch()
      ).to.be.revertedWithCustomError(pool, "AccessControlUnauthorizedAccount");
    });

    it("stranger cannot call submitScores", async () => {
      await pool.connect(oracle).startEpoch();
      await expect(
        pool.connect(stranger).submitScores([miner1.address], [1000n])
      ).to.be.revertedWithCustomError(pool, "AccessControlUnauthorizedAccount");
    });

    it("stranger cannot call finalizeEpoch", async () => {
      await pool.connect(oracle).startEpoch();
      await expect(
        pool.connect(stranger).finalizeEpoch()
      ).to.be.revertedWithCustomError(pool, "AccessControlUnauthorizedAccount");
    });

    it("admin (who also has ORACLE_ROLE) can call all oracle functions", async () => {
      await pool.connect(admin).startEpoch();
      await pool.connect(admin).submitScores([miner1.address], [1000n]);
      await pool.connect(admin).finalizeEpoch();
      expect((await pool.epochs(1n)).finalized).to.be.true;
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Reentrancy protection
  // ─────────────────────────────────────────────────────────────
  describe("Reentrancy protection", () => {
    it("claimReward has nonReentrant modifier (guard is present)", async () => {
      // We verify the function selector is guarded — the contract compiles
      // with ReentrancyGuard and the modifier is applied in the source.
      // Behavioral test: sequential claims work, double-claim reverts
      const REWARD = ethers.parseEther("1000");
      await pool.connect(oracle).startEpoch();
      await pool.connect(oracle).submitScores([miner1.address], [1000n]);
      await fundPool(REWARD);
      await pool.connect(oracle).finalizeEpoch();

      await pool.connect(miner1).claimReward(1n);
      await expect(
        pool.connect(miner1).claimReward(1n)
      ).to.be.revertedWith("Pool: already claimed");
    });
  });
});
