import { expect } from "chai"
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers"
import { ethers } from "hardhat"

async function deployFixture() {
  const [owner, callerSale, m1, m2, m3, m4, m5] = await ethers.getSigners()
  const MockUSDT = await ethers.getContractFactory("MockUSDT")
  const usdt = await MockUSDT.deploy()
  const V5c = await ethers.getContractFactory("SeedBudgetV5c")
  const v5c = await V5c.deploy(await usdt.getAddress(), owner.address)
  const SC = await ethers.getContractFactory("StewardCouncil")
  const council = await SC.deploy(owner.address)
  const OSP = await ethers.getContractFactory("OperationalSalaryPoolV3")
  const osp = await OSP.deploy(await council.getAddress(), await v5c.getAddress(), owner.address)

  for (const m of [m1, m2, m3, m4, m5]) {
    await council.connect(owner).addMember(m.address, `id_${m.address.slice(2, 8)}`, "Member", "vote", "")
  }
  return { v5c, usdt, osp, council, owner, callerSale, m1, m2, m3, m4, m5 }
}

describe("OperationalSalaryPoolV3", () => {
  it("Owner can enroll member with share + maxout", async () => {
    const { osp, owner, m1 } = await loadFixture(deployFixture)
    await expect(osp.connect(owner).enrollMember(m1.address, 700, 5000n * 10n**6n))
      .to.not.be.reverted
    const mem = await osp.members(m1.address)
    expect(mem.sharePctBps).to.equal(700n)
    expect(mem.weeklyMaxoutUsdt).to.equal(5000n * 10n**6n)
  })

  it("claimable equals sharePctBps x slotTotalReceived(1) / 10000 (when uncapped)", async () => {
    const { v5c, usdt, osp, owner, callerSale, m1 } = await loadFixture(deployFixture)
    const CALLER = await v5c.CALLER_ROLE()
    await v5c.connect(owner).grantRole(CALLER, callerSale.address)
    await usdt.mint(callerSale.address, 1000n * 10n**6n)
    await usdt.connect(callerSale).approve(await v5c.getAddress(), 1000n * 10n**6n)
    await v5c.connect(callerSale).receiveAndDistribute(1000n * 10n**6n)
    await osp.connect(owner).enrollMember(m1.address, 700, 5000n * 10n**6n)
    expect(await osp.claimable(m1.address)).to.equal(14n * 10n**6n)
  })

  it("claim() releases USDT via V5c.release(1, ...) with fee deduction", async () => {
    const { v5c, usdt, osp, owner, callerSale, m1 } = await loadFixture(deployFixture)
    const CALLER = await v5c.CALLER_ROLE()
    await v5c.connect(owner).grantRole(CALLER, callerSale.address)
    await usdt.mint(callerSale.address, 1000n * 10n**6n)
    await usdt.connect(callerSale).approve(await v5c.getAddress(), 1000n * 10n**6n)
    await v5c.connect(callerSale).receiveAndDistribute(1000n * 10n**6n)
    await v5c.connect(owner).setSlotController(1, await osp.getAddress())
    await v5c.connect(owner).setFee(500, owner.address)
    await osp.connect(owner).enrollMember(m1.address, 700, 5000n * 10n**6n)
    const m1Before = await usdt.balanceOf(m1.address)
    await osp.connect(m1).claim()
    const m1After = await usdt.balanceOf(m1.address)
    expect(m1After - m1Before).to.equal(13_300_000n)
  })
})
