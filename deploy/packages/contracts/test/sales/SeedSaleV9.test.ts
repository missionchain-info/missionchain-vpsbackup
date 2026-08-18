import { expect } from "chai"
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers"
import { ethers } from "hardhat"

/**
 * SeedSaleV9 — the SEED contract that finally has both fixes: 18-decimal prices and an enforced whitelist.
 *
 * V7 `0xe4C1B4fBE009245eBB6B3a4F76DcAAE445F60905` went live with prices written in 6
 * decimals against an 18-decimal token, so package 3 sold 4,000,000 MIC and 20 MFP for
 * 0.00000001 USDT. It was halted with `totalSold` still 0. These tests pin the price
 * scale, the whitelist V7 declared but never read, and the Old Investors carry-over —
 * which is what stops a redeploy from silently handing out the 75,000,000 pool twice.
 *
 * The whitelist is load-bearing, not decoration: SEED sells MIC at half the Pre-Sale
 * price, so an open SEED makes the Pre-Sale unsellable.
 */

const USDT = (n: string | number) => ethers.parseEther(String(n))
const MIC  = (n: string | number) => ethers.parseEther(String(n))

const CARRIED_OVER = MIC("45941150") // read off live V7 on 2026-08-08

async function setupFixture() {
  const [owner, buyer, other, granter] = await ethers.getSigners()

  const usdt = await (await ethers.getContractFactory("MockUSDT")).deploy()
  const mic = await (await ethers.getContractFactory("MICToken")).deploy(owner.address)
  const lock = await (await ethers.getContractFactory("MockLockManagerV6")).deploy()
  const mfp = await (await ethers.getContractFactory("MockMFPNFTV6")).deploy()
  const v5c = await (await ethers.getContractFactory("SeedBudgetV5c"))
    .deploy(await usdt.getAddress(), owner.address)

  const v8: any = await (await ethers.getContractFactory("SeedSaleV9")).deploy(
    await usdt.getAddress(),
    await mic.getAddress(),
    await lock.getAddress(),
    await mfp.getAddress(),
    await v5c.getAddress(),
    owner.address,
    CARRIED_OVER,
  )

  await v5c.connect(owner).grantRole(await v5c.CALLER_ROLE(), await v8.getAddress())
  await mic.connect(owner).transfer(await v8.getAddress(), await v8.micRequired())
  await v8.connect(owner).setActive(true)
  await v8.connect(owner).addToWhitelist([buyer.address])

  // Buyers need USDT and an approval to reach anything interesting.
  for (const s of [buyer, other]) {
    await usdt.mint(s.address, USDT(100_000))
    await usdt.connect(s).approve(await v8.getAddress(), ethers.MaxUint256)
  }

  return { usdt, mic, lock, mfp, v5c, v8, owner, buyer, other, granter }
}

