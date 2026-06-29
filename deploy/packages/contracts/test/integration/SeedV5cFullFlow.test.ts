import { expect } from "chai"
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers"
import { ethers } from "hardhat"

// ─── Integration test — V5c full flow E2E ──────────────────────────────────────
// Exercises all 5 V5c-era contracts together:
//   SeedSaleV7 -> SeedBudgetV5c (4-slot split) -> ReservedExpensesPoolV3 (council vote)
//                                              -> OperationalSalaryPoolV3 (slot 1 ctrl)
//                                              -> ManagementBonusPoolV3   (slot 2 ctrl)
//
// Mocks: MockUSDT, MockLockManagerV6, MockMFPNFTV6 — see SeedSaleV7.test.ts header
// for the rationale (on-chain MFPNFT/LM expose V6/V7 interface that in-repo source
// predates).
//
// Mock constructors take ZERO args (no AccessControl gate in mocks). The SeedSaleV7
// fixture in test/sales/SeedSaleV7.test.ts is the source of truth — we mirror it.

async function deployFullStackFixture() {
  const [owner, buyer, m1, m2, m3, m4, m5, recipient, feeWallet] = await ethers.getSigners()

  // ─── 1. Token layer ─────────────────────────────────────────────────
  const MockUSDT = await ethers.getContractFactory("MockUSDT")
  const usdt = await MockUSDT.deploy()

  const MIC = await ethers.getContractFactory("MICToken")
  const mic = await MIC.deploy(owner.address)

  const MockLock = await ethers.getContractFactory("MockLockManagerV6")
  const lock = await MockLock.deploy()

  const MockMFP = await ethers.getContractFactory("MockMFPNFTV6")
  const mfp = await MockMFP.deploy()

  // ─── 2. Governance + budget layer ───────────────────────────────────
  const SC = await ethers.getContractFactory("StewardCouncil")
  const council = await SC.deploy(owner.address)
  for (const m of [m1, m2, m3, m4, m5]) {
    await council.connect(owner).addMember(m.address, `id_${m.address.slice(2, 8)}`, "Member", "vote", "")
  }

  const V5c = await ethers.getContractFactory("SeedBudgetV5c")
  const v5c = await V5c.deploy(await usdt.getAddress(), owner.address)

  // ─── 3. Pool V3 layer ───────────────────────────────────────────────
  const OSP = await ethers.getContractFactory("OperationalSalaryPoolV3")
  const osp = await OSP.deploy(await council.getAddress(), await v5c.getAddress(), owner.address)

  const MBP = await ethers.getContractFactory("ManagementBonusPoolV3")
  const mbp = await MBP.deploy(await council.getAddress(), await v5c.getAddress(), owner.address)

  const REP = await ethers.getContractFactory("ReservedExpensesPoolV3")
  const rep = await REP.deploy(await council.getAddress(), await v5c.getAddress(), owner.address)

  // ─── 4. SeedSaleV7 ─────────────────────────────────────────────────
  const V7 = await ethers.getContractFactory("SeedSaleV7")
  const v7 = await V7.deploy(
    await usdt.getAddress(),
    await mic.getAddress(),
    await lock.getAddress(),
    await mfp.getAddress(),
    await v5c.getAddress(),
    owner.address,
    0n, // _initialOldInvestorsGranted
  )

  // ─── 5. Wire roles ─────────────────────────────────────────────────
  // V5c: grant CALLER_ROLE to V7 (so buyPackage can call receiveAndDistribute)
  const CALLER = await v5c.CALLER_ROLE()
  await v5c.connect(owner).grantRole(CALLER, await v7.getAddress())

  // V5c slot controllers (slot 0 Distribution → owner direct release pattern;
  // slots 1/2/3 → V3 pools)
  await v5c.connect(owner).setSlotController(0, owner.address)
  await v5c.connect(owner).setSlotController(1, await osp.getAddress())
  await v5c.connect(owner).setSlotController(2, await mbp.getAddress())
  await v5c.connect(owner).setSlotController(3, await rep.getAddress())

  // V5c fee: 5% to feeWallet
  await v5c.connect(owner).setFee(500, feeWallet.address)

  // Fund V7 with ALLOCATION MIC + activate
  const allocation = await v7.ALLOCATION()
  await mic.connect(owner).transfer(await v7.getAddress(), allocation)
  await v7.connect(owner).setActive(true)

  return {
    v5c, usdt, v7, mic, lock, mfp, osp, mbp, rep, council,
    owner, buyer, m1, m2, m3, m4, m5, recipient, feeWallet,
  }
}

