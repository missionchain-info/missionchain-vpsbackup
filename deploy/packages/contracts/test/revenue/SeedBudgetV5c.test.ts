import { expect } from "chai"
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers"
import { ethers } from "hardhat"

async function deployFixture() {
  const [owner, treasury, alice] = await ethers.getSigners()
  const MockUSDT = await ethers.getContractFactory("MockUSDT")
  const usdt = await MockUSDT.deploy()
  const V5c = await ethers.getContractFactory("SeedBudgetV5c")
  const v5c = await V5c.deploy(await usdt.getAddress(), owner.address)
  return { v5c, usdt, owner, treasury, alice }
}

describe("SeedBudgetV5c — constants", () => {
  it("BPS sum equals 10000", async () => {
    const { v5c } = await loadFixture(deployFixture)
    const d = await v5c.BPS_DISTRIBUTION()
    const o = await v5c.BPS_OPERATIONAL()
    const m = await v5c.BPS_MGMT_BONUS()
    const r = await v5c.BPS_RESERVED()
    expect(d + o + m + r).to.equal(10000n)
  })
  it("Distribution = 20%", async () => {
    const { v5c } = await loadFixture(deployFixture)
    expect(await v5c.BPS_DISTRIBUTION()).to.equal(2000n)
  })
  it("Operational = 20%", async () => {
    const { v5c } = await loadFixture(deployFixture)
    expect(await v5c.BPS_OPERATIONAL()).to.equal(2000n)
  })
  it("MgmtBonus = 10%", async () => {
    const { v5c } = await loadFixture(deployFixture)
    expect(await v5c.BPS_MGMT_BONUS()).to.equal(1000n)
  })
  it("Reserved = 50%", async () => {
    const { v5c } = await loadFixture(deployFixture)
    expect(await v5c.BPS_RESERVED()).to.equal(5000n)
  })
  it("Slot indices 0-3 only (no SLOT_LIQUIDITY)", async () => {
    const { v5c } = await loadFixture(deployFixture)
    expect(await v5c.SLOT_DISTRIBUTION()).to.equal(0n)
    expect(await v5c.SLOT_OPERATIONAL()).to.equal(1n)
    expect(await v5c.SLOT_MGMT_BONUS()).to.equal(2n)
    expect(await v5c.SLOT_RESERVED()).to.equal(3n)
  })
})

describe("SeedBudgetV5c — receiveAndDistribute", () => {
  it("rejects caller without CALLER_ROLE", async () => {
    const { v5c, usdt, alice } = await loadFixture(deployFixture)
    await usdt.mint(alice.address, 1000n * 10n**6n)
    await usdt.connect(alice).approve(await v5c.getAddress(), 1000n * 10n**6n)
    await expect(v5c.connect(alice).receiveAndDistribute(1000n * 10n**6n))
      .to.be.reverted
  })

  it("splits $1000 into 4 slots correctly: 200/200/100/500", async () => {
    const { v5c, usdt, owner, alice } = await loadFixture(deployFixture)
    const CALLER = await v5c.CALLER_ROLE()
    await v5c.connect(owner).grantRole(CALLER, alice.address)
    await usdt.mint(alice.address, 1000n * 10n**6n)
    await usdt.connect(alice).approve(await v5c.getAddress(), 1000n * 10n**6n)

    await v5c.connect(alice).receiveAndDistribute(1000n * 10n**6n)

    expect(await v5c.slotBalance(0)).to.equal(200n * 10n**6n)
    expect(await v5c.slotBalance(1)).to.equal(200n * 10n**6n)
    expect(await v5c.slotBalance(2)).to.equal(100n * 10n**6n)
    expect(await v5c.slotBalance(3)).to.equal(500n * 10n**6n)
    expect(await v5c.slotTotalReceived(0)).to.equal(200n * 10n**6n)
    expect(await v5c.slotTotalReceived(3)).to.equal(500n * 10n**6n)
  })

  it("emits ReceivedAndDistributed event", async () => {
    const { v5c, usdt, owner, alice } = await loadFixture(deployFixture)
    const CALLER = await v5c.CALLER_ROLE()
    await v5c.connect(owner).grantRole(CALLER, alice.address)
    await usdt.mint(alice.address, 100n * 10n**6n)
    await usdt.connect(alice).approve(await v5c.getAddress(), 100n * 10n**6n)
    await expect(v5c.connect(alice).receiveAndDistribute(100n * 10n**6n))
      .to.emit(v5c, "ReceivedAndDistributed")
      .withArgs(100n * 10n**6n, 20n * 10n**6n, 20n * 10n**6n, 10n * 10n**6n, 50n * 10n**6n)
  })

  it("reverts on zero amount", async () => {
    const { v5c, owner, alice } = await loadFixture(deployFixture)
    const CALLER = await v5c.CALLER_ROLE()
    await v5c.connect(owner).grantRole(CALLER, alice.address)
    await expect(v5c.connect(alice).receiveAndDistribute(0))
      .to.be.revertedWith("SBv5c: zero amount")
  })
})

