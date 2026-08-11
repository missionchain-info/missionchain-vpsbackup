/**
 * MIC/USDT peer-to-peer marketplace — read side.
 *
 * Everything here is read straight from P2PEscrowMIC. There is no database table and no
 * indexer, deliberately: an order book that disagrees with the contract is worse than no
 * order book, and this one cannot drift. `nextOrderId` bounds the work exactly, so the cost
 * is knowable rather than open-ended.
 *
 * Writes are not proxied. Creating, filling and cancelling an order all move the user's own
 * money, so they are signed by the user's wallet in the browser and never by a server key.
 */
import { FastifyPluginAsync } from 'fastify'
import { Contract, JsonRpcProvider, formatUnits } from 'ethers'
import { getActiveAddresses } from '@missionchain/sdk'

const ZERO = '0x0000000000000000000000000000000000000000'

const ABI = [
  'function nextOrderId() view returns (uint256)',
  'function feeBps() view returns (uint16)',
  'function paused() view returns (bool)',
  'function totalEscrowedMic() view returns (uint256)',
  'function minPriceUsdt() view returns (uint256)',
  'function maxPriceUsdt() view returns (uint256)',
  'function minAmountMic() view returns (uint256)',
  'function maxAmountMic() view returns (uint256)',
  'function MIN_EXPIRY_SECONDS() view returns (uint256)',
  'function MAX_EXPIRY_SECONDS() view returns (uint256)',
  'function getOrder(uint256) view returns (tuple(uint256 id, address seller, uint256 amountMic, uint256 priceUsdt, uint64 createdAt, uint64 expiresAt, uint8 status, address buyer, uint64 closedAt))',
]

const STATUS = ['PENDING', 'EXECUTED', 'CANCELLED', 'EXPIRED'] as const

/** Reading every order at once is fine at this size; the cap keeps a busy book from stalling a page. */
const MAX_ORDERS_READ = 500

type OrderOut = {
  id: number
  seller: string
  amountMic: string
  priceUsdt: string
  /** USD per MIC, for display only — the contract prices the whole lot, never per unit. */
  pricePerMic: string
  createdAt: number
  expiresAt: number
  status: string
  buyer: string | null
  /** PENDING but past its expiry: nobody can fill it, and anyone can return it to the seller. */
  expiredButOpen: boolean
}

const p2pMicRoutes: FastifyPluginAsync = async (app) => {
  const rpc = () =>
    process.env.INDEXER_RPC_URL || process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org/'

  function contract() {
    const addr = (getActiveAddresses() as Record<string, string>).P2PEscrowMIC
    if (!addr || addr === ZERO) return null
    return new Contract(addr, ABI, new JsonRpcProvider(rpc()))
  }

  /** Fee, bounds and the address the browser must sign against. */
  app.get('/config', async (_req, reply) => {
    const c = contract()
    if (!c) return reply.status(503).send({ error: 'NOT_DEPLOYED', message: 'MIC P2P is not deployed on this network.' })

    const [feeBps, paused, minP, maxP, minA, maxA, minE, maxE, escrowed] = await Promise.all([
      c.feeBps(), c.paused(),
      c.minPriceUsdt(), c.maxPriceUsdt(),
      c.minAmountMic(), c.maxAmountMic(),
      c.MIN_EXPIRY_SECONDS(), c.MAX_EXPIRY_SECONDS(),
      c.totalEscrowedMic(),
    ])

    return {
      data: {
        address: await c.getAddress(),
        feeBps: Number(feeBps),
        feePct: Number(feeBps) / 100,
        paused,
        minPriceUsdt: formatUnits(minP, 18),
        maxPriceUsdt: formatUnits(maxP, 18),
        minAmountMic: formatUnits(minA, 18),
        maxAmountMic: formatUnits(maxA, 18),
        minExpirySeconds: Number(minE),
        maxExpirySeconds: Number(maxE),
        totalEscrowedMic: formatUnits(escrowed, 18),
      },
    }
  })

  /**
   * The order book.
   *
   * `?status=open` (default) returns only what a buyer can actually fill right now — still
   * PENDING and not yet past its expiry. An expired order is listed under `status=all` so a
   * seller can find it and take the MIC back, but never offered as if it were tradeable.
   */
  app.get<{ Querystring: { status?: string; seller?: string } }>('/orders', async (req, reply) => {
    const c = contract()
    if (!c) return reply.status(503).send({ error: 'NOT_DEPLOYED', message: 'MIC P2P is not deployed on this network.' })

    const want = (req.query.status || 'open').toLowerCase()
    const seller = req.query.seller?.toLowerCase()

    const total = Number(await c.nextOrderId())
    const from = Math.max(0, total - MAX_ORDERS_READ)
    const now = Math.floor(Date.now() / 1000)

    const raw = await Promise.all(
      Array.from({ length: total - from }, (_, i) => c.getOrder(from + i)),
    )

    let out: OrderOut[] = raw.map((o: any) => {
      const amount = o.amountMic as bigint
      const price = o.priceUsdt as bigint
      const status = STATUS[Number(o.status)] ?? 'UNKNOWN'
      return {
        id: Number(o.id),
        seller: String(o.seller),
        amountMic: formatUnits(amount, 18),
        priceUsdt: formatUnits(price, 18),
        // Guard the divide: a zero-amount order cannot exist on chain, but a display layer
        // should not be the thing that discovers otherwise.
        pricePerMic: amount > 0n ? formatUnits((price * 10n ** 18n) / amount, 18) : '0',
        createdAt: Number(o.createdAt),
        expiresAt: Number(o.expiresAt),
        status,
        buyer: o.buyer === ZERO ? null : String(o.buyer),
        expiredButOpen: status === 'PENDING' && Number(o.expiresAt) <= now,
      }
    })

    if (seller) out = out.filter((o) => o.seller.toLowerCase() === seller)
    if (want === 'open') out = out.filter((o) => o.status === 'PENDING' && !o.expiredButOpen)
    else if (want !== 'all') out = out.filter((o) => o.status === want.toUpperCase())

    // Cheapest per MIC first — what a buyer is looking for.
    out.sort((a, b) => Number(a.pricePerMic) - Number(b.pricePerMic))

    return {
      data: out,
      meta: {
        totalEverCreated: total,
        returned: out.length,
        truncated: total - from < total,
      },
    }
  })
}

export default p2pMicRoutes
