import { expect } from "chai"
import { loadFixture, time } from "@nomicfoundation/hardhat-toolbox/network-helpers"
import { ethers } from "hardhat"

/**
 * PeriodRewardPool — the weekly and monthly USDT programmes.
 *
 * These do not pay by time held. Weekly goes only to Community NFTs minted inside that
 * week; monthly goes to every NFT still valid at 24:00 GMT on the last day of the month.
 * Both are decided by the period, so both are settled as sealed snapshots rather than as
 * a running accumulator.
 *
 * The properties worth defending are all about the seal:
 *
 *  · a period cannot be sealed for more money than the contract holds
 *  · nothing about a sealed period can move, because a weight changing after the first
 *    claim would quietly re-price everyone else's share
 *  · a batch written twice must not pay anyone twice — a retried transaction is one of
 *    the likeliest operational mistakes here
 */

const USD = (n: string | number) => ethers.parseEther(String(n))
const DAY = 86400

const W_BUILDER = 10_000n
const W_MAKER = 25_000n
const W_LUMINARY = 50_000n

async function setup() {
  const [admin, funder, alice, bob, carol, dave] = await ethers.getSigners()

  const usdt: any = await (await ethers.getContractFactory("MockUSDT")).deploy()
  const pool: any = await (await ethers.getContractFactory("PeriodRewardPool"))
    .deploy(await usdt.getAddress(), admin.address)

  await pool.grantRole(await pool.FUNDER_ROLE(), funder.address)
  await usdt.mint(funder.address, USD(1_000_000))
  await usdt.connect(funder).approve(await pool.getAddress(), ethers.MaxUint256)

  return { usdt, pool, admin, funder, alice, bob, carol, dave }
}

/** Open, fund, fill and seal one period in the shape the operator would. */
async function makePeriod(
  ctx: any,
  label: string,
  amount: bigint,
  cohort: Array<[string, bigint]>,
) {
  const now = await time.latest()
  const tx = await ctx.pool.openPeriod(label, now, now + 7 * DAY)
  await tx.wait()
  const id = Number(await ctx.pool.periodCount()) - 1

  await ctx.pool.connect(ctx.funder).fundPeriod(id, amount)
  await ctx.pool.setWeights(id, cohort.map((c) => c[0]), cohort.map((c) => c[1]))
  await ctx.pool.finalize(id)
  return id
}

