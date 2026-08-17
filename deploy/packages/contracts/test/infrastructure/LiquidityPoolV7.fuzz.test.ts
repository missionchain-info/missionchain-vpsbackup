import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

/**
 * Differential fuzz for LiquidityPoolV7.
 *
 * The V6 defect survived a green suite because every test that touched `quoteBuy` used
 * `quoteBuy` as its own reference — "delivers what it quoted", "quoted + 1 reverts". Both
 * pass whatever number comes back. Nothing ever asked what a buyer should receive.
 *
 * So this file never asks the contract to confirm itself. It reimplements the published
 * rules in TypeScript, drives the pool through random operations, and after every single
 * one checks the chain against the model and against invariants that must hold no matter
 * what happened. A constant-factor error like V6's cannot survive this.
 */

const usd = (n: string | number) => ethers.parseUnits(String(n), 18);
const e18 = (n: string | number) => ethers.parseEther(String(n));

const M0   = e18("23500000");       // the float that ships
const UV0  = usd("235000");         // $0.01 × 23,500,000
const GATE = usd("25000");          // Owner's sell gate

const BPS = 10_000n;
const BUY_FEE_BPS = 30n;
const MAX_FEE_BPS = 1_500n;
const SELL_FEE_MIN_BPS = 0n;
const MAX_TRADE_BPS = 100n;
const DAILY_OUT_BPS = 500n;

/** The published rules, written from the spec — not from the contract. */
class Model {
  reserveUsdt = 0n;
  highWater = 0n;
  reserveMic = 0n;

  virtual(): bigint {
    return this.highWater >= UV0 ? 0n : UV0 - this.highWater;   // one-for-one
  }
  eff(): bigint { return this.reserveUsdt + this.virtual(); }
  spot(): bigint {
    return this.reserveMic === 0n ? 0n : (this.eff() * 10n ** 18n) / this.reserveMic;
  }
  backingBps(): bigint {
    const e = this.eff();
    if (e === 0n) return 0n;
    const b = (this.reserveUsdt * BPS) / e;
    return b > BPS ? BPS : b;
  }
  sellFeeBps(): bigint {
    return MAX_FEE_BPS - ((MAX_FEE_BPS - SELL_FEE_MIN_BPS) * this.backingBps()) / BPS;
  }
  /** Linear: whole pool over whole float, on the reserves as they stand. */
  quoteBuy(usdtIn: bigint): bigint {
    if (usdtIn === 0n || this.reserveMic === 0n) return 0n;
    const eff = this.eff();
    if (eff === 0n) return 0n;
    const inNet = usdtIn - (usdtIn * BUY_FEE_BPS) / BPS;
    return (inNet * this.reserveMic) / eff;
  }
  grossSell(micIn: bigint): bigint {
    const e = this.eff();
    return e - (e * this.reserveMic) / (this.reserveMic + micIn);
  }
  maxTradeMic(): bigint { return (this.reserveMic * MAX_TRADE_BPS) / BPS; }

  applyUsdtIn(amount: bigint) {
    this.reserveUsdt += amount;
    if (this.reserveUsdt > this.highWater) this.highWater = this.reserveUsdt;
  }
}

