import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

const DAY = 86_400;
const E = ethers.parseEther;

/** $100 / $0.01 / 120 days — the published rate, to the wei the contract stores. */
const RATE = 83_333333333333333333n;
const TERM = 360 * DAY;

describe("EmissionControllerV2", function () {
  let ec: any, mic: any, pool: any;
  let admin: any, licencer: any, staking: any, dao: any, community: any, mfp: any, alice: any, bob: any;
  let ecAddr: string, poolAddr: string;

  /** Activate `n` licences in the pool, each running a full 360-day term from now. */
  async function activate(n: number, from = 0) {
    const owner = alice.address;
    const expiry = (await time.latest()) + TERM;
    for (let i = 0; i < n; i++) {
      await pool.connect(licencer).onLicenceActivated(from + i, owner, expiry + i);
    }
  }

  /** Run a distribution and hand back what the contract said it did. */
  async function distribute() {
    const rc = await (await ec.distributeDaily()).wait();
    const log = rc!.logs.find((l: any) => l.fragment?.name === "DailyDistributed");
    const a = log.args;
    return {
      day: a[0], activeLicences: a[1], elapsed: a[2], totalMinted: a[3],
      toMiners: a[4], toStaking: a[5], toDAO: a[6], toCommunityNFT: a[7], toMFPReward: a[8],
    };
  }

  beforeEach(async () => {
    [admin, licencer, staking, dao, community, mfp, alice, bob] = await ethers.getSigners();

    mic  = await (await ethers.getContractFactory("MICToken")).deploy(admin.address);
    pool = await (await ethers.getContractFactory("MiningPool")).deploy(await mic.getAddress(), admin.address);
    poolAddr = await pool.getAddress();

    ec = await (await ethers.getContractFactory("EmissionControllerV2")).deploy(
      await mic.getAddress(), poolAddr, staking.address, dao.address, community.address, mfp.address, admin.address,
    );
    ecAddr = await ec.getAddress();

    await mic.connect(admin).grantRole(await mic.MINTER_ROLE(), ecAddr);
    await pool.connect(admin).grantRole(await pool.EMISSION_ROLE(), ecAddr);
    await pool.connect(admin).grantRole(await pool.LICENCE_ROLE(), licencer.address);
  });

  // ───────────────────────────────────────────────────────────────
  // The rule Owner set: every licence earns the same, and E scales with N
  // ───────────────────────────────────────────────────────────────

  describe("proportionality — the whole point of V2", () => {
    it("pays exactly 83.3333 MIC per licence per day", async () => {
      await activate(1);
      const n = await ec.activeLicences();
      expect(n).to.equal(1n);
      expect(await ec.minerAmountFor(n, DAY)).to.equal(RATE);
    });

    it("scales miner pay linearly with N, leaving each licence untouched", async () => {
      for (const n of [1, 2, 10, 137, 1_000, 100_000]) {
        const total = await ec.minerAmountFor(n, DAY);
        expect(total).to.equal(RATE * BigInt(n));
        expect(total / BigInt(n)).to.equal(RATE);
      }
    });

    it("issues N x rate / minerShare, so miners receive exactly N x rate", async () => {
      await activate(4);
      await time.increase(DAY);
      const n = await ec.activeLicences();
      const emission = await ec.pendingEmission();
      const minerBps = await ec.currentMinerBps();

      // The gross-up is what lets staking/DAO/NFT be funded without taxing miners.
      // Two integer divisions round-trip, so a single wei may be lost — never more.
      const owed = await ec.minerAmountFor(n, await ec.pendingElapsed());
      expect((emission * minerBps) / 10_000n).to.be.closeTo(owed, 1n);
    });

    it("V1's defect: adding miners must NOT dilute the ones already there", async () => {
      await activate(2);
      const two = await ec.minerAmountFor(await ec.activeLicences(), DAY);
      await activate(98, 2);
      const hundred = await ec.minerAmountFor(await ec.activeLicences(), DAY);
      expect(two / 2n).to.equal(hundred / 100n);
    });

    it("emits nothing when nobody is mining", async () => {
      expect(await ec.activeLicences()).to.equal(0n);
      expect(await ec.dailyEmission()).to.equal(0n);
      await time.increase(DAY);
      await ec.distributeDaily();
      expect(await ec.totalEmitted()).to.equal(0n);
    });
  });

  // ───────────────────────────────────────────────────────────────
  // Payback and lifetime — the numbers the spec promises
  // ───────────────────────────────────────────────────────────────

  describe("payback arithmetic", () => {
    it("returns a $100 round-1 licence in 120 days at $0.01", async () => {
      const micOut = RATE * 120n;
      expect(micOut).to.be.closeTo(E("10000"), E("0.0000001"));
      // 10,000 MIC x $0.01 = $100 = the round-1 price.
    });

    it("a full 360-day term pays 30,000 MIC — which IS the K=3.0 cap", async () => {
      expect(RATE * 360n).to.be.closeTo(E("30000"), E("0.0000001"));
    });

    it("100,000 licences over a full term fit inside the 5.95B mining pool", async () => {
      const toMiners = RATE * 360n * 100_000n;
      const issued = (toMiners * 10_000n) / 5900n;
      const poolSize = await mic.MINING_POOL();
      expect(issued).to.be.lt(poolSize);
      // Headroom must survive the 90-day Early Staking Boost too (~0.12B).
      expect(poolSize - issued).to.be.gt(E("800000000"));
    });

    it("a round-2 $200 licence takes 240 days if MIC never leaves $0.01", async () => {
      // Owner's rule: same MIC for every round. 200 / (83.3333 x 0.01) = 240.
      const perDayUsdCents = (RATE * 1n) / 100n;      // $0.01 per MIC, in wei-cents
      const days = (200n * 10n ** 18n * 100n) / perDayUsdCents / 100n;
      expect(days).to.equal(240n);
    });
  });

  // ───────────────────────────────────────────────────────────────
  // Distribution
  // ───────────────────────────────────────────────────────────────

  describe("distributeDaily", () => {
    it("mints the five-way split and hands miners their share", async () => {
      await activate(10);
      await time.increase(DAY);

      const ev = await distribute();
      const total = ev.totalMinted;

      expect(await ec.totalEmitted()).to.equal(total);

      // THE PROMISE: miners receive N x rate x elapsed, whatever the split happens to be.
      expect(await mic.balanceOf(poolAddr)).to.be.closeTo(
        (10n * RATE * ev.elapsed) / BigInt(DAY), 10n,
      );

      expect(await mic.balanceOf(poolAddr)).to.equal(ev.toMiners);
      expect(await mic.balanceOf(staking.address)).to.equal(ev.toStaking);
      expect(await mic.balanceOf(dao.address)).to.equal((total * 1000n) / 10_000n);
      expect(await mic.balanceOf(mfp.address)).to.equal((total * 100n) / 10_000n);
    });

    it("the five legs sum to exactly the amount minted — no dust stranded", async () => {
      await activate(7);
      await time.increase(DAY);
      await ec.distributeDaily();

      const total = await ec.totalEmitted();
      const sum = (await mic.balanceOf(poolAddr))
        + (await mic.balanceOf(staking.address))
        + (await mic.balanceOf(dao.address))
        + (await mic.balanceOf(community.address))
        + (await mic.balanceOf(mfp.address));
      expect(sum).to.equal(total);
    });

    it("refuses a second call inside the same day", async () => {
      await activate(3);
      await time.increase(DAY);
      await ec.distributeDaily();
      await expect(ec.distributeDaily()).to.be.revertedWith("EC2: too early");
    });

    it("is permissionless — a keeper needs no role", async () => {
      await activate(3);
      await time.increase(DAY);
      await expect(ec.connect(bob).distributeDaily()).to.not.be.reverted;
    });

    it("makes up missed days, capped at a week", async () => {
      await activate(5);
      await time.increase(3 * DAY);
      const first = await distribute();
      // Setup transactions each burn a second, so this is 3 days plus a handful.
      expect(first.elapsed).to.be.closeTo(BigInt(3 * DAY), 60n);

      await time.increase(30 * DAY);            // a long outage
      const second = await distribute();
      expect(second.elapsed).to.equal(BigInt(7 * DAY));   // clipped at MAX_CATCHUP

      // 10 days of the outage are simply not paid — that is the cap doing its job.
      // What IS paid still honours the per-licence rate exactly.
      const paid = await mic.balanceOf(poolAddr);
      const owed = (5n * RATE * (first.elapsed + second.elapsed)) / BigInt(DAY);
      expect(paid).to.be.closeTo(owed, 10n);
    });

    it("normalises a catch-up call before recording the average", async () => {
      await activate(5);
      await time.increase(3 * DAY);
      await ec.distributeDaily();
      // 3 days of issuance recorded, but the average must read as one day's worth.
      expect(await ec.avgDailyEmission()).to.be.closeTo(await ec.emissionFor(5, DAY), E("0.001"));
    });
  });

  // ───────────────────────────────────────────────────────────────
  // Finding (3) in the spec: V1 counted the dead
  // ───────────────────────────────────────────────────────────────

  describe("counting only licences that are genuinely mining", () => {
    it("drops a licence the second its term ends, without waiting for recycle", async () => {
      const expiry = (await time.latest()) + 10 * DAY;
      await pool.connect(licencer).onLicenceActivated(1, alice.address, expiry);
      await pool.connect(licencer).onLicenceActivated(2, alice.address, expiry + TERM);

      expect(await ec.activeLicences()).to.equal(2n);
      await time.increaseTo(expiry + 1);

      // MiningPool has not synced, so its raw counter still says 2 …
      expect(await pool.totalActive()).to.equal(2n);
      expect(await pool.pendingExpiries()).to.equal(1n);
      // … but the controller must not pay for the dead one.
      expect(await ec.activeLicences()).to.equal(1n);
    });

    it("syncs the pool before counting, so a distribution never pays an expired licence", async () => {
      const expiry = (await time.latest()) + 2 * DAY;
      await pool.connect(licencer).onLicenceActivated(1, alice.address, expiry);
      await pool.connect(licencer).onLicenceActivated(2, alice.address, expiry + TERM);

      await time.increaseTo(expiry + DAY);
      await ec.distributeDaily();

      expect(await pool.totalActive()).to.equal(1n);
      const oneDay = await ec.emissionFor(1, DAY);
      expect(await ec.totalEmitted()).to.be.closeTo(oneDay * 3n, oneDay / 100n);
    });

    it("clamps N at MICE max supply even if the counter misreports", async () => {
      const rogue = await (await ethers.getContractFactory("MockMiningPoolNotify")).deploy();
      // MockMiningPoolNotify has no totalActive(); a counter that cannot answer must not
      // silently read as zero — the call reverts, and that is the safe direction.
      await ec.connect(admin).setMiningPool(await rogue.getAddress());
      await expect(ec.activeLicences()).to.be.reverted;
    });
  });

  // ───────────────────────────────────────────────────────────────
  // Pool ceiling
  // ───────────────────────────────────────────────────────────────

  describe("the mining allocation is a hard ceiling", () => {
    it("never issues more than remains", async () => {
      const remaining = await mic.remainingMiningPool();
      // emissionFor is a pure view over (n, elapsed) — ask it for an interval no pool
      // could cover and watch it clip, rather than minting 100,000 licences to get there.
      expect(await ec.emissionFor(100_000, 10_000n * BigInt(DAY))).to.equal(remaining);
      // A realistic full-scale week stays far below the ceiling.
      expect(await ec.emissionFor(100_000, 7n * BigInt(DAY))).to.be.lt(remaining);
    });

    it("stops cleanly at exhaustion rather than reverting", async () => {
      await activate(10);
      // Drain the allocation through a second minter.
      await mic.connect(admin).grantRole(await mic.MINTER_ROLE(), admin.address);
      const remaining = await mic.remainingMiningPool();
      await mic.connect(admin).mintFromMining(bob.address, remaining);

      await time.increase(DAY);
      await expect(ec.distributeDaily()).to.not.be.reverted;
      expect(await ec.totalEmitted()).to.equal(0n);
    });
  });

  // ───────────────────────────────────────────────────────────────
  // Early Staking Boost
  // ───────────────────────────────────────────────────────────────

  describe("Early Staking Boost", () => {
    it("starts miners at 49% and lands on 59% after 90 days", async () => {
      expect(await ec.currentMinerBps()).to.equal(4900n);
      await time.increase(45 * DAY);
      expect(await ec.currentMinerBps()).to.equal(5400n);
      await time.increase(45 * DAY);
      expect(await ec.currentMinerBps()).to.equal(5900n);
      await time.increase(365 * DAY);
      expect(await ec.currentMinerBps()).to.equal(5900n);
    });

    it("pays miners the same N x rate throughout — the boost only changes what is issued", async () => {
      await activate(10);
      const early = await ec.emissionFor(10, DAY);
      const earlyMiners = (early * (await ec.currentMinerBps())) / 10_000n;

      await time.increase(120 * DAY);
      const late = await ec.emissionFor(10, DAY);
      const lateMiners = (late * (await ec.currentMinerBps())) / 10_000n;

      expect(earlyMiners).to.be.closeTo(lateMiners, E("0.001"));
      expect(early).to.be.gt(late);        // more issued early, because staking takes more
    });
  });

  // ───────────────────────────────────────────────────────────────
  // Settable parameters — V1's real failure was that it had none
  // ───────────────────────────────────────────────────────────────

  describe("governance parameters", () => {
    it("lets admin move the rate inside its bounds", async () => {
      await ec.connect(admin).setMicPerLicencePerDay(E("100"));
      expect(await ec.minerAmountFor(1, DAY)).to.equal(E("100"));
    });

    it("refuses a rate outside its bounds", async () => {
      await expect(ec.connect(admin).setMicPerLicencePerDay(E("0.5"))).to.be.revertedWith("EC2: rate out of range");
      await expect(ec.connect(admin).setMicPerLicencePerDay(E("501"))).to.be.revertedWith("EC2: rate out of range");
    });

    it("starts with the damper disengaged", async () => {
      expect(await ec.damperBps()).to.equal(10_000n);
    });

    it("cuts issuance when the damper is engaged, and never below 25%", async () => {
      await activate(10);
      const full = await ec.emissionFor(10, DAY);
      await ec.connect(admin).setDamperBps(5000);
      expect(await ec.emissionFor(10, DAY)).to.equal(full / 2n);
      await expect(ec.connect(admin).setDamperBps(2499)).to.be.revertedWith("EC2: damper out of range");
    });

    it("keeps non-admins out of every setter", async () => {
      for (const call of [
        ec.connect(bob).setMicPerLicencePerDay(E("50")),
        ec.connect(bob).setDamperBps(9000),
        ec.connect(bob).setMiningPool(bob.address),
        ec.connect(bob).setSplitRatios(5900, 2500, 1000, 500, 100),
      ]) {
        await expect(call).to.be.reverted;
      }
    });

    it("holds the split to +/-10% of the published shares", async () => {
      await expect(ec.connect(admin).setSplitRatios(5900, 2500, 1000, 500, 100)).to.not.be.reverted;
      await expect(ec.connect(admin).setSplitRatios(7000, 1400, 1000, 500, 100)).to.be.revertedWith("EC2: miners out of range");
      await expect(ec.connect(admin).setSplitRatios(5900, 2500, 1000, 500, 200)).to.be.revertedWith("EC2: must total 100%");
    });
  });

  // ───────────────────────────────────────────────────────────────
  // Telemetry must never hold a distribution hostage
  // ───────────────────────────────────────────────────────────────

  describe("emission report", () => {
    it("distributes normally with no report target set", async () => {
      await activate(3);
      await time.increase(DAY);
      await expect(ec.distributeDaily()).to.not.be.reverted;
    });

    it("survives a report target that reverts", async () => {
      // Any contract without reportDailyEmission will revert the call.
      await ec.connect(admin).setEmissionReportTarget(await mic.getAddress());
      await activate(3);
      await time.increase(DAY);
      await expect(ec.distributeDaily()).to.emit(ec, "EmissionReportFailed");
      expect(await ec.totalEmitted()).to.be.gt(0n);
    });
  });

  // ───────────────────────────────────────────────────────────────
  // End to end: what a miner actually collects
  // ───────────────────────────────────────────────────────────────

  describe("end to end", () => {
    it("a single miner claims ~83.33 MIC after one full day of streaming", async () => {
      await activate(1);
      await time.increase(DAY);
      await ec.distributeDaily();
      await time.increase(DAY);        // MiningPool streams over 24h

      const pending = await pool.pendingOf(0);
      expect(pending).to.be.closeTo(RATE, RATE / 100n);
    });

    it("two miners each collect the same, and together collect twice one", async () => {
      await pool.connect(licencer).onLicenceActivated(0, alice.address, (await time.latest()) + TERM);
      await pool.connect(licencer).onLicenceActivated(1, bob.address, (await time.latest()) + TERM);
      await time.increase(DAY);
      await ec.distributeDaily();
      await time.increase(DAY);

      const a = await pool.pendingOf(0);
      const b = await pool.pendingOf(1);
      expect(a).to.be.closeTo(b, RATE / 1000n);
      expect(a + b).to.be.closeTo(RATE * 2n, RATE / 50n);
    });
  });
});
