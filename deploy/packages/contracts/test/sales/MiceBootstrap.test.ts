import { expect } from "chai"
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers"
import { ethers } from "hardhat"

/**
 * MICELicense — pricing before the pool exists.
 *
 * A licence is half USDT and half MIC-to-burn, and the MIC half needs a price. Until the
 * SWAP pool is seeded there is no market to ask, so sales would simply stop.
 *
 * The bootstrap price fills that window, and the property that makes it safe is not that
 * it is "close enough" — it is that it is *the same number the pool will quote on its
 * first block*. Spot at the seed is the virtual reserve over the MIC seeded
 * ($500,000 / 50,000,000 = $0.01), and `twap7d` on a pool of age zero falls back to spot.
 * So there is no step at the moment of activation, and therefore nothing to trade against
 * by rushing in just before or just after.
 *
 * The other half of the safety is the boundary: the bootstrap is immutable, and it stops
 * applying the instant the pool reports itself seeded. There is no path back to it.
 */

const MIC = (n: string | number) => ethers.parseEther(String(n))
const USD = (n: string | number) => ethers.parseEther(String(n))

const OPENING = ethers.parseEther("0.01")
const ROUND1 = USD(100)

async function setup() {
  const [admin, buyer, other] = await ethers.getSigners()

  const usdt: any = await (await ethers.getContractFactory("MockUSDT")).deploy()
  const mic: any = await (await ethers.getContractFactory("MICToken")).deploy(admin.address)
  const pool: any = await (await ethers.getContractFactory("MockLiquidityPoolV6")).deploy()

  // Dormant: no price, not seeded — the state the real pool is in right now.
  await pool.setPrices(0n, 0n, 0n)
  await pool.setSeeded(false)

  const registry: any = await (await ethers.getContractFactory("ReferralRegistry"))
    .deploy(await usdt.getAddress(), admin.address)
  const router: any = await (await ethers.getContractFactory("MockRewardReceiver"))
    .deploy(await usdt.getAddress())

  const mice: any = await (await ethers.getContractFactory("MICELicense")).deploy(
    await usdt.getAddress(), await mic.getAddress(),
    await registry.getAddress(), await router.getAddress(),
    admin.address, await pool.getAddress(), OPENING,
  )
  await registry.grantRole(await registry.CALLER_ROLE(), await mice.getAddress())

  for (const who of [buyer, other]) {
    await usdt.mint(who.address, USD(100_000))
    await mic.connect(admin).transfer(who.address, MIC(1_000_000))
    await usdt.connect(who).approve(await mice.getAddress(), ethers.MaxUint256)
    await mic.connect(who).approve(await mice.getAddress(), ethers.MaxUint256)
  }

  return { usdt, mic, pool, mice, registry, router, admin, buyer, other }
}

