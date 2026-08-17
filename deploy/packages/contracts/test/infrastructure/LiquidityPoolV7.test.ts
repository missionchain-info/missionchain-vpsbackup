import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

const DAY = 86_400;
// 18 decimals — BSC-USD, which MockUSDT mirrors.
const usd = (n: string | number) => ethers.parseUnits(String(n), 18);
const e18 = (n: string | number) => ethers.parseEther(String(n));

// The exact deployment parameters, so the suite exercises what actually ships.
const M0  = e18("23500000");        // 23,500,000 MIC — all the movable MIC that exists
const P0  = usd("0.01");            // $0.01 per MIC — the published opening price
const UV0 = usd("235000");          // virtual reserve = P0 × M0 = $235,000
const BUY = usd("2000");            // a normal buy; 1% of the float is ~$2,357
const GATE = usd("25000");          // real USDT that opens the sell side (Owner)
const GATE_USDT = GATE;

// Mainnet state of LiquidityPoolV6 0xf6AB…C98e, read from chain 2026-08-17.
const LIVE_MIC  = e18("49999900.300198801403590001");
const LIVE_USDT = usd("10");
const LIVE_UV0  = usd("500000");    // V6's own virtualReserve0, on chain

/** The formula the Owner signed off: whole pool over whole float, flat within a trade. */
const expectedOut = (usdtIn: bigint, reserveMic: bigint, eff: bigint) => {
  const inNet = usdtIn - (usdtIn * 30n) / 10_000n;
  return (inNet * reserveMic) / eff;
};

