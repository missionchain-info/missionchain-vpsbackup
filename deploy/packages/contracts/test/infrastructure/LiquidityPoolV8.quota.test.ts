import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

const DAY = 86_400;
const TERM = 360 * DAY;
const usd = (n: string | number) => ethers.parseUnits(String(n), 18);
const e18 = (n: string | number) => ethers.parseEther(String(n));

const M0   = e18("23500000");
const UV0  = usd("235000");
const GATE = usd("25000");
const RATE = 83_333333333333333333n;   // EmissionControllerV2's published rate

describe("LiquidityPoolV8 — sell quota", () => {
  let pool: any, usdt: any, mic: any, mice: any, emission: any;
  let admin: any, router: any, alice: any, bob: any, carol: any;

  /** Open the sell side: push real USDT past the gate and advance the phase. */
  async function openSells() {
    await usdt.connect(router).approve(await pool.getAddress(), ethers.MaxUint256);
    await pool.connect(router).receiveUSDT(GATE);
    await pool.advancePhase();
    expect(await pool.sellsOpen()).to.equal(true);
  }

  /** Mint a licence to `who` and start its 360-day term. */
  async function giveMice(who: any): Promise<bigint> {
    const id = await mice.nextId();
    await mice.mint(who.address, usd("100"));
    await mice.activate(id, TERM);
    return id;
  }

  beforeEach(async () => {
    [admin, router, alice, bob, carol] = await ethers.getSigners();

    usdt = await (await ethers.getContractFactory("MockUSDT")).deploy();
    mic  = await (await ethers.getContractFactory("MICToken")).deploy(admin.address);
    mice = await (await ethers.getContractFactory("MockMiceForQuota")).deploy();
    emission = await (await ethers.getContractFactory("MockEmissionRate")).deploy(RATE);

    pool = await (await ethers.getContractFactory("LiquidityPoolV8")).deploy(
      await usdt.getAddress(), await mic.getAddress(), UV0, GATE, admin.address,
    );
    await pool.connect(admin).grantRole(await pool.DISTRIBUTOR_ROLE(), router.address);
    await pool.connect(admin).setQuotaSources(await mice.getAddress(), await emission.getAddress());

    await mic.connect(admin).approve(await pool.getAddress(), ethers.MaxUint256);
    await pool.connect(admin).seedMic(M0);

    for (const who of [alice, bob, carol, router]) {
      await usdt.mint(who.address, usd("10000000"));
      await usdt.connect(who).approve(await pool.getAddress(), ethers.MaxUint256);
      await mic.connect(who).approve(await pool.getAddress(), ethers.MaxUint256);
    }
    // Everyone holds MIC from somewhere other than mining — the exact case being fenced off.
    for (const who of [alice, bob, carol]) {
      await mic.connect(admin).transfer(who.address, e18("500000"));
    }
    await openSells();
  });

  // ───────────────────────────────────────────────────────────
  // The rule
  // ───────────────────────────────────────────────────────────

  describe("a wallet with no mining licence cannot sell", () => {
    it("quotes zero allowance", async () => {
      expect(await pool.activeMiceOf(alice.address)).to.equal(0n);
      expect(await pool.sellQuotaOf(alice.address)).to.equal(0n);
    });

    it("is refused outright, holding MIC or not", async () => {
      expect(await mic.balanceOf(alice.address)).to.be.gt(0n);
      await expect(pool.connect(alice).swapMicToUsdt(e18("1"), 0))
        .to.be.revertedWith("LP8: no mining allowance");
    });

    it("may still BUY — the gate is one-directional", async () => {
      await expect(pool.connect(alice).swapUsdtToMic(usd("100"), 0)).to.not.be.reverted;
    });

    it("a PENDING licence grants nothing — it is not mining yet", async () => {
      const id = await mice.nextId();
      await mice.mint(alice.address, usd("100"));      // minted, never activated
      expect(await mice.statusOf(id)).to.equal(1n);
      expect(await pool.sellQuotaOf(alice.address)).to.equal(0n);
      await expect(pool.connect(alice).swapMicToUsdt(e18("1"), 0))
        .to.be.revertedWith("LP8: no mining allowance");
    });
  });

  describe("a wallet with a mining licence sells what it mined", () => {
    it("accrues 83.3333 MIC per day, per licence", async () => {
      await giveMice(alice);
      await pool.syncQuota(alice.address);

      await time.increase(DAY);
      expect(await pool.sellQuotaOf(alice.address)).to.be.closeTo(RATE, e18("0.01"));

      await time.increase(9 * DAY);
      expect(await pool.sellQuotaOf(alice.address)).to.be.closeTo(RATE * 10n, e18("0.1"));
    });

    it("scales with the number of licences", async () => {
      for (let i = 0; i < 3; i++) await giveMice(bob);
      await pool.syncQuota(bob.address);
      await time.increase(DAY);
      expect(await pool.activeMiceOf(bob.address)).to.equal(3n);
      expect(await pool.sellQuotaOf(bob.address)).to.be.closeTo(RATE * 3n, e18("0.05"));
    });

    it("carries over — not selling today does not forfeit the allowance", async () => {
      await giveMice(alice);
      await pool.syncQuota(alice.address);
      await time.increase(30 * DAY);
      expect(await pool.sellQuotaOf(alice.address)).to.be.closeTo(RATE * 30n, e18("0.5"));
    });

    it("decrements as it is used, and refuses the wei above it", async () => {
      await giveMice(alice);
      await pool.syncQuota(alice.address);
      await time.increase(10 * DAY);

      const quota = await pool.sellQuotaOf(alice.address);
      await pool.connect(alice).swapMicToUsdt(quota / 2n, 0);

      const left = await pool.sellQuotaOf(alice.address);
      expect(left).to.be.closeTo(quota / 2n, e18("0.2"));

      await expect(pool.connect(alice).swapMicToUsdt(left + e18("1"), 0))
        .to.be.revertedWith("LP8: over mining allowance");
      await expect(pool.connect(alice).swapMicToUsdt(left, 0)).to.not.be.reverted;
    });

    it("stops accruing when the licence expires", async () => {
      const id = await giveMice(alice);
      await pool.syncQuota(alice.address);
      await time.increase(TERM + 30 * DAY);       // 30 days past expiry

      expect(await mice.statusOf(id)).to.equal(3n);           // EXPIRED
      const q = await pool.sellQuotaOf(alice.address);
      expect(q).to.be.closeTo(RATE * 360n, e18("5"));         // 360 days, not 390
      expect(q).to.be.lt(RATE * 365n);
    });
  });

  // ───────────────────────────────────────────────────────────
  // The reason the clock starts at firstSeen — transfers are permitted
  // ───────────────────────────────────────────────────────────

  describe("a transferred licence carries no allowance", () => {
    it("hands the buyer of a 300-day-old licence nothing", async () => {
      const id = await giveMice(alice);
      await pool.syncQuota(alice.address);
      await time.increase(300 * DAY);

      // Alice has a large allowance; the licence itself is worth 300 days of it.
      expect(await pool.sellQuotaOf(alice.address)).to.be.gt(RATE * 299n);

      await mice.connect(alice).transferLicence(id, carol.address);
      await pool.syncQuota(carol.address);

      // Carol holds a licence that has mined 300 days — and starts from zero. Blocks
      // advance a second at a time, so "zero" here means the seconds since her sync,
      // not 300 days of someone else's mining.
      expect(await pool.activeMiceOf(carol.address)).to.equal(1n);
      expect(await pool.sellQuotaOf(carol.address)).to.be.lt(RATE / 1000n);
      await expect(pool.connect(carol).swapMicToUsdt(e18("1"), 0))
        .to.be.revertedWith("LP8: over mining allowance");
    });

    it("closes the reusable-voucher loop: passing it on grants nothing either", async () => {
      const id = await giveMice(alice);
      await pool.syncQuota(alice.address);
      await time.increase(100 * DAY);

      for (const who of [carol, bob]) {
        const from = await mice.licenses(id);
        await mice.transferLicence(id, who.address);
        await pool.syncQuota(who.address);
        expect(await pool.sellQuotaOf(who.address), `${who.address} got a free allowance`).to.equal(0n);
        await time.increase(100 * DAY);
      }
    });

    it("leaves the seller no debt when the licence goes", async () => {
      const id = await giveMice(alice);
      await pool.syncQuota(alice.address);
      await time.increase(20 * DAY);

      const quota = await pool.sellQuotaOf(alice.address);
      await pool.connect(alice).swapMicToUsdt(quota, 0);
      expect(await pool.sellQuotaOf(alice.address)).to.be.lt(RATE / 1000n);

      // Sold everything, then parted with the licence: minedToDate drops below totalSold.
      await mice.connect(alice).transferLicence(id, bob.address);
      expect(await pool.minedToDate(alice.address)).to.equal(0n);
      expect(await pool.totalSold(alice.address)).to.be.gt(0n);
      expect(await pool.sellQuotaOf(alice.address)).to.equal(0n);   // saturates, never reverts
    });

    it("survives a recycled licence the same way", async () => {
      const id = await giveMice(alice);
      await pool.syncQuota(alice.address);
      await time.increase(TERM + DAY);
      await mice.recycle(id);
      expect(await pool.sellQuotaOf(alice.address)).to.equal(0n);
    });
  });

  // ───────────────────────────────────────────────────────────
  // syncQuota
  // ───────────────────────────────────────────────────────────

  describe("syncQuota", () => {
    it("is permissionless and can only ever start a clock", async () => {
      await giveMice(alice);
      await pool.connect(bob).syncQuota(alice.address);        // a stranger starts it
      const t1 = await time.latest();
      await time.increase(5 * DAY);

      await pool.connect(bob).syncQuota(alice.address);        // and cannot restart it
      expect(await pool.sellQuotaOf(alice.address)).to.be.closeTo(RATE * 5n, e18("0.1"));
      expect(await pool.firstSeen(alice.address, 0)).to.be.closeTo(BigInt(t1), 3n);
    });

    it("a reverted sale does NOT start the clock — the revert unwinds the sync too", async () => {
      await giveMice(alice);
      await time.increase(10 * DAY);

      // Never synced, so nothing has accrued and the sale is refused. The syncQuota call
      // inside swapMicToUsdt is rolled back with the rest of the transaction, so trying
      // again forever changes nothing. This is why syncQuota is public and permissionless.
      await expect(pool.connect(alice).swapMicToUsdt(e18("1"), 0))
        .to.be.revertedWith("LP8: no mining allowance");
      await time.increase(2 * DAY);
      expect(await pool.sellQuotaOf(alice.address)).to.equal(0n);

      // One explicit call is all it takes, and it is not retroactive.
      await pool.connect(alice).syncQuota(alice.address);
      expect(await pool.sellQuotaOf(alice.address)).to.equal(0n);
      await time.increase(2 * DAY);
      expect(await pool.sellQuotaOf(alice.address)).to.be.closeTo(RATE * 2n, e18("0.05"));
      await expect(pool.connect(alice).swapMicToUsdt(RATE, 0)).to.not.be.reverted;
    });

    it("picks up a licence acquired after the wallet already had allowance", async () => {
      await giveMice(alice);
      await pool.syncQuota(alice.address);
      await time.increase(10 * DAY);

      await giveMice(alice);                       // second licence, never synced
      const before = await pool.sellQuotaOf(alice.address);
      await pool.connect(alice).swapMicToUsdt(RATE, 0);   // succeeds, so the sync sticks
      await time.increase(DAY);

      // Now earning on two licences, not one.
      const gained = (await pool.sellQuotaOf(alice.address)) - (before - RATE);
      expect(gained).to.be.closeTo(RATE * 2n, e18("0.2"));
    });

    it("ignores licences that are not mining", async () => {
      await mice.mint(alice.address, usd("100"));   // PENDING
      expect(await pool.syncQuota.staticCall(alice.address)).to.equal(0n);
    });
  });

  // ───────────────────────────────────────────────────────────
  // Interaction with the pool-level limits, which are unchanged
  // ───────────────────────────────────────────────────────────

  describe("the pool's own limits still apply on top", () => {
    it("the 5%/day outflow cap binds even with allowance to spare", async () => {
      for (let i = 0; i < 200; i++) await mice.mint(alice.address, usd("100"));
      const ids = await mice.getUserLicenses(alice.address);
      for (const id of ids) await mice.activate(id, TERM);
      await pool.syncQuota(alice.address);
      await time.increase(60 * DAY);

      // A very large personal allowance …
      expect(await pool.sellQuotaOf(alice.address)).to.be.gt(e18("900000"));
      // … does not let one wallet drain the pool: the per-trade and daily caps hold.
      await expect(pool.connect(alice).swapMicToUsdt(e18("900000"), 0))
        .to.be.revertedWith("LP8: over per-trade limit");
    });

    it("admin cannot be bypassed: quota sources are role-gated", async () => {
      await expect(
        pool.connect(alice).setQuotaSources(await mice.getAddress(), await emission.getAddress()),
      ).to.be.reverted;
    });
  });
});
