import { expect } from "chai"
import { loadFixture, time } from "@nomicfoundation/hardhat-toolbox/network-helpers"
import { ethers } from "hardhat"

/**
 * MICELicense ↔ MiningPool, wired together.
 *
 * Two things are being pinned here.
 *
 * The first is the Owner's rule: the 360-day term and the reward meter both start at
 * activation, not at purchase, and not at a shared daily boundary. Activate at any hour
 * and you are owed from that hour.
 *
 * The second is quieter and was a live defect. Licences are ERC-1155 and therefore
 * sellable, but `licenses[id].owner` was only ever written at mint. A sold licence left
 * that field pointing at the seller for good — so every reward path built on it would
 * have paid the wrong wallet, permanently, with nothing on-chain looking wrong.
 */

const MIC = (n: string | number) => ethers.parseEther(String(n))
const USD = (n: string | number) => ethers.parseEther(String(n))
const DAY = 86400
// The waiting period was removed: a buyer activates whenever they choose.
const ACTIVATION_DELAY = 0

async function setup() {
  const [admin, emission, alice, bob] = await ethers.getSigners()

  const usdt: any = await (await ethers.getContractFactory("MockUSDT")).deploy()
  const mic: any = await (await ethers.getContractFactory("MICToken")).deploy(admin.address)
  const pool: any = await (await ethers.getContractFactory("MockLiquidityPoolV6")).deploy()
  await pool.setPrices(MIC("0.01"), MIC("0.01"), MIC("0.01"))

  const registry: any = await (await ethers.getContractFactory("ReferralRegistry"))
    .deploy(await usdt.getAddress(), admin.address)
  const router: any = await (await ethers.getContractFactory("MockRewardReceiver"))
    .deploy(await usdt.getAddress())

  const mice: any = await (await ethers.getContractFactory("MICELicense")).deploy(
    await usdt.getAddress(), await mic.getAddress(),
    await registry.getAddress(), await router.getAddress(),
    admin.address, await pool.getAddress(), MIC("0.01"),
  )

  const mining: any = await (await ethers.getContractFactory("MiningPool"))
    .deploy(await mic.getAddress(), admin.address)

  // The wiring the deploy script performs.
  await registry.grantRole(await registry.CALLER_ROLE(), await mice.getAddress())
  await mining.grantRole(await mining.LICENCE_ROLE(), await mice.getAddress())
  await mining.grantRole(await mining.EMISSION_ROLE(), emission.address)
  await mining.setLicenceContract(await mice.getAddress())
  await mice.setMiningPool(await mining.getAddress())
  await mic.grantRole(await mic.MINTER_ROLE(), admin.address)

  // Fund the buyers: a licence costs $100, half in USDT and half burned in MIC.
  for (const who of [alice, bob]) {
    await usdt.mint(who.address, USD(10_000))
    await mic.connect(admin).transfer(who.address, MIC(1_000_000))
    await usdt.connect(who).approve(await mice.getAddress(), ethers.MaxUint256)
    await mic.connect(who).approve(await mice.getAddress(), ethers.MaxUint256)
  }

  return { usdt, mic, pool, mice, mining, registry, admin, emission, alice, bob }
}

async function buyAndActivate(ctx: any, who: any) {
  await ctx.mice.connect(who)["buyLicense(uint256)"](1n)
  const ids = await ctx.mice.getUserLicenses(who.address)
  const id = ids[ids.length - 1]
  await time.increase(ACTIVATION_DELAY + 1)
  await ctx.mice.activate(id)
  return id
}

async function fundMining(ctx: any, amount: bigint) {
  await ctx.mic.mintFromMining(await ctx.mining.getAddress(), amount)
  await ctx.mining.connect(ctx.emission).notifyReward(amount)
}

describe("MICE ↔ Mining — activation starts the clock", () => {
  it("a purchased licence earns nothing until it is activated", async () => {
    const ctx = await loadFixture(setup)
    await ctx.mice.connect(ctx.alice)["buyLicense(uint256)"](1n)
    const [id] = await ctx.mice.getUserLicenses(ctx.alice.address)

    await fundMining(ctx, MIC(1_000))
    await time.increase(DAY)

    expect(await ctx.mining.isActive(id)).to.equal(false)
    expect(await ctx.mining.pendingOf(id)).to.equal(0n)
    expect(await ctx.mining.totalActive()).to.equal(0n)
  })

  it("starts the 360-day term and the reward meter at the same second", async () => {
    const ctx = await loadFixture(setup)
    const id = await buyAndActivate(ctx, ctx.alice)

    const lic = await ctx.mice.licenses(id)
    const activatedAt = Number(lic.activatedAt)
    expect(Number(lic.expiryTime) - activatedAt).to.equal(360 * DAY)

    // The pool agrees the licence is live as of the same moment.
    expect(await ctx.mining.isActive(id)).to.equal(true)
    expect(await ctx.mining.totalActive()).to.equal(1n)
  })

  it("earns from its own activation hour, not from a shared boundary", async () => {
    const ctx = await loadFixture(setup)
    const aliceId = await buyAndActivate(ctx, ctx.alice)
    await fundMining(ctx, MIC(1_000))

    await time.increase(DAY / 2)                        // alice alone: 500
    const bobId = await buyAndActivate(ctx, ctx.bob)    // note: this advances time too

    const aliceAtJoin = await ctx.mining.pendingOf(aliceId)
    expect(await ctx.mining.pendingOf(bobId)).to.equal(0n)
    expect(aliceAtJoin).to.be.gt(MIC(400))
  })

  it("the whole stream goes to the one licence that is active", async () => {
    const ctx = await loadFixture(setup)
    const id = await buyAndActivate(ctx, ctx.alice)
    await fundMining(ctx, MIC(1_000))
    await time.increase(DAY)

    expect(await ctx.mining.pendingOf(id)).to.be.closeTo(MIC(1_000), MIC("0.01"))
  })

  it("pays out to the wallet on claim", async () => {
    const ctx = await loadFixture(setup)
    const id = await buyAndActivate(ctx, ctx.alice)
    await fundMining(ctx, MIC(1_000))
    await time.increase(DAY)

    const before = await ctx.mic.balanceOf(ctx.alice.address)
    await ctx.mining.connect(ctx.alice).claim([id])
    const gained = (await ctx.mic.balanceOf(ctx.alice.address)) - before
    expect(gained).to.be.closeTo(MIC(1_000), MIC("0.01"))
  })
})

