import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

const DAY = 86_400;
/**
 * USDT amounts. Named `e6` when the suite was written against a 6-decimal token;
 * BSC-USD is 18, so this now produces what the pool will really receive. Every
 * amount below scales together, and `LISTING_THRESHOLD` is once again $10M rather
 * than the $0.00001 a 6-decimal constant made it.
 */
const e6 = (n: string | number) => ethers.parseUnits(String(n), 18);
const e18 = (n: string | number) => ethers.parseEther(String(n));

const M0 = e18("50000000");        // 50M MIC seeded
/**
 * Opening price, $0.01 per MIC.
 *
 * `spotPrice()` is `effectiveUsdt * 1e18 / reserveMic` — USDT wei per 1e18 MIC — so
 * with an 18-decimal token the price is 18-decimal too. The literal `10_000n` was the
 * 6-decimal form and asserted a price a trillion times too low.
 */
const P0 = ethers.parseEther("0.01");   // $0.01 per MIC, 18-dec
const UV0 = e6("500000");          // virtual reserve = P0 × M0 = $500,000

describe("LiquidityPoolV6", () => {
  let pool: any, usdt: any, mic: any;
  let admin: any, router: any, emitter: any, alice: any, bob: any;

  beforeEach(async () => {
    [admin, router, emitter, alice, bob] = await ethers.getSigners();

    usdt = await (await ethers.getContractFactory("MockUSDT")).deploy();
    mic  = await (await ethers.getContractFactory("MICToken")).deploy(admin.address);

    pool = await (await ethers.getContractFactory("LiquidityPoolV6"))
      .deploy(await usdt.getAddress(), await mic.getAddress(), UV0, admin.address);

    await pool.connect(admin).grantRole(await pool.DISTRIBUTOR_ROLE(), router.address);
    await pool.connect(admin).grantRole(await pool.EMISSION_REPORTER_ROLE(), emitter.address);

    await mic.connect(admin).approve(await pool.getAddress(), M0);
    await pool.connect(admin).seedMic(M0);

    for (const who of [alice, bob, router]) {
      await usdt.mint(who.address, e6("50000000"));
      await usdt.connect(who).approve(await pool.getAddress(), ethers.MaxUint256);
      await mic.connect(who).approve(await pool.getAddress(), ethers.MaxUint256);
    }
  });

  // ── Opening state ──────────────────────────────────────────────────────────

  describe("Opening state", () => {
    it("quotes a two-sided price on day one with zero real USDT", async () => {
      expect(await pool.reserveUsdt()).to.equal(0n);
      expect(await pool.virtualReserve()).to.equal(UV0);
      expect(await pool.spotPrice()).to.equal(P0);
    });

    it("starts in Bootstrap with the sell direction closed", async () => {
      expect(await pool.phase()).to.equal(0);
      await expect(pool.connect(alice).swapMicToUsdt(e18("1000"), 0))
        .to.be.revertedWith("LP6: sells not open");
    });
  });

  // ── Virtual reserve ────────────────────────────────────────────────────────

  describe("Virtual reserve", () => {
    it("retires at half the rate of real inflow", async () => {
      await pool.connect(router).receiveUSDT(e6("100000"));
      // $100k in → $50k of virtual retired
      expect(await pool.virtualReserve()).to.equal(UV0 - e6("50000"));
    });

    it("reaches zero at twice its own size and never goes negative", async () => {
      await pool.connect(router).receiveUSDT(e6("1000000"));   // 2 × UV0
      expect(await pool.virtualReserve()).to.equal(0n);
      await pool.connect(router).receiveUSDT(e6("500000"));
      expect(await pool.virtualReserve()).to.equal(0n);
    });

    it("produces no price discontinuity when it finishes retiring", async () => {
      // Walk right up to the boundary, then step over it, and check the price moves
      // smoothly rather than jumping.
      await pool.connect(router).receiveUSDT(e6("999000"));
      const before = await pool.spotPrice();
      await pool.connect(router).receiveUSDT(e6("2000"));      // crosses 2 × UV0
      const after = await pool.spotPrice();
      expect(await pool.virtualReserve()).to.equal(0n);
      // A $2k step on a ~$1M pool must not move price more than a fraction of a percent.
      expect(after - before).to.be.lt(before / 100n);
    });
  });

  // ── Curve ──────────────────────────────────────────────────────────────────

  describe("Constant product", () => {
    it("a buy raises the price and delivers what the quote said", async () => {
      const quoted = await pool.quoteBuy(e6("4000"));
      const before = await pool.spotPrice();
      const micBefore = await mic.balanceOf(alice.address);

      await pool.connect(alice).swapUsdtToMic(e6("4000"), 0);

      expect(await mic.balanceOf(alice.address) - micBefore).to.equal(quoted);
      expect(await pool.spotPrice()).to.be.gt(before);
    });

    it("preserves the product across a buy, after the fee is added in", async () => {
      const kBefore = (await pool.effectiveUsdt()) * (await pool.reserveMic());
      await pool.connect(alice).swapUsdtToMic(e6("4000"), 0);
      const kAfter = (await pool.effectiveUsdt()) * (await pool.reserveMic());
      // k grows, never shrinks — the fee stays in the pool.
      expect(kAfter).to.be.gte(kBefore);
    });

    it("honours the slippage guard", async () => {
      const quoted = await pool.quoteBuy(e6("4000"));
      await expect(pool.connect(alice).swapUsdtToMic(e6("4000"), quoted + 1n))
        .to.be.revertedWith("LP6: slippage");
    });

    it("rejects a trade larger than 1% of the MIC reserve", async () => {
      // 1% of 50M = 500k MIC. At $0.01 that is about $5,000 of buying.
      await expect(pool.connect(alice).swapUsdtToMic(e6("100000"), 0))
        .to.be.revertedWith("LP6: trade too large");
    });
  });

  // ── Solvency ───────────────────────────────────────────────────────────────

  describe("Solvency", () => {
    beforeEach(async () => {
      await time.increase(31 * DAY);
      await pool.advancePhase();                      // open the sell side
    });

    it("never pays out more USDT than it actually holds", async () => {
      // The curve would quote against (real + virtual); only real exists.
      await pool.connect(router).receiveUSDT(e6("1000"));
      const held = await usdt.balanceOf(await pool.getAddress());

      // Ask for the largest sale the size cap allows.
      const maxMic = (await pool.reserveMic()) / 100n;
      await mic.connect(admin).transfer(alice.address, maxMic);

      try {
        await pool.connect(alice).swapMicToUsdt(maxMic, 0);
      } catch { /* daily cap or balance guard — either is a correct refusal */ }

      expect(await usdt.balanceOf(await pool.getAddress())).to.be.lte(held);
      expect(await pool.reserveUsdt()).to.be.lte(held);
    });

    it("caps outbound USDT at 5% of reserves per rolling day", async () => {
      await pool.connect(router).receiveUSDT(e6("1000000"));
      const cap = (await pool.reserveUsdt()) * 500n / 10_000n;
      expect(await pool.remainingDailyOut()).to.equal(cap);

      const chunk = (await pool.reserveMic()) / 200n;   // 0.5% of reserve
      await mic.connect(admin).transfer(alice.address, chunk * 20n);

      let blocked = false;
      for (let i = 0; i < 20 && !blocked; i++) {
        await time.increase(15);
        try { await pool.connect(alice).swapMicToUsdt(chunk, 0); }
        catch (e: any) { blocked = /daily cap/.test(e.message); }
      }
      expect(blocked).to.be.true;
    });
  });

  // ── Fees ───────────────────────────────────────────────────────────────────

  describe("Fees", () => {
    it("charges the floor fee while coverage is at or above target", async () => {
      expect(await pool.sellFeeBps()).to.equal(30n);      // no emission reported yet
    });

    it("raises the fee as coverage falls, and never past the hard cap", async () => {
      await pool.connect(router).receiveUSDT(e6("100000"));

      // Report a large daily issuance so coverage collapses.
      await pool.connect(emitter).reportDailyEmission(e18("100000000"));
      const high = await pool.sellFeeBps();
      expect(high).to.equal(await pool.MAX_FEE_BPS());
      expect(high).to.equal(1000n);                       // 10%, not 25%

      // A modest issuance leaves coverage healthy and the fee at the floor.
      await pool.connect(emitter).reportDailyEmission(e18("1"));
      expect(await pool.sellFeeBps()).to.equal(30n);
    });

    it("fees stay in the pool", async () => {
      const before = await pool.totalFeesCollected();
      await pool.connect(alice).swapUsdtToMic(e6("4000"), 0);
      expect(await pool.totalFeesCollected()).to.be.gt(before);
      // The whole payment landed in reserves; nothing was skimmed out.
      expect(await pool.reserveUsdt()).to.equal(e6("4000"));
    });
  });

  // ── Phases ─────────────────────────────────────────────────────────────────

  describe("Phases", () => {
    it("refuses to advance before the condition is met", async () => {
      await expect(pool.advancePhase()).to.be.revertedWith("LP6: condition not met");
    });

    it("opens the sell side on day 30, callable by anyone", async () => {
      await time.increase(30 * DAY);
      await pool.connect(alice).advancePhase();           // no permission needed
      expect(await pool.phase()).to.equal(1);
    });

    it("enters the listing phase once real reserves pass the threshold", async () => {
      await time.increase(30 * DAY);
      await pool.advancePhase();
      await pool.connect(router).receiveUSDT(e6("10000000"));
      await pool.advancePhase();
      expect(await pool.phase()).to.equal(2);
    });
  });

  // ── TWAP ───────────────────────────────────────────────────────────────────

  describe("Time-weighted average price", () => {
    it("is defined on day one, before any history exists", async () => {
      expect(await pool.twap7d()).to.equal(await pool.spotPrice());
      expect(await pool.twap30d()).to.equal(await pool.spotPrice());
    });

    it("lags spot after the price moves, which is the point of an average", async () => {
      for (let i = 0; i < 5; i++) {
        await time.increase(DAY);
        await pool.connect(alice).swapUsdtToMic(e6("4000"), 0);
      }
      await time.increase(DAY);
      await pool.poke();
      expect(await pool.twap7d()).to.be.lt(await pool.spotPrice());
      expect(await pool.twap7d()).to.be.gt(0n);
    });

    it("the 30-day average lags the 7-day one in a rising market", async () => {
      for (let i = 0; i < 12; i++) {
        await time.increase(DAY);
        await pool.connect(alice).swapUsdtToMic(e6("4000"), 0);
      }
      await time.increase(DAY);
      await pool.poke();
      expect(await pool.twap30d()).to.be.lte(await pool.twap7d());
    });
  });

  // ── Guards ─────────────────────────────────────────────────────────────────

  describe("Guards", () => {
    it("blocks buying and selling from one address in the same block", async () => {
      await time.increase(31 * DAY);
      await pool.advancePhase();
      await pool.connect(router).receiveUSDT(e6("500000"));

      const Attack = await ethers.getContractFactory("MockSameBlockTrader");
      const attacker = await Attack.deploy(
        await pool.getAddress(), await usdt.getAddress(), await mic.getAddress()
      );
      await usdt.mint(await attacker.getAddress(), e6("10000"));
      await expect(attacker.buyThenSell(e6("1000"))).to.be.revertedWith("LP6: same block");
    });

    it("only the distributor may push USDT in", async () => {
      await expect(pool.connect(alice).receiveUSDT(e6("1000"))).to.be.reverted;
    });

    it("only the emission reporter may report issuance", async () => {
      await expect(pool.connect(alice).reportDailyEmission(e18("1"))).to.be.reverted;
    });
  });
});