describe("LiquidityPoolV7 — differential fuzz", () => {
  let pool: any, usdt: any, mic: any;
  let admin: any, router: any, alice: any, bob: any;

  // Deterministic PRNG: a failure must be replayable.
  let seed = 0x5eed;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const pick = <T>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];

  beforeEach(async () => {
    [admin, router, alice, bob] = await ethers.getSigners();
    usdt = await (await ethers.getContractFactory("MockUSDT")).deploy();
    mic  = await (await ethers.getContractFactory("MICToken")).deploy(admin.address);

    pool = await (await ethers.getContractFactory("LiquidityPoolV7"))
      .deploy(await usdt.getAddress(), await mic.getAddress(), UV0, GATE, admin.address);
    await pool.connect(admin).grantRole(await pool.DISTRIBUTOR_ROLE(), router.address);

    await mic.connect(admin).approve(await pool.getAddress(), ethers.MaxUint256);
    await pool.connect(admin).seedMic(M0);

    for (const who of [alice, bob, router]) {
      await usdt.mint(who.address, usd("100000000"));
      await usdt.connect(who).approve(await pool.getAddress(), ethers.MaxUint256);
      await mic.connect(who).approve(await pool.getAddress(), ethers.MaxUint256);
    }
    seed = 0x5eed;
    lastVirtual = ethers.MaxUint256;
  });

  let lastVirtual = ethers.MaxUint256;

  /** Everything that must be true of the pool at rest, whatever just happened. */
  const checkInvariants = async (m: Model, ctx: string) => {
    const addr = await pool.getAddress();

    // 1. The contract's own books match the chain's balances, exactly.
    expect(await pool.reserveUsdt(), `${ctx}: reserveUsdt vs balance`)
      .to.equal(await usdt.balanceOf(addr));
    expect(await pool.reserveMic(), `${ctx}: reserveMic vs balance`)
      .to.equal(await mic.balanceOf(addr));

    // 2. The model and the chain agree on every derived figure.
    expect(await pool.reserveUsdt(), `${ctx}: reserveUsdt`).to.equal(m.reserveUsdt);
    expect(await pool.reserveMic(), `${ctx}: reserveMic`).to.equal(m.reserveMic);
    expect(await pool.reserveUsdtHighWater(), `${ctx}: highWater`).to.equal(m.highWater);
    expect(await pool.virtualReserve(), `${ctx}: virtual`).to.equal(m.virtual());
    expect(await pool.effectiveUsdt(), `${ctx}: eff`).to.equal(m.eff());
    expect(await pool.spotPrice(), `${ctx}: spot`).to.equal(m.spot());
    expect(await pool.backingBps(), `${ctx}: backing`).to.equal(m.backingBps());
    expect(await pool.sellFeeBps(), `${ctx}: sellFee`).to.equal(m.sellFeeBps());

    // 3. One-for-one substitution, stated precisely. While virtual remains AND nothing has
    //    ever been paid out, the total is pinned: a deposit swaps virtual for real and
    //    changes what the backing is made of, not how much of it there is.
    if (m.virtual() > 0n && m.reserveUsdt === m.highWater) {
      expect(await pool.effectiveUsdt(), `${ctx}: eff must be pinned at UV0`).to.equal(UV0);
    }

    // 4. Once USDT has left, the total is strictly lower — the retired virtual does NOT
    //    come back. Re-inflating the phantom side at the moment the pool is weakening is
    //    exactly what the high-water mark exists to prevent.
    if (m.virtual() > 0n) {
      expect(await pool.effectiveUsdt(), `${ctx}: eff above UV0`).to.be.lte(UV0);
      expect(await pool.effectiveUsdt(), `${ctx}: eff below real`).to.be.gte(m.reserveUsdt);
    }

    // 5. Fully backed: every dollar the curve can quote is a dollar the pool holds.
    if (m.virtual() === 0n) {
      expect(await pool.effectiveUsdt()).to.equal(await pool.reserveUsdt());
    }

    // 6. Retirement is one-way, across the entire run.
    const v = await pool.virtualReserve();
    expect(v, `${ctx}: virtual reserve went UP`).to.be.lte(lastVirtual);
    lastVirtual = v;

    // 7. The fee band is honoured, always.
    const fee = await pool.sellFeeBps();
    expect(fee).to.be.gte(SELL_FEE_MIN_BPS);
    expect(fee).to.be.lte(MAX_FEE_BPS);

    // 8. THE V6 GUARD. A buyer's unit price is spot plus the published fee and nothing
    //    else. This is the single assertion that would have caught the 2× defect.
    if (m.reserveMic > 0n && m.spot() > 0n) {
      const probe = m.eff() / 10_000n;                 // ~0.01% of the pool
      if (probe > 0n) {
        const out = await pool.quoteBuy(probe);
        if (out > 0n) {
          const unit = (probe * 10n ** 18n) / out;      // USDT per 1e18 MIC
          const expected = (m.spot() * 10_030n) / 10_000n;
          const diff = unit > expected ? unit - expected : expected - unit;
          expect(diff * 10_000n / expected, `${ctx}: buy price drifted from spot+0.3%`)
            .to.be.lt(5n);                              // within 0.05%
        }
      }
    }
  };

  for (const runSeed of [0x5eed, 0xc0ffee, 0x1337, 0xbeef, 0xa11ce]) {
  it(`matches an independent model across 250 random operations [seed ${runSeed.toString(16)}]`, async () => {
    seed = runSeed;
    const m = new Model();
    m.reserveMic = M0;

    let buys = 0, sells = 0, pushes = 0, blocked = 0, withdrawn = 0;

    for (let i = 0; i < 250; i++) {
      const op = pick(["buy", "buy", "buy", "push", "sell", "sell", "wait", "withdraw"]);

      if (op === "withdraw") {
        // A migration announced mid-life must not disturb anything until it executes.
        const amt = m.reserveMic / 50n;
        if (amt === 0n) continue;
        await pool.connect(admin).requestMicWithdraw(bob.address, amt, "fuzz");
        await checkInvariants(m, `op #${i} (announced, must change nothing)`);
        if (rnd() < 0.5) {
          await pool.connect(admin).cancelMicWithdraw();
        } else {
          await time.increase(7 * 86400 + 1);
          const capped = amt <= m.reserveMic ? amt : m.reserveMic;
          await pool.connect(admin).executeMicWithdraw();
          m.reserveMic -= capped;
          withdrawn++;
        }

      } else if (op === "wait") {
        await time.increase(Math.floor(rnd() * 3 * 86400) + 60);
        await pool.poke();

      } else if (op === "push") {
        const amt = usd(Math.floor(rnd() * 30000) + 1);
        await pool.connect(router).receiveUSDT(amt);
        m.applyUsdtIn(amt);
        pushes++;

      } else if (op === "buy") {
        const who = pick([alice, bob]);
        const amt = usd(Math.floor(rnd() * 6000) + 1);   // straddles the ~$2,357 trade cap
        const expected = m.quoteBuy(amt);

        // Model the guards exactly as the contract orders them.
        if (expected === 0n || expected > m.maxTradeMic()) {
          await expect(pool.connect(who).swapUsdtToMic(amt, 0)).to.be.reverted;
          blocked++;
        } else {
          const onChain = await pool.quoteBuy(amt);
          expect(onChain, `buy quote #${i}`).to.equal(expected);
          const before = await mic.balanceOf(who.address);
          await pool.connect(who).swapUsdtToMic(amt, 0);
          expect(await mic.balanceOf(who.address) - before, `buy fill #${i}`).to.equal(expected);
          m.reserveMic -= expected;
          m.applyUsdtIn(amt);
          buys++;
        }

      } else {
        // sell
        const open = await pool.sellsOpen();
        if (!open) {
          if (m.highWater >= GATE) { await pool.advancePhase(); }
          else {
            expect(await pool.quoteSell(e18("1000"))).to.equal(0n);
            await expect(pool.advancePhase()).to.be.revertedWith("LP7: condition not met");
            continue;
          }
        }
        const who = pick([alice, bob]);
        const maxNow = await pool.maxSellNow();
        if (maxNow === 0n) { continue; }

        const amt = (maxNow * BigInt(Math.floor(rnd() * 90) + 5)) / 100n;
        if (amt === 0n) continue;
        const quoted = await pool.quoteSell(amt);
        if (quoted === 0n) continue;

        const bal = await mic.balanceOf(who.address);
        if (bal < amt) { await mic.connect(admin).transfer(who.address, amt - bal); }

        const beforeU = await usdt.balanceOf(who.address);
        await pool.connect(who).swapMicToUsdt(amt, 0);
        expect(await usdt.balanceOf(who.address) - beforeU, `sell fill #${i}`).to.equal(quoted);

        m.reserveMic += amt;
        m.reserveUsdt -= quoted;
        sells++;
      }

      await checkInvariants(m, `op #${i} (${op})`);
    }

    // The run has to actually exercise things, or the green tick means nothing.
    expect(buys, "no buys executed").to.be.gt(20);
    expect(pushes, "no revenue pushed").to.be.gt(10);
    expect(sells, "no sells executed").to.be.gt(3);
    expect(blocked, "the per-trade limit never fired").to.be.gt(3);
    console.log(`        seed ${runSeed.toString(16)}: ${buys} buys · ${sells} sells · ${pushes} pushes · ${withdrawn} withdrawals · ${blocked} correctly refused`);
  });
  }

  it("maxSellNow is always executable, and anything past it is refused", async () => {
    await pool.connect(router).receiveUSDT(GATE);
    await pool.advancePhase();

    for (let i = 0; i < 25; i++) {
      const max = await pool.maxSellNow();
      if (max === 0n) { await time.increase(86_401); continue; }

      // At the boundary: quotable and fillable.
      expect(await pool.quoteSell(max), `maxSellNow #${i} not quotable`).to.be.gt(0n);

      // One step past it: refused, both in the quote and on chain.
      const over = max + max / 50n + 1n;
      expect(await pool.quoteSell(over), `#${i} over-limit still quoted`).to.equal(0n);
      await mic.connect(admin).transfer(alice.address, over);
      await expect(pool.connect(alice).swapMicToUsdt(over, 0)).to.be.reverted;

      await mic.connect(admin).transfer(bob.address, max);
      await pool.connect(bob).swapMicToUsdt(max, 0);
      await time.increase(86_401);
    }
  });

  it("never pays out more USDT than it holds, under sustained maximum selling", async () => {
    await pool.connect(router).receiveUSDT(GATE);
    await pool.advancePhase();
    const addr = await pool.getAddress();

    for (let d = 0; d < 60; d++) {
      const max = await pool.maxSellNow();
      if (max === 0n) break;
      await mic.connect(admin).transfer(alice.address, max);
      await pool.connect(alice).swapMicToUsdt(max, 0);

      expect(await usdt.balanceOf(addr)).to.equal(await pool.reserveUsdt());
      expect(await pool.reserveUsdt()).to.be.gte(0n);
      await time.increase(86_401);
    }
    // Solvent to the last wei, and the sell side never re-closed.
    expect(await usdt.balanceOf(addr)).to.equal(await pool.reserveUsdt());
    expect(await pool.sellsOpen()).to.equal(true);
  });

  it("a buy never costs less than the opening price, however the pool got there", async () => {
    const m = new Model();
    m.reserveMic = M0;
    for (let i = 0; i < 120; i++) {
      const amt = usd(Math.floor(rnd() * 2000) + 1);
      const q = m.quoteBuy(amt);
      if (q === 0n || q > m.maxTradeMic()) continue;
      await pool.connect(pick([alice, bob])).swapUsdtToMic(amt, 0);
      m.reserveMic -= q; m.applyUsdtIn(amt);

      const unit = (amt * 10n ** 18n) / q;
      // $0.01 plus the 0.3% fee is the floor. It can only ever rise from there.
      expect(unit, `buy #${i} below the published floor`).to.be.gte(usd("0.01003") - usd("0.0000001"));
    }
  });
});