describe("MICE ↔ Mining — selling a licence", () => {
  it("moves ownership in the licence record, not just the token", async () => {
    const ctx = await loadFixture(setup)
    const id = await buyAndActivate(ctx, ctx.alice)

    await ctx.mice.connect(ctx.alice).safeTransferFrom(
      ctx.alice.address, ctx.bob.address, id, 1, "0x",
    )

    // Before this fix, `owner` stayed on Alice for the life of the licence.
    expect(await ctx.mice.ownerOfLicense(id)).to.equal(ctx.bob.address)
    expect(await ctx.mice.balanceOf(ctx.bob.address, id)).to.equal(1n)
  })

  it("keeps each side's licence list right", async () => {
    const ctx = await loadFixture(setup)
    const id = await buyAndActivate(ctx, ctx.alice)

    await ctx.mice.connect(ctx.alice).safeTransferFrom(
      ctx.alice.address, ctx.bob.address, id, 1, "0x",
    )

    expect(await ctx.mice.getUserLicenses(ctx.alice.address)).to.not.include(id)
    expect(await ctx.mice.getUserLicenses(ctx.bob.address)).to.deep.include(id)
  })

  it("pays the seller for the days they mined, and the buyer from the sale on", async () => {
    const ctx = await loadFixture(setup)
    const id = await buyAndActivate(ctx, ctx.alice)
    await fundMining(ctx, MIC(1_000))
    await time.increase(DAY / 2)

    await ctx.mice.connect(ctx.alice).safeTransferFrom(
      ctx.alice.address, ctx.bob.address, id, 1, "0x",
    )

    // Alice's half day is banked to her, and travels with her rather than the token.
    expect(await ctx.mining.accrued(ctx.alice.address)).to.be.closeTo(MIC(500), MIC("0.1"))

    await time.increase(DAY / 2)
    await ctx.mining.connect(ctx.bob).claim([id])
    expect(await ctx.mic.balanceOf(ctx.bob.address)).to.be.gt(0n)

    // And Alice can still take hers, with no licence left in her name.
    await ctx.mining.connect(ctx.alice).claimAccrued()
  })

  it("the buyer cannot claim what the seller earned", async () => {
    const ctx = await loadFixture(setup)
    const id = await buyAndActivate(ctx, ctx.alice)
    await fundMining(ctx, MIC(1_000))
    await time.increase(DAY)

    const bobBefore = await ctx.mic.balanceOf(ctx.bob.address)
    await ctx.mice.connect(ctx.alice).safeTransferFrom(
      ctx.alice.address, ctx.bob.address, id, 1, "0x",
    )
    // A day's reward was settled to Alice at the moment of sale; Bob starts from zero.
    await expect(ctx.mining.connect(ctx.bob).claim([id])).to.be.revertedWith("MP: nothing to claim")
    expect(await ctx.mic.balanceOf(ctx.bob.address)).to.equal(bobBefore)
  })

  it("the seller can no longer claim against a licence they sold", async () => {
    const ctx = await loadFixture(setup)
    const id = await buyAndActivate(ctx, ctx.alice)
    await fundMining(ctx, MIC(1_000))
    await time.increase(DAY / 2)
    await ctx.mice.connect(ctx.alice).safeTransferFrom(
      ctx.alice.address, ctx.bob.address, id, 1, "0x",
    )
    await time.increase(DAY / 2)

    await expect(ctx.mining.connect(ctx.alice).claim([id])).to.be.revertedWith("MP: not licence owner")
  })
})

describe("MICE ↔ Mining — expiry", () => {
  it("recycling stops the meter and banks the reward for the holder", async () => {
    const ctx = await loadFixture(setup)
    const id = await buyAndActivate(ctx, ctx.alice)
    await fundMining(ctx, MIC(1_000))
    await time.increase(DAY)

    await time.increase(360 * DAY)
    await ctx.mice.recycleLicense(id)

    expect(await ctx.mining.isActive(id)).to.equal(false)
    expect(await ctx.mining.totalActive()).to.equal(0n)
    expect(await ctx.mining.accrued(ctx.alice.address)).to.be.closeTo(MIC(1_000), MIC("0.01"))

    await ctx.mining.connect(ctx.alice).claimAccrued()
    expect(await ctx.mic.balanceOf(ctx.alice.address)).to.be.gt(0n)
  })

  it("a recycled seat sold to someone else does not carry the old rewards", async () => {
    const ctx = await loadFixture(setup)
    const id = await buyAndActivate(ctx, ctx.alice)
    await fundMining(ctx, MIC(1_000))
    await time.increase(361 * DAY)
    await ctx.mice.recycleLicense(id)

    // Bob buys and gets the recycled seat back.
    const bobId = await buyAndActivate(ctx, ctx.bob)
    expect(bobId).to.equal(id)
    expect(await ctx.mining.pendingOf(bobId)).to.equal(0n)
    expect(await ctx.mining.accrued(ctx.bob.address)).to.equal(0n)
  })
})