describe("LiquidityPoolV7", () => {
  let pool: any, usdt: any, mic: any;
  let admin: any, router: any, emitter: any, alice: any, bob: any;

  const deploy = async (): Promise<any> => {
    const p: any = await (await ethers.getContractFactory("LiquidityPoolV7"))
      .deploy(await usdt.getAddress(), await mic.getAddress(), UV0, GATE, admin.address);
    await p.connect(admin).grantRole(await p.DISTRIBUTOR_ROLE(), router.address);
    await p.connect(admin).grantRole(await p.EMISSION_REPORTER_ROLE(), emitter.address);
    return p;
  };

  beforeEach(async () => {
    [admin, router, emitter, alice, bob] = await ethers.getSigners();

    usdt = await (await ethers.getContractFactory("MockUSDT")).deploy();
    mic  = await (await ethers.getContractFactory("MICToken")).deploy(admin.address);

    pool = await deploy();
    await mic.connect(admin).approve(await pool.getAddress(), ethers.MaxUint256);
    await pool.connect(admin).seedMic(M0);

    for (const who of [alice, bob, router]) {
      await usdt.mint(who.address, usd("50000000"));
      await usdt.connect(who).approve(await pool.getAddress(), ethers.MaxUint256);
      await mic.connect(who).approve(await pool.getAddress(), ethers.MaxUint256);
    }
  });

  // ── Acceptance: the numbers in MISSIONCHAIN_BUILD_SWAP_V7.md ───────────────

  describe("The $0.02 regression", () => {
    /** Rebuilds the exact mainnet reserves: 49,999,900.3 MIC against $10 real USDT. */
    const liveState = async (factory: string): Promise<any> => {
      const isV7 = factory === "LiquidityPoolV7";
      const args: any[] = isV7
        ? [await usdt.getAddress(), await mic.getAddress(), LIVE_UV0, GATE, admin.address]
        : [await usdt.getAddress(), await mic.getAddress(), LIVE_UV0, admin.address];
      const p: any = await (await ethers.getContractFactory(factory)).deploy(...args);
      await p.connect(admin).grantRole(await p.DISTRIBUTOR_ROLE(), router.address);
      await mic.connect(admin).approve(await p.getAddress(), ethers.MaxUint256);
      await p.connect(admin).seedMic(LIVE_MIC);
      await usdt.connect(router).approve(await p.getAddress(), ethers.MaxUint256);
      await p.connect(router).receiveUSDT(LIVE_USDT);
      return p;
    };

    it("reproduces the live pool's reserves exactly", async () => {
      const p = await liveState("LiquidityPoolV7");
      expect(await p.reserveMic()).to.equal(LIVE_MIC);
      expect(await p.reserveUsdt()).to.equal(LIVE_USDT);
      // One-for-one: $10 of real USDT displaced $10 of virtual, total unchanged.
      expect(await p.virtualReserve()).to.equal(usd("499990"));
      expect(await p.effectiveUsdt()).to.equal(LIVE_UV0);
      // spotPrice was never the broken part — it read correctly on V6 too.
      expect(Number(ethers.formatEther(await p.spotPrice()))).to.be.closeTo(0.01, 1e-6);
    });

    it("hits the acceptance table: $1→99.70, $10→997.0, $50→4985 MIC", async () => {
      const p = await liveState("LiquidityPoolV7");
      for (const [amount, want] of [["1", 99.70], ["10", 997.0], ["50", 4985]] as const) {
        const out = Number(ethers.formatEther(await p.quoteBuy(usd(amount))));
        expect(out).to.be.closeTo(want, want * 0.0005);
        expect(Number(amount) / out).to.be.closeTo(0.01003, 1e-5);   // $0.01 + 0.3% fee
      }
    });

    it("is flat across $1, $10 and $50 — the spread must be ~0", async () => {
      const p = await liveState("LiquidityPoolV7");
      const unit = async (a: string) =>
        Number(a) / Number(ethers.formatEther(await p.quoteBuy(usd(a))));
      const [one, ten, fifty] = [await unit("1"), await unit("10"), await unit("50")];
      expect(Math.abs(fifty - one)).to.be.lt(1e-9);
      expect(Math.abs(ten - one)).to.be.lt(1e-9);
    });

    it("delivers exactly twice what the deployed V6 delivers", async () => {
      const v7 = await liveState("LiquidityPoolV7");
      const v6 = await liveState("LiquidityPoolV6");
      for (const [amount, want6] of [["1", 49.8494], ["10", 498.4891], ["50", 2492.3459]] as const) {
        const got6 = await v6.quoteBuy(usd(amount));
        const got7 = await v7.quoteBuy(usd(amount));
        // The measured V6 figures from the issue report, reproduced.
        expect(Number(ethers.formatEther(got6))).to.be.closeTo(want6, 0.001);
        expect(Number(got7) / Number(got6)).to.be.closeTo(2, 0.002);
      }
    });
  });

  // ── The formula, stated directly ───────────────────────────────────────────

  describe("Linear pricing", () => {
    it("is effectiveUsdt / reserveMic, on the reserves before the trade", async () => {
      const eff = await pool.effectiveUsdt();
      const rm  = await pool.reserveMic();
      for (const amt of ["1", "137.42", "4000"]) {
        expect(await pool.quoteBuy(usd(amt))).to.equal(expectedOut(usd(amt), rm, eff));
      }
    });

    it("opens at exactly $0.01", async () => {
      expect(await pool.spotPrice()).to.equal(P0);
      expect(await pool.reserveUsdt()).to.equal(0n);
      expect(await pool.virtualReserve()).to.equal(UV0);
    });

    it("agrees with spotPrice", async () => {
      const out = await pool.quoteBuy(usd("1000"));
      const net = usd("1000") - (usd("1000") * 30n) / 10_000n;
      expect(out).to.equal((net * 10n ** 18n) / (await pool.spotPrice()));
    });

    it("delivers exactly what it quoted — quote and swap are one function", async () => {
      const quoted = await pool.quoteBuy(BUY);
      const before = await mic.balanceOf(alice.address);
      await pool.connect(alice).swapUsdtToMic(BUY, 0);
      expect(await mic.balanceOf(alice.address) - before).to.equal(quoted);
    });

    it("does not use V6's denominator", async () => {
      const eff = await pool.effectiveUsdt();
      const rm  = await pool.reserveMic();
      const inNet = BUY - (BUY * 30n) / 10_000n;
      // What V6 would have returned: constant product over the half-stepped denominator.
      const v6Style = rm - (eff * rm) / (eff + inNet / 2n);
      const quoted  = await pool.quoteBuy(BUY);
      expect(quoted).to.equal(expectedOut(BUY, rm, eff));
      // ~2.008 rather than a clean 2.000: $4,000 is 0.8% of this pool, and V6's constant
      // product bends a little at that size. On the live pool a $50 trade is 0.01% of the
      // book and the factor is 2.000 flat — see the regression suite above.
      expect(Number(quoted) / Number(v6Style)).to.be.closeTo(2, 0.02);
    });
  });

  // ── The 50% rule: right mechanism, now in the right place ──────────────────

  describe("Virtual → real substitution", () => {
    it("retires virtual one-for-one with real inflow", async () => {
      await pool.connect(router).receiveUSDT(usd("100000"));
      expect(await pool.virtualReserve()).to.equal(UV0 - usd("100000"));
    });

    it("holds the effective side perfectly still while substituting", async () => {
      // This is the whole point of one-for-one: money arriving changes what the backing
      // is made of, never how much of it there is.
      for (const push of ["1000", "50000", "100000", "83999"]) {
        await pool.connect(router).receiveUSDT(usd(push));
        expect(await pool.effectiveUsdt()).to.equal(UV0);
      }
      expect(await pool.reserveUsdt()).to.equal(usd("234999"));
      expect(await pool.virtualReserve()).to.equal(usd("1"));
    });

    it("a deposit alone does not move the price — only MIC leaving does", async () => {
      const before = await pool.spotPrice();
      await pool.connect(router).receiveUSDT(usd("100000"));
      expect(await pool.reserveMic()).to.equal(M0);
      expect(await pool.spotPrice()).to.equal(before);      // exactly, not approximately
    });

    it("after a buy: reserveUsdt +100%, virtualReserve −100%, total unchanged", async () => {
      await pool.connect(alice).swapUsdtToMic(BUY, 0);
      expect(await pool.reserveUsdt()).to.equal(BUY);       // the whole payment, fee included
      expect(await pool.virtualReserve()).to.equal(UV0 - BUY);
      expect(await pool.effectiveUsdt()).to.equal(UV0);
    });

    it("holds across a run of buys", async () => {
      for (let i = 0; i < 6; i++) {
        await pool.connect(i % 2 ? bob : alice).swapUsdtToMic(usd("1000"), 0);
      }
      expect(await pool.reserveUsdt()).to.equal(usd("6000"));
      expect(await pool.virtualReserve()).to.equal(UV0 - usd("6000"));
      expect(await pool.effectiveUsdt()).to.equal(UV0);
    });

    it("reaches zero at its own size, and never goes negative", async () => {
      await pool.connect(router).receiveUSDT(UV0);
      expect(await pool.virtualReserve()).to.equal(0n);
      expect(await pool.effectiveUsdt()).to.equal(UV0);
      await pool.connect(router).receiveUSDT(usd("500000"));
      expect(await pool.virtualReserve()).to.equal(0n);
      // Free from here on: the curve is real capital only, and grows with it.
      expect(await pool.effectiveUsdt()).to.equal(UV0 + usd("500000"));
    });

    it("never un-retires when USDT later leaves", async () => {
      await pool.connect(router).receiveUSDT(UV0);
      await pool.advancePhase();
      const chunk = (await pool.reserveMic()) / 200n;
      await mic.connect(admin).transfer(alice.address, chunk);
      await pool.connect(alice).swapMicToUsdt(chunk, 0);
      expect(await pool.reserveUsdt()).to.be.lt(UV0);
      expect(await pool.virtualReserve()).to.equal(0n);     // high-water is one-way
    });

    it("moves the price up slowly and in proportion — no step", async () => {
      let prev = await pool.spotPrice();
      for (let i = 0; i < 8; i++) {
        await pool.connect(i % 2 ? bob : alice).swapUsdtToMic(usd("1000"), 0);
        const now = await pool.spotPrice();
        expect(now).to.be.gt(prev);
        expect(now).to.be.lt((prev * 10_100n) / 10_000n);
        prev = now;
      }
    });

    it("is never consulted while quoting", async () => {
      const a = await pool.quoteBuy(BUY);
      const b = await pool.quoteBuy(BUY);
      expect(a).to.equal(b);
    });
  });

  // ── Sell gate: real reserves, not the calendar ─────────────────────────────

  describe("Sell gate", () => {
    it("publishes the gate as a USDT figure, not a date", async () => {
      expect(await pool.sellGateUsdt()).to.equal(GATE);
      expect(GATE).to.equal(usd("25000"));
      expect(await pool.sellsOpen()).to.equal(false);
      expect(await pool.phase()).to.equal(0);
    });

    it("keeps sells shut on day one", async () => {
      await expect(pool.connect(alice).swapMicToUsdt(e18("1000"), 0))
        .to.be.revertedWith("LP7: sells not open");
      await expect(pool.advancePhase()).to.be.revertedWith("LP7: condition not met");
      expect(await pool.quoteSell(e18("1000"))).to.equal(0n);
      expect(await pool.maxSellNow()).to.equal(0n);
    });

    it("stays shut long past the day V6 would have opened", async () => {
      await time.increase(400 * DAY);
      await pool.poke();
      await expect(pool.advancePhase()).to.be.revertedWith("LP7: condition not met");
      expect(await pool.sellsOpen()).to.equal(false);
    });

    it("stays shut one dollar short of the gate", async () => {
      await pool.connect(router).receiveUSDT(GATE - usd("1"));
      await expect(pool.advancePhase()).to.be.revertedWith("LP7: condition not met");
    });

    it("opens the moment real USDT reaches the gate, callable by anyone", async () => {
      await pool.connect(router).receiveUSDT(GATE);
      await pool.connect(alice).advancePhase();          // no permission needed
      expect(await pool.sellsOpen()).to.equal(true);
      expect(await pool.phase()).to.equal(1);
    });

    it("measures against the high-water mark, so a drain cannot re-close it", async () => {
      await pool.connect(router).receiveUSDT(GATE);
      await pool.advancePhase();
      const chunk = await pool.maxSellNow();
      await mic.connect(admin).transfer(alice.address, chunk);
      await pool.connect(alice).swapMicToUsdt(chunk, 0);
      expect(await pool.reserveUsdt()).to.be.lt(GATE);
      expect(await pool.sellsOpen()).to.equal(true);
    });

    it("keeps SELL_OPEN_DAY in the ABI but no longer obeys it", async () => {
      expect(await pool.SELL_OPEN_DAY()).to.equal(30n);
      await time.increase(31 * DAY);
      await expect(pool.advancePhase()).to.be.revertedWith("LP7: condition not met");
    });

    it("refuses a gate above the virtual reserve", async () => {
      await expect(
        (await ethers.getContractFactory("LiquidityPoolV7"))
          .deploy(await usdt.getAddress(), await mic.getAddress(), UV0, UV0 + 1n, admin.address)
      ).to.be.revertedWith("LP7: gate above virtual reserve");
    });
  });

  // ── Sell fee tracks how much of the pool is real ───────────────────────────

  describe("Sell fee follows backing", () => {
    const feeAt = async (realUsdt: bigint) => {
      const p: any = await deploy();
      await mic.connect(admin).approve(await p.getAddress(), ethers.MaxUint256);
      await p.connect(admin).seedMic(M0);
      await usdt.connect(router).approve(await p.getAddress(), ethers.MaxUint256);
      if (realUsdt > 0n) await p.connect(router).receiveUSDT(realUsdt);
      return { fee: await p.sellFeeBps(), backing: await p.backingBps() };
    };

    it("is the full 15% when the pool is almost entirely virtual", async () => {
      const { fee, backing } = await feeAt(0n);
      expect(backing).to.equal(0n);
      expect(fee).to.equal(1500n);
    });

    it("is ~13.4% at the $25,000 gate, where 89% of the depth is still virtual", async () => {
      const { fee, backing } = await feeAt(GATE);
      expect(Number(backing) / 100).to.be.closeTo(10.6, 0.2);   // ~10.6% backed
      expect(Number(fee) / 100).to.be.closeTo(13.4, 0.1);       // ~13.4%
    });

    it("falls as real capital replaces virtual", async () => {
      const points = [usd("50000"), usd("100000"), usd("150000"), usd("200000")];
      let prev = 1500n;
      for (const p of points) {
        const { fee } = await feeAt(p);
        expect(fee).to.be.lt(prev);
        prev = fee;
      }
    });

    it("reaches 0% once the pool is fully backed", async () => {
      const { fee, backing } = await feeAt(UV0);
      expect(backing).to.equal(10_000n);
      expect(fee).to.equal(0n);
    });

    it("does not depend on EmissionController reporting anything", async () => {
      // V6 drove this off coverageH(), which is type(uint256).max until an emission is
      // reported — so the fee sat at its floor no matter how thin the pool was.
      expect(await pool.avgDailyEmission()).to.equal(0n);
      expect(await pool.sellFeeBps()).to.equal(1500n);   // thin pool, full fee, no reporter
    });
  });

  // ── A quote must be a trade that will go through ───────────────────────────

  describe("quoteSell only quotes what executes", () => {
    beforeEach(async () => {
      await pool.connect(router).receiveUSDT(GATE);
      await pool.advancePhase();
    });

    it("says WHICH limit was hit — per-trade and daily are different refusals", async () => {
      const overTrade = (await pool.maxTradeMic()) + e18("1");
      await mic.connect(admin).transfer(alice.address, overTrade);
      await expect(pool.connect(alice).swapMicToUsdt(overTrade, 0))
        .to.be.revertedWith("LP7: over per-trade limit");

      // Inside the per-trade limit, but more USDT than the rolling day allows.
      const atTrade = await pool.maxTradeMic();
      expect(atTrade).to.be.gt(await pool.maxSellNow());
      await mic.connect(admin).transfer(bob.address, atTrade);
      await expect(pool.connect(bob).swapMicToUsdt(atTrade, 0))
        .to.be.revertedWith("LP7: over daily limit");
    });

    it("applies the per-trade limit to buys too, with the same message", async () => {
      await expect(pool.connect(alice).swapUsdtToMic(usd("100000"), 0))
        .to.be.revertedWith("LP7: over per-trade limit");
    });

    it("returns 0 for an amount the daily cap would refuse", async () => {
      const big = (await pool.reserveMic()) / 100n;      // at the 1% trade cap
      expect(await pool.quoteSell(big)).to.equal(0n);
      await mic.connect(admin).transfer(alice.address, big);
      await expect(pool.connect(alice).swapMicToUsdt(big, 0)).to.be.reverted;
    });

    it("returns 0 above the 1% trade cap", async () => {
      const over = (await pool.reserveMic()) / 100n + e18("1");
      expect(await pool.quoteSell(over)).to.equal(0n);
    });

    it("maxSellNow is executable, and one step past it is not", async () => {
      const max = await pool.maxSellNow();
      expect(max).to.be.gt(0n);
      expect(await pool.quoteSell(max)).to.be.gt(0n);
      expect(await pool.quoteSell(max * 12n / 10n)).to.equal(0n);

      await mic.connect(admin).transfer(alice.address, max);
      const before = await usdt.balanceOf(alice.address);
      await pool.connect(alice).swapMicToUsdt(max, 0);
      expect(await usdt.balanceOf(alice.address)).to.be.gt(before);
    });

    it("every non-zero quote is honoured to the wei", async () => {
      const amt = (await pool.maxSellNow()) / 2n;
      const quoted = await pool.quoteSell(amt);
      expect(quoted).to.be.gt(0n);
      await mic.connect(admin).transfer(alice.address, amt);
      const before = await usdt.balanceOf(alice.address);
      await pool.connect(alice).swapMicToUsdt(amt, 0);
      expect(await usdt.balanceOf(alice.address) - before).to.equal(quoted);
    });

    it("goes to 0 for everyone once the daily cap is spent", async () => {
      const max = await pool.maxSellNow();
      await mic.connect(admin).transfer(alice.address, max);
      await pool.connect(alice).swapMicToUsdt(max, 0);
      expect(await pool.remainingDailyOut()).to.equal(0n);
      expect(await pool.maxSellNow()).to.equal(0n);
      expect(await pool.quoteSell(e18("1000"))).to.equal(0n);
    });
  });

  // ── Price stays honest at every depth ──────────────────────────────────────

  describe("Honest price at any depth", () => {
    it("spot equals the price a buyer actually pays, at every reserve level", async () => {
      for (const push of ["0", "50000", "235000", "500000", "1000000"]) {
        const p: any = await deploy();
        await mic.connect(admin).approve(await p.getAddress(), ethers.MaxUint256);
        await p.connect(admin).seedMic(M0);
        if (push !== "0") {
          await usdt.connect(router).approve(await p.getAddress(), ethers.MaxUint256);
          await p.connect(router).receiveUSDT(usd(push));
        }

        const spot = await p.spotPrice();
        const out  = await p.quoteBuy(usd("50"));
        const paid = (usd("50") * 10n ** 18n) / out;
        // Only the published 0.3% fee separates them — never a hidden factor.
        expect(Number(paid) / Number(spot)).to.be.closeTo(1.003, 0.0005);
      }
    });
  });

  // ── Carried over from V6 unchanged ─────────────────────────────────────────

  describe("Carried over from V6 unchanged", () => {
    it("keeps the published fee constants", async () => {
      expect(await pool.BUY_FEE_BPS()).to.equal(30n);
      expect(await pool.SELL_FEE_MIN_BPS()).to.equal(0n);      // Owner: 0–10% band
      expect(await pool.MAX_FEE_BPS()).to.equal(1500n);   // Owner: 0–15% band
      expect(await pool.MAX_TRADE_BPS()).to.equal(100n);
    });

    it("still reports coverage, it just no longer drives the fee", async () => {
      await pool.connect(router).receiveUSDT(usd("100000"));
      await pool.connect(emitter).reportDailyEmission(e18("100000000"));
      const collapsed = await pool.coverageH();
      await pool.connect(emitter).reportDailyEmission(e18("1"));
      expect(await pool.coverageH()).to.be.gt(collapsed);
    });

    it("caps outbound USDT at 5% of reserves per rolling day", async () => {
      await pool.connect(router).receiveUSDT(usd("1000000"));
      await pool.advancePhase();
      expect(await pool.remainingDailyOut())
        .to.equal((await pool.reserveUsdt()) * 500n / 10_000n);
    });

    it("never pays out more USDT than it actually holds", async () => {
      await pool.connect(router).receiveUSDT(GATE_USDT);     // past the sell gate
      await pool.advancePhase();
      const held = await usdt.balanceOf(await pool.getAddress());
      const maxMic = (await pool.reserveMic()) / 100n;
      await mic.connect(admin).transfer(alice.address, maxMic);
      try { await pool.connect(alice).swapMicToUsdt(maxMic, 0); } catch { /* capped */ }
      expect(await usdt.balanceOf(await pool.getAddress())).to.be.lte(held);
      expect(await pool.reserveUsdt()).to.be.lte(held);
    });
  });

  // ── Migration path ─────────────────────────────────────────────────────────

  describe("MIC withdrawal", () => {
    it("waits out the 7-day cooldown", async () => {
      await pool.connect(admin).requestMicWithdraw(bob.address, e18("1000000"), "migrate");
      await expect(pool.connect(admin).executeMicWithdraw())
        .to.be.revertedWith("LP7: cooldown active");

      await time.increase(7 * DAY);
      const before = await mic.balanceOf(bob.address);
      await pool.connect(admin).executeMicWithdraw();

      expect(await mic.balanceOf(bob.address) - before).to.equal(e18("1000000"));
      expect(await pool.reserveMic()).to.equal(M0 - e18("1000000"));
      expect(await pool.totalMicWithdrawn()).to.equal(e18("1000000"));
    });

    it("can move the whole float — the point of having it at all", async () => {
      await pool.connect(admin).requestMicWithdraw(bob.address, M0, "consolidate into V6");
      await time.increase(7 * DAY);
      await pool.connect(admin).executeMicWithdraw();
      expect(await pool.reserveMic()).to.equal(0n);
      expect(await mic.balanceOf(await pool.getAddress())).to.equal(0n);
    });

    it("is cancellable, and a cancelled request cannot execute", async () => {
      await pool.connect(admin).requestMicWithdraw(bob.address, e18("1000"), "oops");
      await pool.connect(admin).cancelMicWithdraw();
      await time.increase(7 * DAY);
      await expect(pool.connect(admin).executeMicWithdraw())
        .to.be.revertedWith("LP7: no request");
    });

    it("cannot execute twice", async () => {
      await pool.connect(admin).requestMicWithdraw(bob.address, e18("1000"), "x");
      await time.increase(7 * DAY);
      await pool.connect(admin).executeMicWithdraw();
      await expect(pool.connect(admin).executeMicWithdraw())
        .to.be.revertedWith("LP7: no request");
    });

    it("re-announcing restarts the clock", async () => {
      await pool.connect(admin).requestMicWithdraw(bob.address, e18("1000"), "first");
      await time.increase(6 * DAY);
      await pool.connect(admin).requestMicWithdraw(bob.address, e18("2000"), "second");
      await time.increase(2 * DAY);                     // 8 days since the first
      await expect(pool.connect(admin).executeMicWithdraw())
        .to.be.revertedWith("LP7: cooldown active");
    });

    it("refuses more than the pool holds", async () => {
      await expect(pool.connect(admin).requestMicWithdraw(bob.address, M0 + 1n, "x"))
        .to.be.revertedWith("LP7: bad amount");
    });

    it("is admin-only at every step", async () => {
      await expect(pool.connect(alice).requestMicWithdraw(alice.address, e18("1"), "x"))
        .to.be.reverted;
      await pool.connect(admin).requestMicWithdraw(bob.address, e18("1"), "x");
      await time.increase(7 * DAY);
      await expect(pool.connect(alice).executeMicWithdraw()).to.be.reverted;
      await expect(pool.connect(alice).cancelMicWithdraw()).to.be.reverted;
    });

    it("announcing alone moves nothing; only executing does", async () => {
      const before = await pool.spotPrice();
      await pool.connect(admin).requestMicWithdraw(bob.address, M0 / 2n, "half");
      expect(await pool.spotPrice()).to.equal(before);
      expect(await pool.reserveMic()).to.equal(M0);
      await time.increase(7 * DAY);
      await pool.connect(admin).executeMicWithdraw();
      // Half the float against the same capital — the remainder is worth twice as much.
      expect(await pool.spotPrice()).to.be.closeTo(before * 2n, before / 1000n);
    });
  });

  // ── Dormancy ───────────────────────────────────────────────────────────────

  describe("Before it is seeded", () => {
    let dormant: any;
    beforeEach(async () => { dormant = await deploy(); });

    it("quotes nothing and prices nothing", async () => {
      expect(await dormant.isSeeded()).to.equal(false);
      expect(await dormant.spotPrice()).to.equal(0n);
      expect(await dormant.quoteBuy(usd("100"))).to.equal(0n);
      expect(await dormant.twap7d()).to.equal(0n);
      expect(await dormant.poolAgeDays()).to.equal(0n);
    });

    it("refuses trades — there is no MIC to price or to deliver", async () => {
      await expect(dormant.connect(alice).swapUsdtToMic(usd("100"), 0))
        .to.be.revertedWith("LP7: pool not seeded");
      await expect(dormant.connect(alice).swapMicToUsdt(e18("100"), 0)).to.be.reverted;
    });

    it("ACCEPTS revenue before it is seeded", async () => {
      // RevenueRouter calls receiveUSDT in the same transaction as a Pre-Sale or MICE
      // purchase. If this reverted, the sale would revert with it — every sale, for the
      // whole window between deploying the pool and seeding it.
      await usdt.connect(router).approve(await dormant.getAddress(), ethers.MaxUint256);
      await expect(dormant.connect(router).receiveUSDT(usd("5000"))).to.not.be.reverted;
      expect(await dormant.reserveUsdt()).to.equal(usd("5000"));
      expect(await dormant.isSeeded()).to.equal(false);
      expect(await dormant.spotPrice()).to.equal(0n);          // still no MIC to price
    });

    it("opens at EXACTLY $0.01 however much revenue arrived first", async () => {
      // The property that makes the above safe: one-for-one substitution pins
      // effectiveUsdt at virtualReserve0, so early USDT changes the composition of the
      // backing and never its size. Under V6's half-rate rule each of these would have
      // opened the pool above $0.01.
      for (const early of ["0", "10", "5000", "100000", "235000"]) {
        const p: any = await deploy();
        if (early !== "0") {
          await usdt.connect(router).approve(await p.getAddress(), ethers.MaxUint256);
          await p.connect(router).receiveUSDT(usd(early));
          expect(await p.effectiveUsdt(), `eff moved at $${early}`).to.equal(UV0);
        }
        await mic.connect(admin).approve(await p.getAddress(), ethers.MaxUint256);
        await p.connect(admin).seedMic(M0);
        expect(await p.spotPrice(), `opening price wrong after $${early} early`).to.equal(P0);
      }
    });

    it("early revenue still counts toward the sell gate", async () => {
      await usdt.connect(router).approve(await dormant.getAddress(), ethers.MaxUint256);
      await dormant.connect(router).receiveUSDT(GATE);
      await mic.connect(admin).approve(await dormant.getAddress(), ethers.MaxUint256);
      await dormant.connect(admin).seedMic(M0);
      expect(await dormant.spotPrice()).to.equal(P0);
      await dormant.advancePhase();
      expect(await dormant.sellsOpen()).to.equal(true);
    });

    it("starts its clock on the first seed, not at deployment", async () => {
      await time.increase(5 * DAY);
      await mic.connect(admin).approve(await dormant.getAddress(), ethers.MaxUint256);
      await dormant.connect(admin).seedMic(M0);
      expect(await dormant.isSeeded()).to.equal(true);
      expect(await dormant.poolAgeDays()).to.equal(0n);
      expect(await dormant.spotPrice()).to.equal(P0);
    });

    it("rejects a 6-decimal USDT at construction", async () => {
      const six = await (await ethers.getContractFactory("MockUSDT6")).deploy();
      await expect(
        (await ethers.getContractFactory("LiquidityPoolV7"))
          .deploy(await six.getAddress(), await mic.getAddress(), UV0, GATE, admin.address)
      ).to.be.revertedWith("LP7: usdt must be 18 decimals");
    });
  });

  // ── Guards ─────────────────────────────────────────────────────────────────

  describe("Guards", () => {
    it("honours the slippage floor", async () => {
      const quoted = await pool.quoteBuy(BUY);
      await expect(pool.connect(alice).swapUsdtToMic(BUY, quoted + 1n))
        .to.be.revertedWith("LP7: slippage");
    });

    it("rejects a trade larger than 1% of the MIC reserve", async () => {
      // 1% of 23.5M = 235,000 MIC ≈ $2,357 at the opening price. V6's cap bound at twice
      // the money because it handed out half as much MIC; the same cap now bites sooner.
      await expect(pool.connect(alice).swapUsdtToMic(usd("100000"), 0))
        .to.be.revertedWith("LP7: over per-trade limit");
      await expect(pool.connect(alice).swapUsdtToMic(BUY, 0)).to.not.be.reverted;
    });

    it("blocks a buy and a sell from one address in the same block", async () => {
      await pool.connect(router).receiveUSDT(GATE_USDT);       // past the sell gate
      await pool.advancePhase();

      const Attack = await ethers.getContractFactory("MockSameBlockTrader");
      const attacker = await Attack.deploy(
        await pool.getAddress(), await usdt.getAddress(), await mic.getAddress()
      );
      await usdt.mint(await attacker.getAddress(), usd("10000"));
      await expect(attacker.buyThenSell(usd("1000"))).to.be.revertedWith("LP7: same block");
    });

    it("only the distributor may push USDT in", async () => {
      await expect(pool.connect(alice).receiveUSDT(usd("1000"))).to.be.reverted;
    });

    it("only the emission reporter may report issuance", async () => {
      await expect(pool.connect(alice).reportDailyEmission(e18("1"))).to.be.reverted;
    });

    it("only the admin may seed", async () => {
      await mic.connect(admin).transfer(alice.address, e18("1000"));
      await expect(pool.connect(alice).seedMic(e18("1000"))).to.be.reverted;
    });

    it("keeps the fee in the pool", async () => {
      await pool.connect(alice).swapUsdtToMic(BUY, 0);
      expect(await pool.totalFeesCollected()).to.equal(usd("6"));    // 0.3% of $2,000
      expect(await pool.reserveUsdt()).to.equal(BUY);                // fee included
    });
  });

  // ── Averages ───────────────────────────────────────────────────────────────

  describe("Time-weighted average price", () => {
    it("is defined on day one, before any history exists", async () => {
      expect(await pool.twap7d()).to.equal(await pool.spotPrice());
      expect(await pool.twap30d()).to.equal(await pool.spotPrice());
    });

    it("lags spot once the window clears day zero", async () => {
      for (let i = 0; i < 10; i++) {
        await time.increase(DAY);
        await pool.connect(i % 2 ? bob : alice).swapUsdtToMic(usd("1000"), 0);
      }
      await time.increase(DAY);
      await pool.poke();
      expect(await pool.twap7d()).to.be.lt(await pool.spotPrice());
      expect(await pool.twap7d()).to.be.gt(0n);
    });

    it("the 30-day average lags the 7-day one in a rising market", async () => {
      for (let i = 0; i < 14; i++) {
        await time.increase(DAY);
        await pool.connect(i % 2 ? bob : alice).swapUsdtToMic(usd("1000"), 0);
      }
      await time.increase(DAY);
      await pool.poke();
      expect(await pool.twap30d()).to.be.lte(await pool.twap7d());
    });

    it("averages properly inside the first week, because the seed stamps day zero", async () => {
      // `seedMic` sets `startTime` and only then calls `_accrue()`, so slot 0 of the ring
      // is written at the seed instant. Without that, every window reaching back to day 0
      // would find an empty slot and fall back to spot — `twap7d()` would not be an
      // average at all for the pool's first week, which is exactly what
      // EmissionController's brake must be insulated from. Ordering carried from V6.
      for (let i = 0; i < 4; i++) {
        await time.increase(DAY);
        await pool.connect(i % 2 ? bob : alice).swapUsdtToMic(usd("1000"), 0);
      }
      await time.increase(DAY);
      await pool.poke();
      const [ts] = await pool.snapshots(0);
      expect(ts).to.equal(await pool.startTime());                    // day zero recorded
      expect(await pool.twap7d()).to.be.lt(await pool.spotPrice());   // a real average
      expect(await pool.twap7d()).to.be.gt(P0);
    });

    it("never records the zero price of an unseeded pool", async () => {
      const dormant: any = await deploy();
      await time.increase(10 * DAY);
      await dormant.poke();
      await mic.connect(admin).approve(await dormant.getAddress(), ethers.MaxUint256);
      await dormant.connect(admin).seedMic(M0);
      await time.increase(DAY);
      await dormant.poke();
      // A 10-day dormancy would otherwise have dragged this to a fraction of $0.01.
      expect(await dormant.twap7d()).to.equal(P0);
    });
  });

  // ── Whole-float behaviour ──────────────────────────────────────────────────

  describe("Selling the float down", () => {
    it("never dips below the $0.01 opening price, and holds every dollar taken", async () => {
      let spent = 0n;
      const buyers = [alice, bob];
      for (let i = 0; i < 120; i++) {
        const maxMic = (await pool.reserveMic()) / 100n;
        if (maxMic === 0n) break;
        const price = await pool.spotPrice();
        let pay = (maxMic * price) / 10n ** 18n;
        pay = (pay * 9_900n) / 10_000n;            // just under the 1% cap
        if (pay === 0n) break;
        await pool.connect(buyers[i % 2]).swapUsdtToMic(pay, 0);
        spent += pay;
      }
      const sold = M0 - (await pool.reserveMic());
      const avg = Number(ethers.formatEther(spent)) / Number(ethers.formatEther(sold));

      expect(avg).to.be.gt(0.01);
      expect(await pool.spotPrice()).to.be.gt(P0);
      expect(await usdt.balanceOf(await pool.getAddress())).to.equal(spent);
    });
  });
});
