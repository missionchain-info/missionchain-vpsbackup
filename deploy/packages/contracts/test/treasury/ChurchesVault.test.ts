import { expect } from "chai"
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers"
import { ethers } from "hardhat"

/**
 * ChurchesVault — the 10% of the DAO's mining slice reserved for churches, ministries
 * and Christian community bodies.
 *
 * Two properties carry the weight here, and neither is obvious from reading the happy
 * path:
 *
 *  · **A grant and its vesting schedule are one call.** If the transfer could land
 *    without `LockManager.createSchedule`, the published 24-month cliff would be advice
 *    rather than a rule, skippable by an operator in a hurry.
 *
 *  · **`rescueToken` refuses MIC.** MIC sitting here is the programme's funding, and its
 *    only way out is `grant`, which carries the schedule. A rescue path for MIC would be
 *    a hole straight through the cliff — the mirror of the mistake that immobilised
 *    105,000,000 MIC in TreasuryManager v1, where the danger was having no exit at all.
 */

const MIC = (n: string | number) => ethers.parseEther(String(n))

const CLIFF_DAYS = 730          // 24 months
const CLIFF_BPS = 1000          // 10% at the cliff
const MONTHLY_BPS = 250         // 2.5% per month afterwards

async function setup() {
  const [admin, grantor, church, other] = await ethers.getSigners()

  const mic = await (await ethers.getContractFactory("MICToken")).deploy(admin.address)
  const lock = await (await ethers.getContractFactory("MockLockManagerV6")).deploy()
  const stray = await (await ethers.getContractFactory("MockUSDT")).deploy()

  const vault: any = await (await ethers.getContractFactory("ChurchesVault"))
    .deploy(await mic.getAddress(), await lock.getAddress(), admin.address)

  await vault.connect(admin).grantRole(await vault.GRANTOR_ROLE(), grantor.address)
  await mic.connect(admin).transfer(await vault.getAddress(), MIC(1_000_000))

  return { vault, mic, lock, stray, admin, grantor, church, other }
}

