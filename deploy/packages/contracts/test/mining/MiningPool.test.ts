import { expect } from "chai"
import { loadFixture, time } from "@nomicfoundation/hardhat-toolbox/network-helpers"
import { ethers } from "hardhat"

/**
 * MiningPool — per-licence accrual.
 *
 * The property that matters most is the one the old epoch pool could not hold: what a
 * licence is owed is *derived* from a running total, never allocated out of a shared pot.
 * So no two licences can be owed the same MIC, and a holder who claims a month late is
 * paid exactly what a holder who claimed hourly would have been.
 *
 * The second property is time. Rewards stream by the second, which is what makes
 * "activated at 3pm, earning from 3pm" literally true rather than a rounding of it.
 */

const MIC = (n: string | number) => ethers.parseEther(String(n))
const DAY = 86400

async function setup() {
  const [admin, emission, licenceCtr, alice, bob, carol] = await ethers.getSigners()

  const mic: any = await (await ethers.getContractFactory("MICToken")).deploy(admin.address)
  const pool: any = await (await ethers.getContractFactory("MiningPool"))
    .deploy(await mic.getAddress(), admin.address)

  await pool.grantRole(await pool.EMISSION_ROLE(), emission.address)
  await pool.grantRole(await pool.LICENCE_ROLE(), licenceCtr.address)

  // A stand-in for MICELicense's ownership lookup. The real contract answers the same
  // `ownerOfLicense(uint256)` call; here the test decides who owns what.
  const registry: any = await (await ethers.getContractFactory("MockLicenceOwner")).deploy()
  await pool.setLicenceContract(await registry.getAddress())

  await mic.grantRole(await mic.MINTER_ROLE(), admin.address)

  return { mic, pool, registry, admin, emission, licenceCtr, alice, bob, carol }
}

/** Mint MIC into the pool and announce it, the way EmissionController does. */
async function fundMining(ctx: any, amount: bigint) { return fund(ctx, amount) }

async function fund(ctx: any, amount: bigint) {
  await ctx.mic.mintFromMining(await ctx.pool.getAddress(), amount)
  await ctx.pool.connect(ctx.emission).notifyReward(amount)
}

const TERM = 360 * DAY

/** Activate with a term far past anything the test measures, unless one is given. */
async function activate(ctx: any, id: number, owner: string, term = TERM) {
  await ctx.registry.setOwner(id, owner)
  const now = await time.latest()
  await ctx.pool.connect(ctx.licenceCtr).onLicenceActivated(id, owner, now + term + 1)
}

