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

    it('rejects a listing below $1 — the old contract allowed a millionth of a cent', async () => {
      const { p2p, seller } = await fixture()
      await expect(
        p2p.connect(seller).createOrder(E18(1000), ethers.parseUnits('0.99', 18), DAY),
      ).to.be.revertedWith('P2P: price out of range')
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

      const [pays, receives] = await p2p.quote(0)
      expect(pays).to.equal(E18(100))
      expect(receives).to.equal(E18(98.5)) // 1.5%

      await p2p.connect(buyer).matchOrder(0, E18(100))

      expect(await usdt.balanceOf(seller.address)).to.equal(E18(98.5))
      expect(await usdt.balanceOf(treasury.address)).to.equal(E18(1.5))
      expect(await mic.balanceOf(buyer.address)).to.equal(E18(1000))
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
})
