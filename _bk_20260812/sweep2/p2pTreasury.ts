/**
 * P2P Treasury — On-chain reader for the MFP-NFT escrow.
 *
 * Points at P2PEscrowNFT_MFP since 2026-08-12. The contract it used to read,
 * P2PEscrowMFP 0xcff2…4b8B, is dead: its $0.000001 price ceiling is a `constant`, so it
 * never took a single order and never will.
 *
 * Reads order state + emits log scan helpers for event sync.
 * Mirrors seedTreasury.ts pattern (state provider via env BSC_RPC_URL with batchMaxCount=1,
 * log provider forced to publicnode since data-seed RPC doesn't support eth_getLogs).
 */
import { Contract, JsonRpcProvider, formatUnits } from 'ethers'
import { getActiveAddresses, isMainnet, USDT_DECIMALS } from '@missionchain/sdk'

/**
 * The live `P2PEscrowNFT` surface, deployed 2026-08-12.
 *
 * Three things changed from the P2PEscrowMFP shape this used to describe, and each one
 * fails silently rather than loudly if it is not carried through:
 *
 *   - `OrderExecuted` gained an indexed `tokenId` in third place. Every later argument
 *     shifted by one, so a reader still using positional access records the price as the
 *     royalty and the royalty as the fee — wrong money, no error.
 *   - `OrderCancelled` lost `cancellationFeePaid`. There is no cancellation fee any more;
 *     withdrawing an offer nobody accepted is not a wrong.
 *   - `cancellationFeeUsdt()` is gone entirely.
 *
 * A changed event signature changes its topic0, so a stale ABI does not throw — the
 * indexer simply matches nothing and the order book stays empty forever.
 */
export const P2P_EVENT_ABI = [
  'function VERSION() view returns (string)',
  'function feeBps() view returns (uint16)',
  'function feeRecipient() view returns (address)',
  'function paused() view returns (bool)',
  'function nextOrderId() view returns (uint256)',
  'function nextBuyOrderId() view returns (uint256)',
  'function minPriceUsdt() view returns (uint256)',
  'function maxPriceUsdt() view returns (uint256)',
  'function royaltyAware() view returns (bool)',
  'function orders(uint256) view returns (uint256 id, address seller, uint256 tokenId, uint256 priceUsdt, uint64 createdAt, uint64 expiresAt, uint8 status, address buyer, uint64 closedAt)',
  'function buyOrders(uint256) view returns (uint256 id, address buyer, uint256 tokenId, bool anyToken, uint256 priceUsdt, uint64 createdAt, uint64 expiresAt, uint8 status, address seller, uint64 closedAt)',
  'function activeOrderForToken(uint256) view returns (uint256)',
  'function isExpired(uint256) view returns (bool)',
  'event OrderCreated(uint256 indexed id, address indexed seller, uint256 indexed tokenId, uint256 priceUsdt, uint64 expiresAt)',
  'event OrderExecuted(uint256 indexed id, address indexed buyer, uint256 indexed tokenId, uint256 priceUsdt, uint256 royaltyAmount, uint256 feeAmount, uint256 sellerNet)',
  'event OrderCancelled(uint256 indexed id, address indexed by)',
  'event OrderExpired(uint256 indexed id, address indexed by)',
  'event BuyOrderCreated(uint256 indexed id, address indexed buyer, uint256 tokenId, bool anyToken, uint256 priceUsdt, uint64 expiresAt)',
  'event BuyOrderFilled(uint256 indexed id, address indexed seller, uint256 indexed tokenId, uint256 priceUsdt, uint256 royaltyAmount, uint256 feeAmount, uint256 sellerNet)',
  'event BuyOrderCancelled(uint256 indexed id, address indexed by)',
  'event BuyOrderExpired(uint256 indexed id, address indexed by)',
]

const STATE_RPC_FALLBACK_TESTNET = [
  'https://bsc-dataseed.binance.org/',
  'https://bsc.publicnode.com',
]
const STATE_RPC_FALLBACK_MAINNET = [
  'https://bsc-dataseed.binance.org/',
  'https://bsc.publicnode.com',
]
function stateRpcFallback(): string[] {
  return isMainnet() ? STATE_RPC_FALLBACK_MAINNET : STATE_RPC_FALLBACK_TESTNET
}

/*
 * Log endpoints, archive-capable first.
 *
 * This list used to be publicnode and nothing else, on the reasoning that the Binance
 * data-seeds cannot serve eth_getLogs. Both halves were true and the conclusion was still
 * wrong: publicnode answers every getLogs on this contract with
 *
 *   -32602  "Archive requests require a personal token"
 *
 * so the P2P indexer logged "chunk getLogs failed, skipping chunk" for every chunk of
 * every poll and quietly indexed nothing. An empty order book looks exactly like a market
 * nobody is using, which is why it survived.
 *
 * INDEXER_RPC_URL (Alchemy) goes first because it is the only endpoint here that actually
 * serves archive log queries. The publicnode hosts stay as fallbacks — they do work for
 * recent ranges — and the data-seeds are deliberately absent.
 */
const LOG_RPC_FALLBACK = [
  'https://bsc.publicnode.com',
  'https://bsc-rpc.publicnode.com',
]
function logRpcEndpoints(): string[] {
  const primary = process.env.INDEXER_RPC_URL
  return primary ? [primary, ...LOG_RPC_FALLBACK] : LOG_RPC_FALLBACK
}

/**
 * State provider: reads contract storage (orders, config).
 * batchMaxCount: 1 disables JSON-RPC batching. Public BSC testnet RPCs
 * (data-seed + publicnode) reject the ENTIRE batch when any single call
 * hits rate-limit, which would otherwise crash endpoints.
 */