describe("ChurchesVault", () => {
  describe("funding", () => {
    it("reports its balance rather than a separate ledger", async () => {
      const { vault, mic } = await loadFixture(setup)
      // `available()` reads balanceOf directly, so it cannot drift from reality the way
      // a bookkeeping variable can.
      expect(await vault.available()).to.equal(MIC(1_000_000))
      expect(await vault.available()).to.equal(await mic.balanceOf(await vault.getAddress()))
    })

    it("starts with nothing granted", async () => {
      const { vault } = await loadFixture(setup)
      expect(await vault.totalGranted()).to.equal(0n)
      expect(await vault.grantCount()).to.equal(0n)
    })
  })

  describe("grant", () => {
    it("moves the MIC and creates the vesting schedule in one call", async () => {
      const { vault, mic, lock, grantor, church } = await loadFixture(setup)
      await vault.connect(grantor).grant(church.address, MIC(100_000), "Church building fund")

      expect(await mic.balanceOf(church.address)).to.equal(MIC(100_000))
      expect(await lock.scheduleCount(church.address)).to.equal(1n)

      const sched = await lock.getScheduleAt(church.address, 0)
      expect(sched.totalAmount).to.equal(MIC(100_000))
      expect(sched.cliffDuration).to.equal(BigInt(CLIFF_DAYS * 24 * 3600))
      expect(sched.cliffUnlockBps).to.equal(BigInt(CLIFF_BPS))
      expect(sched.monthlyUnlockBps).to.equal(BigInt(MONTHLY_BPS))
    })

    it("publishes a 24-month cliff, 10% at cliff, 2.5% monthly", async () => {
      const { vault, lock, grantor, church } = await loadFixture(setup)
      await vault.connect(grantor).grant(church.address, MIC(1_000), "Ministry support")
      const sched = await lock.getScheduleAt(church.address, 0)
      // Stated in months rather than seconds so a changed constant is visible here.
      expect(Number(sched.cliffDuration) / (24 * 3600) / 365).to.be.closeTo(2, 0.01)
    })

    it("records the purpose on-chain for audit", async () => {
      const { vault, grantor, church } = await loadFixture(setup)
      await vault.connect(grantor).grant(church.address, MIC(500), "Orphanage roof repair")
      const g = await vault.getGrant(0)
      expect(g.recipient).to.equal(church.address)
      expect(g.amount).to.equal(MIC(500))
      expect(g.purpose).to.equal("Orphanage roof repair")
      expect(g.grantedBy).to.equal(grantor.address)
    })

    it("accumulates totals per recipient and overall", async () => {
      const { vault, grantor, church } = await loadFixture(setup)
      await vault.connect(grantor).grant(church.address, MIC(100), "First")
      await vault.connect(grantor).grant(church.address, MIC(250), "Second")
      expect(await vault.totalGranted()).to.equal(MIC(350))
      expect(await vault.grantCount()).to.equal(2n)
      expect(await vault.grantedTo(church.address)).to.equal(MIC(350))
    })

    it("refuses more than the vault holds", async () => {
      const { vault, grantor, church } = await loadFixture(setup)
      await expect(
        vault.connect(grantor).grant(church.address, MIC(1_000_001), "Too much"),
      ).to.be.revertedWith("CV: insufficient balance")
    })

    it("refuses a zero recipient and a zero amount", async () => {
      const { vault, grantor, church } = await loadFixture(setup)
      await expect(vault.connect(grantor).grant(ethers.ZeroAddress, MIC(1), "x"))
        .to.be.revertedWith("CV: zero recipient")
      await expect(vault.connect(grantor).grant(church.address, 0, "x"))
        .to.be.revertedWith("CV: zero amount")
    })

    it("only GRANTOR_ROLE may grant", async () => {
      const { vault, other, church } = await loadFixture(setup)
      await expect(
        vault.connect(other).grant(church.address, MIC(1), "x"),
      ).to.be.reverted
    })

    it("emits GrantIssued", async () => {
      const { vault, grantor, church } = await loadFixture(setup)
      await expect(vault.connect(grantor).grant(church.address, MIC(42), "Youth camp"))
        .to.emit(vault, "GrantIssued")
        .withArgs(0n, church.address, MIC(42), "Youth camp")
    })

    it("refuses to grant while no LockManager is set", async () => {
      const { mic, admin, grantor, church } = await loadFixture(setup)
      // A vault deployed without a LockManager must not hand out unvested MIC.
      const bare: any = await (await ethers.getContractFactory("ChurchesVault"))
        .deploy(await mic.getAddress(), ethers.ZeroAddress, admin.address)
      await bare.connect(admin).grantRole(await bare.GRANTOR_ROLE(), grantor.address)
      await mic.connect(admin).transfer(await bare.getAddress(), MIC(100))
      await expect(
        bare.connect(grantor).grant(church.address, MIC(10), "x"),
      ).to.be.revertedWith("CV: lockManager not set")
    })
  })

  describe("rescueToken", () => {
    it("recovers a token sent here by mistake", async () => {
      const { vault, stray, admin, other } = await loadFixture(setup)
      await stray.mint(await vault.getAddress(), MIC(1_000))
      await vault.connect(admin).rescueToken(await stray.getAddress(), other.address, MIC(1_000))
      expect(await stray.balanceOf(other.address)).to.equal(MIC(1_000))
    })

    it("refuses MIC — the cliff is not bypassable", async () => {
      const { vault, mic, admin, other } = await loadFixture(setup)
      await expect(
        vault.connect(admin).rescueToken(await mic.getAddress(), other.address, MIC(1)),
      ).to.be.revertedWith("CV: use grant() for MIC")
    })

    it("only admin may rescue", async () => {
      const { vault, stray, other } = await loadFixture(setup)
      await stray.mint(await vault.getAddress(), MIC(10))
      await expect(
        vault.connect(other).rescueToken(await stray.getAddress(), other.address, MIC(10)),
      ).to.be.reverted
    })
  })

  describe("setLockManager", () => {
    it("admin can point the vault at a new LockManager", async () => {
      const { vault, admin } = await loadFixture(setup)
      const next = await (await ethers.getContractFactory("MockLockManagerV6")).deploy()
      await vault.connect(admin).setLockManager(await next.getAddress())
      expect(await vault.lockManager()).to.equal(await next.getAddress())
    })

    it("refuses the zero address", async () => {
      const { vault, admin } = await loadFixture(setup)
      await expect(vault.connect(admin).setLockManager(ethers.ZeroAddress))
        .to.be.revertedWith("CV: zero lockManager")
    })

    it("only admin may change it", async () => {
      const { vault, other } = await loadFixture(setup)
      const next = await (await ethers.getContractFactory("MockLockManagerV6")).deploy()
      await expect(
        vault.connect(other).setLockManager(await next.getAddress()),
      ).to.be.reverted
    })
  })
})