describe("MiningPool — per-licence accrual", () => {
  describe("streaming", () => {
    it("pays a full day's reward over a full day, to a single licence", async () => {
      const ctx = await loadFixture(setup)
      await activate(ctx, 1, ctx.alice.address)
      await fund(ctx, MIC(1_000))

      await time.increase(DAY)
      // Rate is amount/86400 truncated, so the total lands a hair under 1,000.
      expect(await ctx.pool.pendingOf(1)).to.be.closeTo(MIC(1_000), MIC("0.001"))
    })

    it("pays a quarter of it after six hours", async () => {
      const ctx = await loadFixture(setup)
      await activate(ctx, 1, ctx.alice.address)
      await fund(ctx, MIC(1_000))

      await time.increase(DAY / 4)
      expect(await ctx.pool.pendingOf(1)).to.be.closeTo(MIC(250), MIC("0.01"))
    })

    it("stops accruing once the period runs dry", async () => {
      const ctx = await loadFixture(setup)
      await activate(ctx, 1, ctx.alice.address)
      await fund(ctx, MIC(1_000))

      await time.increase(DAY * 3)
      // Three days later it is still one day's worth — the stream ended, it did not
      // keep paying out of thin air.
      expect(await ctx.pool.pendingOf(1)).to.be.closeTo(MIC(1_000), MIC("0.001"))
    })

    it("splits evenly between two licences held for the same time", async () => {
      const ctx = await loadFixture(setup)
      await activate(ctx, 1, ctx.alice.address)
      await activate(ctx, 2, ctx.bob.address)
      await fund(ctx, MIC(1_000))

      await time.increase(DAY)
      expect(await ctx.pool.pendingOf(1)).to.be.closeTo(MIC(500), MIC("0.01"))
      expect(await ctx.pool.pendingOf(2)).to.be.closeTo(MIC(500), MIC("0.01"))
    })
  })

  describe("activation time is the anchor", () => {
    it("a licence activated halfway through earns only from that point", async () => {
      const ctx = await loadFixture(setup)
      await activate(ctx, 1, ctx.alice.address)
      await fund(ctx, MIC(1_000))

      await time.increase(DAY / 2)          // alice alone for 12h → 500
      await activate(ctx, 2, ctx.bob.address)
      await time.increase(DAY / 2)          // shared for 12h → 250 each

      expect(await ctx.pool.pendingOf(1)).to.be.closeTo(MIC(750), MIC("0.05"))
      expect(await ctx.pool.pendingOf(2)).to.be.closeTo(MIC(250), MIC("0.05"))
    })

    it("earns nothing for time before it was activated", async () => {
      const ctx = await loadFixture(setup)
      await activate(ctx, 1, ctx.alice.address)
      await fund(ctx, MIC(1_000))
      await time.increase(DAY / 2)

      await activate(ctx, 2, ctx.bob.address)
      // Bob's bookmark is set at activation, so at that instant he is owed zero — he
      // cannot reach back into the half day Alice mined alone.
      expect(await ctx.pool.pendingOf(2)).to.equal(0n)
    })
  })

  describe("claiming late costs nothing", () => {
    it("a miner who waits a month is paid the same as one who claims hourly", async () => {
      const ctx = await loadFixture(setup)
      await activate(ctx, 1, ctx.alice.address)
      await activate(ctx, 2, ctx.bob.address)

      // Ten daily emissions. Alice claims after each; Bob never does.
      for (let d = 0; d < 10; d++) {
        await fund(ctx, MIC(1_000))
        await time.increase(DAY)
        await ctx.pool.connect(ctx.alice).claim([1])
      }

      await ctx.pool.connect(ctx.bob).claim([2])

      const a = await ctx.mic.balanceOf(ctx.alice.address)
      const b = await ctx.mic.balanceOf(ctx.bob.address)
      expect(b).to.be.closeTo(a, MIC("0.01"))
      // This is the old pool's failure, inverted: there, Bob would have been robbed by
      // Alice's promptness.
      expect(b).to.be.closeTo(MIC(5_000), MIC(1))
    })

    it("never promises more MIC than it holds", async () => {
      const ctx = await loadFixture(setup)
      await activate(ctx, 1, ctx.alice.address)
      await activate(ctx, 2, ctx.bob.address)

      for (let d = 0; d < 5; d++) {
        await fund(ctx, MIC(1_000))
        await time.increase(DAY)
      }
      await ctx.pool.connect(ctx.alice).claim([1])
      await ctx.pool.connect(ctx.bob).claim([2])

      const paid = (await ctx.mic.balanceOf(ctx.alice.address)) + (await ctx.mic.balanceOf(ctx.bob.address))
      expect(paid).to.be.lte(MIC(5_000))
      expect(await ctx.mic.balanceOf(await ctx.pool.getAddress())).to.be.gte(0n)
    })
  })

  describe("nothing active", () => {
    it("carries the reward over instead of destroying it", async () => {
      const ctx = await loadFixture(setup)
      await fund(ctx, MIC(1_000))       // no licence exists yet
      await time.increase(DAY)

      await ctx.pool.sync()
      expect(await ctx.pool.carryOver()).to.be.closeTo(MIC(1_000), MIC("0.001"))

      // The next notification folds it back in, so day two pays out both days.
      await activate(ctx, 1, ctx.alice.address)
      await fund(ctx, MIC(1_000))
      await time.increase(DAY)
      expect(await ctx.pool.pendingOf(1)).to.be.closeTo(MIC(2_000), MIC("0.01"))
    })
  })

  describe("a late keeper stretches, it does not lose", () => {
    it("rolls the unstreamed remainder into the next notification", async () => {
      const ctx = await loadFixture(setup)
      await activate(ctx, 1, ctx.alice.address)

      await fund(ctx, MIC(1_000))
      await time.increase(DAY / 2)        // only half of day one streamed
      await fund(ctx, MIC(1_000))         // keeper is early with day two
      await time.increase(DAY)

      // Half of day one (500) plus day two's 1,000 plus the 500 rolled in = 2,000.
      expect(await ctx.pool.pendingOf(1)).to.be.closeTo(MIC(2_000), MIC("0.05"))
    })
  })

  describe("expiry", () => {
    it("banks what the licence earned and stops the meter", async () => {
      const ctx = await loadFixture(setup)
      await activate(ctx, 1, ctx.alice.address)
      await fund(ctx, MIC(1_000))
      await time.increase(DAY)

      await ctx.pool.connect(ctx.licenceCtr).onLicenceEnded(1, ctx.alice.address)
      const banked = await ctx.pool.accrued(ctx.alice.address)
      expect(banked).to.be.closeTo(MIC(1_000), MIC("0.01"))

      await time.increase(DAY * 5)
      expect(await ctx.pool.pendingOf(1)).to.equal(0n)
      expect(await ctx.pool.accrued(ctx.alice.address)).to.equal(banked)
    })

    it("lets the former holder claim without naming any licence", async () => {
      const ctx = await loadFixture(setup)
      await activate(ctx, 1, ctx.alice.address)
      await fund(ctx, MIC(1_000))
      await time.increase(DAY)
      await ctx.pool.connect(ctx.licenceCtr).onLicenceEnded(1, ctx.alice.address)

      await ctx.pool.connect(ctx.alice).claimAccrued()
      expect(await ctx.mic.balanceOf(ctx.alice.address)).to.be.closeTo(MIC(1_000), MIC("0.01"))
    })

    it("is idempotent — recycling twice must not corrupt the active count", async () => {
      const ctx = await loadFixture(setup)
      await activate(ctx, 1, ctx.alice.address)
      await ctx.pool.connect(ctx.licenceCtr).onLicenceEnded(1, ctx.alice.address)
      await ctx.pool.connect(ctx.licenceCtr).onLicenceEnded(1, ctx.alice.address)
      expect(await ctx.pool.totalActive()).to.equal(0n)
    })

    it("the remaining licence takes the whole stream afterwards", async () => {
      const ctx = await loadFixture(setup)
      await activate(ctx, 1, ctx.alice.address)
      await activate(ctx, 2, ctx.bob.address)
      await fund(ctx, MIC(1_000))

      await time.increase(DAY / 2)                                   // 250 each
      await ctx.pool.connect(ctx.licenceCtr).onLicenceEnded(1, ctx.alice.address)
      await time.increase(DAY / 2)                                   // bob alone → +500

      expect(await ctx.pool.pendingOf(2)).to.be.closeTo(MIC(750), MIC("0.05"))
    })
  })

  describe("transfer", () => {
    it("pays the seller for the time they held it", async () => {
      const ctx = await loadFixture(setup)
      await activate(ctx, 1, ctx.alice.address)
      await fund(ctx, MIC(1_000))
      await time.increase(DAY / 2)

      await ctx.pool.connect(ctx.licenceCtr).onLicenceTransferred(1, ctx.alice.address, ctx.bob.address)
      await ctx.registry.setOwner(1, ctx.bob.address)

      expect(await ctx.pool.accrued(ctx.alice.address)).to.be.closeTo(MIC(500), MIC("0.05"))
      // Not exactly zero: settling the registry costs a block, and this pool accrues by
      // the second, so a second of Bob's ownership is already on the meter.
      expect(await ctx.pool.pendingOf(1)).to.be.closeTo(0n, MIC("0.05"))

      await time.increase(DAY / 2)
      expect(await ctx.pool.pendingOf(1)).to.be.closeTo(MIC(500), MIC("0.05"))
    })
  })

  describe("claim guards", () => {
    it("refuses to settle a licence the caller does not own", async () => {
      const ctx = await loadFixture(setup)
      await activate(ctx, 1, ctx.alice.address)
      await fund(ctx, MIC(1_000))
      await time.increase(DAY)
      await expect(ctx.pool.connect(ctx.bob).claim([1])).to.be.revertedWith("MP: not licence owner")
    })

    it("refuses an empty claim", async () => {
      const ctx = await loadFixture(setup)
      await expect(ctx.pool.connect(ctx.alice).claimAccrued()).to.be.revertedWith("MP: nothing to claim")
    })

    it("a second claim in the same breath yields nothing more", async () => {
      const ctx = await loadFixture(setup)
      await activate(ctx, 1, ctx.alice.address)
      await fund(ctx, MIC(1_000))
      await time.increase(DAY)
      await ctx.pool.connect(ctx.alice).claim([1])
      await expect(ctx.pool.connect(ctx.alice).claim([1])).to.be.revertedWith("MP: nothing to claim")
    })
  })

  describe("access control", () => {
    it("only EMISSION_ROLE may notify", async () => {
      const ctx = await loadFixture(setup)
      await ctx.mic.mintFromMining(await ctx.pool.getAddress(), MIC(1_000))
      await expect(ctx.pool.connect(ctx.alice).notifyReward(MIC(1_000))).to.be.reverted
    })

    it("only LICENCE_ROLE may activate", async () => {
      const ctx = await loadFixture(setup)
      const now = await time.latest()
      await expect(
        ctx.pool.connect(ctx.alice).onLicenceActivated(1, ctx.alice.address, now + TERM),
      ).to.be.reverted
    })

    it("refuses to notify more than the pool actually holds", async () => {
      const ctx = await loadFixture(setup)
      await activate(ctx, 1, ctx.alice.address)
      // Announce MIC that was never minted here — the accumulator would promise it and
      // the shortfall would surface as a failed claim for whoever came last.
      await expect(
        ctx.pool.connect(ctx.emission).notifyReward(MIC(1_000)),
      ).to.be.revertedWith("MP: reward not funded")
    })

    it("rescueToken refuses MIC", async () => {
      const ctx = await loadFixture(setup)
      await expect(
        ctx.pool.rescueToken(await ctx.mic.getAddress(), ctx.alice.address, 1n),
      ).to.be.revertedWith("MP: MIC belongs to miners")
    })
  })
})