describe("SeedBudgetV5c — release", () => {
  async function withFundedFixture() {
    const f = await loadFixture(deployFixture)
    const CALLER = await f.v5c.CALLER_ROLE()
    await f.v5c.grantRole(CALLER, f.alice.address)
    await f.usdt.mint(f.alice.address, 1000n * 10n**6n)
    await f.usdt.connect(f.alice).approve(await f.v5c.getAddress(), 1000n * 10n**6n)
    await f.v5c.connect(f.alice).receiveAndDistribute(1000n * 10n**6n)
    return f
  }

  it("rejects non-controller caller", async () => {
    const { v5c, alice, treasury } = await withFundedFixture()
    await expect(v5c.connect(alice).release(0, treasury.address, 100n * 10n**6n))
      .to.be.revertedWith("SBv5c: not controller")
  })

  it("Owner sets slotController + releases with 5% fee", async () => {
    const { v5c, usdt, owner, treasury } = await withFundedFixture()
    await v5c.connect(owner).setSlotController(0, owner.address)
    await v5c.connect(owner).setFee(500, owner.address)

    const balBefore = await usdt.balanceOf(treasury.address)
    const ownerBalBefore = await usdt.balanceOf(owner.address)

    await v5c.connect(owner).release(0, treasury.address, 100n * 10n**6n)

    expect(await usdt.balanceOf(treasury.address)).to.equal(balBefore + 95n * 10n**6n)
    expect(await usdt.balanceOf(owner.address)).to.equal(ownerBalBefore + 5n * 10n**6n)
    expect(await v5c.slotBalance(0)).to.equal(100n * 10n**6n)
    expect(await v5c.slotTotalReleased(0)).to.equal(100n * 10n**6n)
  })

  it("reverts on insufficient slot balance", async () => {
    const { v5c, owner, treasury } = await withFundedFixture()
    await v5c.connect(owner).setSlotController(0, owner.address)
    await expect(v5c.connect(owner).release(0, treasury.address, 300n * 10n**6n))
      .to.be.revertedWith("SBv5c: insufficient slot balance")
  })

  it("setSlotController rejects slot >= 4", async () => {
    const { v5c, owner } = await loadFixture(deployFixture)
    await expect(v5c.connect(owner).setSlotController(4, owner.address))
      .to.be.revertedWith("SBv5c: invalid slot")
  })

  it("release rejects slot >= 4 (defense in depth)", async () => {
    // Note: this path is unreachable in practice since setSlotController also rejects,
    // but the release-side guard is defensive. We can't actually exercise it via the
    // public API anymore, so this test asserts the guard exists via low-level call.
    const { v5c, owner, treasury } = await withFundedFixture()
    // Cannot setSlotController(4) anymore, so just verify the require message is reachable
    // via a different angle — call release on uninitialized slot 4 which has no controller
    await expect(v5c.connect(owner).release(4, treasury.address, 1n))
      .to.be.revertedWith("SBv5c: invalid slot")
  })

  it("releases full amount when feeBps=0 (no fee transfer)", async () => {
    const { v5c, usdt, owner, treasury } = await withFundedFixture()
    await v5c.connect(owner).setSlotController(0, owner.address)
    // Don't set fee — defaults to 0
    expect(await v5c.feeBps()).to.equal(0n)

    const balBefore = await usdt.balanceOf(treasury.address)
    await v5c.connect(owner).release(0, treasury.address, 100n * 10n**6n)
    expect(await usdt.balanceOf(treasury.address)).to.equal(balBefore + 100n * 10n**6n) // full 100, no fee
    expect(await v5c.slotBalance(0)).to.equal(100n * 10n**6n) // 200 - 100
    expect(await v5c.slotTotalReleased(0)).to.equal(100n * 10n**6n)
  })
})

describe("SeedBudgetV5c — setters", () => {
  it("setSlotController emits event and stores", async () => {
    const { v5c, owner, alice } = await loadFixture(deployFixture)
    await expect(v5c.connect(owner).setSlotController(0, alice.address))
      .to.emit(v5c, "SlotControllerUpdated").withArgs(0, alice.address)
    expect(await v5c.slotController(0)).to.equal(alice.address)
  })

  it("setFee caps at 1000 bps", async () => {
    const { v5c, owner } = await loadFixture(deployFixture)
    await expect(v5c.connect(owner).setFee(1001, owner.address))
      .to.be.revertedWith("SBv5c: fee too high")
  })

  it("only DEFAULT_ADMIN_ROLE can set", async () => {
    const { v5c, alice } = await loadFixture(deployFixture)
    await expect(v5c.connect(alice).setSlotController(0, alice.address))
      .to.be.reverted
  })
})
