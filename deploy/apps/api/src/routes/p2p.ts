/**
 * P2P Marketplace API — read + preview endpoints (Task 10).
 *
 * Phase 1: MFP-NFT only. All reads require JWT (per spec rev2 §5.1).
 * Record endpoints removed — eventSync is single writer for DB rows (Chunk 2 review).
 */
import { FastifyPluginAsync } from 'fastify'
import {
  readP2POrder,
  readP2PActiveOrders,
  readP2PActiveOrderForToken,
} from '../services/p2pTreasury.js'

export const p2pRoutes: FastifyPluginAsync = async (app) => {
  // GET /p2p/orders — list active orders (DB, not on-chain — O(1) query)
  app.get('/orders', { preHandler: [app.authenticate] }, async (req, reply) => {
    const orders = await app.prisma.p2POrder.findMany({
      where: { status: 'PENDING', expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })
    return reply.send({
      data: orders.map(o => ({
        ...o,
        onChainId: o.onChainId.toString(),
        tokenId: o.tokenId.toString(),
        priceUsdt: o.priceUsdt.toString(),
        royaltyAmount: o.royaltyAmount?.toString() ?? null,
        feeAmount: o.feeAmount?.toString() ?? null,
        sellerNet: o.sellerNet?.toString() ?? null,
      })),
    })
  })

  // GET /p2p/orders/:id — single order (on-chain for freshness guarantee)
  app.get('/orders/:id', { preHandler: [app.authenticate] }, async (req, reply) => {
    const id = parseInt((req.params as any).id, 10)
    if (isNaN(id) || id < 1) return reply.status(400).send({ error: 'BAD_REQUEST', message: 'Invalid order id' })
    try {
      const order = await readP2POrder(id)
      if (!order) return reply.status(404).send({ error: 'NOT_FOUND', message: 'Order does not exist' })
      return reply.send({ data: { ...order, tokenId: order.tokenId.toString() } })
    } catch (e: any) {
      app.log.error({ err: e?.message, id }, '/p2p/orders/:id read failed')
      return reply.status(502).send({ error: 'CHAIN_ERROR', message: 'Failed to read order' })
    }
  })

  // GET /p2p/my-orders
  app.get('/my-orders', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { wallet } = req.user as { wallet: string }
    const myOrders = await app.prisma.p2POrder.findMany({
      where: { seller: wallet.toLowerCase() },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })
    return reply.send({
      data: myOrders.map(o => ({
        ...o,
        onChainId: o.onChainId.toString(),
        tokenId: o.tokenId.toString(),
        priceUsdt: o.priceUsdt.toString(),
        royaltyAmount: o.royaltyAmount?.toString() ?? null,
        feeAmount: o.feeAmount?.toString() ?? null,
        sellerNet: o.sellerNet?.toString() ?? null,
      })),
    })
  })

  // GET /p2p/history (caller's purchases)
  app.get('/history', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { wallet } = req.user as { wallet: string }
    const purchases = await app.prisma.p2POrder.findMany({
      where: { buyer: wallet.toLowerCase(), status: 'EXECUTED' },
      orderBy: { closedAt: 'desc' },
      take: 100,
    })
    return reply.send({
      data: purchases.map(p => ({
        ...p,
        onChainId: p.onChainId.toString(),
        tokenId: p.tokenId.toString(),
        priceUsdt: p.priceUsdt.toString(),
        royaltyAmount: p.royaltyAmount?.toString() ?? null,
        feeAmount: p.feeAmount?.toString() ?? null,
        sellerNet: p.sellerNet?.toString() ?? null,
      })),
    })
  })

  // ─── KYC gate helper ─────────────────────────────────────────────
  // Testnet: bypass by default (P2P_REQUIRE_KYC unset/false).
  // Mainnet: anh set P2P_REQUIRE_KYC=true in .env to enforce strict gate.
  async function requireKyc(req: any, reply: any) {
    if (process.env.P2P_REQUIRE_KYC !== 'true') return // bypass on testnet
    const { wallet } = req.user as { wallet: string }
    const user = await app.prisma.user.findUnique({
      where: { wallet: wallet.toLowerCase() },
      select: { kycStatus: true },
    })
    if (!user || user.kycStatus !== 'fully_verified') {
      return reply.status(403).send({
        error: 'KYC_REQUIRED',
        message: 'KYC approval required for P2P trading',
      })
    }
  }

  // POST /p2p/orders/preview — pre-flight validation before user signs createOrder
  app.post('/orders/preview', { preHandler: [app.authenticate, requireKyc] }, async (req, reply) => {
    const body = req.body as { tokenId?: string; priceUsdt?: number; expirySeconds?: number }
    const errors: string[] = []
    if (!body.tokenId) errors.push('tokenId required')
    const priceUsdt = Number(body.priceUsdt || 0)
    if (priceUsdt < 100) errors.push('priceUsdt must be >= $100')
    if (priceUsdt > 1_000_000) errors.push('priceUsdt must be <= $1,000,000')
    const expiry = Number(body.expirySeconds || 0)
    if (expiry < 86400) errors.push('expirySeconds must be >= 1 day (86400)')
    if (expiry > 15 * 86400) errors.push('expirySeconds must be <= 15 days (1296000)')
    return reply.send({ data: { valid: errors.length === 0, errors } })
  })

  // POST /p2p/orders/:id/match-preview — buyer pre-flight (KYC + on-chain freshness check)
  app.post('/orders/:id/match-preview', { preHandler: [app.authenticate, requireKyc] }, async (req, reply) => {
    const { wallet } = req.user as { wallet: string }
    const id = parseInt((req.params as any).id, 10)
    if (isNaN(id) || id < 1) return reply.status(400).send({ error: 'BAD_REQUEST' })
    const order = await readP2POrder(id)
    if (!order) return reply.status(404).send({ error: 'NOT_FOUND' })
    const errors: string[] = []
    if (order.status !== 'PENDING') errors.push(`order is ${order.status}`)
    if (order.seller === wallet.toLowerCase()) errors.push('cannot buy own listing')
    // Freshness check: verify this order is still active for its token
    const activeId = await readP2PActiveOrderForToken(order.tokenId)
    if (activeId !== id) errors.push('order no longer active for this token')
    return reply.send({
      data: {
        valid: errors.length === 0,
        errors,
        requiredApproval: order.priceUsdt,  // buyer must approve EXACTLY priceUsdt to P2P contract
        order: { ...order, tokenId: order.tokenId.toString() },
      },
    })
  })
}
