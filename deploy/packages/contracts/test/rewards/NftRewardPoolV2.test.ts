import { expect } from "chai"
import { loadFixture, time } from "@nomicfoundation/hardhat-toolbox/network-helpers"
import { ethers } from "hardhat"

/**
 * NftRewardPoolV2 — Community NFT holders claim their own rewards.
 *
 * The pool it replaces pushed MIC out in operator-run batches, which meant there was
 * nothing for a holder to press and nothing happened on a day nobody ran it. Here the MIC
 * accrues by the second against tier weight and waits to be claimed.
 *
 * Two properties carry the weight:
 *
 *  · **Weight is the tier multiplier, read live.** Builder ×1, Maker ×2.5, Luminary ×5,
 *    taken from the NFT contract rather than copied, so a DAO vote that changes a
 *    multiplier moves the rewards with it.
 *
 *  · **Expiry is exact, and out of order.** Durations differ (60/90/180 days), so NFTs do
 *    not expire in the order they were minted. The min-heap is what makes that safe, and
 *    it is the part most worth attacking in tests: a heap that retires the wrong token
 *    would silently pay the wrong person for months.
 */

const MIC = (n: string | number) => ethers.parseEther(String(n))
const DAY = 86400

const W_BUILDER = 10_000n
const W_MAKER = 25_000n
const W_LUMINARY = 50_000n

async function setup() {
  const [admin, emission, alice, bob, carol] = await ethers.getSigners()

  const mic: any = await (await ethers.getContractFactory("MICToken")).deploy(admin.address)
  const nft: any = await (await ethers.getContractFactory("MockCommunityNFTV2")).deploy()

  const pool: any = await (await ethers.getContractFactory("NftRewardPoolV2"))
    .deploy(await mic.getAddress(), await nft.getAddress(), 0, admin.address)

  await pool.grantRole(await pool.EMISSION_ROLE(), emission.address)
  await mic.grantRole(await mic.MINTER_ROLE(), admin.address)

  return { mic, nft, pool, admin, emission, alice, bob, carol }
}

/** Mint a token in the mock and enrol it, the way the keeper would. */
async function give(ctx: any, tokenId: number, owner: string, tier: number, durationDays: number) {
  const now = await time.latest()
  await ctx.nft.setToken(tokenId, owner, tier, now + durationDays * DAY + 1)
  await ctx.pool.enroll(tokenId)
}

async function fund(ctx: any, amount: bigint) {
  await ctx.mic.mintFromMining(await ctx.pool.getAddress(), amount)
  await ctx.pool.connect(ctx.emission).notifyReward(amount)
}

