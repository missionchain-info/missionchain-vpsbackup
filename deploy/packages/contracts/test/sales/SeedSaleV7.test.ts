import { expect } from "chai"
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers"
import { ethers } from "hardhat"

// ─── Package spec (V6/V7) ──────────────────────────────────────────────────────
// Package 0: $1,000 USDT /   400,000 MIC /  1 MFP allowance
// Package 1: $2,500 USDT / 1,000,000 MIC /  3 MFP allowance
// Package 2: $5,000 USDT / 2,000,000 MIC /  8 MFP allowance
// Package 3: $10,000 USDT / 4,000,000 MIC / 20 MFP allowance
//
// V7 = V6 with constructor arg pointing at SeedBudgetV5c (was V5b in V6).
// Logic identical: 152.5M MIC allocation, 75M Old Investors pool, 4-slot USDT split.
//
// Tests use MockMFPNFTV6 (autoGrantFromSeed shim) and MockLockManagerV6
// (createSchedule + createScheduleWithStart shim) because the in-repo MFPNFT.sol
// and LockManager.sol predate V6's interface — the actual on-chain MFPNFT/LM
// (BSC testnet/mainnet) does expose those functions.

async function setupFixture() {
  const [owner, buyer, granter] = await ethers.getSigners()

  // MockUSDT (6 decimals)
  const MockUSDT = await ethers.getContractFactory("MockUSDT")
  const usdt = await MockUSDT.deploy()

  // MICToken (admin = owner)
  const MIC = await ethers.getContractFactory("MICToken")
  const mic = await MIC.deploy(owner.address)

  // Mock LockManager — accepts createSchedule + createScheduleWithStart
  const MockLM = await ethers.getContractFactory("MockLockManagerV6")
  const lock = await MockLM.deploy()

  // Mock MFPNFT — supports autoGrantFromSeed
  const MockMFP = await ethers.getContractFactory("MockMFPNFTV6")
  const mfp = await MockMFP.deploy()

  // SeedBudgetV5c (4-slot vault)
  const V5c = await ethers.getContractFactory("SeedBudgetV5c")
  const v5c = await V5c.deploy(await usdt.getAddress(), owner.address)

  // SeedSaleV7 (7 args: usdt, mic, lock, mfp, seedBudget, admin, initialOldInvestorsGranted)
  const V7 = await ethers.getContractFactory("SeedSaleV7")
  const v7 = await V7.deploy(
    await usdt.getAddress(),
    await mic.getAddress(),
    await lock.getAddress(),
    await mfp.getAddress(),
    await v5c.getAddress(),
    owner.address,
    0n, // initialOldInvestorsGranted
  )

  // Wire roles
  const CALLER = await v5c.CALLER_ROLE()
  await v5c.connect(owner).grantRole(CALLER, await v7.getAddress())

  // Fund V7 with ALLOCATION MIC. MICToken mints full supply to admin at construction.
  const allocation = await v7.ALLOCATION()
  await mic.connect(owner).transfer(await v7.getAddress(), allocation)

  // Activate sale
  await v7.connect(owner).setActive(true)

  return { v5c, usdt, mic, lock, mfp, v7, owner, buyer, granter }
}