describe("SeedSaleV9", () => {
  describe("pricing — the defect that halted V7", () => {
    it("packages are priced in real dollars, not millionths", async () => {
      const { v8 } = await loadFixture(setupFixture)
      const expected = [
        [USDT(1_000), MIC(400_000), 1n],
        [USDT(2_500), MIC(1_000_000), 3n],
        [USDT(5_000), MIC(2_000_000), 8n],
        [USDT(10_000), MIC(4_000_000), 20n],
      ]
      for (let i = 0; i < 4; i++) {
        const p = await v8.packages(i)
        expect(p[0], `package ${i} price`).to.equal(expected[i][0])
        expect(p[1], `package ${i} MIC`).to.equal(expected[i][1])
        expect(p[2], `package ${i} MFP`).to.equal(expected[i][2])
      }
    })

    it("the top package costs more than a cent — V7's cost 0.00000001 USDT", async () => {
      const { v8 } = await loadFixture(setupFixture)
      const p = await v8.packages(3)
      expect(p[0]).to.be.greaterThan(USDT("0.01"))
      expect(p[0]).to.equal(USDT(10_000))
    })

    it("refuses to deploy against a 6-decimal token", async () => {
      const { mic, lock, mfp, v5c, owner } = await loadFixture(setupFixture)
      const usdt6 = await (await ethers.getContractFactory("MockUSDT6")).deploy()
      const F = await ethers.getContractFactory("SeedSaleV9")
      await expect(F.deploy(
        await usdt6.getAddress(), await mic.getAddress(), await lock.getAddress(),
        await mfp.getAddress(), await v5c.getAddress(), owner.address, 0n,
      )).to.be.revertedWith("Seed: usdt must be 18 decimals")
    })

    it("a buyer actually pays the full package price", async () => {
      const { v8, usdt, owner, buyer } = await loadFixture(setupFixture)
      const before = await usdt.balanceOf(buyer.address)
      await v8.connect(buyer).buyPackage(0)
      expect(before - (await usdt.balanceOf(buyer.address))).to.equal(USDT(1_000))
    })
  })

  describe("whitelist — the gate V7 declared and never read", () => {
    it("is required by default", async () => {
      const { v8 } = await loadFixture(setupFixture)
      expect(await v8.whitelistRequired()).to.equal(true)
    })

    it("refuses a wallet that is not on the list", async () => {
      const { v8, other } = await loadFixture(setupFixture)
      await expect(v8.connect(other).buyPackage(0)).to.be.revertedWith("Seed: not whitelisted")
    })

    it("lets a listed wallet through", async () => {
      const { v8, buyer, mic } = await loadFixture(setupFixture)
      expect(await mic.balanceOf(buyer.address)).to.equal(0n)
      await v8.connect(buyer).buyPackage(0)
      expect(await mic.balanceOf(buyer.address)).to.equal(MIC(400_000))
    })

    it("the gate is checked before the package index, so a bad index cannot probe it", async () => {
      const { v8, other } = await loadFixture(setupFixture)
      await expect(v8.connect(other).buyPackage(99)).to.be.revertedWith("Seed: not whitelisted")
    })

    it("removing a wallet closes the door again", async () => {
      const { v8, owner, buyer } = await loadFixture(setupFixture)
      await v8.connect(owner).removeFromWhitelist([buyer.address])
      await expect(v8.connect(buyer).buyPackage(0)).to.be.revertedWith("Seed: not whitelisted")
    })

    it("adds a batch and counts it", async () => {
      const { v8, owner, other, granter } = await loadFixture(setupFixture)
      const before = await v8.whitelistedCount()
      await v8.connect(owner).addToWhitelist([other.address, granter.address])
      expect(await v8.whitelistedCount()).to.equal(before + 2n)
      expect(await v8.whitelisted(other.address)).to.equal(true)
    })

    it("re-adding the same wallet does not inflate the count", async () => {
      const { v8, owner, buyer } = await loadFixture(setupFixture)
      const before = await v8.whitelistedCount()
      await v8.connect(owner).addToWhitelist([buyer.address, buyer.address])
      expect(await v8.whitelistedCount()).to.equal(before)
    })

    it("removing a wallet that was never listed does not underflow", async () => {
      const { v8, owner, other } = await loadFixture(setupFixture)
      const before = await v8.whitelistedCount()
      await v8.connect(owner).removeFromWhitelist([other.address])
      expect(await v8.whitelistedCount()).to.equal(before)
    })

    it("skips the zero address", async () => {
      const { v8, owner } = await loadFixture(setupFixture)
      const before = await v8.whitelistedCount()
      await v8.connect(owner).addToWhitelist([ethers.ZeroAddress])
      expect(await v8.whitelistedCount()).to.equal(before)
    })

    it("emits WhitelistUpdated on add and remove", async () => {
      const { v8, owner, other } = await loadFixture(setupFixture)
      await expect(v8.connect(owner).addToWhitelist([other.address]))
        .to.emit(v8, "WhitelistUpdated").withArgs(other.address, true)
      await expect(v8.connect(owner).removeFromWhitelist([other.address]))
        .to.emit(v8, "WhitelistUpdated").withArgs(other.address, false)
    })

    it("only WHITELISTER_ROLE may add or remove", async () => {
      const { v8, other } = await loadFixture(setupFixture)
      await expect(v8.connect(other).addToWhitelist([other.address])).to.be.reverted
      await expect(v8.connect(other).removeFromWhitelist([other.address])).to.be.reverted
    })

    it("admin can open the round to everyone, and it is an explicit logged act", async () => {
      const { v8, owner, other, mic } = await loadFixture(setupFixture)
      await expect(v8.connect(owner).setWhitelistRequired(false))
        .to.emit(v8, "WhitelistRequirementSet").withArgs(false)
      await v8.connect(other).buyPackage(0)
      expect(await mic.balanceOf(other.address)).to.equal(MIC(400_000))
    })

    it("only DEFAULT_ADMIN may open it", async () => {
      const { v8, other } = await loadFixture(setupFixture)
      await expect(v8.connect(other).setWhitelistRequired(false)).to.be.reverted
    })

    it("canBuy answers what buyPackage will do", async () => {
      const { v8, owner, buyer, other } = await loadFixture(setupFixture)
      expect(await v8.canBuy(buyer.address)).to.equal(true)
      expect(await v8.canBuy(other.address)).to.equal(false)
      await v8.connect(owner).setActive(false)
      expect(await v8.canBuy(buyer.address)).to.equal(false)
    })
  })

  describe("Old Investors carry-over", () => {
    it("starts from the amount already granted by the contract it replaces", async () => {
      const { v8 } = await loadFixture(setupFixture)
      expect(await v8.oldInvestorsGranted()).to.equal(CARRIED_OVER)
      expect(await v8.oldInvestorsRemaining()).to.equal(MIC("29058850"))
    })

    it("the 75M cap counts the carried amount — no second full round", async () => {
      const { v8, owner, other } = await loadFixture(setupFixture)
      await expect(
        v8.connect(owner).adminGrantOldInvestor(other.address, MIC("29058851"), 1764547200),
      ).to.be.revertedWith("Seed: Old Investors pool exhausted")
    })

    it("grants up to exactly the remaining amount", async () => {
      const { v8, owner, other, mic } = await loadFixture(setupFixture)
      await v8.connect(owner).adminGrantOldInvestor(other.address, MIC("29058850"), 1764547200)
      expect(await mic.balanceOf(other.address)).to.equal(MIC("29058850"))
      expect(await v8.oldInvestorsRemaining()).to.equal(0n)
    })

    it("constructor refuses a carry-over above the pool", async () => {
      const { usdt, mic, lock, mfp, v5c, owner } = await loadFixture(setupFixture)
      const F = await ethers.getContractFactory("SeedSaleV9")
      await expect(F.deploy(
        await usdt.getAddress(), await mic.getAddress(), await lock.getAddress(),
        await mfp.getAddress(), await v5c.getAddress(), owner.address, MIC("75000001"),
      )).to.be.revertedWith("Seed: seed exceeds pool")
    })

    it("non-GRANTER cannot grant", async () => {
      const { v8, other } = await loadFixture(setupFixture)
      await expect(
        v8.connect(other).adminGrantOldInvestor(other.address, MIC(1), 1764547200),
      ).to.be.reverted
    })
  })

  describe("funding", () => {
    it("micRequired covers unsold allocation plus the ungranted Old Investors pool", async () => {
      const { v8, mic } = await loadFixture(setupFixture)
      // 152,500,000 unsold + (75,000,000 − 45,941,150) = 181,558,850 — exactly what the
      // live V7 held, which is how the migration reconciles to zero.
      const held = await mic.balanceOf(await v8.getAddress())
      expect(held).to.equal(MIC("181558850"))
    })

    it("micRequired shrinks as the round sells", async () => {
      const { v8, owner, buyer } = await loadFixture(setupFixture)
      const before = await v8.micRequired()
      await v8.connect(buyer).buyPackage(0)
      expect(before - (await v8.micRequired())).to.equal(MIC(400_000))
    })
  })

  describe("sale mechanics still intact", () => {
    it("USDT is forwarded to SeedBudgetV5c, none rests here", async () => {
      const { v8, usdt, v5c, owner, buyer } = await loadFixture(setupFixture)
      await v8.connect(buyer).buyPackage(1)
      expect(await usdt.balanceOf(await v8.getAddress())).to.equal(0n)
      expect(await usdt.balanceOf(await v5c.getAddress())).to.equal(USDT(2_500))
    })

    it("creates a vesting schedule and grants MFP allowance", async () => {
      const { v8, lock, mfp, owner, buyer } = await loadFixture(setupFixture)
      await v8.connect(buyer).buyPackage(2)
      expect(await lock.scheduleCount(buyer.address)).to.equal(1n)
      expect((await lock.getScheduleAt(buyer.address, 0)).totalAmount).to.equal(MIC(2_000_000))
      expect(await mfp.mintAllowance(buyer.address)).to.equal(8n)
    })

    it("reverts when the sale is not active", async () => {
      const { v8, owner, buyer } = await loadFixture(setupFixture)
      await v8.connect(owner).setActive(false)
      await expect(v8.connect(buyer).buyPackage(0)).to.be.revertedWith("Seed: sale not active")
    })

    it("reverts on an invalid package index", async () => {
      const { v8, owner, buyer } = await loadFixture(setupFixture)
      await expect(v8.connect(buyer).buyPackage(4)).to.be.revertedWith("Seed: invalid package")
    })

    it("emits SeedPurchase with the real price", async () => {
      const { v8, owner, buyer } = await loadFixture(setupFixture)
      await expect(v8.connect(buyer).buyPackage(3))
        .to.emit(v8, "SeedPurchase")
        .withArgs(buyer.address, 3n, USDT(10_000), MIC(4_000_000), 20n)
    })
  })

  describe("rescueToken — the way out if this one is ever replaced", () => {
    it("admin can move MIC out", async () => {
      const { v8, mic, owner, other } = await loadFixture(setupFixture)
      await v8.connect(owner).rescueToken(await mic.getAddress(), other.address, MIC(1_000))
      expect(await mic.balanceOf(other.address)).to.equal(MIC(1_000))
    })

    it("non-admin cannot", async () => {
      const { v8, mic, other } = await loadFixture(setupFixture)
      await expect(
        v8.connect(other).rescueToken(await mic.getAddress(), other.address, MIC(1)),
      ).to.be.reverted
    })
  })
})
