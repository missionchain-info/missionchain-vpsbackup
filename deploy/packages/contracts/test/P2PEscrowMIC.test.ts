/**
 * P2PEscrowMIC — the money paths, and the decimals guard that six incidents earned.
 *
 * The suite that let `1_000_000e6` reach mainnet was green throughout, because it minted
 * in the same wrong unit it asserted in. So the bounds here are asserted against *dollars*
 * — a listing at $1,000,001 must fail and one at $1,000,000 must pass — and the guard is
 * proved by deploying against a real 6-decimal token and requiring the revert.
 */
import { expect } from 'chai'
import { ethers } from 'hardhat'
import { time } from '@nomicfoundation/hardhat-network-helpers'

const E18 = (n: string | number) => ethers.parseUnits(String(n), 18)
const DAY = 24 * 60 * 60

async function fixture() {
  const [admin, seller, buyer, treasury, stranger] = await ethers.getSigners()

  const Token = await ethers.getContractFactory('MockUSDT') // 18 decimals
  const usdt = await Token.deploy()
  const mic = await Token.deploy()

  const P2P = await ethers.getContractFactory('P2PEscrowMIC')
  const p2p = await P2P.deploy(
    await usdt.getAddress(),
    await mic.getAddress(),
    treasury.address,
    admin.address,
  )

  await mic.mint(seller.address, E18(1_000_000))
  await usdt.mint(buyer.address, E18(100_000))
  await mic.connect(seller).approve(await p2p.getAddress(), ethers.MaxUint256)
  await usdt.connect(buyer).approve(await p2p.getAddress(), ethers.MaxUint256)
  // Either side may now go first, so both need both approvals.
  await usdt.connect(seller).approve(await p2p.getAddress(), ethers.MaxUint256)
  await mic.connect(buyer).approve(await p2p.getAddress(), ethers.MaxUint256)
  await usdt.mint(seller.address, E18(10_000))
  await mic.mint(buyer.address, E18(500_000))

  return { p2p, usdt, mic, admin, seller, buyer, treasury, stranger }
}