const ORDER_1 = 1n // first order id (++nextOrderId convention)

describe("Integration — V5c full flow E2E", () => {
  it("$1000 SEED purchase → 4-slot split → Reserved vote → release with fee", async () => {
    const { v5c, usdt, v7, rep, buyer, m1, m2, m3, m4, recipient, feeWallet } =
      await loadFixture(deployFullStackFixture)

    // ─── Step 1: Buyer purchases Pack 0 ─────────────────────────────
    await usdt.mint(buyer.address, 1000n * 10n ** 6n)
    await usdt.connect(buyer).approve(await v7.getAddress(), 1000n * 10n ** 6n)
    await v7.connect(buyer).buyPackage(0)

    // ─── Step 2: Verify 4-slot split (200/200/100/500) ──────────────
    expect(await v5c.slotBalance(0)).to.equal(200n * 10n ** 6n, "Distribution slot")
    expect(await v5c.slotBalance(1)).to.equal(200n * 10n ** 6n, "Operational slot")
    expect(await v5c.slotBalance(2)).to.equal(100n * 10n ** 6n, "MgmtBonus slot")
    expect(await v5c.slotBalance(3)).to.equal(500n * 10n ** 6n, "Reserved slot")

    // ─── Step 3: Council creates + approves Reserved $300 order ─────
    await rep.connect(m1).createOrder(recipient.address, 300n * 10n ** 6n, "Q3 marketing")
    await rep.connect(m1).approveOrder(ORDER_1)
    await rep.connect(m2).approveOrder(ORDER_1)
    await rep.connect(m3).approveOrder(ORDER_1)
    await rep.connect(m4).approveOrder(ORDER_1) // 4 of 5 = 80% > 75%

    // ─── Step 4: Execute order (anyone can call after threshold met) ──
    const recipientBefore = await usdt.balanceOf(recipient.address)
    const feeBefore = await usdt.balanceOf(feeWallet.address)
    await rep.connect(m1).executeOrder(ORDER_1)

    // ─── Step 5: Verify amounts ─────────────────────────────────────
    // Order amount = $300 → fee = 5% = $15, net = $285
    expect(await usdt.balanceOf(recipient.address)).to.equal(
      recipientBefore + 285n * 10n ** 6n,
      "Recipient net",
    )
    expect(await usdt.balanceOf(feeWallet.address)).to.equal(
      feeBefore + 15n * 10n ** 6n,
      "Fee wallet",
    )
    expect(await v5c.slotBalance(3)).to.equal(
      200n * 10n ** 6n,
      "Reserved slot after release: 500 - 300",
    )
    expect(await v5c.slotTotalReleased(3)).to.equal(
      300n * 10n ** 6n,
      "totalReleased counts gross",
    )
  })

  it("3 of 5 approvals — order remains pending, cannot execute", async () => {
    const { usdt, v7, rep, buyer, m1, m2, m3, recipient } =
      await loadFixture(deployFullStackFixture)
    await usdt.mint(buyer.address, 1000n * 10n ** 6n)
    await usdt.connect(buyer).approve(await v7.getAddress(), 1000n * 10n ** 6n)
    await v7.connect(buyer).buyPackage(0)

    await rep.connect(m1).createOrder(recipient.address, 300n * 10n ** 6n, "X")
    await rep.connect(m1).approveOrder(ORDER_1)
    await rep.connect(m2).approveOrder(ORDER_1)
    await rep.connect(m3).approveOrder(ORDER_1) // 3 of 5 = 60% < 75%
    await expect(rep.connect(m1).executeOrder(ORDER_1)).to.be.revertedWith(
      "REPv3: insufficient approvals",
    )
  })
})