describe("SeedSaleV7", () => {
  describe("constructor + identity", () => {
    it("ALLOCATION = 152.5M MIC", async () => {
      const { v7 } = await loadFixture(setupFixture)
      expect(await v7.ALLOCATION()).to.equal(152_500_000n * 10n ** 18n)
    })

    it("OLD_INVESTORS_ALLOCATION = 75M MIC", async () => {
      const { v7 } = await loadFixture(setupFixture)
      expect(await v7.OLD_INVESTORS_ALLOCATION()).to.equal(75_000_000n * 10n ** 18n)
    })

    it("seedBudget points at SeedBudgetV5c", async () => {
      const { v7, v5c } = await loadFixture(setupFixture)
      expect(await v7.seedBudget()).to.equal(await v5c.getAddress())
    })
  })

  describe("buyPackage", () => {
    it("Pack 0 routes USDT to V5c with 4-slot split 200/200/100/500", async () => {
      const { v5c, usdt, v7, buyer } = await loadFixture(setupFixture)
      await usdt.mint(buyer.address, 1000n * 10n ** 6n)
      await usdt.connect(buyer).approve(await v7.getAddress(), 1000n * 10n ** 6n)

      await v7.connect(buyer).buyPackage(0)

      expect(await v5c.slotBalance(0)).to.equal(200n * 10n ** 6n) // Distribution 20%
      expect(await v5c.slotBalance(1)).to.equal(200n * 10n ** 6n) // Operational 20%
      expect(await v5c.slotBalance(2)).to.equal(100n * 10n ** 6n) // MgmtBonus 10%
      expect(await v5c.slotBalance(3)).to.equal(500n * 10n ** 6n) // Reserved 50%
    })

    it("Pack 0 delivers 400,000 MIC to buyer", async () => {
      const { mic, v7, buyer, usdt } = await loadFixture(setupFixture)
      await usdt.mint(buyer.address, 1000n * 10n ** 6n)
      await usdt.connect(buyer).approve(await v7.getAddress(), 1000n * 10n ** 6n)

      await v7.connect(buyer).buyPackage(0)

      expect(await mic.balanceOf(buyer.address)).to.equal(400_000n * 10n ** 18n)
    })

    it("Pack 0 grants 1 MFP allowance via autoGrantFromSeed", async () => {
      const { mfp, v7, buyer, usdt } = await loadFixture(setupFixture)
      await usdt.mint(buyer.address, 1000n * 10n ** 6n)
      await usdt.connect(buyer).approve(await v7.getAddress(), 1000n * 10n ** 6n)

      await v7.connect(buyer).buyPackage(0)

      expect(await mfp.mintAllowance(buyer.address)).to.equal(1n)
    })

    it("Pack 0 creates vesting schedule (180d cliff, 10% / 2.5%)", async () => {
      const { lock, v7, buyer, usdt } = await loadFixture(setupFixture)
      await usdt.mint(buyer.address, 1000n * 10n ** 6n)
      await usdt.connect(buyer).approve(await v7.getAddress(), 1000n * 10n ** 6n)

      await v7.connect(buyer).buyPackage(0)

      expect(await lock.scheduleCount(buyer.address)).to.equal(1n)
      const s = await lock.getScheduleAt(buyer.address, 0)
      expect(s.totalAmount).to.equal(400_000n * 10n ** 18n)
      expect(s.cliffDuration).to.equal(BigInt(180 * 24 * 3600))
      expect(s.cliffUnlockBps).to.equal(1000n)
      expect(s.monthlyUnlockBps).to.equal(250n)
    })

    it("emits SeedPurchase event with correct args", async () => {
      const { v7, buyer, usdt } = await loadFixture(setupFixture)
      await usdt.mint(buyer.address, 1000n * 10n ** 6n)
      await usdt.connect(buyer).approve(await v7.getAddress(), 1000n * 10n ** 6n)

      await expect(v7.connect(buyer).buyPackage(0))
        .to.emit(v7, "SeedPurchase")
        .withArgs(buyer.address, 0n, 1000n * 10n ** 6n, 400_000n * 10n ** 18n, 1n)
    })

    it("reverts when sale not active", async () => {
      const { v7, owner, buyer, usdt } = await loadFixture(setupFixture)
      await v7.connect(owner).setActive(false)
      await usdt.mint(buyer.address, 1000n * 10n ** 6n)
      await usdt.connect(buyer).approve(await v7.getAddress(), 1000n * 10n ** 6n)
      await expect(v7.connect(buyer).buyPackage(0)).to.be.revertedWith("Seed: sale not active")
    })

    it("reverts on invalid package index >=4", async () => {
      const { v7, buyer } = await loadFixture(setupFixture)
      await expect(v7.connect(buyer).buyPackage(4)).to.be.revertedWith("Seed: invalid package")
    })
  })

  describe("Old Investors grant", () => {
    it("adminGrantOldInvestor by GRANTER_ROLE transfers MIC + tracks cap", async () => {
      const { mic, v7, owner, granter, buyer } = await loadFixture(setupFixture)
      const GRANTER = await v7.GRANTER_ROLE()
      await v7.connect(owner).grantRole(GRANTER, granter.address)

      const startTime = (await ethers.provider.getBlock("latest"))!.timestamp
      const amount = 5_000_000n * 10n ** 18n

      await v7.connect(granter).adminGrantOldInvestor(buyer.address, amount, startTime)

      expect(await mic.balanceOf(buyer.address)).to.equal(amount)
      expect(await v7.oldInvestorsGranted()).to.equal(amount)
      expect(await v7.oldInvestorsRemaining()).to.equal(75_000_000n * 10n ** 18n - amount)
    })

    it("adminGrantOldInvestor reverts when non-granter calls", async () => {
      const { v7, buyer } = await loadFixture(setupFixture)
      const startTime = (await ethers.provider.getBlock("latest"))!.timestamp
      await expect(
        v7.connect(buyer).adminGrantOldInvestor(buyer.address, 1n * 10n ** 18n, startTime),
      ).to.be.reverted
    })

    it("adminGrantOldInvestor reverts when cumulative exceeds 75M cap", async () => {
      const { v7, owner, granter, buyer } = await loadFixture(setupFixture)
      const GRANTER = await v7.GRANTER_ROLE()
      await v7.connect(owner).grantRole(GRANTER, granter.address)

      const startTime = (await ethers.provider.getBlock("latest"))!.timestamp
      const over = 75_000_001n * 10n ** 18n
      await expect(
        v7.connect(granter).adminGrantOldInvestor(buyer.address, over, startTime),
      ).to.be.revertedWith("Seed: Old Investors pool exhausted")
    })
  })

  describe("rescueToken", () => {
    it("admin can withdraw stuck MIC", async () => {
      const { mic, v7, owner } = await loadFixture(setupFixture)
      const before = await mic.balanceOf(owner.address)
      const stuck = 1000n * 10n ** 18n
      await v7.connect(owner).rescueToken(await mic.getAddress(), owner.address, stuck)
      expect(await mic.balanceOf(owner.address)).to.equal(before + stuck)
    })

    it("non-admin cannot rescue", async () => {
      const { mic, v7, buyer } = await loadFixture(setupFixture)
      await expect(
        v7.connect(buyer).rescueToken(await mic.getAddress(), buyer.address, 1n),
      ).to.be.reverted
    })
  })
})