describe("NftRewardPoolV2", () => {
  describe("weight follows the tier", () => {
    it("uses the multiplier the NFT contract reports", async () => {
      const ctx = await loadFixture(setup)
      await give(ctx, 1, ctx.alice.address, 1, 60)
      await give(ctx, 2, ctx.bob.address, 3, 180)

      expect(await ctx.pool.weightOf(ctx.alice.address)).to.equal(W_BUILDER)
      expect(await ctx.pool.weightOf(ctx.bob.address)).to.equal(W_LUMINARY)
      expect(await ctx.pool.totalWeight()).to.equal(W_BUILDER + W_LUMINARY)
    })

    it("splits a day's reward by weight, not by head count", async () => {
      const ctx = await loadFixture(setup)
      await give(ctx, 1, ctx.alice.address, 1, 60)    // ×1
      await give(ctx, 2, ctx.bob.address, 3, 180)     // ×5
      await fund(ctx, MIC(600))
      await time.increase(DAY)

      // 1 : 5 → 100 and 500, not 300 each.
      expect(await ctx.pool.claimable(ctx.alice.address)).to.be.closeTo(MIC(100), MIC("0.05"))
      expect(await ctx.pool.claimable(ctx.bob.address)).to.be.closeTo(MIC(500), MIC("0.05"))
    })

    it("adds up when one wallet holds several", async () => {
      const ctx = await loadFixture(setup)
      await give(ctx, 1, ctx.alice.address, 1, 60)
      await give(ctx, 2, ctx.alice.address, 2, 90)
      expect(await ctx.pool.weightOf(ctx.alice.address)).to.equal(W_BUILDER + W_MAKER)
    })
  })

  describe("claiming", () => {
    it("pays out to the wallet", async () => {
      const ctx = await loadFixture(setup)
      await give(ctx, 1, ctx.alice.address, 1, 60)
      await fund(ctx, MIC(1_000))
      await time.increase(DAY)

      await ctx.pool.connect(ctx.alice).claim()
      expect(await ctx.mic.balanceOf(ctx.alice.address)).to.be.closeTo(MIC(1_000), MIC("0.05"))
    })

    it("claiming late pays the same as claiming often", async () => {
      const ctx = await loadFixture(setup)
      await give(ctx, 1, ctx.alice.address, 2, 90)
      await give(ctx, 2, ctx.bob.address, 2, 90)

      for (let d = 0; d < 7; d++) {
        await fund(ctx, MIC(1_000))
        await time.increase(DAY)
        await ctx.pool.connect(ctx.alice).claim()
      }
      await ctx.pool.connect(ctx.bob).claim()

      expect(await ctx.mic.balanceOf(ctx.bob.address))
        .to.be.closeTo(await ctx.mic.balanceOf(ctx.alice.address), MIC("0.05"))
    })

    it("refuses an empty claim", async () => {
      const ctx = await loadFixture(setup)
      await expect(ctx.pool.connect(ctx.alice).claim()).to.be.revertedWith("NRP: nothing to claim")
    })

    it("never pays out more than it holds", async () => {
      const ctx = await loadFixture(setup)
      await give(ctx, 1, ctx.alice.address, 3, 180)
      await give(ctx, 2, ctx.bob.address, 1, 60)
      for (let d = 0; d < 3; d++) { await fund(ctx, MIC(1_000)); await time.increase(DAY) }

      await ctx.pool.connect(ctx.alice).claim()
      await ctx.pool.connect(ctx.bob).claim()
      const paid = (await ctx.mic.balanceOf(ctx.alice.address)) + (await ctx.mic.balanceOf(ctx.bob.address))
      expect(paid).to.be.lte(MIC(3_000))
    })
  })

  describe("expiry, out of order", () => {
    it("retires the Luminary first when it was minted first but expires last", async () => {
      const ctx = await loadFixture(setup)
      // Minted in this order, but they expire in the reverse: a queue would get it wrong.
      await give(ctx, 1, ctx.alice.address, 3, 30)   // Luminary, 30 days
      await give(ctx, 2, ctx.bob.address, 1, 10)     // Builder, 10 days
      await give(ctx, 3, ctx.carol.address, 2, 20)   // Maker, 20 days

      await time.increase(11 * DAY)
      await ctx.pool.sync()
      // Only Bob's has run out.
      expect(await ctx.pool.weightOf(ctx.bob.address)).to.equal(0n)
      expect(await ctx.pool.weightOf(ctx.carol.address)).to.equal(W_MAKER)
      expect(await ctx.pool.weightOf(ctx.alice.address)).to.equal(W_LUMINARY)

      await time.increase(10 * DAY)
      await ctx.pool.sync()
      expect(await ctx.pool.weightOf(ctx.carol.address)).to.equal(0n)
      expect(await ctx.pool.weightOf(ctx.alice.address)).to.equal(W_LUMINARY)

      await time.increase(10 * DAY)
      await ctx.pool.sync()
      expect(await ctx.pool.totalWeight()).to.equal(0n)
    })

    it("stops earning at the expiry second, with nobody calling anything", async () => {
      const ctx = await loadFixture(setup)
      await give(ctx, 1, ctx.alice.address, 1, 1)     // one day
      await fund(ctx, MIC(1_000))

      await time.increase(5 * DAY)
      await ctx.pool.sync()

      // Five days later, still exactly one day's worth.
      expect(await ctx.pool.claimable(ctx.alice.address)).to.be.closeTo(MIC(1_000), MIC("0.05"))
      expect(await ctx.pool.weightOf(ctx.alice.address)).to.equal(0n)
    })

    it("hands the expired share to whoever is still active", async () => {
      const ctx = await loadFixture(setup)
      // Alice's runs half a day; Bob's has a month left. 2,000 MIC streams over one day,
      // so the first half day pays 1,000 split evenly and the second pays 1,000 to Bob
      // alone — the expiry moves the divisor, which is the whole point.
      const base = await time.latest()
      await ctx.nft.setToken(1, ctx.alice.address, 1, base + DAY / 2)
      await ctx.pool.enroll(1)
      await ctx.nft.setToken(2, ctx.bob.address, 1, base + 30 * DAY)
      await ctx.pool.enroll(2)
      await fund(ctx, MIC(2_000))

      await time.increase(DAY)
      await ctx.pool.sync()

      expect(await ctx.pool.claimable(ctx.alice.address)).to.be.closeTo(MIC(500), MIC(5))
      expect(await ctx.pool.claimable(ctx.bob.address)).to.be.closeTo(MIC(1_500), MIC(5))
    })

    it("keeps the earnings claimable after the NFT has gone", async () => {
      const ctx = await loadFixture(setup)
      await give(ctx, 1, ctx.alice.address, 1, 1)
      await fund(ctx, MIC(1_000))
      await time.increase(3 * DAY)
      await ctx.pool.sync()

      await ctx.pool.connect(ctx.alice).claim()
      expect(await ctx.mic.balanceOf(ctx.alice.address)).to.be.closeTo(MIC(1_000), MIC("0.05"))
    })

    it("survives twenty NFTs expiring in a scrambled order", async () => {
      const ctx = await loadFixture(setup)
      // Durations deliberately jumbled so the heap has to do real work.
      const durations = [17, 3, 29, 8, 1, 22, 11, 5, 26, 14, 2, 19, 7, 24, 12, 30, 9, 4, 21, 16]

      // Every expiry is anchored to one base timestamp. Setting them relative to "now" at
      // each enrolment instead drifts by a second per token, which is enough to retire a
      // borderline NFT early and make the test argue with itself rather than the contract.
      const base = await time.latest()
      for (let i = 0; i < durations.length; i++) {
        await ctx.nft.setToken(i + 1, ctx.alice.address, 1, base + durations[i] * DAY)
        await ctx.pool.enroll(i + 1)
      }
      expect(await ctx.pool.totalWeight()).to.equal(W_BUILDER * 20n)

      // Walk to each checkpoint and confirm exactly the right tokens survive. The earlier
      // version advanced a single day per iteration while asserting against day 31, so it
      // was comparing the contract against a timeline the test never reached.
      for (const day of [2, 6, 10, 15, 20, 25, 31]) {
        // Land half a day past the checkpoint so no expiry sits exactly on the boundary.
        await time.increaseTo(base + day * DAY + DAY / 2)
        await ctx.pool.sync()
        await ctx.pool.sync()   // a second pass drains anything the per-call cap held back

        const alive = durations.filter((d) => d > day).length
        expect(await ctx.pool.totalWeight(), `day ${day}`).to.equal(W_BUILDER * BigInt(alive))
      }
      expect(await ctx.pool.totalWeight()).to.equal(0n)
    })
  })

  describe("transfer", () => {
    it("keeps paying the seller until somebody resyncs", async () => {
      const ctx = await loadFixture(setup)
      await give(ctx, 1, ctx.alice.address, 1, 60)
      await fund(ctx, MIC(1_000))
      await time.increase(DAY / 2)

      await ctx.nft.setOwner(1, ctx.bob.address)   // sold, pool cannot see it
      expect(await ctx.pool.weightOf(ctx.bob.address)).to.equal(0n)

      await ctx.pool.resync(1)
      expect(await ctx.pool.weightOf(ctx.bob.address)).to.equal(W_BUILDER)
      expect(await ctx.pool.weightOf(ctx.alice.address)).to.equal(0n)
      // Alice keeps the half day she actually held it for.
      expect(await ctx.pool.claimable(ctx.alice.address)).to.be.closeTo(MIC(500), MIC(2))
    })

    it("lets the buyer force the resync themselves", async () => {
      const ctx = await loadFixture(setup)
      await give(ctx, 1, ctx.alice.address, 2, 90)
      await ctx.nft.setOwner(1, ctx.bob.address)
      await ctx.pool.connect(ctx.bob).resync(1)
      expect(await ctx.pool.weightOf(ctx.bob.address)).to.equal(W_MAKER)
    })
  })

  describe("nothing enrolled", () => {
    it("carries the reward over rather than losing it", async () => {
      const ctx = await loadFixture(setup)
      await fund(ctx, MIC(1_000))
      await time.increase(DAY)
      await ctx.pool.sync()
      expect(await ctx.pool.carryOver()).to.be.closeTo(MIC(1_000), MIC("0.05"))

      await give(ctx, 1, ctx.alice.address, 1, 60)
      await fund(ctx, MIC(1_000))
      await time.increase(DAY)
      expect(await ctx.pool.claimable(ctx.alice.address)).to.be.closeTo(MIC(2_000), MIC("0.1"))
    })

    it("a token enrolled late cannot reach back for it", async () => {
      const ctx = await loadFixture(setup)
      await give(ctx, 1, ctx.alice.address, 1, 60)
      await fund(ctx, MIC(1_000))
      await time.increase(DAY)

      await give(ctx, 2, ctx.bob.address, 1, 60)
      expect(await ctx.pool.claimable(ctx.bob.address)).to.equal(0n)
    })
  })

  describe("enrolment guards", () => {
    it("refuses to enrol the same token twice", async () => {
      const ctx = await loadFixture(setup)
      await give(ctx, 1, ctx.alice.address, 1, 60)
      await expect(ctx.pool.enroll(1)).to.be.revertedWith("NRP: already enrolled")
    })

    it("refuses an already-expired token", async () => {
      const ctx = await loadFixture(setup)
      const now = await time.latest()
      await ctx.nft.setToken(9, ctx.alice.address, 1, now - 1)
      await expect(ctx.pool.enroll(9)).to.be.revertedWith("NRP: already expired")
    })

    it("only EMISSION_ROLE may notify, and only for MIC that is here", async () => {
      const ctx = await loadFixture(setup)
      await expect(ctx.pool.connect(ctx.alice).notifyReward(MIC(1))).to.be.reverted
      await expect(ctx.pool.connect(ctx.emission).notifyReward(MIC(1_000)))
        .to.be.revertedWith("NRP: reward not funded")
    })

    it("rescueToken refuses MIC", async () => {
      const ctx = await loadFixture(setup)
      await expect(
        ctx.pool.rescueToken(await ctx.mic.getAddress(), ctx.alice.address, 1n),
      ).to.be.revertedWith("NRP: MIC belongs to holders")
    })
  })

  describe("MFP variant — flat weight, no expiry", () => {
    async function mfpSetup() {
      const [admin, emission, alice, bob] = await ethers.getSigners()
      const mic: any = await (await ethers.getContractFactory("MICToken")).deploy(admin.address)
      const pool: any = await (await ethers.getContractFactory("NftRewardPoolV2"))
        .deploy(await mic.getAddress(), ethers.ZeroAddress, 100_000, admin.address)
      await pool.grantRole(await pool.EMISSION_ROLE(), emission.address)
      await mic.grantRole(await mic.MINTER_ROLE(), admin.address)
      return { mic, pool, admin, emission, alice, bob }
    }

    it("splits by pass count", async () => {
      const ctx: any = await loadFixture(mfpSetup)
      await ctx.pool.setWeight(ctx.alice.address, 1)
      await ctx.pool.setWeight(ctx.bob.address, 3)
      await ctx.mic.mintFromMining(await ctx.pool.getAddress(), MIC(400))
      await ctx.pool.connect(ctx.emission).notifyReward(MIC(400))
      await time.increase(DAY)

      expect(await ctx.pool.claimable(ctx.alice.address)).to.be.closeTo(MIC(100), MIC("0.05"))
      expect(await ctx.pool.claimable(ctx.bob.address)).to.be.closeTo(MIC(300), MIC("0.05"))
    })

    it("settles before a weight change, so the past is not repriced", async () => {
      const ctx: any = await loadFixture(mfpSetup)
      await ctx.pool.setWeight(ctx.alice.address, 1)
      await ctx.mic.mintFromMining(await ctx.pool.getAddress(), MIC(1_000))
      await ctx.pool.connect(ctx.emission).notifyReward(MIC(1_000))
      await time.increase(DAY)

      const before = await ctx.pool.claimable(ctx.alice.address)
      await ctx.pool.setWeight(ctx.alice.address, 10)
      // Ten times the weight from now on, but yesterday still pays yesterday's rate.
      expect(await ctx.pool.claimable(ctx.alice.address)).to.be.closeTo(before, MIC("0.05"))
    })

    it("refuses enroll() on a flat-weight pool", async () => {
      const ctx: any = await loadFixture(mfpSetup)
      await expect(ctx.pool.enroll(1)).to.be.revertedWith("NRP: not an NFT pool")
    })
  })
})
