/**
 * P2P Treasury — On-chain reader for P2PEscrowMFP contract.
 *
 * Reads order state + emits log scan helpers for event sync.
 * Mirrors seedTreasury.ts pattern (state provider via env BSC_RPC_URL with batchMaxCount=1,
 * log provider forced to publicnode since data-seed RPC doesn't support eth_getLogs).
 */
import { Contract, JsonRpcProvider, formatUnits } from 'ethers'
import { getActiveAddresses, isMainnet } from '@missionchain/sdk'

export const P2P_EVENT_ABI = [
  'function VERSION() view returns (string)',
  'function feeBps() view returns (uint16)',
  'function feeRecipient() view returns (address)',
  'function cancellationFeeUsdt() view returns (uint256)',
  'function paused() view returns (bool)',
  'function nextOrderId() view returns (uint256)',
  'function orders(uint256) view returns (uint256 id, address seller, uint256 tokenId, uint256 priceUsdt, uint64 createdAt, uint64 expiresAt, uint8 status, address buyer, uint64 closedAt)',
  'function activeOrderForToken(uint256) view returns (uint256)',
  'function isExpired(uint256) view returns (bool)',
  'event OrderCreated(uint256 indexed id, address indexed seller, uint256 indexed tokenId, uint256 priceUsdt, uint64 expiresAt)',
  'event OrderExecuted(uint256 indexed id, address indexed buyer, uint256 priceUsdt, uint256 royaltyAmount, uint256 feeAmount, uint256 sellerNet)',
  'event OrderCancelled(uint256 indexed id, address indexed by, uint256 cancellationFeePaid)',
  'event OrderExpired(uint256 indexed id, address indexed by)',
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

const LOG_RPC_TESTNET = [
  'https://bsc.publicnode.com',
  'https://bsc.publicnode.com',
]
const LOG_RPC_MAINNET = [
  'https://bsc.publicnode.com',
  'https://bsc-rpc.publicnode.com',
]
function logRpcEndpoints(): string[] {
  return isMainnet() ? LOG_RPC_MAINNET : LOG_RPC_TESTNET
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
  const primary = process.env.BSC_RPC_URL || fallback[0]
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
export async function getLogProvider(): Promise<JsonRpcProvider> {
  if (logProvider) {
    try { await logProvider.getBlockNumber(); return logProvider } catch { logProvider = null }
  }
  for (const url of logRpcEndpoints()) {
    try {
      const p = new JsonRpcProvider(url, undefined, { batchMaxCount: 1 })
      await p.getBlockNumber()
      logProvider = p
      return p
    } catch { /* next */ }
  }
  throw new Error('No log-capable BSC testnet RPC reachable')
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
    priceUsdt:  Number(formatUnits(o[3] as bigint, 6)),
    createdAt:  Number(o[4]),
    expiresAt:  Number(o[5]),
    status:     STATUS[Number(o[6])] ?? 'PENDING',
    buyer:      (o[7] as string).toLowerCase(),
    closedAt:   Number(o[8]),
  }
}

export async function readP2POrder(id: number): Promise<P2POrderOnChain | null> {
  const provider = await getStateProvider()
  const c = new Contract(getActiveAddresses().P2PEscrowMFP, P2P_EVENT_ABI, provider)
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
  const c = new Contract(getActiveAddresses().P2PEscrowMFP, P2P_EVENT_ABI, provider)
  const nextId = Number(await c.nextOrderId())
  const all: P2POrderOnChain[] = []
  for (let i = 1; i < nextId; i++) {
    const order = parseOrder(await c.orders(i))
    if (order && order.status === 'PENDING') all.push(order)
  }
  activeOrdersCache = { at: Date.now(), data: all }
  return all
}

export async function readP2PActiveOrderForToken(tokenId: bigint): Promise<number> {
  const provider = await getStateProvider()
  const c = new Contract(getActiveAddresses().P2PEscrowMFP, P2P_EVENT_ABI, provider)
  return Number(await c.activeOrderForToken(tokenId))
}
