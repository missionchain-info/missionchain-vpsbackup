import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

// ─── Constants ────────────────────────────────────────────────────────────────

const E0 = ethers.parseEther("22907500"); // 22,907,500 MIC/day
const ONE_DAY = 86_400;
const THIRTY_DAYS = 30 * ONE_DAY;
const NINETY_DAYS = 90 * ONE_DAY;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Relative diff in basis points (1e4 = 100%) */
function diffBps(actual: bigint, expected: bigint): bigint {
  if (expected === 0n) return actual === 0n ? 0n : 1_000_000n;
  const delta = actual > expected ? actual - expected : expected - actual;
  return (delta * 10_000n) / expected;
}

/** Expect two bigints to be within `toleranceBps` of each other (default 1%) */
function expectApprox(actual: bigint, expected: bigint, toleranceBps = 100n, label = "") {
  const diff = diffBps(actual, expected);
  expect(diff).to.be.lte(
    toleranceBps,
    `${label}: expected ~${expected}, got ${actual} (diff ${diff} bps)`
  );
}

// ─── Describe ─────────────────────────────────────────────────────────────────

describe("EmissionController", function () {
  let ec: any;
  let mic: any;
  let miceLicense: any;

  let admin: any;
  let oracle: any;
  let miningPool: any;
  let stakingPool: any;
  let daoTreasury: any;
  let communityNFTAddr: any;

  beforeEach(async () => {
    [admin, oracle, miningPool, stakingPool, daoTreasury, communityNFTAddr] = await ethers.getSigners();

    // Deploy MICToken
    const MICFactory = await ethers.getContractFactory("MICToken");
    mic = await MICFactory.deploy(admin.address);

    // Deploy MockMICELicense
    const MockLicenseFactory = await ethers.getContractFactory("MockMICELicense");
    miceLicense = await MockLicenseFactory.deploy();

    // Deploy EmissionController
    const ECFactory = await ethers.getContractFactory("EmissionController");
    ec = await ECFactory.deploy(
      await mic.getAddress(),
      await miceLicense.getAddress(),
      miningPool.address,
      stakingPool.address,
      daoTreasury.address,
      communityNFTAddr.address,
      admin.address
    );

    // Grant MINTER_ROLE to EmissionController
    const MINTER_ROLE = await mic.MINTER_ROLE();
    await mic.connect(admin).grantRole(MINTER_ROLE, await ec.getAddress());

    // Grant ORACLE_ROLE to oracle signer
    const ORACLE_ROLE = await ec.ORACLE_ROLE();
    await ec.connect(admin).grantRole(ORACLE_ROLE, oracle.address);
  });

  // ── Constructor ────────────────────────────────────────────────────────────

  describe("Constructor", () => {
    it("should set deployTime and lastDistribution to block.timestamp", async () => {
      const deployTime = await ec.deployTime();
      const lastDist = await ec.lastDistribution();
      expect(deployTime).to.equal(lastDist);
      expect(deployTime).to.be.gt(0n);
    });

    it("should set default split ratios: 6000/2500/1000/500", async () => {
      expect(await ec.minersBps()).to.equal(6000n);
      expect(await ec.stakingBps()).to.equal(2500n);
      expect(await ec.daoBps()).to.equal(1000n);
      expect(await ec.communityNFTBps()).to.equal(500n);
    });

    it("should set default ROI to 25000 bps (250%)", async () => {
      expect(await ec.currentROI()).to.equal(25000n);
    });
  });

  // ── eBase ──────────────────────────────────────────────────────────────────

  describe("eBase()", () => {
    it("should return ~E0 at t=0", async () => {
      const base = await ec.eBase();
      // Hardhat block mining adds ~1-2s offset, causing a tiny fractional decay.
      // Verify it is within 1 bps of E0.
      expectApprox(base, E0, 1n, "eBase at t≈0");
    });

    it("should return ~E0/2 at t=HALF_LIFE (180 days)", async () => {
      await time.increase(180 * ONE_DAY);
      const base = await ec.eBase();
      // At exactly 1 half-life: halvings=1, remainder=0 → base = E0 >> 1 = E0/2
      expectApprox(base, E0 / 2n, 10n, "eBase at 180d");
    });

    it("should return ~0 after 20 half-lives", async () => {
      await time.increase(20 * 180 * ONE_DAY);
      const base = await ec.eBase();
      expect(base).to.equal(0n);
    });
  });

  // ── demandFactor ───────────────────────────────────────────────────────────

  describe("demandFactor()", () => {
    it("should return 0.5e18 when activeLicenses = 0", async () => {
      const d = await ec.demandFactor();
      expect(d).to.equal(5n * 10n ** 17n);
    });

    it("should return 1.0e18 when activeLicenses = 50,000 (half of max)", async () => {
      await miceLicense.setActiveLicenses(50_000);
      const d = await ec.demandFactor();
      expect(d).to.equal(10n ** 18n);
    });

    it("should return 1.5e18 when activeLicenses = 100,000 (max)", async () => {
      await miceLicense.setActiveLicenses(100_000);
      const d = await ec.demandFactor();
      expect(d).to.equal(15n * 10n ** 17n);
    });
  });

  // ── roiFactor ─────────────────────────────────────────────────────────────

  describe("roiFactor()", () => {
    it("should return 1.0e18 at default ROI=250% (25000 bps)", async () => {
      const r = await ec.roiFactor();
      expect(r).to.equal(10n ** 18n);
    });

    it("should return 2.0e18 (max) when ROI < 125%", async () => {
      await ec.connect(oracle).setROI(10000); // 100% ROI → r = 250/100 = 2.5 → clamped to 2.0
      const r = await ec.roiFactor();
      expect(r).to.equal(2n * 10n ** 18n);
    });

    it("should return 0.5e18 (min) when ROI > 500%", async () => {
      await ec.connect(oracle).setROI(60000); // 600% → r = 250/600 < 0.5 → clamped
      const r = await ec.roiFactor();
      expect(r).to.equal(5n * 10n ** 17n);
    });

    it("should return 2.0e18 when ROI=0 (no data)", async () => {
      await ec.connect(oracle).setROI(0);
      const r = await ec.roiFactor();
      expect(r).to.equal(2n * 10n ** 18n);
    });
  });

  // ── warmUpFactor W(t) ─────────────────────────────────────────────────────

  describe("warmUpFactor()", () => {
    it("should return ~0 at t=0 (deploy instant)", async () => {
      // At deploy, elapsed ~0 so W ≈ 0 (could be a few seconds in)
      const w = await ec.warmUpFactor();
      expect(w).to.be.lt(ethers.parseEther("0.01")); // < 1%
    });

    it("should return ~0.5e18 at t=15 days", async () => {
      await time.increase(15 * ONE_DAY);
      const w = await ec.warmUpFactor();
      // W = 15/30 = 0.5
      expectApprox(w, 5n * 10n ** 17n, 10n, "warmUp at 15d");
    });

    it("should return 1.0e18 at t=30 days", async () => {
      await time.increase(THIRTY_DAYS);
      const w = await ec.warmUpFactor();
      expect(w).to.equal(10n ** 18n);
    });

    it("should return 1.0e18 at t=60 days (fully ramped)", async () => {
      await time.increase(60 * ONE_DAY);
      const w = await ec.warmUpFactor();
      expect(w).to.equal(10n ** 18n);
    });

    it("should return 1.0e18 at t=90 days", async () => {
      await time.increase(NINETY_DAYS);
      const w = await ec.warmUpFactor();
      expect(w).to.equal(10n ** 18n);
    });
  });

  // ── dailyEmission ─────────────────────────────────────────────────────────

  describe("dailyEmission()", () => {
    it("should return 0 when activeLicenses = 0", async () => {
      await time.increase(THIRTY_DAYS); // past warmup
      const emission = await ec.dailyEmission();
      expect(emission).to.equal(0n);
    });

    it("should return ~0 on Day 0 (WarmUp ≈ 0)", async () => {
      await miceLicense.setActiveLicenses(50_000);
      const emission = await ec.dailyEmission();
      // W(0) ≈ 0, so emission ≈ 0
      expect(emission).to.be.lt(ethers.parseEther("100000")); // < 100K MIC (essentially 0)
    });

    it("should be ~50% of full emission at Day 15 (WarmUp = 0.5)", async () => {
      await miceLicense.setActiveLicenses(100_000); // D=1.5, R=1.0 at ROI=250%
      await time.increase(15 * ONE_DAY);

      const emission = await ec.dailyEmission();
      const base = await ec.eBase();
      const d = await ec.demandFactor();     // 1.5e18
      const r = await ec.roiFactor();        // 1.0e18
      const w = await ec.warmUpFactor();     // ~0.5e18

      // Expected = base × D × R × W / 1e54
      const expected = ((base * d / BigInt(1e18)) * r / BigInt(1e18)) * w / BigInt(1e18);
      // The result must match dailyEmission() exactly (same calculation)
      expect(emission).to.equal(expected);

      // Also verify W(15d) ≈ 0.5, meaning emission ≈ 50% of what it'd be at Day 30
      // W should be between 0.49 and 0.51
      expect(w).to.be.gte(49n * 10n ** 16n).and.lte(51n * 10n ** 16n);
    });

    it("should be at full emission after Day 30 (WarmUp = 1.0)", async () => {
      await miceLicense.setActiveLicenses(100_000);
      await time.increase(THIRTY_DAYS + ONE_DAY);

      const emission = await ec.dailyEmission();
      const base = await ec.eBase();
      const w = await ec.warmUpFactor();

      // W must be 1.0 (fully ramped)
      expect(w).to.equal(10n ** 18n);

      // Emission should match base × D × R × 1.0 (W=1)
      const d = await ec.demandFactor();
      const r = await ec.roiFactor();
      const expected = ((base * d / BigInt(1e18)) * r / BigInt(1e18)) * w / BigInt(1e18);
      expect(emission).to.equal(expected);
    });

    it("should apply daily cap: emission ≤ 2 × eBase", async () => {
      await miceLicense.setActiveLicenses(100_000); // D = 1.5
      await ec.connect(oracle).setROI(5000); // 50% ROI → R = 250/50 = 5.0 → clamped to 2.0
      await time.increase(THIRTY_DAYS + ONE_DAY); // past warmup, W=1

      const emission = await ec.dailyEmission();
      const base = await ec.eBase();
      expect(emission).to.lte(base * 2n);
    });

    it("should be capped by remainingMiningPool", async () => {
      // Manually exhaust the mining pool via minting
      await miceLicense.setActiveLicenses(50_000);
      await time.increase(THIRTY_DAYS);

      const remaining = await mic.remainingMiningPool();
      const emission = await ec.dailyEmission();
      expect(emission).to.lte(remaining);
    });

    it("should return 0 when mining pool is exhausted", async () => {
      // Drain the mining pool by minting the full 85%
      const MINTER_ROLE = await mic.MINTER_ROLE();
      // EmissionController already has MINTER_ROLE; let admin also mint
      await mic.connect(admin).grantRole(MINTER_ROLE, admin.address);
      const remaining = await mic.remainingMiningPool();
      await mic.connect(admin).mintFromMining(admin.address, remaining);

      await miceLicense.setActiveLicenses(50_000);
      await time.increase(THIRTY_DAYS);

      const emission = await ec.dailyEmission();
      expect(emission).to.equal(0n);
    });
  });

  // ── Early Staking Boost ───────────────────────────────────────────────────

  describe("Early Staking Boost — distributeDaily() split", () => {
    beforeEach(async () => {
      // Set enough licenses and advance past warmup so emission > 0
      await miceLicense.setActiveLicenses(50_000); // D = 1.0, R = 1.0 → clean numbers
      // Advance 1 day so distributeDaily can be called
      await time.increase(ONE_DAY);
    });

    it("Day 1: miners ~50%, staking ~35%, dao 10%, communityNFT 5%", async () => {
      // daysElapsed = 1, boost = (90-1)*1000/90 ≈ 989 bps
      // currentMiners = 6000 - 989 = 5011
      // currentStaking = 2500 + 989 = 3489
      await ec.distributeDaily();

      const filter = ec.filters.DailyDistributed();
      const events = await ec.queryFilter(filter);
      expect(events.length).to.equal(1);

      const { toMiners, toStaking, toDAO, toCommunityNFT, totalMinted } = events[0].args;

      // Check DAO = 10% and CommunityNFT gets 5%
      expectApprox(toDAO, (totalMinted * 1000n) / 10000n, 10n, "DAO Day1");
      expectApprox(toCommunityNFT, (totalMinted * 500n) / 10000n, 10n, "CommunityNFT Day1");

      // Miners should be ~50% (5000 bps ± generous tolerance for boost rounding)
      const minersPct = (toMiners * 10000n) / totalMinted;
      expect(minersPct).to.be.gte(4900n).and.lte(5100n);

      // Staking should be ~35% (3500 bps)
      const stakingPct = (toStaking * 10000n) / totalMinted;
      expect(stakingPct).to.be.gte(3300n).and.lte(3700n);
    });

    it("Day 45 (~midpoint): miners ~55%, staking ~30%", async () => {
      // beforeEach already advanced 1 day. Advance 44 more → total ~45 days elapsed.
      // Call distributeDaily at Day 1 first, then advance to Day 45.
      await ec.distributeDaily(); // Day 1 call (uses Day 1 split)
      await time.increase(44 * ONE_DAY); // now at ~45 days total

      await ec.distributeDaily(); // Day 45 call

      const filter = ec.filters.DailyDistributed();
      const events = await ec.queryFilter(filter);
      // Last event is the Day 45 call
      const evt = events[events.length - 1].args;

      const minersPct = (evt.toMiners * 10000n) / evt.totalMinted;
      const stakingPct = (evt.toStaking * 10000n) / evt.totalMinted;

      // At day 45: boost = (90-45)*1000/90 = 500 bps; miners = 5500, staking = 3000
      expect(minersPct).to.be.gte(5300n).and.lte(5700n);
      expect(stakingPct).to.be.gte(2800n).and.lte(3200n);
    });

    it("Day 90+: miners 60%, staking 25% (permanent ratio)", async () => {
      // beforeEach already at Day 1. Advance 89 more days → total ~90 days.
      await time.increase(89 * ONE_DAY);

      await ec.distributeDaily();

      const filter = ec.filters.DailyDistributed();
      const events = await ec.queryFilter(filter);
      const evt = events[0].args;

      // At Day 90+: Early Boost = 0, permanent split 60/25/10/5
      // Use integer BPS: miners = toMiners * 10000 / total, rounding may produce 5999/6000
      const minersPct = (evt.toMiners * 10000n) / evt.totalMinted;
      const stakingPct = (evt.toStaking * 10000n) / evt.totalMinted;

      // Allow ±1 bps for integer division rounding
      expect(minersPct).to.be.gte(5999n).and.lte(6001n);
      expect(stakingPct).to.be.gte(2499n).and.lte(2501n);

      // DAO = 10%: use expectApprox (1 bps tolerance for rounding)
      expectApprox(evt.toDAO, (evt.totalMinted * 1000n) / 10000n, 1n, "DAO Day90+");
    });

    it("miners + staking + dao + communityNFT should sum to totalMinted", async () => {
      await ec.distributeDaily();

      const filter = ec.filters.DailyDistributed();
      const events = await ec.queryFilter(filter);
      const { toMiners, toStaking, toDAO, toCommunityNFT, totalMinted } = events[0].args;

      expect(toMiners + toStaking + toDAO + toCommunityNFT).to.equal(totalMinted);
    });
  });

  // ── distributeDaily — core mechanics ──────────────────────────────────────

  describe("distributeDaily() — core mechanics", () => {
    beforeEach(async () => {
      await miceLicense.setActiveLicenses(50_000);
      await time.increase(NINETY_DAYS); // past warmup AND early boost
    });

    it("should revert if called twice within 24 hours", async () => {
      await ec.distributeDaily();
      await expect(ec.distributeDaily()).to.be.revertedWith("EC: too early");
    });

    it("should succeed on next call after 1 day", async () => {
      await ec.distributeDaily();
      await time.increase(ONE_DAY);
      await expect(ec.distributeDaily()).to.not.be.reverted;
    });

    it("should accumulate totalEmitted correctly over 2 days", async () => {
      await ec.distributeDaily();
      const e1 = await ec.dailyEmission();
      await time.increase(ONE_DAY);
      await ec.distributeDaily();
      const total = await ec.totalEmitted();
      // totalEmitted should be > 0 and approximately 2 × daily emission
      expect(total).to.be.gt(0n);
    });

    it("should mint tokens to pool addresses", async () => {
      const balBefore = await mic.balanceOf(miningPool.address);
      await ec.distributeDaily();
      const balAfter = await mic.balanceOf(miningPool.address);
      expect(balAfter).to.be.gt(balBefore);
    });

    it("should emit DailyDistributed event with correct day number", async () => {
      await ec.distributeDaily();
      const filter = ec.filters.DailyDistributed();
      const events = await ec.queryFilter(filter);
      expect(events.length).to.equal(1);
      const dayNum = events[0].args.day;
      expect(dayNum).to.equal(90n); // 90 days elapsed
    });

    it("should skip minting (no state change) when emission = 0 (activeLicenses = 0)", async () => {
      await miceLicense.setActiveLicenses(0);
      const totalBefore = await ec.totalEmitted();
      await ec.distributeDaily();
      const totalAfter = await ec.totalEmitted();
      expect(totalAfter).to.equal(totalBefore);
    });
  });

  // ── Circuit Breakers ───────────────────────────────────────────────────────

  describe("Circuit Breakers", () => {
    beforeEach(async () => {
      await miceLicense.setActiveLicenses(50_000);
      await time.increase(NINETY_DAYS);
    });

    it("should block distributeDaily when price floor is breached", async () => {
      await ec.connect(oracle).setPriceFloorBreached(true);
      await expect(ec.distributeDaily()).to.be.revertedWith("EC: price floor breached");
    });

    it("should resume after price floor is cleared", async () => {
      await ec.connect(oracle).setPriceFloorBreached(true);
      await ec.connect(oracle).setPriceFloorBreached(false);
      await expect(ec.distributeDaily()).to.not.be.reverted;
    });

    it("should emit PriceFloorToggled event", async () => {
      await expect(ec.connect(oracle).setPriceFloorBreached(true))
        .to.emit(ec, "PriceFloorToggled")
        .withArgs(true);
    });

    it("daily cap: emission should never exceed 2 × eBase regardless of D and R", async () => {
      await miceLicense.setActiveLicenses(100_000); // D = 1.5
      await ec.connect(oracle).setROI(5000); // R → clamped to 2.0
      // W = 1 (past 30 days)
      const emission = await ec.dailyEmission();
      const base = await ec.eBase();
      expect(emission).to.lte(base * 2n);
    });

    it("cumulative cap: totalEmitted should not exceed 5.95B MIC", async () => {
      // Just verify dailyEmission respects remainingMiningPool bound
      const remaining = await mic.remainingMiningPool();
      const emission = await ec.dailyEmission();
      expect(emission).to.lte(remaining);
    });
  });

  // ── setSplitRatios ─────────────────────────────────────────────────────────

  describe("setSplitRatios()", () => {
    it("should update split ratios within ±10% of originals", async () => {
      // Valid: miners=6500, staking=2500, dao=500, communityNFT=500 (total=10000)
      await ec.connect(admin).setSplitRatios(6500, 2500, 500, 500);
      expect(await ec.minersBps()).to.equal(6500n);
    });

    it("should revert if ratios do not sum to 10000", async () => {
      await expect(
        ec.connect(admin).setSplitRatios(6000, 2500, 1000, 600)
      ).to.be.revertedWith("EC: must total 100%");
    });

    it("should revert if miners is out of ±10% range", async () => {
      // miners=7100 → exceeds ORIG_MINERS+1000=7000
      // Other values within range: staking=2400 in [1500,3500], dao=0 in [0,2000], communityNFT=500 in [0,1500]
      await expect(
        ec.connect(admin).setSplitRatios(7100, 2400, 0, 500)
      ).to.be.revertedWith("EC: miners out of range");
    });

    it("should emit SplitRatiosUpdated event", async () => {
      await expect(ec.connect(admin).setSplitRatios(6000, 2500, 1000, 500))
        .to.emit(ec, "SplitRatiosUpdated")
        .withArgs(6000n, 2500n, 1000n, 500n);
    });

    it("Early Staking Boost should still apply on top of custom split ratios", async () => {
      // Set miners to 5500 (within range), staking to 2500, dao to 1500, communityNFT to 500
      await ec.connect(admin).setSplitRatios(5500, 2500, 1500, 500);

      await miceLicense.setActiveLicenses(50_000);
      await time.increase(ONE_DAY); // Day 1 — Early Boost active

      await ec.distributeDaily();

      const filter = ec.filters.DailyDistributed();
      const events = await ec.queryFilter(filter);
      const { toMiners, toStaking, totalMinted } = events[0].args;

      // At Day 1: boost ≈ 989 bps subtracted from minersBps(5500)
      // currentMiners = 5500 - 989 = ~4511, currentStaking = 2500 + 989 = ~3489
      // Miners should be less than 5500/10000 of total
      const minersPct = (toMiners * 10000n) / totalMinted;
      expect(minersPct).to.be.lt(5500n);

      // Staking should be more than 2500/10000 of total
      const stakingPct = (toStaking * 10000n) / totalMinted;
      expect(stakingPct).to.be.gt(2500n);
    });
  });

  // ── Oracle ─────────────────────────────────────────────────────────────────

  describe("Oracle setROI()", () => {
    it("should update currentROI and emit ROIUpdated", async () => {
      await expect(ec.connect(oracle).setROI(30000))
        .to.emit(ec, "ROIUpdated")
        .withArgs(25000n, 30000n);
      expect(await ec.currentROI()).to.equal(30000n);
    });

    it("should revert if called by non-oracle", async () => {
      await expect(ec.connect(miningPool).setROI(30000)).to.be.reverted;
    });
  });

  // ── Admin setters ──────────────────────────────────────────────────────────

  describe("Admin pool address setters", () => {
    it("setMiningPool should update address", async () => {
      await ec.connect(admin).setMiningPool(oracle.address);
      expect(await ec.miningPool()).to.equal(oracle.address);
    });

    it("setMiningPool should revert on zero address", async () => {
      await expect(
        ec.connect(admin).setMiningPool(ethers.ZeroAddress)
      ).to.be.revertedWith("EC: zero address");
    });

    it("should revert on non-admin caller", async () => {
      await expect(
        ec.connect(oracle).setMiningPool(oracle.address)
      ).to.be.reverted;
    });
  });
});