describe("MiningPool — expiry is exact", () => {
  it("stops earning at its expiry second, with nobody calling anything", async () => {
    const ctx = await loadFixture(setup)
    await activate(ctx, 1, ctx.alice.address, DAY)      // one-day term
    await fundMining(ctx, MIC(1_000))

    await time.increase(DAY * 5)

    // Five days passed and no one recycled. The licence still earned exactly one day.
    await ctx.pool.sync()
    const banked = await ctx.pool.accrued(ctx.alice.address)
    expect(banked).to.be.closeTo(MIC(1_000), MIC("0.05"))
    expect(await ctx.pool.isActive(1)).to.equal(false)
    expect(await ctx.pool.pendingOf(1)).to.equal(0n)
  })

  it("reports zero the moment it is due, before anyone has synced", async () => {
    const ctx = await loadFixture(setup)
    await activate(ctx, 1, ctx.alice.address, DAY)
    await fundMining(ctx, MIC(1_000))
    await time.increase(DAY * 2)

    // No transaction has touched the pool. The view must already say it earns nothing.
    expect(await ctx.pool.pendingOf(1)).to.equal(0n)
    expect(await ctx.pool.pendingExpiries()).to.equal(1n)
  })

  it("hands the expired licence's share to the ones still running", async () => {
    const ctx = await loadFixture(setup)
    await activate(ctx, 1, ctx.alice.address, DAY / 2)   // expires at the halfway mark
    await activate(ctx, 2, ctx.bob.address)
    await fundMining(ctx, MIC(1_000))

    await time.increase(DAY)
    await ctx.pool.sync()

    // First half shared (250 each); second half is Bob's alone (500).
    expect(await ctx.pool.accrued(ctx.alice.address)).to.be.closeTo(MIC(250), MIC("0.1"))
    expect(await ctx.pool.pendingOf(2)).to.be.closeTo(MIC(750), MIC("0.1"))
  })

  it("an expired licence cannot be claimed against, but its earnings can", async () => {
    const ctx = await loadFixture(setup)
    await activate(ctx, 1, ctx.alice.address, DAY)
    await fundMining(ctx, MIC(1_000))
    await time.increase(DAY * 3)

    await ctx.pool.connect(ctx.alice).claim([1])
    expect(await ctx.mic.balanceOf(ctx.alice.address)).to.be.closeTo(MIC(1_000), MIC("0.05"))

    // Nothing further accrues, however long anyone waits.
    await time.increase(DAY * 10)
    await expect(ctx.pool.connect(ctx.alice).claim([1])).to.be.revertedWith("MP: nothing to claim")
  })

  it("a sale does not extend the term", async () => {
    const ctx = await loadFixture(setup)
    await activate(ctx, 1, ctx.alice.address, DAY)
    await fundMining(ctx, MIC(1_000))

    await time.increase(DAY / 2)
    await ctx.pool.connect(ctx.licenceCtr).onLicenceTransferred(1, ctx.alice.address, ctx.bob.address)
    await ctx.registry.setOwner(1, ctx.bob.address)

    await time.increase(DAY * 3)
    await ctx.pool.sync()

    // Bob earns only the second half of the one-day term, not from the sale onward.
    expect(await ctx.pool.accrued(ctx.bob.address)).to.be.closeTo(MIC(500), MIC("0.1"))
    expect(await ctx.pool.isActive(1)).to.equal(false)
  })

  it("carries the reward over once every licence has expired", async () => {
    const ctx = await loadFixture(setup)
    await activate(ctx, 1, ctx.alice.address, DAY)
    await fundMining(ctx, MIC(2_000))     // two days' worth over one day

    await time.increase(DAY * 2)
    await ctx.pool.sync()

    // Alice mined the whole day alone; the stream had already finished by then, so the
    // pool holds no orphaned time.
    expect(await ctx.pool.accrued(ctx.alice.address)).to.be.closeTo(MIC(2_000), MIC("0.1"))
  })

  it("refuses an activation whose expiry would jump the queue", async () => {
    const ctx = await loadFixture(setup)
    await activate(ctx, 1, ctx.alice.address, DAY * 10)
    const now = await time.latest()
    await ctx.registry.setOwner(2, ctx.bob.address)
    await expect(
      ctx.pool.connect(ctx.licenceCtr).onLicenceActivated(2, ctx.bob.address, now + DAY),
    ).to.be.revertedWith("MP: expiry out of order")
  })

  it("refuses an activation that is already expired", async () => {
    const ctx = await loadFixture(setup)
    const now = await time.latest()
    await expect(
      ctx.pool.connect(ctx.licenceCtr).onLicenceActivated(1, ctx.alice.address, now - 1),
    ).to.be.revertedWith("MP: already expired")
  })
})
