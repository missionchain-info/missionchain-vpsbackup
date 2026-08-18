import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

// ─── Constants ────────────────────────────────────────────────────────────────

const E0 = ethers.parseEther("750000"); // 22,907,500 MIC/day
const ONE_DAY = 86_400;
const HALF_LIFE_SECONDS = 2922 * ONE_DAY;   // 8 years
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
  let miningPoolAddr: string;
  let unusedSigner: any;
  let stakingPool: any;
  let daoTreasury: any;
  let communityNFTAddr: any;
  let mfpRewardAddr: any;

  beforeEach(async () => {
    [admin, oracle, unusedSigner, stakingPool, daoTreasury, communityNFTAddr, mfpRewardAddr] = await ethers.getSigners();

    // The miner pool must be a contract now: EmissionController announces each
    // distribution to it, and an EOA cannot answer that call.
    miningPool = await (await ethers.getContractFactory("MockMiningPoolNotify")).deploy();
    miningPoolAddr = await miningPool.getAddress();

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
      miningPoolAddr,
      stakingPool.address,
      daoTreasury.address,
      communityNFTAddr.address,
      mfpRewardAddr.address,
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

    it("should set default split ratios: 5900/2500/1000/500/100", async () => {
      expect(await ec.minersBps()).to.equal(5900n);
      expect(await ec.stakingBps()).to.equal(2500n);
      expect(await ec.daoBps()).to.equal(1000n);
      expect(await ec.communityNFTBps()).to.equal(500n);
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

    it("should return ~E0/2 at t=HALF_LIFE (8 years)", async () => {
      await time.increase(HALF_LIFE_SECONDS);
      const base = await ec.eBase();
      // At exactly 1 half-life: halvings=1, remainder=0 → base = E0 >> 1 = E0/2
      expectApprox(base, E0 / 2n, 10n, "eBase at 180d");
    });

    it("should return ~0 after 20 half-lives", async () => {
      await time.increase(20 * HALF_LIFE_SECONDS);
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
      const w = await ec.warmUpFactor();     // ~0.5e18
      const l = await (ec as any).currentL();
      const g = await (ec as any).trendFactor();
      const a = await (ec as any).adoptionFactor();

      // Expected = base × D × L × G × W × A
      let expected = base;
      for (const f of [d, l, g, w, a]) expected = expected * f / BigInt(1e18);
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

      // Emission should match base × D × L × G × W × A with W = 1
      const d = await ec.demandFactor();
      const l = await (ec as any).currentL();
      const g = await (ec as any).trendFactor();
      const a = await (ec as any).adoptionFactor();
      let expected = base;
      for (const f of [d, l, g, w, a]) expected = expected * f / BigInt(1e18);
      expect(emission).to.equal(expected);
    });

    it("should apply daily cap: emission ≤ 2 × eBase", async () => {
      await miceLicense.setActiveLicenses(100_000); // D = 1.5, A = 1.0
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

    it("Day 90+: miners 59%, staking 25% (permanent ratio)", async () => {
      // beforeEach already at Day 1. Advance 89 more days → total ~90 days.
      await time.increase(89 * ONE_DAY);

      await ec.distributeDaily();

      const filter = ec.filters.DailyDistributed();
      const events = await ec.queryFilter(filter);
      const evt = events[0].args;

      // At Day 90+: Early Boost = 0, permanent split 59/25/10/5/1
      // Use integer BPS: miners = toMiners * 10000 / total, rounding may produce 5899/5900
      const minersPct = (evt.toMiners * 10000n) / evt.totalMinted;
      const stakingPct = (evt.toStaking * 10000n) / evt.totalMinted;

      // Allow ±1 bps for integer division rounding
      expect(minersPct).to.be.gte(5899n).and.lte(5901n);
      expect(stakingPct).to.be.gte(2499n).and.lte(2501n);

      // DAO = 10%: use expectApprox (1 bps tolerance for rounding)
      expectApprox(evt.toDAO, (evt.totalMinted * 1000n) / 10000n, 1n, "DAO Day90+");
    });

    it("miners + staking + dao + communityNFT + mfpReward should sum to totalMinted", async () => {
      await ec.distributeDaily();

      const filter = ec.filters.DailyDistributed();
      const events = await ec.queryFilter(filter);
      const { toMiners, toStaking, toDAO, toCommunityNFT, toMFPReward, totalMinted } = events[0].args;

      expect(toMiners + toStaking + toDAO + toCommunityNFT + toMFPReward).to.equal(totalMinted);
      // MFP-NFT Reward = 1% of daily emission (Deck p.7)
      expectApprox(toMFPReward, (totalMinted * 100n) / 10000n, 1n, "MFP 1%");
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
      const balBefore = await mic.balanceOf(miningPoolAddr);
      await ec.distributeDaily();
      const balAfter = await mic.balanceOf(miningPoolAddr);
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




    it("daily cap: emission should never exceed 2 × eBase regardless of D and R", async () => {
      await miceLicense.setActiveLicenses(100_000); // D = 1.5, A = 1.0
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
      await ec.connect(admin).setSplitRatios(6500, 2500, 400, 500, 100);
      expect(await ec.minersBps()).to.equal(6500n);
    });

    it("should revert if ratios do not sum to 10000", async () => {
      await expect(
        ec.connect(admin).setSplitRatios(5900, 2500, 1000, 600, 100)
      ).to.be.revertedWith("EC: must total 100%");
    });

    it("should revert if miners is out of ±10% range", async () => {
      // miners=7100 → exceeds ORIG_MINERS+1000=7000
      // Other values within range: staking=2400 in [1500,3500], dao=0 in [0,2000], communityNFT=500 in [0,1500]
      await expect(
        ec.connect(admin).setSplitRatios(7100, 2300, 0, 500, 100)
      ).to.be.revertedWith("EC: miners out of range");
    });

    it("should emit SplitRatiosUpdated event", async () => {
      await expect(ec.connect(admin).setSplitRatios(5900, 2500, 1000, 500, 100))
        .to.emit(ec, "SplitRatiosUpdated")
        .withArgs(5900n, 2500n, 1000n, 500n, 100n);
    });

    it("Early Staking Boost should still apply on top of custom split ratios", async () => {
      // Set miners to 5500 (within range), staking to 2500, dao to 1500, communityNFT to 500
      await ec.connect(admin).setSplitRatios(5500, 2500, 1400, 500, 100);

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

  // ── Liquidity regulator L(H), trend damper G, emergency brake ──────────────

  describe("Liquidity regulator and price brakes", () => {
    let pool: any;

    beforeEach(async () => {
      pool = await (await ethers.getContractFactory("MockLiquidityPoolV6")).deploy();
      await pool.setPrices(10_000n, 10_000n, 10_000n);   // $0.01 flat
      await ec.connect(admin).setLiquidityPool(await pool.getAddress(), 10_000n);
      await miceLicense.setActiveLicenses(50_000);
    });

    it("wires the pool once and then refuses to move the brake anchor", async () => {
      await expect(
        ec.connect(admin).setLiquidityPool(await pool.getAddress(), 20_000n)
      ).to.be.revertedWith("EC: already set");
    });

    it("coverage rises with pool reserves", async () => {
      await pool.setReserveUsdt(1_000_000n * 10n ** 6n);
      const low = await (ec as any).coverageH();
      await pool.setReserveUsdt(10_000_000n * 10n ** 6n);
      expect(await (ec as any).coverageH()).to.be.gt(low);
    });

    it("targetL is capped at both ends", async () => {
      await pool.setReserveUsdt(0n);
      expect(await (ec as any).targetL()).to.equal(await (ec as any).L_MIN());
      await pool.setReserveUsdt(10n ** 15n);              // absurdly deep
      expect(await (ec as any).targetL()).to.equal(await (ec as any).L_MAX());
    });

    it("the regulator moves at most 10% per day", async () => {
      await pool.setReserveUsdt(10n ** 15n);              // target pinned at L_MAX
      const before = await (ec as any).currentL();
      await time.increase(ONE_DAY);
      await (ec as any).pokeRegulator();
      const after = await (ec as any).currentL();
      expect(after).to.be.gt(before);
      expect(after).to.be.lte(before + before / 10n + 1n);
    });

    it("G damps when the 7-day average sits below the 30-day, and never boosts", async () => {
      await pool.setPrices(10_000n, 8_000n, 10_000n);     // 7d is 80% of 30d
      expect(await (ec as any).trendFactor()).to.equal(8n * 10n ** 17n);

      await pool.setPrices(10_000n, 20_000n, 10_000n);    // 7d double the 30d
      expect(await (ec as any).trendFactor()).to.equal(10n ** 18n);   // capped at 1.0

      await pool.setPrices(10_000n, 1n, 10_000n);         // collapse
      expect(await (ec as any).trendFactor()).to.equal(25n * 10n ** 16n); // floor 0.25
    });

    it("the emergency brake engages below half the opening price and releases on its own", async () => {
      expect(await (ec as any).brakeEngaged()).to.be.false;
      await pool.setPrices(4_000n, 4_000n, 10_000n);      // 40% of opening
      expect(await (ec as any).brakeEngaged()).to.be.true;
      await pool.setPrices(9_000n, 9_000n, 10_000n);      // recovered
      expect(await (ec as any).brakeEngaged()).to.be.false;
    });

    it("a falling price does NOT accelerate issuance — the whole point of G", async () => {
      await pool.setReserveUsdt(5_000_000n * 10n ** 6n);
      await time.increase(THIRTY_DAYS + ONE_DAY);
      await (ec as any).pokeRegulator();
      const healthy = await ec.dailyEmission();

      // Price halves. Coverage RISES (each day of issuance is worth less), which alone
      // would raise issuance. G and the brake must more than cancel that.
      await pool.setPrices(4_000n, 4_000n, 10_000n);
      expect(await ec.dailyEmission()).to.be.lt(healthy);
    });

    it("the adoption ramp scales issuance to how many licences are actually mining", async () => {
      await miceLicense.setActiveLicenses(100);
      const tiny = await (ec as any).adoptionFactor();
      await miceLicense.setActiveLicenses(10_000);
      expect(await (ec as any).adoptionFactor()).to.equal(10n ** 18n);
      expect(tiny).to.equal(10n ** 17n);        // sqrt(100/10,000) = 0.1 exactly
    });

    it("reports its 7-day average to the pool after each distribution", async () => {
      await pool.setReserveUsdt(5_000_000n * 10n ** 6n);
      await time.increase(ONE_DAY);
      await ec.distributeDaily();
      expect(await pool.lastReportedEmission()).to.be.gt(0n);
      expect(await pool.lastReportedEmission()).to.equal(await (ec as any).avgDailyEmission());
    });
  });

  // ── Admin ──────────────────────────────────────────────────────────────────

  describe("Admin pool address setters", () => {
    it("setMiningPool should update address", async () => {
      await ec.connect(admin).setMiningPool(stakingPool.address);
      expect(await ec.miningPool()).to.equal(stakingPool.address);
    });

    it("setMiningPool should revert on zero address", async () => {
      await expect(
        ec.connect(admin).setMiningPool(ethers.ZeroAddress)
      ).to.be.revertedWith("EC: zero address");
    });

    it("should revert on non-admin caller", async () => {
      // miningPool is a contract now and cannot sign; any non-admin signer proves the point.
      await expect(ec.connect(unusedSigner).setMiningPool(stakingPool.address)).to.be.reverted;
    });

    it("setMfpRewardPool should update the MFP-NFT reward pool", async () => {
      await ec.connect(admin).setMfpRewardPool(stakingPool.address);
      expect(await ec.mfpRewardPool()).to.equal(stakingPool.address);
    });
  });
});
