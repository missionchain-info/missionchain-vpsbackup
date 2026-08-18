import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

/**
 * Differential fuzz for EmissionControllerV2.
 *
 * The model below is written from the SPEC (MISSIONCHAIN_SPEC_EMISSION_V2.md §1), not from
 * the Solidity. If the contract and the model disagree, one of them is wrong and the run
 * stops — which is the point. The V6 price bug survived 1,295 green tests precisely because
 * every one of them re-derived the implementation instead of restating the rule.
 */

const DAY = 86_400;
const RATE0 = 83_333333333333333333n;
const TERM = 360 * DAY;
const MAX_CATCHUP = 7 * DAY;
const MINING_POOL = ethers.parseEther("5950000000");

/** Deterministic PRNG — a failing seed must reproduce exactly. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x1_0000_0000;
  };
}

interface Model {
  rate: bigint;
  damperBps: bigint;
  minersBps: bigint;
  deployTime: number;
  lastDistribution: number;
  totalEmitted: bigint;
  minersPaid: bigint;
  /** licenceId -> expiry timestamp */
  live: Map<number, number>;
}

/** Miner share at `ts`: 49% ramping to 59% across the first 90 days. */
function minerBpsAt(m: Model, ts: number): bigint {
  const elapsed = ts - m.deployTime;
  if (elapsed >= 90 * DAY) return m.minersBps;
  return m.minersBps - (BigInt(90 - Math.floor(elapsed / DAY)) * 1000n) / 90n;
}

function activeAt(m: Model, ts: number): bigint {
  let n = 0n;
  for (const expiry of m.live.values()) if (expiry > ts) n += 1n;
  return n > 100_000n ? 100_000n : n;
}

/** The spec's rule, restated. E = N x r x elapsed / day / minerShare x damper, clipped. */
function modelDistribute(m: Model, ts: number, remaining: bigint) {
  let elapsed = ts - m.lastDistribution;
  if (elapsed > MAX_CATCHUP) elapsed = MAX_CATCHUP;
  const n = activeAt(m, ts);

  let emission = 0n;
  if (n > 0n && elapsed > 0) {
    const owedMiners = (n * m.rate * BigInt(elapsed)) / BigInt(DAY);
    emission = (owedMiners * 10_000n) / minerBpsAt(m, ts);
    emission = (emission * m.damperBps) / 10_000n;
    if (emission > remaining) emission = remaining;
  }

  m.lastDistribution = ts;
  if (emission === 0n) return { emission, elapsed, n, toMiners: 0n };

  const toMiners = (emission * minerBpsAt(m, ts)) / 10_000n;
  m.totalEmitted += emission;
  m.minersPaid += toMiners;
  return { emission, elapsed, n, toMiners };
}

