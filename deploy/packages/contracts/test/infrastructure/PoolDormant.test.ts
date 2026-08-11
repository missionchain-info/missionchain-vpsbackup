import { expect } from "chai"
import { loadFixture, time } from "@nomicfoundation/hardhat-toolbox/network-helpers"
import { ethers } from "hardhat"

/**
 * LiquidityPoolV6 — dormant until seeded.
 *
 * The pool is now deployed days before it receives its MIC, so the gap between the two
 * has to cost nothing. It used to cost a great deal: `spotPrice()` is zero while the pool
 * holds no MIC, and the price accumulator ran from deployment, so every idle second was
 * averaged in as a price of zero.
 *
 * That is not a cosmetic error. `MICELicense` prices its MIC burn at `min(spot, twap7d)`,
 * and a depressed average means a buyer burns *more* MIC for the same $50 — three times
 * more, after a two-day gap. `EmissionController.brakeEngaged()` compares the same
 * average against half the opening price, so it would also trip and halve issuance over a
 * price fall that never happened.
 *
 * The fix is to make "the pool started" mean the seed, not the deployment.
 */

const MIC = (n: string | number) => ethers.parseEther(String(n))
const USD = (n: string | number) => ethers.parseEther(String(n))
const DAY = 86400

const VIRTUAL = USD(500_000)
const SEED = MIC(50_000_000)
const OPENING = ethers.parseEther("0.01")   // $500,000 / 50,000,000

async function setup() {
  const [admin, router, trader] = await ethers.getSigners()

  const usdt: any = await (await ethers.getContractFactory("MockUSDT")).deploy()
  const mic: any = await (await ethers.getContractFactory("MICToken")).deploy(admin.address)
  const pool: any = await (await ethers.getContractFactory("LiquidityPoolV6"))
    .deploy(await usdt.getAddress(), await mic.getAddress(), VIRTUAL, admin.address)

  await pool.grantRole(await pool.DISTRIBUTOR_ROLE(), router.address)
  await mic.connect(admin).approve(await pool.getAddress(), ethers.MaxUint256)
  await usdt.mint(router.address, USD(1_000_000))
  await usdt.mint(trader.address, USD(100_000))
  await usdt.connect(router).approve(await pool.getAddress(), ethers.MaxUint256)
  await usdt.connect(trader).approve(await pool.getAddress(), ethers.MaxUint256)

  return { usdt, mic, pool, admin, router, trader }
}

describe("LiquidityPoolV6 — dormant until seeded", () => {
  describe("before the seed", () => {
    it("reports itself as not started", async () => {
      const { pool } = await loadFixture(setup)
      expect(await pool.isSeeded()).to.equal(false)
      expect(await pool.startTime()).to.equal(0n)
      expect(await pool.poolAgeDays()).to.equal(0n)
    })

    it("quotes no price rather than a wrong one", async () => {
      const { pool } = await loadFixture(setup)
      expect(await pool.spotPrice()).to.equal(0n)
      expect(await pool.twap7d()).to.equal(0n)
      expect(await pool.twap30d()).to.equal(0n)
    })

    it("refuses to trade", async () => {
      const { pool, trader } = await loadFixture(setup)
      await expect(pool.connect(trader).swapUsdtToMic(USD(100), 0)).to.be.revertedWith("LP6: pool not seeded")
      await expect(pool.connect(trader).swapMicToUsdt(MIC(100), 0)).to.be.revertedWith("LP6: pool not seeded")
    })

    it("refuses revenue, which would move the opening price", async () => {
      const { pool, router } = await loadFixture(setup)
      // Reserve over MIC is the price; USDT arriving with no MIC behind it would set the
      // opening above the published $0.01.
      await expect(pool.connect(router).receiveUSDT(USD(10_000))).to.be.revertedWith("LP6: pool not seeded")
    })

    it("cannot advance its phase", async () => {
      const { pool } = await loadFixture(setup)
      await time.increase(DAY * 60)
      await expect(pool.advancePhase()).to.be.revertedWith("LP6: condition not met")
    })

    it("a poke costs nothing and records nothing", async () => {
      const { pool } = await loadFixture(setup)
      await time.increase(DAY * 3)
      await pool.poke()
      expect(await pool.isSeeded()).to.equal(false)
      expect(await pool.twap7d()).to.equal(0n)
    })
  })

  describe("the seed starts everything", () => {
    it("sets the clock to the moment of seeding, not deployment", async () => {
      const { pool, admin } = await loadFixture(setup)
      await time.increase(DAY * 2)

      const tx = await pool.connect(admin).seedMic(SEED)
      const receipt = await tx.wait()
      const block = await ethers.provider.getBlock(receipt!.blockNumber)

      expect(await pool.isSeeded()).to.equal(true)
      expect(await pool.startTime()).to.equal(BigInt(block!.timestamp))
      expect(await pool.poolAgeDays()).to.equal(0n)
    })

    it("opens at exactly $0.01", async () => {
      const { pool, admin } = await loadFixture(setup)
      await time.increase(DAY * 2)
      await pool.connect(admin).seedMic(SEED)
      expect(await pool.spotPrice()).to.equal(OPENING)
    })

    it("emits PoolStarted once", async () => {
      const { pool, admin, mic } = await loadFixture(setup)
      await expect(pool.connect(admin).seedMic(SEED)).to.emit(pool, "PoolStarted")
      // A later top-up is just a top-up; the pool does not start twice.
      await mic.connect(admin).approve(await pool.getAddress(), ethers.MaxUint256)
      await expect(pool.connect(admin).seedMic(MIC(1_000))).to.not.emit(pool, "PoolStarted")
    })
  })

  describe("the gap does not poison the average", () => {
    it("reads the true price a day after seeding, whatever the delay was", async () => {
      const { pool, admin } = await loadFixture(setup)

      // The scenario that made this change necessary: deploy now, seed two days later.
      await time.increase(DAY * 2)
      await pool.connect(admin).seedMic(SEED)
      await time.increase(DAY)
      await pool.poke()

      // Under the old behaviour this read about $0.0033 — two days of zeros divided
      // across a three-day window.
      expect(await pool.twap7d()).to.be.closeTo(OPENING, ethers.parseEther("0.0002"))
    })

    it("stays true after a week-long delay", async () => {
      const { pool, admin } = await loadFixture(setup)
      await time.increase(DAY * 7)
      await pool.connect(admin).seedMic(SEED)
      await time.increase(DAY * 2)
      await pool.poke()
      expect(await pool.twap7d()).to.be.closeTo(OPENING, ethers.parseEther("0.0002"))
    })

    it("keeps the emission brake off, since no price ever fell", async () => {
      const { pool, admin } = await loadFixture(setup)
      await time.increase(DAY * 2)
      await pool.connect(admin).seedMic(SEED)
      await time.increase(DAY)
      await pool.poke()

      // brakeEngaged() trips below half the opening price. A poisoned average would have
      // sat under it and halved issuance for days.
      expect(await pool.twap7d()).to.be.gt(OPENING / 2n)
    })
  })

  describe("the 30-day sell gate counts from the seed", () => {
    it("does not open early because the contract was deployed early", async () => {
      const { pool, admin } = await loadFixture(setup)
      await time.increase(DAY * 5)          // five days deployed, dormant
      await pool.connect(admin).seedMic(SEED)

      await time.increase(DAY * 27)         // 27 days of a working pool
      await expect(pool.advancePhase()).to.be.revertedWith("LP6: condition not met")

      await time.increase(DAY * 3)          // day 30 of the pool's real life
      await pool.advancePhase()
      expect(await pool.phase()).to.equal(1) // TwoWay
    })
  })
})