describe('P2PEscrowMIC', () => {
  describe('decimals guard', () => {
    it('refuses a 6-decimal USDT', async () => {
      const [admin, , , treasury] = await ethers.getSigners()
      const Six = await ethers.getContractFactory('MockUSDT6')
      const six = await Six.deploy()
      const Token = await ethers.getContractFactory('MockUSDT')
      const mic = await Token.deploy()

      const P2P = await ethers.getContractFactory('P2PEscrowMIC')
      await expect(
        P2P.deploy(await six.getAddress(), await mic.getAddress(), treasury.address, admin.address),
      ).to.be.revertedWith('P2P: USDT must be 18 decimals')
    })

    it('refuses a 6-decimal MIC', async () => {
      const [admin, , , treasury] = await ethers.getSigners()
      const Six = await ethers.getContractFactory('MockUSDT6')
      const six = await Six.deploy()
      const Token = await ethers.getContractFactory('MockUSDT')
      const usdt = await Token.deploy()

      const P2P = await ethers.getContractFactory('P2PEscrowMIC')
      await expect(
        P2P.deploy(await usdt.getAddress(), await six.getAddress(), treasury.address, admin.address),
      ).to.be.revertedWith('P2P: MIC must be 18 decimals')
    })

    it('accepts a listing at $1,000,000 and rejects $1,000,001', async () => {
      const { p2p, seller } = await fixture()
      await expect(p2p.connect(seller).createOrder(E18(1000), E18(1_000_000), DAY)).to.not.be.reverted
      await expect(
        p2p.connect(seller).createOrder(E18(1000), E18(1_000_001), DAY),
      ).to.be.revertedWith('P2P: price out of range')
    })

    it('accepts $0.005 and rejects $0.004 — the floor the Owner set', async () => {
      const { p2p, seller } = await fixture()
      await expect(
        p2p.connect(seller).createOrder(E18(1000), ethers.parseUnits('0.005', 18), DAY),
      ).to.not.be.reverted
      await expect(
        p2p.connect(seller).createOrder(E18(1000), ethers.parseUnits('0.004', 18), DAY),
      ).to.be.revertedWith('P2P: price out of range')
    })

    it('lets the admin move the floor without a redeploy — what MFP could not do', async () => {
      const { p2p, admin, seller } = await fixture()
      await expect(
        p2p.connect(seller).createOrder(E18(1000), ethers.parseUnits('0.002', 18), DAY),
      ).to.be.revertedWith('P2P: price out of range')

      await p2p.connect(admin).setPriceBounds(ethers.parseUnits('0.001', 18), E18(1_000_000))
      await expect(
        p2p.connect(seller).createOrder(E18(1000), ethers.parseUnits('0.002', 18), DAY),
      ).to.not.be.reverted
    })

    it('will not let the floor go below $0.001 or the ceiling above $100M', async () => {
      const { p2p, admin } = await fixture()
      await expect(
        p2p.connect(admin).setPriceBounds(ethers.parseUnits('0.0009', 18), E18(1_000_000)),
      ).to.be.revertedWith('P2P: min below floor')
      await expect(
        p2p.connect(admin).setPriceBounds(E18(1), E18(100_000_001)),
      ).to.be.revertedWith('P2P: max above ceiling')
    })

    it('lets nobody but the admin move the bounds', async () => {
      const { p2p, stranger } = await fixture()
      await expect(
        p2p.connect(stranger).setPriceBounds(E18(1), E18(100)),
      ).to.be.reverted
    })
  })

  describe('createOrder', () => {
    it('escrows the MIC and opens the order', async () => {
      const { p2p, mic, seller } = await fixture()
      const before = await mic.balanceOf(seller.address)

      await p2p.connect(seller).createOrder(E18(1000), E18(50), DAY)

      expect(await mic.balanceOf(seller.address)).to.equal(before - E18(1000))
      expect(await mic.balanceOf(await p2p.getAddress())).to.equal(E18(1000))
      expect(await p2p.totalEscrowedMic()).to.equal(E18(1000))

      const o = await p2p.getOrder(0)
      expect(o.seller).to.equal(seller.address)
      expect(o.status).to.equal(0) // PENDING
    })

    it('rejects an expiry beyond 30 days', async () => {
      const { p2p, seller } = await fixture()
      await expect(
        p2p.connect(seller).createOrder(E18(1000), E18(50), 31 * DAY),
      ).to.be.revertedWith('P2P: expiry out of range')
    })

    it('rejects an order while paused', async () => {
      const { p2p, admin, seller } = await fixture()
      await p2p.connect(admin).setPaused(true)
      await expect(p2p.connect(seller).createOrder(E18(1000), E18(50), DAY)).to.be.revertedWith('P2P: paused')
    })
  })

  describe('matchOrder', () => {
    it('settles both legs and takes the fee', async () => {
      const { p2p, usdt, mic, seller, buyer, treasury } = await fixture()
      await p2p.connect(seller).createOrder(E18(1000), E18(100), DAY)

      // Assert the delta: the seller now starts with USDT of their own, since either side
      // may open a trade.
      const sellerUsdtBefore = await usdt.balanceOf(seller.address)

      const [pays, receives] = await p2p.quote(0)
      expect(pays).to.equal(E18(100))
      expect(receives).to.equal(E18(98.5)) // 1.5%

      await p2p.connect(buyer).matchOrder(0, E18(100))

      expect(await usdt.balanceOf(seller.address)).to.equal(sellerUsdtBefore + E18(98.5))
      expect(await usdt.balanceOf(treasury.address)).to.equal(E18(1.5))
      expect(await mic.balanceOf(buyer.address)).to.equal(E18(500_000) + E18(1000))
      expect(await p2p.totalEscrowedMic()).to.equal(0)
      expect((await p2p.getOrder(0)).status).to.equal(1) // EXECUTED
    })

    it('holds no USDT of its own after a fill', async () => {
      const { p2p, usdt, seller, buyer } = await fixture()
      await p2p.connect(seller).createOrder(E18(1000), E18(100), DAY)
      await p2p.connect(buyer).matchOrder(0, E18(100))
      expect(await usdt.balanceOf(await p2p.getAddress())).to.equal(0)
    })

    it('refuses when the buyer cap is below the asking price', async () => {
      const { p2p, seller, buyer } = await fixture()
      await p2p.connect(seller).createOrder(E18(1000), E18(100), DAY)
      await expect(p2p.connect(buyer).matchOrder(0, E18(99))).to.be.revertedWith('P2P: price moved')
    })

    it('refuses a self-trade', async () => {
      const { p2p, usdt, seller } = await fixture()
      await usdt.mint(seller.address, E18(1000))
      await usdt.connect(seller).approve(await p2p.getAddress(), ethers.MaxUint256)
      await p2p.connect(seller).createOrder(E18(1000), E18(100), DAY)
      await expect(p2p.connect(seller).matchOrder(0, E18(100))).to.be.revertedWith('P2P: self-trade')
    })

    it('refuses after expiry', async () => {
      const { p2p, seller, buyer } = await fixture()
      await p2p.connect(seller).createOrder(E18(1000), E18(100), DAY)
      await time.increase(DAY + 1)
      await expect(p2p.connect(buyer).matchOrder(0, E18(100))).to.be.revertedWith('P2P: expired')
    })

    it('cannot be filled twice', async () => {
      const { p2p, seller, buyer } = await fixture()
      await p2p.connect(seller).createOrder(E18(1000), E18(100), DAY)
      await p2p.connect(buyer).matchOrder(0, E18(100))
      await expect(p2p.connect(buyer).matchOrder(0, E18(100))).to.be.revertedWith('P2P: not open')
    })
  })

  describe('cancel and expire', () => {
    it('returns the MIC to the seller on cancel', async () => {
      const { p2p, mic, seller } = await fixture()
      const before = await mic.balanceOf(seller.address)
      await p2p.connect(seller).createOrder(E18(1000), E18(100), DAY)
      await p2p.connect(seller).cancelOrder(0)
      expect(await mic.balanceOf(seller.address)).to.equal(before)
      expect(await p2p.totalEscrowedMic()).to.equal(0)
    })

    it('lets nobody but the seller cancel', async () => {
      const { p2p, seller, stranger } = await fixture()
      await p2p.connect(seller).createOrder(E18(1000), E18(100), DAY)
      await expect(p2p.connect(stranger).cancelOrder(0)).to.be.revertedWith('P2P: not seller')
    })

    it('lets a stranger expire an old order, and the MIC still goes to the seller', async () => {
      const { p2p, mic, seller, stranger } = await fixture()
      const before = await mic.balanceOf(seller.address)
      await p2p.connect(seller).createOrder(E18(1000), E18(100), DAY)
      await time.increase(DAY + 1)
      await p2p.connect(stranger).expireOrder(0)
      expect(await mic.balanceOf(seller.address)).to.equal(before)
    })

    it('refuses to expire before time', async () => {
      const { p2p, seller, stranger } = await fixture()
      await p2p.connect(seller).createOrder(E18(1000), E18(100), DAY)
      await expect(p2p.connect(stranger).expireOrder(0)).to.be.revertedWith('P2P: not yet expired')
    })

    it('still lets a seller cancel while paused — a pause must not trap escrow', async () => {
      const { p2p, mic, admin, seller } = await fixture()
      const before = await mic.balanceOf(seller.address)
      await p2p.connect(seller).createOrder(E18(1000), E18(100), DAY)
      await p2p.connect(admin).setPaused(true)
      await p2p.connect(seller).cancelOrder(0)
      expect(await mic.balanceOf(seller.address)).to.equal(before)
    })
  })

  describe('admin', () => {
    it('bounds the fee at 10%', async () => {
      const { p2p, admin } = await fixture()
      await expect(p2p.connect(admin).setFee(1001)).to.be.revertedWith('P2P: fee out of range')
      await p2p.connect(admin).setFee(1000)
      expect(await p2p.feeBps()).to.equal(1000)
    })

    it('lets nobody but the admin change the fee', async () => {
      const { p2p, stranger } = await fixture()
      await expect(p2p.connect(stranger).setFee(200)).to.be.reverted
    })

    it('cannot sweep MIC that belongs to an open order', async () => {
      const { p2p, admin, seller } = await fixture()
      await p2p.connect(seller).createOrder(E18(1000), E18(100), DAY)
      await expect(
        p2p.connect(admin).sweepStray(await p2p.mic(), admin.address, E18(1)),
      ).to.be.revertedWith('P2P: no stray MIC')
    })

    it('sweeps only the surplus above escrow', async () => {
      const { p2p, mic, admin, seller } = await fixture()
      await p2p.connect(seller).createOrder(E18(1000), E18(100), DAY)
      await mic.mint(await p2p.getAddress(), E18(7)) // stray transfer

      await expect(
        p2p.connect(admin).sweepStray(await p2p.mic(), admin.address, E18(8)),
      ).to.be.revertedWith('P2P: would touch escrow')

      await p2p.connect(admin).sweepStray(await p2p.mic(), admin.address, E18(7))
      expect(await mic.balanceOf(await p2p.getAddress())).to.equal(E18(1000))
    })
  })

  describe('buy orders (bids)', () => {
    it('escrows the buyer USDT when the bid is posted', async () => {
      const { p2p, usdt, buyer } = await fixture()
      const before = await usdt.balanceOf(buyer.address)

      await p2p.connect(buyer).createBuyOrder(E18(1000), E18(8), DAY)

      expect(await usdt.balanceOf(buyer.address)).to.equal(before - E18(8))
      expect(await p2p.totalEscrowedUsdt()).to.equal(E18(8))
      expect((await p2p.getBuyOrder(0)).buyer).to.equal(buyer.address)
    })

    it('settles both legs when a seller fills it', async () => {
      const { p2p, usdt, mic, seller, buyer, treasury } = await fixture()
      await p2p.connect(buyer).createBuyOrder(E18(1000), E18(8), DAY)

      const micBefore = await mic.balanceOf(seller.address)
      const usdtBefore = await usdt.balanceOf(seller.address)

      const [need, net] = await p2p.quoteBuyOrder(0)
      expect(need).to.equal(E18(1000))
      expect(net).to.equal(E18(7.88)) // 8 minus 1.5%

      await p2p.connect(seller).fillBuyOrder(0, E18(8))

      expect(await mic.balanceOf(seller.address)).to.equal(micBefore - E18(1000))
      expect(await mic.balanceOf(buyer.address)).to.equal(E18(500_000) + E18(1000))
      expect(await usdt.balanceOf(seller.address)).to.equal(usdtBefore + E18(7.88))
      expect(await usdt.balanceOf(treasury.address)).to.equal(E18(0.12))
      expect(await p2p.totalEscrowedUsdt()).to.equal(0)
    })

    it('refuses when the seller floor is above the bid', async () => {
      const { p2p, seller, buyer } = await fixture()
      await p2p.connect(buyer).createBuyOrder(E18(1000), E18(8), DAY)
      await expect(p2p.connect(seller).fillBuyOrder(0, E18(9))).to.be.revertedWith('P2P: price moved')
    })

    it('refuses a self-trade', async () => {
      const { p2p, buyer } = await fixture()
      await p2p.connect(buyer).createBuyOrder(E18(1000), E18(8), DAY)
      await expect(p2p.connect(buyer).fillBuyOrder(0, E18(8))).to.be.revertedWith('P2P: self-trade')
    })

    it('returns the USDT on cancel', async () => {
      const { p2p, usdt, buyer } = await fixture()
      const before = await usdt.balanceOf(buyer.address)
      await p2p.connect(buyer).createBuyOrder(E18(1000), E18(8), DAY)
      await p2p.connect(buyer).cancelBuyOrder(0)
      expect(await usdt.balanceOf(buyer.address)).to.equal(before)
      expect(await p2p.totalEscrowedUsdt()).to.equal(0)
    })

    it('lets nobody but the buyer cancel', async () => {
      const { p2p, buyer, stranger } = await fixture()
      await p2p.connect(buyer).createBuyOrder(E18(1000), E18(8), DAY)
      await expect(p2p.connect(stranger).cancelBuyOrder(0)).to.be.revertedWith('P2P: not buyer')
    })

    it('lets a stranger expire an old bid, and the USDT still goes to the buyer', async () => {
      const { p2p, usdt, buyer, stranger } = await fixture()
      const before = await usdt.balanceOf(buyer.address)
      await p2p.connect(buyer).createBuyOrder(E18(1000), E18(8), DAY)
      await time.increase(DAY + 1)
      await p2p.connect(stranger).expireBuyOrder(0)
      expect(await usdt.balanceOf(buyer.address)).to.equal(before)
    })

    it('cannot be filled after expiry, or twice', async () => {
      const { p2p, seller, buyer } = await fixture()
      await p2p.connect(buyer).createBuyOrder(E18(1000), E18(8), DAY)
      await p2p.connect(seller).fillBuyOrder(0, E18(8))
      await expect(p2p.connect(seller).fillBuyOrder(0, E18(8))).to.be.revertedWith('P2P: not open')

      await p2p.connect(buyer).createBuyOrder(E18(1000), E18(8), DAY)
      await time.increase(DAY + 1)
      await expect(p2p.connect(seller).fillBuyOrder(1, E18(8))).to.be.revertedWith('P2P: expired')
    })

    it('honours the price floor for bids too', async () => {
      const { p2p, buyer } = await fixture()
      await expect(
        p2p.connect(buyer).createBuyOrder(E18(1000), ethers.parseUnits('0.004', 18), DAY),
      ).to.be.revertedWith('P2P: price out of range')
    })

    it('will not let an admin sweep USDT a buyer has escrowed', async () => {
      const { p2p, usdt, admin, buyer } = await fixture()
      await p2p.connect(buyer).createBuyOrder(E18(1000), E18(8), DAY)

      await expect(
        p2p.connect(admin).sweepStray(await p2p.usdt(), admin.address, E18(1)),
      ).to.be.revertedWith('P2P: no stray USDT')

      // A genuine stray on top may be taken -- but not one wei more.
      await usdt.mint(await p2p.getAddress(), E18(3))
      await expect(
        p2p.connect(admin).sweepStray(await p2p.usdt(), admin.address, E18(4)),
      ).to.be.revertedWith('P2P: would touch escrow')
      await p2p.connect(admin).sweepStray(await p2p.usdt(), admin.address, E18(3))
      expect(await usdt.balanceOf(await p2p.getAddress())).to.equal(E18(8))
    })

    it('lets a buyer cancel a bid while paused — a pause must not trap escrow', async () => {
      const { p2p, usdt, admin, buyer } = await fixture()
      const before = await usdt.balanceOf(buyer.address)
      await p2p.connect(buyer).createBuyOrder(E18(1000), E18(8), DAY)
      await p2p.connect(admin).setPaused(true)
      await p2p.connect(buyer).cancelBuyOrder(0)
      expect(await usdt.balanceOf(buyer.address)).to.equal(before)
    })
  })
})
