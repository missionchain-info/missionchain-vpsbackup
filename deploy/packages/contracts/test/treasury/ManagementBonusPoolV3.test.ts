import { expect } from "chai"
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers"
import { ethers } from "hardhat"

async function setupFixture() {
  const [owner, callerSale, m1, m2, m3, m4, m5, recipient] = await ethers.getSigners()

  const MockUSDT = await ethers.getContractFactory("MockUSDT")
  const usdt = await MockUSDT.deploy()

  const V5c = await ethers.getContractFactory("SeedBudgetV5c")
  const v5c = await V5c.deploy(await usdt.getAddress(), owner.address)

  const SC = await ethers.getContractFactory("StewardCouncil")
  const council = await SC.deploy(owner.address)

  const MBP = await ethers.getContractFactory("ManagementBonusPoolV3")
  const mbp = await MBP.deploy(
    await council.getAddress(),
    await v5c.getAddress(),
    owner.address
  )

  // Enroll 5 council members
  for (const m of [m1, m2, m3, m4, m5]) {
    await council
      .connect(owner)
      .addMember(m.address, `id_${m.address.slice(2, 8)}`, "Member", "vote", "")
  }

  // Wire V5c slot 2 (SLOT_MGMT_BONUS) controller to MBP
  await v5c.connect(owner).setSlotController(2, await mbp.getAddress())

  // Fund slot 2 with $100 (= 10% of $1000)
  const CALLER = await v5c.CALLER_ROLE()
  await v5c.connect(owner).grantRole(CALLER, callerSale.address)
  await usdt.mint(callerSale.address, 1000n * 10n ** 6n)
  await usdt.connect(callerSale).approve(await v5c.getAddress(), 1000n * 10n ** 6n)
  await v5c.connect(callerSale).receiveAndDistribute(1000n * 10n ** 6n)

  return { v5c, usdt, mbp, council, owner, m1, m2, m3, m4, m5, recipient }
}

// NOTE: V2/V3 uses `++nextOrderId` so the FIRST order id is 1, not 0.
const FIRST_ORDER_ID = 1n

describe("ManagementBonusPoolV3 — voting flow", () => {
  it("Council member creates order", async () => {
    const { mbp, m1, recipient } = await loadFixture(setupFixture)
    await expect(
      mbp.connect(m1).createOrder(recipient.address, 50n * 10n ** 6n, "Q3 bonus payout")
    ).to.not.be.reverted
    const o = await mbp.getOrder(FIRST_ORDER_ID)
    expect(o.recipient).to.equal(recipient.address)
    expect(o.amount).to.equal(50n * 10n ** 6n)
  })

  it("4 of 5 approvals (>=75%) allow execution", async () => {
    const { mbp, m1, m2, m3, m4, recipient, usdt } = await loadFixture(setupFixture)
    await mbp.connect(m1).createOrder(recipient.address, 50n * 10n ** 6n, "Q3 bonus")
    await mbp.connect(m1).approveOrder(FIRST_ORDER_ID)
    await mbp.connect(m2).approveOrder(FIRST_ORDER_ID)
    await mbp.connect(m3).approveOrder(FIRST_ORDER_ID)
    await mbp.connect(m4).approveOrder(FIRST_ORDER_ID)

    const balBefore = await usdt.balanceOf(recipient.address)
    await mbp.connect(m1).executeOrder(FIRST_ORDER_ID)
    const balAfter = await usdt.balanceOf(recipient.address)
    expect(balAfter - balBefore).to.equal(50n * 10n ** 6n)
  })

  it("3 of 5 approvals (<75%) cannot execute", async () => {
    const { mbp, m1, m2, m3, recipient } = await loadFixture(setupFixture)
    await mbp.connect(m1).createOrder(recipient.address, 50n * 10n ** 6n, "X")
    await mbp.connect(m1).approveOrder(FIRST_ORDER_ID)
    await mbp.connect(m2).approveOrder(FIRST_ORDER_ID)
    await mbp.connect(m3).approveOrder(FIRST_ORDER_ID)
    await expect(mbp.connect(m1).executeOrder(FIRST_ORDER_ID))
      .to.be.revertedWith("MBPv3: threshold not met")
  })

  it("Owner can cancel pending order", async () => {
    const { mbp, owner, m1, recipient } = await loadFixture(setupFixture)
    await mbp.connect(m1).createOrder(recipient.address, 50n * 10n ** 6n, "X")
    await mbp.connect(owner).cancelOrder(FIRST_ORDER_ID)
    await expect(mbp.connect(m1).executeOrder(FIRST_ORDER_ID))
      .to.be.revertedWith("MBPv3: not pending")
  })
})