describe("PeriodRewardPool", () => {
  describe("a sealed period pays by weight", () => {
    it("splits in proportion to tier weight", async () => {
      const ctx = await loadFixture(setup)
      const id = await makePeriod(ctx, "2026-W33", USD(8_000), [
        [ctx.alice.address, W_BUILDER],    // ×1
        [ctx.bob.address, W_LUMINARY],     // ×5
        [ctx.carol.address, W_MAKER],      // ×2.5
      ])

      // Weights 1 : 5 : 2.5 of $8,000 → 941.18 / 4705.88 / 2352.94
      expect(await ctx.pool.claimableOf(id, ctx.alice.address)).to.be.closeTo(USD(941.18), USD(1))
      expect(await ctx.pool.claimableOf(id, ctx.bob.address)).to.be.closeTo(USD(4705.88), USD(1))
      expect(await ctx.pool.claimableOf(id, ctx.carol.address)).to.be.closeTo(USD(2352.94), USD(1))
    })

    it("pays out on claim and not twice", async () => {
      const ctx = await loadFixture(setup)
      const id = await makePeriod(ctx, "2026-W33", USD(1_000), [
        [ctx.alice.address, W_BUILDER],
        [ctx.bob.address, W_BUILDER],
      ])

      await ctx.pool.connect(ctx.alice).claim(id)
      expect(await ctx.usdt.balanceOf(ctx.alice.address)).to.equal(USD(500))
      await expect(ctx.pool.connect(ctx.alice).claim(id)).to.be.revertedWith("PRP: nothing to claim")
    })

    it("gives nothing to someone outside the cohort", async () => {
      const ctx = await loadFixture(setup)
      const id = await makePeriod(ctx, "2026-W33", USD(1_000), [[ctx.alice.address, W_BUILDER]])
      expect(await ctx.pool.claimableOf(id, ctx.dave.address)).to.equal(0n)
      await expect(ctx.pool.connect(ctx.dave).claim(id)).to.be.revertedWith("PRP: nothing to claim")
    })

    it("never pays out more than the period held", async () => {
      const ctx = await loadFixture(setup)
      const id = await makePeriod(ctx, "2026-W33", USD(1_000), [
        [ctx.alice.address, 1n], [ctx.bob.address, 1n], [ctx.carol.address, 1n],
      ])
      for (const who of [ctx.alice, ctx.bob, ctx.carol]) await ctx.pool.connect(who).claim(id)

      const paid = (await ctx.usdt.balanceOf(ctx.alice.address))
        + (await ctx.usdt.balanceOf(ctx.bob.address))
        + (await ctx.usdt.balanceOf(ctx.carol.address))
      // Integer division leaves dust behind rather than overspending.
      expect(paid).to.be.lte(USD(1_000))
      expect(USD(1_000) - paid).to.be.lt(10n)
    })
  })

  describe("weekly cohorts are independent", () => {
    it("a wallet in week 1 gets nothing from week 2 unless it is in that cohort too", async () => {
      const ctx = await loadFixture(setup)
      // Alice minted an NFT in week 1; Bob minted one in week 2.
      const w1 = await makePeriod(ctx, "2026-W33", USD(1_000), [[ctx.alice.address, W_BUILDER]])
      const w2 = await makePeriod(ctx, "2026-W34", USD(1_000), [[ctx.bob.address, W_BUILDER]])

      expect(await ctx.pool.claimableOf(w1, ctx.alice.address)).to.equal(USD(1_000))
      // This is the rule that separates weekly from the streaming pool: still holding an
      // older NFT earns nothing in a later week.
      expect(await ctx.pool.claimableOf(w2, ctx.alice.address)).to.equal(0n)
      expect(await ctx.pool.claimableOf(w2, ctx.bob.address)).to.equal(USD(1_000))
    })

    it("claims several weeks in one transaction", async () => {
      const ctx = await loadFixture(setup)
      const w1 = await makePeriod(ctx, "2026-W33", USD(600), [[ctx.alice.address, W_BUILDER]])
      const w2 = await makePeriod(ctx, "2026-W34", USD(400), [[ctx.alice.address, W_BUILDER]])

      expect(await ctx.pool.totalClaimable(ctx.alice.address)).to.equal(USD(1_000))
      await ctx.pool.connect(ctx.alice).claimMany([w1, w2])
      expect(await ctx.usdt.balanceOf(ctx.alice.address)).to.equal(USD(1_000))
    })

    it("claimMany skips what is already claimed rather than reverting", async () => {
      const ctx = await loadFixture(setup)
      const w1 = await makePeriod(ctx, "2026-W33", USD(600), [[ctx.alice.address, W_BUILDER]])
      const w2 = await makePeriod(ctx, "2026-W34", USD(400), [[ctx.alice.address, W_BUILDER]])
      await ctx.pool.connect(ctx.alice).claim(w1)

      await ctx.pool.connect(ctx.alice).claimMany([w1, w2])
      expect(await ctx.usdt.balanceOf(ctx.alice.address)).to.equal(USD(1_000))
    })
  })

  describe("writing the cohort", () => {
    it("a batch sent twice does not double anyone's share", async () => {
      const ctx = await loadFixture(setup)
      const now = await time.latest()
      await ctx.pool.openPeriod("2026-W33", now, now + 7 * DAY)
      await ctx.pool.connect(ctx.funder).fundPeriod(0, USD(1_000))

      const wallets = [ctx.alice.address, ctx.bob.address]
      const weights = [W_BUILDER, W_BUILDER]
      await ctx.pool.setWeights(0, wallets, weights)
      // The retry an operator makes after a timeout, which in a naive implementation
      // would double both weights and halve everyone's actual payout.
      await ctx.pool.setWeights(0, wallets, weights)

      const p = await ctx.pool.getPeriod(0)
      expect(p.totalWeight).to.equal(W_BUILDER * 2n)
      expect(p.entrants).to.equal(2n)
    })

    it("corrects a weight before sealing", async () => {
      const ctx = await loadFixture(setup)
      const now = await time.latest()
      await ctx.pool.openPeriod("2026-W33", now, now + 7 * DAY)
      await ctx.pool.connect(ctx.funder).fundPeriod(0, USD(1_000))
      await ctx.pool.setWeights(0, [ctx.alice.address], [W_LUMINARY])
      await ctx.pool.setWeights(0, [ctx.alice.address], [W_BUILDER])   // was the wrong tier

      const p = await ctx.pool.getPeriod(0)
      expect(p.totalWeight).to.equal(W_BUILDER)
      expect(p.entrants).to.equal(1n)
    })

    it("removing a wallet drops the entrant count", async () => {
      const ctx = await loadFixture(setup)
      const now = await time.latest()
      await ctx.pool.openPeriod("2026-W33", now, now + 7 * DAY)
      await ctx.pool.setWeights(0, [ctx.alice.address, ctx.bob.address], [W_BUILDER, W_BUILDER])
      await ctx.pool.setWeights(0, [ctx.bob.address], [0n])

      const p = await ctx.pool.getPeriod(0)
      expect(p.entrants).to.equal(1n)
      expect(p.totalWeight).to.equal(W_BUILDER)
    })

    it("refuses to write after sealing", async () => {
      const ctx = await loadFixture(setup)
      const id = await makePeriod(ctx, "2026-W33", USD(1_000), [[ctx.alice.address, W_BUILDER]])
      await expect(
        ctx.pool.setWeights(id, [ctx.bob.address], [W_BUILDER]),
      ).to.be.revertedWith("PRP: period finalized")
    })

    it("refuses to fund after sealing", async () => {
      const ctx = await loadFixture(setup)
      const id = await makePeriod(ctx, "2026-W33", USD(1_000), [[ctx.alice.address, W_BUILDER]])
      await expect(
        ctx.pool.connect(ctx.funder).fundPeriod(id, USD(1)),
      ).to.be.revertedWith("PRP: period finalized")
    })
  })

  describe("sealing", () => {
    it("refuses to seal a period nobody funded", async () => {
      const ctx = await loadFixture(setup)
      const now = await time.latest()
      await ctx.pool.openPeriod("2026-W33", now, now + 7 * DAY)
      await ctx.pool.setWeights(0, [ctx.alice.address], [W_BUILDER])

      // Sealing here would be worse than useless: funding is refused afterwards, so the
      // cohort would be permanently entitled to nothing with no way to correct it.
      await expect(ctx.pool.finalize(0)).to.be.revertedWith("PRP: not funded")
    })

    it("refuses to seal an empty cohort", async () => {
      const ctx = await loadFixture(setup)
      const now = await time.latest()
      await ctx.pool.openPeriod("2026-W33", now, now + 7 * DAY)
      await ctx.pool.connect(ctx.funder).fundPeriod(0, USD(1_000))
      await expect(ctx.pool.finalize(0)).to.be.revertedWith("PRP: no entrants")
    })

    it("each sealed period is backed by its own money", async () => {
      const ctx = await loadFixture(setup)
      await makePeriod(ctx, "2026-W33", USD(1_000), [[ctx.alice.address, W_BUILDER]])
      await makePeriod(ctx, "2026-W34", USD(2_000), [[ctx.bob.address, W_BUILDER]])

      // Both sealed, both fully backed — funding only ever moves real tokens in, so a
      // period cannot promise money that belongs to another one.
      expect(await ctx.pool.outstanding()).to.equal(USD(3_000))
      expect(await ctx.usdt.balanceOf(await ctx.pool.getAddress())).to.equal(USD(3_000))
    })

    it("nothing is claimable before sealing", async () => {
      const ctx = await loadFixture(setup)
      const now = await time.latest()
      await ctx.pool.openPeriod("2026-W33", now, now + 7 * DAY)
      await ctx.pool.connect(ctx.funder).fundPeriod(0, USD(1_000))
      await ctx.pool.setWeights(0, [ctx.alice.address], [W_BUILDER])

      expect(await ctx.pool.claimableOf(0, ctx.alice.address)).to.equal(0n)
      await expect(ctx.pool.connect(ctx.alice).claim(0)).to.be.revertedWith("PRP: nothing to claim")
    })

    it("refuses to seal twice", async () => {
      const ctx = await loadFixture(setup)
      const id = await makePeriod(ctx, "2026-W33", USD(1_000), [[ctx.alice.address, W_BUILDER]])
      await expect(ctx.pool.finalize(id)).to.be.revertedWith("PRP: already finalized")
    })
  })

  describe("unclaimed value", () => {
    it("stays claimable for six months", async () => {
      const ctx = await loadFixture(setup)
      const id = await makePeriod(ctx, "2026-W33", USD(1_000), [
        [ctx.alice.address, W_BUILDER], [ctx.bob.address, W_BUILDER],
      ])
      await time.increase(150 * DAY)
      await expect(ctx.pool.sweepUnclaimed(id, ctx.admin.address)).to.be.revertedWith("PRP: too early")

      // Bob, who went quiet for five months, is still paid in full.
      await ctx.pool.connect(ctx.bob).claim(id)
      expect(await ctx.usdt.balanceOf(ctx.bob.address)).to.equal(USD(500))
    })

    it("can be swept after the delay", async () => {
      const ctx = await loadFixture(setup)
      const id = await makePeriod(ctx, "2026-W33", USD(1_000), [
        [ctx.alice.address, W_BUILDER], [ctx.bob.address, W_BUILDER],
      ])
      await ctx.pool.connect(ctx.alice).claim(id)
      await time.increase(181 * DAY)

      // A second period funded and sealed alongside it — so if a post-sweep claim were
      // still possible, it would be paid out of these holders' money.
      const other = await makePeriod(ctx, "2026-W34", USD(900), [[ctx.dave.address, W_BUILDER]])

      await ctx.pool.sweepUnclaimed(id, ctx.carol.address)
      expect(await ctx.usdt.balanceOf(ctx.carol.address)).to.equal(USD(500))

      // The sweep closes the period. Before this was enforced, `claimableOf` kept quoting
      // Bob his $500 and the claim would have been paid out of another period's balance.
      expect(await ctx.pool.claimableOf(id, ctx.bob.address)).to.equal(0n)
      await expect(ctx.pool.connect(ctx.bob).claim(id)).to.be.revertedWith("PRP: nothing to claim")

      // And week 34's money is untouched.
      expect(await ctx.pool.claimableOf(other, ctx.dave.address)).to.equal(USD(900))
      await ctx.pool.connect(ctx.dave).claim(other)
      expect(await ctx.usdt.balanceOf(ctx.dave.address)).to.equal(USD(900))
    })
  })

  describe("access control", () => {
    it("only the operator opens, writes and seals", async () => {
      const ctx = await loadFixture(setup)
      const now = await time.latest()
      await expect(ctx.pool.connect(ctx.alice).openPeriod("x", now, now + DAY)).to.be.reverted
      await ctx.pool.openPeriod("2026-W33", now, now + 7 * DAY)
      await expect(ctx.pool.connect(ctx.alice).setWeights(0, [ctx.alice.address], [1n])).to.be.reverted
      await expect(ctx.pool.connect(ctx.alice).finalize(0)).to.be.reverted
    })

    it("only a funder deposits", async () => {
      const ctx = await loadFixture(setup)
      const now = await time.latest()
      await ctx.pool.openPeriod("2026-W33", now, now + 7 * DAY)
      await expect(ctx.pool.connect(ctx.alice).fundPeriod(0, USD(1))).to.be.reverted
    })

    it("rescueToken refuses the reward token", async () => {
      const ctx = await loadFixture(setup)
      await expect(
        ctx.pool.rescueToken(await ctx.usdt.getAddress(), ctx.alice.address, 1n),
      ).to.be.revertedWith("PRP: use sweepUnclaimed")
    })
  })
})