describe("EmissionControllerV2 — differential fuzz", function () {
  this.timeout(600_000);

  const SEEDS = [1, 7, 42, 1337, 20260818];

  for (const seed of SEEDS) {
    it(`holds every invariant across 250 random operations (seed ${seed})`, async () => {
      const rand = rng(seed);
      const [admin, licencer, staking, dao, community, mfp, alice] = await ethers.getSigners();

      const mic = await (await ethers.getContractFactory("MICToken")).deploy(admin.address);
      const pool = await (await ethers.getContractFactory("MiningPool")).deploy(await mic.getAddress(), admin.address);
      const ec = await (await ethers.getContractFactory("EmissionControllerV2")).deploy(
        await mic.getAddress(), await pool.getAddress(),
        staking.address, dao.address, community.address, mfp.address, admin.address,
      );
      const poolAddr = await pool.getAddress();

      await mic.connect(admin).grantRole(await mic.MINTER_ROLE(), await ec.getAddress());
      await pool.connect(admin).grantRole(await pool.EMISSION_ROLE(), await ec.getAddress());
      await pool.connect(admin).grantRole(await pool.LICENCE_ROLE(), licencer.address);

      const m: Model = {
        rate: RATE0,
        damperBps: 10_000n,
        minersBps: 5900n,
        deployTime: Number(await ec.deployTime()),
        lastDistribution: Number(await ec.lastDistribution()),
        totalEmitted: 0n,
        minersPaid: 0n,
        live: new Map(),
      };

      let nextId = 0;
      /** MiningPool's expiry queue must be pushed in non-decreasing order. */
      let queueTail = 0;

      for (let step = 0; step < 250; step++) {
        const roll = rand();

        if (roll < 0.40) {
          // ── activate a batch of licences ──
          const count = 1 + Math.floor(rand() * 8);
          for (let i = 0; i < count; i++) {
            const now = await time.latest();
            // Vary the term so expiries interleave, but never break queue ordering.
            const span = Math.floor(rand() * TERM) + DAY;
            const expiry = Math.max(now + span, queueTail);
            await pool.connect(licencer).onLicenceActivated(nextId, alice.address, expiry);
            m.live.set(nextId, expiry);
            queueTail = expiry;
            nextId += 1;
          }

        } else if (roll < 0.85) {
          // ── advance time, then distribute ──
          const jump = DAY + Math.floor(rand() * 9 * DAY);
          await time.increase(jump);

          const nBefore = await ec.activeLicences();
          expect(nBefore, "active count must match the model").to.equal(
            activeAt(m, await time.latest()),
          );

          const remaining = await mic.remainingMiningPool();
          const rc = await (await ec.distributeDaily()).wait();
          const ts = await time.latest();
          const exp = modelDistribute(m, ts, remaining);

          const log = rc!.logs.find((l: any) => l.fragment?.name === "DailyDistributed");
          if (exp.emission === 0n) {
            expect(log, "no emission means no event").to.equal(undefined);
          } else {
            expect(log, "emission means an event").to.not.equal(undefined);
            const [, nEv, elapsedEv, mintedEv, toMinersEv, toStakingEv, toDaoEv, toCommEv, toMfpEv] = log!.args;

            expect(elapsedEv, "elapsed").to.equal(BigInt(exp.elapsed));
            expect(nEv, "N").to.equal(exp.n);
            expect(mintedEv, "emission").to.equal(exp.emission);
            expect(toMinersEv, "miner share").to.equal(exp.toMiners);

            // INVARIANT 1 — the five legs are exactly the amount minted. No dust escapes.
            expect(toMinersEv + toStakingEv + toDaoEv + toCommEv + toMfpEv).to.equal(mintedEv);

            // INVARIANT 2 — THE PROMISE. Miners are paid N x rate x elapsed, and the
            // gross-up to 100% is what funds the other four pools. This is the guard the
            // whole design exists to satisfy; nothing else in this file matters if it fails.
            // The damper is the one thing allowed to cut this, and it is off by default.
            const owed = (exp.n * m.rate * BigInt(exp.elapsed) * m.damperBps) / BigInt(DAY) / 10_000n;
            if (exp.emission < remaining) {
              expect(toMinersEv, "miners must receive N x rate x elapsed x damper").to.be.closeTo(owed, 10n);
            }

            // INVARIANT 3 — per-licence pay is independent of how many licences there are.
            if (exp.n > 0n && exp.emission < remaining) {
              expect(toMinersEv / exp.n, "per-licence pay must not move with N").to.be.closeTo(
                (m.rate * BigInt(exp.elapsed) * m.damperBps) / BigInt(DAY) / 10_000n, 10n,
              );
            }

            // INVARIANT 3b — with the damper released, the published rate is paid in full.
            if (m.damperBps === 10_000n && exp.n > 0n && exp.emission < remaining) {
              expect(toMinersEv / exp.n, "undamped pay must equal the published rate").to.be.closeTo(
                (m.rate * BigInt(exp.elapsed)) / BigInt(DAY), 10n,
              );
            }
          }

          // INVARIANT 4 — cumulative issuance tracks the model exactly.
          expect(await ec.totalEmitted(), "cumulative emission").to.equal(m.totalEmitted);

          // INVARIANT 5 — the mining allocation is never breached.
          expect(await mic.totalMiningMinted()).to.be.lte(MINING_POOL);
          expect(await mic.remainingMiningPool()).to.equal(MINING_POOL - m.totalEmitted);

          // INVARIANT 6 — every MIC minted for miners is sitting in the pool, unspent.
          expect(await mic.balanceOf(poolAddr)).to.equal(m.minersPaid);

        } else if (roll < 0.92) {
          // ── governance moves the rate ──
          const rate = ethers.parseEther(String(1 + Math.floor(rand() * 499)));
          await ec.connect(admin).setMicPerLicencePerDay(rate);
          m.rate = rate;

        } else if (roll < 0.97) {
          // ── governance engages or releases the damper ──
          const bps = BigInt(2500 + Math.floor(rand() * 7501));
          await ec.connect(admin).setDamperBps(bps);
          m.damperBps = bps;

        } else {
          // ── a keeper syncs the pool between distributions ──
          await pool.sync();
        }

        // INVARIANT 7 — bounds hold no matter what governance did.
        const r = await ec.micPerLicencePerDay();
        expect(r).to.be.gte(ethers.parseEther("1"));
        expect(r).to.be.lte(ethers.parseEther("500"));
        const d = await ec.damperBps();
        expect(d).to.be.gte(2500n);
        expect(d).to.be.lte(10_000n);
      }

      // The run must actually have exercised the thing, not idled.
      expect(m.totalEmitted, "fuzz run emitted nothing — the run was vacuous").to.be.gt(0n);
      expect(nextId, "fuzz run activated nothing").to.be.gt(0);
    });
  }

  it("a falling MIC price cannot raise issuance — there is no price input at all", async () => {
    // The spiral this design was rewritten to remove: with r = pricePaid / price / 120,
    // MIC at $0.001 would demand 58B MIC against a 5.95B pool. Assert structurally that
    // no price can reach the reward path.
    const src = await ethers.getContractFactory("EmissionControllerV2");
    const iface = src.interface;
    for (const f of iface.fragments) {
      const name = (f as any).name ?? "";
      expect(name.toLowerCase(), `${name} looks like a price input`).to.not.match(
        /twap|spot|price|oracle|coverage/,
      );
    }
  });
});