let stateProvider: JsonRpcProvider | null = null
async function getStateProvider(): Promise<JsonRpcProvider> {
  if (stateProvider) {
    try { await stateProvider.getBlockNumber(); return stateProvider } catch { stateProvider = null }
  }
  const fallback = stateRpcFallback()
  const primary = process.env.INDEXER_RPC_URL || process.env.BSC_RPC_URL || fallback[0]
  const endpoints = [primary, ...fallback.filter((u) => u !== primary)]
  for (const url of endpoints) {
    try {
      const p = new JsonRpcProvider(url, undefined, { batchMaxCount: 1 })
      await p.getBlockNumber()
      stateProvider = p
      return p
    } catch {
      // try next
    }
  }
  throw new Error(`No BSC ${isMainnet() ? 'mainnet' : 'testnet'} state RPC reachable`)
}

/**
 * Log provider: forced to publicnode-only since data-seed RPC returns
 * "could not coalesce error" for all eth_getLogs queries.
 */
let logProvider: JsonRpcProvider | null = null

/**
 * Probe with the call we actually need, not with `eth_blockNumber`.
 *
 * publicnode answers `eth_blockNumber` in milliseconds and then refuses `eth_getLogs`
 * with "Archive requests require a personal token". A health check on the cheap call
 * therefore selects an endpoint that cannot do the job, and the failure only shows up
 * once per chunk, per poll, in a warning nobody reads.
 */
async function canServeLogs(p: JsonRpcProvider): Promise<boolean> {
  try {
    const head = await p.getBlockNumber()
    // One-block window: cheap on a healthy node, and still an archive request to a node
    // that is going to refuse them.
    await p.getLogs({ address: getActiveAddresses().P2PEscrowNFT_MFP, fromBlock: head - 1, toBlock: head })
    return true
  } catch {
    return false
  }
}

export async function getLogProvider(): Promise<JsonRpcProvider> {
  if (logProvider && await canServeLogs(logProvider)) return logProvider
  logProvider = null

  const tried: string[] = []
  for (const url of logRpcEndpoints()) {
    const p = new JsonRpcProvider(url, undefined, { batchMaxCount: 1 })
    if (await canServeLogs(p)) {
      logProvider = p
      return p
    }
    tried.push(new URL(url).host)
  }
  // Name the hosts. "No RPC reachable" sent the last reader looking at the network when
  // the endpoints were up and simply declining the query.
  throw new Error(`No archive-capable BSC log RPC: tried ${tried.join(', ')}`)
}

export type P2POrderOnChain = {
  id: number
  seller: string
  tokenId: bigint
  priceUsdt: number
  createdAt: number
  expiresAt: number
  status: 'PENDING' | 'EXECUTED' | 'CANCELLED' | 'EXPIRED'
  buyer: string
  closedAt: number
}

const STATUS = ['PENDING', 'EXECUTED', 'CANCELLED', 'EXPIRED'] as const

function parseOrder(o: any): P2POrderOnChain | null {
  if (Number(o[0]) === 0) return null
  return {
    id:         Number(o[0]),
    seller:     (o[1] as string).toLowerCase(),
    tokenId:    o[2] as bigint,
    priceUsdt:  Number(formatUnits(o[3] as bigint, USDT_DECIMALS)),
    createdAt:  Number(o[4]),
    expiresAt:  Number(o[5]),
    status:     STATUS[Number(o[6])] ?? 'PENDING',
    buyer:      (o[7] as string).toLowerCase(),
    closedAt:   Number(o[8]),
  }
}

export async function readP2POrder(id: number): Promise<P2POrderOnChain | null> {
  const provider = await getStateProvider()
  const c = new Contract(getActiveAddresses().P2PEscrowNFT_MFP, P2P_EVENT_ABI, provider)
  const o = await c.orders(id)
  return parseOrder(o)
}

// Cache 30s in memory (per process)
let activeOrdersCache: { at: number; data: P2POrderOnChain[] } | null = null
const ACTIVE_ORDERS_CACHE_MS = 30_000

export async function readP2PActiveOrders(): Promise<P2POrderOnChain[]> {
  if (activeOrdersCache && Date.now() - activeOrdersCache.at < ACTIVE_ORDERS_CACHE_MS) {
    return activeOrdersCache.data
  }
  const provider = await getStateProvider()
  const c = new Contract(getActiveAddresses().P2PEscrowNFT_MFP, P2P_EVENT_ABI, provider)
  // `id = ++nextOrderId`, so ids run 1…nextOrderId INCLUSIVE and `nextOrderId` is the last
  // id issued, not the next one its name promises. The bound used to be `i < nextId`,
  // which silently dropped the most recent order — invisible until now only because the
  // dead contract never took one. (P2PEscrowMIC uses `nextOrderId++` and does start at 0;
  // the two contracts genuinely differ, so neither loop can be copied to the other.)
  const lastId = Number(await c.nextOrderId())
  const all: P2POrderOnChain[] = []
  for (let i = 1; i <= lastId; i++) {
    const order = parseOrder(await c.orders(i))
    if (order && order.status === 'PENDING') all.push(order)
  }
  activeOrdersCache = { at: Date.now(), data: all }
  return all
}

export async function readP2PActiveOrderForToken(tokenId: bigint): Promise<number> {
  const provider = await getStateProvider()
  const c = new Contract(getActiveAddresses().P2PEscrowNFT_MFP, P2P_EVENT_ABI, provider)
  return Number(await c.activeOrderForToken(tokenId))
}