describe("MICELicense — bootstrap price", () => {
  describe("while the pool is dormant", () => {
    it("quotes the burn off the published opening price", async () => {
      const { mice } = await loadFixture(setup)
      // $100 licence → $50 of MIC at $0.01 → 5,000 MIC.
      expect(await mice.quoteMicRequired(1n)).to.equal(MIC(5_000))
    })

    it("sells, where before it reverted with no price", async () => {
      const { mice, buyer } = await loadFixture(setup)
      await mice.connect(buyer)["buyLicense(uint256)"](1n)
      expect(await mice.totalMinted()).to.equal(1n)
    })

    it("burns exactly the MIC the quote promised", async () => {
      const { mice, mic, buyer } = await loadFixture(setup)
      const supplyBefore = await mic.totalSupply()
      await mice.connect(buyer)["buyLicense(uint256)"](1n)
      expect(supplyBefore - (await mic.totalSupply())).to.equal(MIC(5_000))
    })

    it("still takes the USDT half and routes it", async () => {
      const { mice, usdt, buyer } = await loadFixture(setup)
      const before = await usdt.balanceOf(buyer.address)
      await mice.connect(buyer)["buyLicense(uint256)"](1n)
      expect(before - (await usdt.balanceOf(buyer.address))).to.equal(ROUND1 / 2n)
    })

    it("scales with quantity", async () => {
      const { mice } = await loadFixture(setup)
      expect(await mice.quoteMicRequired(3n)).to.equal(MIC(15_000))
    })
  })

  describe("the handover is seamless", () => {
    it("charges the same MIC on either side of the seed", async () => {
      const { mice, pool, buyer, other } = await loadFixture(setup)

      const quoteBefore = await mice.quoteMicRequired(1n)
      await mice.connect(buyer)["buyLicense(uint256)"](1n)

      // The pool comes to life at exactly the price it was always going to open at.
      await pool.setPrices(OPENING, OPENING, OPENING)
      await pool.setSeeded(true)

      const quoteAfter = await mice.quoteMicRequired(1n)
      // Not "close" — identical. A difference here would be a window to trade.
      expect(quoteAfter).to.equal(quoteBefore)

      await mice.connect(other)["buyLicense(uint256)"](1n)
      expect(await mice.totalMinted()).to.equal(2n)
    })
  })

  describe("once the market exists, the market decides", () => {
    it("uses the pool's price, not the bootstrap, as soon as it is seeded", async () => {
      const { mice, pool } = await loadFixture(setup)
      await pool.setPrices(ethers.parseEther("0.02"), ethers.parseEther("0.02"), ethers.parseEther("0.02"))
      await pool.setSeeded(true)
      // At $0.02 the same $50 needs half the MIC. The bootstrap is no longer consulted.
      expect(await mice.quoteMicRequired(1n)).to.equal(MIC(2_500))
    })

    it("follows the price down as well as up", async () => {
      const { mice, pool } = await loadFixture(setup)
      await pool.setPrices(ethers.parseEther("0.005"), ethers.parseEther("0.005"), ethers.parseEther("0.005"))
      await pool.setSeeded(true)
      expect(await mice.quoteMicRequired(1n)).to.equal(MIC(10_000))
    })

    it("still takes the lower of spot and the 7-day average", async () => {
      const { mice, pool } = await loadFixture(setup)
      // Spot pumped to $0.05, average still $0.01 — the average wins, so pumping the
      // price buys nothing.
      await pool.setPrices(ethers.parseEther("0.05"), OPENING, OPENING)
      await pool.setSeeded(true)
      expect(await mice.quoteMicRequired(1n)).to.equal(MIC(5_000))
    })

    it("refuses to sell if a seeded pool somehow quotes nothing", async () => {
      const { mice, pool, buyer } = await loadFixture(setup)
      await pool.setSeeded(true)          // seeded, yet quoting zero
      await pool.setPrices(0n, 0n, 0n)

      // An impossible state, but the contract must stop rather than fall back to the
      // bootstrap. Once the pool has been live, its silence is a fault to investigate,
      // not a licence to reprice at a number the market has long moved past.
      await expect(mice.quoteMicRequired(1n)).to.be.revertedWith("MICE: no price")
      await expect(mice.connect(buyer)["buyLicense(uint256)"](1n)).to.be.revertedWith("MICE: no price")
    })
  })

  describe("the bootstrap cannot be turned into a lever", () => {
    it("is immutable — there is no setter", async () => {
      const { mice } = await loadFixture(setup)
      expect(await mice.bootstrapPrice()).to.equal(OPENING)
      expect((mice as any).setBootstrapPrice).to.equal(undefined)
    })

    it("refuses to deploy with a zero bootstrap", async () => {
      const { usdt, mic, registry, router, pool, admin } = await loadFixture(setup)
      await expect(
        (await ethers.getContractFactory("MICELicense")).deploy(
          await usdt.getAddress(), await mic.getAddress(),
          await registry.getAddress(), await router.getAddress(),
          admin.address, await pool.getAddress(), 0n,
        ),
      ).to.be.revertedWith("MICE: zero bootstrap price")
    })
  })

  describe("setLiquidityPool", () => {
    it("lets admin repoint the price source without a redeploy", async () => {
      const { mice, admin } = await loadFixture(setup)
      const next: any = await (await ethers.getContractFactory("MockLiquidityPoolV6")).deploy()
      await next.setPrices(ethers.parseEther("0.03"), ethers.parseEther("0.03"), ethers.parseEther("0.03"))
      await next.setSeeded(true)

      await mice.connect(admin).setLiquidityPool(await next.getAddress())
      expect(await mice.liquidityPool()).to.equal(await next.getAddress())
      // $50 of MIC at $0.03 = 1,666.666… MIC. Written as an exact ratio: JS float
      // division here produced a number 33,334 wei away from what the chain computes.
      expect(await mice.quoteMicRequired(1n)).to.equal(
        (USD(50) * 10n ** 18n) / ethers.parseEther("0.03"),
      )
    })

    it("rejects the zero address and non-admins", async () => {
      const { mice, admin, other } = await loadFixture(setup)
      await expect(mice.connect(admin).setLiquidityPool(ethers.ZeroAddress))
        .to.be.revertedWith("MICE: zero pool")
      await expect(mice.connect(other).setLiquidityPool(other.address)).to.be.reverted
    })
  })
})
