import { expect } from "chai"
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers"
import { ethers } from "hardhat"

async function setupFixture() {
  const [owner, callerSale, m1, m2, m3, m4, m5, recipient, dao, notMember] = await ethers.getSigners()
  const MockUSDT = await ethers.getContractFactory("MockUSDT")
  const usdt = await MockUSDT.deploy()
  const V5c = await ethers.getContractFactory("SeedBudgetV5c")
  const v5c = await V5c.deploy(await usdt.getAddress(), owner.address)
  const SC = await ethers.getContractFactory("StewardCouncil")
  const council = await SC.deploy(owner.address)
  const REP = await ethers.getContractFactory("ReservedExpensesPoolV3")
  const rep = await REP.deploy(await council.getAddress(), await v5c.getAddress(), owner.address)

  for (const m of [m1, m2, m3, m4, m5]) {
    await council.connect(owner).addMember(m.address, `id_${m.address.slice(2,8)}`, "Member", "vote", "")
  }
  await v5c.connect(owner).setSlotController(3, await rep.getAddress())

  // Fund slot 3 with $500 (= 50% of $1000)
  const CALLER = await v5c.CALLER_ROLE()
  await v5c.connect(owner).grantRole(CALLER, callerSale.address)
  await usdt.mint(callerSale.address, 1000n * 10n**6n)
  await usdt.connect(callerSale).approve(await v5c.getAddress(), 1000n * 10n**6n)
  await v5c.connect(callerSale).receiveAndDistribute(1000n * 10n**6n)

  return { v5c, usdt, rep, council, owner, m1, m2, m3, m4, m5, recipient, dao, notMember }
}

const ORDER_1 = 1n // first order id (due to ++nextOrderId)

describe("ReservedExpensesPoolV3 — voting + Phase B", () => {
  it("Council member or owner creates order", async () => {
    const { rep, owner, m1, recipient } = await loadFixture(setupFixture)
    await expect(rep.connect(m1).createOrder(recipient.address, 100n * 10n**6n, "Marketing campaign"))
      .to.not.be.reverted
    await expect(rep.connect(owner).createOrder(recipient.address, 100n * 10n**6n, "Owner proposal"))
      .to.not.be.reverted
  })

  it("Non-council non-owner cannot create", async () => {
    const { rep, notMember, recipient } = await loadFixture(setupFixture)
    await expect(rep.connect(notMember).createOrder(recipient.address, 100n * 10n**6n, "X"))
      .to.be.revertedWith("REPv3: not council")
  })

  it("Threshold 75% — 4 of 5 approve -> executable (no fee)", async () => {
    const { rep, usdt, m1, m2, m3, m4, recipient } = await loadFixture(setupFixture)
    await rep.connect(m1).createOrder(recipient.address, 200n * 10n**6n, "Y")
    await rep.connect(m1).approveOrder(ORDER_1)
    await rep.connect(m2).approveOrder(ORDER_1)
    await rep.connect(m3).approveOrder(ORDER_1)
    await rep.connect(m4).approveOrder(ORDER_1)
    const balBefore = await usdt.balanceOf(recipient.address)
    await rep.connect(m1).executeOrder(ORDER_1)
    expect(await usdt.balanceOf(recipient.address)).to.equal(balBefore + 200n * 10n**6n)
  })

  it("3 of 5 (60%) cannot execute", async () => {
    const { rep, m1, m2, m3, recipient } = await loadFixture(setupFixture)
    await rep.connect(m1).createOrder(recipient.address, 200n * 10n**6n, "Y")
    await rep.connect(m1).approveOrder(ORDER_1)
    await rep.connect(m2).approveOrder(ORDER_1)
    await rep.connect(m3).approveOrder(ORDER_1)
    await expect(rep.connect(m1).executeOrder(ORDER_1)).to.be.revertedWith("REPv3: insufficient approvals")
  })

  it("Cannot double-approve", async () => {
    const { rep, m1, recipient } = await loadFixture(setupFixture)
    await rep.connect(m1).createOrder(recipient.address, 100n * 10n**6n, "Y")
    await rep.connect(m1).approveOrder(ORDER_1)
    await expect(rep.connect(m1).approveOrder(ORDER_1))
      .to.be.revertedWith("REPv3: already approved")
  })

  it("Owner can cancel", async () => {
    const { rep, owner, m1, recipient } = await loadFixture(setupFixture)
    await rep.connect(m1).createOrder(recipient.address, 100n * 10n**6n, "Y")
    await rep.connect(owner).cancelOrder(ORDER_1)
    await expect(rep.connect(m1).executeOrder(ORDER_1)).to.be.reverted
  })

  it("Proposer can cancel their own order before execution", async () => {
    const { rep, m1, recipient } = await loadFixture(setupFixture)
    await rep.connect(m1).createOrder(recipient.address, 100n * 10n**6n, "Y")
    await expect(rep.connect(m1).cancelOrder(ORDER_1)).to.not.be.reverted
  })

  it("setThreshold updates voting threshold", async () => {
    const { rep, owner } = await loadFixture(setupFixture)
    await rep.connect(owner).setThreshold(8000) // 80%
    expect(await rep.threshold()).to.equal(8000n)
  })

  it("setThreshold rejects out-of-range", async () => {
    const { rep, owner } = await loadFixture(setupFixture)
    await expect(rep.connect(owner).setThreshold(4999)).to.be.revertedWith("REPv3: threshold out of range")
    await expect(rep.connect(owner).setThreshold(10001)).to.be.revertedWith("REPv3: threshold out of range")
  })

  it("setPhaseB transfers admin to DAOGovernor", async () => {
    const { rep, owner, dao } = await loadFixture(setupFixture)
    await rep.connect(owner).setPhaseB(dao.address)
    expect(await rep.isPhaseB()).to.equal(true)
    expect(await rep.owner()).to.equal(dao.address)
    // Phase B prevents calling setPhaseB again
    await expect(rep.connect(dao).setPhaseB(dao.address)).to.be.revertedWith("REPv3: already Phase B")
  })
})
