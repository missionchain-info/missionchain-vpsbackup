/**
 * SEED Treasury On-Chain Reader
 *
 * Reads live state from SeedBudgetV5c (centralized vault) + V3 policy pools
 * (Operational / MgmtBonus / Reserved). Used by /governance/* and admin
 * /admin/seed-budget/* endpoints.
 *
 * Phase 2c-pivot (May 2, 2026): replaces the DB-only Phase 2a flow.
 * V5c/V3 cutover (Jun 23, 2026): replaces V5b/V2 trio + V6.
 */
import { Contract, JsonRpcProvider, formatUnits } from 'ethers'
import { getActiveAddresses, isMainnet } from '@missionchain/sdk'

const TESTNET_RPC_FALLBACK = [
  'https://bsc-dataseed.binance.org/',
  'https://bsc-dataseed1.binance.org/',
  'https://bsc.publicnode.com',
  'https://bsc.publicnode.com',
]
const MAINNET_RPC_FALLBACK = [
  'https://bsc-dataseed.binance.org/',
  'https://bsc-dataseed1.binance.org/',
  'https://bsc-dataseed2.binance.org/',
  'https://bsc.publicnode.com',
]
function getRpcFallback(): string[] {
  return isMainnet() ? MAINNET_RPC_FALLBACK : TESTNET_RPC_FALLBACK
}

const SB_V5C_ABI = [
  'function slotBalance(uint8) view returns (uint256)',
  'function slotTotalReceived(uint8) view returns (uint256)',
  'function slotTotalReleased(uint8) view returns (uint256)',
  'function feeBps() view returns (uint16)',
  'function feeReceiver() view returns (address)',
  'function totalUsdtBalance() view returns (uint256)',
]

const OSP_V2_ABI = [
  'function claimable(address) view returns (uint256)',
  'function members(address) view returns (uint16 sharePctBps, uint128 weeklyMaxoutUsdt, uint128 totalClaimed, bool enrolled)',
  'function allocatedInWeek(address, uint256) view returns (uint128)',
  'function totalShareBps() view returns (uint16)',
  'function memberCount() view returns (uint256)',
  'function memberAt(uint256) view returns (address)',
  'function currentWeekIdx() view returns (uint256)',
]

// ManagementBonusPoolV3 — policy contract for SLOT_MGMT_BONUS (10%)
const MBP_V2_ABI = [
  'function nextOrderId() view returns (uint256)',
  'function thresholdBps() view returns (uint16)',
  'function owner() view returns (address)',
  'function orders(uint256) view returns (uint256 id, address recipient, uint256 amount, string content, address requester, uint64 createdAt, uint8 status, uint64 executedAt)',
  'function approvalsCount(uint256) view returns (uint256)',
  'function approvalRatioBps(uint256) view returns (uint256)',
  'function isApproved(uint256, address) view returns (bool)',
  'event OrderCreated(uint256 indexed id, address indexed requester, address indexed recipient, uint256 amount, string content)',
  'event OrderApproved(uint256 indexed id, address indexed voter, uint256 approvals, uint256 active)',
  'event OrderExecuted(uint256 indexed id, address indexed recipient, uint256 amount)',
  'event OrderCancelled(uint256 indexed id, address indexed by)',
]

const STEWARD_COUNCIL_ABI = [
  'function activeCount() view returns (uint256)',
]

export const SLOT = {
  DISTRIBUTION: 0,
  OPERATIONAL:  1,
  MGMT_BONUS:   2,
  RESERVED:     3,
} as const

export type SlotIdx = 0 | 1 | 2 | 3

/**
 * Try each RPC endpoint until one succeeds. Returns provider for direct use.
 * (Single-provider strategy — picks first that responds.)
 *
 * batchMaxCount: 1 disables JSON-RPC batching. Public BSC testnet RPCs
 * (data-seed + publicnode) reject the ENTIRE batch when any single call
 * hits rate-limit, which would otherwise crash /governance/proposals.
 */
let cachedProvider: JsonRpcProvider | null = null
async function getProvider(): Promise<JsonRpcProvider> {
  if (cachedProvider) {
    try {
      await cachedProvider.getBlockNumber()
      return cachedProvider
    } catch {
      cachedProvider = null
    }
  }
  const fallback = getRpcFallback()
  const primary = process.env.BSC_RPC_URL || fallback[0]
  const endpoints = [primary, ...fallback.filter((u) => u !== primary)]
  for (const url of endpoints) {
    try {
      const p = new JsonRpcProvider(url, undefined, { batchMaxCount: 1 })
      await p.getBlockNumber()
      cachedProvider = p
      return p
    } catch {
      // try next
    }
  }
  throw new Error('No BSC testnet RPC endpoint reachable')
}

export async function readSeedBudgetSlot(slot: SlotIdx) {
  const sbAddr = getActiveAddresses().SeedBudgetV5c
  const provider = await getProvider()
  const sb = new Contract(sbAddr, SB_V5C_ABI, provider)
  const [balance, totalReceived, totalReleased] = await Promise.all([
    sb.slotBalance(slot) as Promise<bigint>,
    sb.slotTotalReceived(slot) as Promise<bigint>,
    sb.slotTotalReleased(slot) as Promise<bigint>,
  ])
  return {
    balance:        Number(formatUnits(balance, 6)),
    totalReceived:  Number(formatUnits(totalReceived, 6)),
    totalReleased:  Number(formatUnits(totalReleased, 6)),
  }
}

export async function readSeedBudgetAllSlots() {
  const sbAddr = getActiveAddresses().SeedBudgetV5c
  const provider = await getProvider()
  const sb = new Contract(sbAddr, SB_V5C_ABI, provider)

  const calls = [0, 1, 2, 3].flatMap((s) => [
    sb.slotBalance(s),
    sb.slotTotalReceived(s),
    sb.slotTotalReleased(s),
  ])
  const results = await Promise.all(calls) as bigint[]

  const slot = (i: number) => ({
    balance:       Number(formatUnits(results[i * 3] ?? 0n, 6)),
    totalReceived: Number(formatUnits(results[i * 3 + 1] ?? 0n, 6)),
    totalReleased: Number(formatUnits(results[i * 3 + 2] ?? 0n, 6)),
  })

  return {
    distribution: slot(0),
    operational:  slot(1),
    mgmtBonus:    slot(2),
    reserved:     slot(3),
  }
}

export type OspMemberOnChain = {
  wallet: string
  enrolled: boolean
  sharePctBps: number
  weeklyMaxoutUsdt: number
  totalClaimed: number
  claimable: number
  allocatedThisWeek: number
}

export async function readOperationalPoolMember(wallet: string): Promise<OspMemberOnChain | null> {
  const ospAddr = getActiveAddresses().OperationalSalaryPoolV3
  const provider = await getProvider()
  const osp = new Contract(ospAddr, OSP_V2_ABI, provider)

  const w = wallet.toLowerCase()
  const [m, claimable, weekIdx] = await Promise.all([
    osp.members(w) as Promise<[bigint, bigint, bigint, boolean]>,
    osp.claimable(w) as Promise<bigint>,
    osp.currentWeekIdx() as Promise<bigint>,
  ])
  const sharePctBps = Number(m[0])
  const weeklyMaxoutUsdt = Number(formatUnits(m[1], 6))
  const totalClaimed = Number(formatUnits(m[2], 6))
  const enrolled = m[3]
  if (!enrolled) return null

  const allocatedThisWeek = Number(formatUnits(
    await osp.allocatedInWeek(w, weekIdx) as bigint,
    6,
  ))

  return {
    wallet: w,
    enrolled,
    sharePctBps,
    weeklyMaxoutUsdt,
    totalClaimed,
    claimable: Number(formatUnits(claimable, 6)),
    allocatedThisWeek,
  }
}

export async function readOperationalPoolAllMembers(): Promise<OspMemberOnChain[]> {
  const ospAddr = getActiveAddresses().OperationalSalaryPoolV3
  const provider = await getProvider()
  const osp = new Contract(ospAddr, OSP_V2_ABI, provider)
  const count = Number(await osp.memberCount() as bigint)
  if (count === 0) return []
  const wallets = await Promise.all(
    Array.from({ length: count }, (_, i) => osp.memberAt(i) as Promise<string>),
  )
  const results = await Promise.all(wallets.map((w) => readOperationalPoolMember(w)))
  return results.filter((m): m is OspMemberOnChain => m !== null)
}

export async function readOperationalPoolTotalShareBps(): Promise<number> {
  const ospAddr = getActiveAddresses().OperationalSalaryPoolV3
  const provider = await getProvider()
  const osp = new Contract(ospAddr, OSP_V2_ABI, provider)
  return Number(await osp.totalShareBps() as bigint)
}

export async function readSeedBudgetFee() {
  const sbAddr = getActiveAddresses().SeedBudgetV5c
  const provider = await getProvider()
  const sb = new Contract(sbAddr, SB_V5C_ABI, provider)
  const [bps, receiver] = await Promise.all([
    sb.feeBps() as Promise<bigint>,
    sb.feeReceiver() as Promise<string>,
  ])
  return { feeBps: Number(bps), feeReceiver: receiver as string }
}

export async function readCurrentWeekIdx(): Promise<number> {
  const ospAddr = getActiveAddresses().OperationalSalaryPoolV3
  const provider = await getProvider()
  const osp = new Contract(ospAddr, OSP_V2_ABI, provider)
  return Number(await osp.currentWeekIdx() as bigint)
}

// ─── ManagementBonusPoolV3 readers ────────────────────────────────────────

export type MgmtBonusOrderOnChain = {
  id: number
  recipient: string
  amount: number          // USDT (6-dec formatted)
  content: string
  requester: string
  createdAt: number       // unix seconds
  status: 'PENDING' | 'EXECUTED' | 'CANCELLED'
  executedAt: number      // unix seconds (0 if not executed)
  approvalsCount: number
  approvalRatioBps: number  // 0..10000
}

export type MgmtBonusState = {
  orders: MgmtBonusOrderOnChain[]
  thresholdBps: number
  activeCouncilCount: number
  slotBalance: number     // USDT in slot[2]
  // Note: ownerWallet field removed after Chunk 3 refactor (MBPv2 → AccessControl).
  // Ownership identification now via isOwnerWallet() helper at consumer layer.
}

const STATUS_LABELS = ['PENDING', 'EXECUTED', 'CANCELLED'] as const

export async function readMgmtBonusState(): Promise<MgmtBonusState> {
  const mbpAddr = getActiveAddresses().ManagementBonusPoolV3
  const scAddr  = getActiveAddresses().StewardCouncil
  const sbAddr  = getActiveAddresses().SeedBudgetV5c
  const provider = await getProvider()
  const mbp = new Contract(mbpAddr, MBP_V2_ABI, provider)
  const sc  = new Contract(scAddr,  STEWARD_COUNCIL_ABI, provider)
  const sb  = new Contract(sbAddr,  SB_V5C_ABI, provider)

  const [nextId, thresholdBps, activeCount, slotBalanceWei] = await Promise.all([
    mbp.nextOrderId() as Promise<bigint>,
    mbp.thresholdBps() as Promise<bigint>,
    sc.activeCount() as Promise<bigint>,
    sb.slotBalance(SLOT.MGMT_BONUS) as Promise<bigint>,
  ])

  const totalOrders = Number(nextId)
  const baseState: Omit<MgmtBonusState, 'orders'> = {
    thresholdBps:       Number(thresholdBps),
    activeCouncilCount: Number(activeCount),
    slotBalance:        Number(formatUnits(slotBalanceWei, 6)),
  }
  if (totalOrders === 0) {
    return { ...baseState, orders: [] }
  }

  // Fetch all orders in parallel (id 1..totalOrders)
  const ids = Array.from({ length: totalOrders }, (_, i) => i + 1)
  const all = await Promise.all(ids.map((id) => Promise.all([
    mbp.orders(id) as Promise<any>,
    mbp.approvalsCount(id) as Promise<bigint>,
    mbp.approvalRatioBps(id) as Promise<bigint>,
  ])))

  const orders: MgmtBonusOrderOnChain[] = all.map(([o, approvals, ratioBps]) => ({
    id:               Number(o[0]),
    recipient:        (o[1] as string).toLowerCase(),
    amount:           Number(formatUnits(o[2] as bigint, 6)),
    content:          o[3] as string,
    requester:        (o[4] as string).toLowerCase(),
    createdAt:        Number(o[5]),
    status:           STATUS_LABELS[Number(o[6])] ?? 'PENDING',
    executedAt:       Number(o[7]),
    approvalsCount:   Number(approvals),
    approvalRatioBps: Number(ratioBps),
  })).filter((o) => o.id !== 0)

  // Newest first
  orders.sort((a, b) => b.id - a.id)
  return { ...baseState, orders }
}

/// Check if a specific wallet has approved a specific order. Used to mark
/// `myVote` on the proposals list.
export async function readMgmtBonusVoteStatus(orderId: number, voter: string): Promise<boolean> {
  const mbpAddr = getActiveAddresses().ManagementBonusPoolV3
  const provider = await getProvider()
  const mbp = new Contract(mbpAddr, MBP_V2_ABI, provider)
  return mbp.isApproved(orderId, voter.toLowerCase()) as Promise<boolean>
}

/// Look up which council members voted on an order. One isApproved() call per
/// council member — for ~5-10 members this is ≤10 RPC reads, acceptable.
export async function readMgmtBonusVoters(orderId: number, councilWallets: string[]): Promise<string[]> {
  const mbpAddr = getActiveAddresses().ManagementBonusPoolV3
  const provider = await getProvider()
  const mbp = new Contract(mbpAddr, MBP_V2_ABI, provider)
  const checks = await Promise.all(
    councilWallets.map(async (w) => ({
      wallet: w.toLowerCase(),
      voted: await mbp.isApproved(orderId, w.toLowerCase()) as boolean,
    })),
  )
  return checks.filter((c) => c.voted).map((c) => c.wallet)
}

/// Scan ManagementBonusPoolV3 event logs for tx hashes. Returns maps for:
///   - createdTx[orderId]      → tx of OrderCreated
///   - executedTx[orderId]     → tx of OrderExecuted
///   - cancelledTx[orderId]    → tx of OrderCancelled
///   - voteTxBy["${id}-${voter}"] → tx of OrderApproved
///
/// BSC public RPC limits getLogs to ~5000 blocks per call, so we chunk.
/// MBP_V2 deployed May 2 ~14:00 UTC (block ~105,030,000); 60k-block scan
/// covers >2 days of history at 3s/block.
export type MgmtBonusEvents = {
  createdTx: Map<number, string>
  executedTx: Map<number, string>
  cancelledTx: Map<number, string>
  voteTxBy: Map<string, string>
}

// MBP deployed May 2 ~14:00 UTC. 50K blocks ≈ 1.5d at 3s/block — covers
// creation + recent activity. Sequential scan + 2K chunks to stay under
// publicnode rate limits.
const MBP_SCAN_BLOCKS = 50_000
const MBP_CHUNK = 2_000

// Public BSC testnet RPCs that ACTUALLY support eth_getLogs. data-seed
// (the default BSC_RPC_URL) returns "could not coalesce error" for all log
// queries, so we MUST use publicnode for event scanning regardless of env.
const LOG_RPC_ENDPOINTS = [
  'https://bsc.publicnode.com',
  'https://bsc.publicnode.com',
]

let logProvider: JsonRpcProvider | null = null
async function getLogProvider(): Promise<JsonRpcProvider> {
  if (logProvider) {
    try { await logProvider.getBlockNumber(); return logProvider } catch { logProvider = null }
  }
  for (const url of LOG_RPC_ENDPOINTS) {
    try {
      const p = new JsonRpcProvider(url, undefined, { batchMaxCount: 1 })
      await p.getBlockNumber()
      logProvider = p
      return p
    } catch { /* next */ }
  }
  throw new Error('No log-capable BSC testnet RPC reachable')
}

// In-memory cache to avoid re-scanning on every /proposals request.
// Each scan takes ~5-15s sequential; cache for 60s is enough.
let mbpEventsCache: { at: number; data: MgmtBonusEvents } | null = null
const MBP_CACHE_TTL_MS = 60_000

export async function readMgmtBonusEvents(): Promise<MgmtBonusEvents> {
  if (mbpEventsCache && Date.now() - mbpEventsCache.at < MBP_CACHE_TTL_MS) {
    return mbpEventsCache.data
  }

  const mbpAddr = getActiveAddresses().ManagementBonusPoolV3
  const provider = await getLogProvider()
  const mbp = new Contract(mbpAddr, MBP_V2_ABI, provider)
  const iface = mbp.interface

  const currentBlock = await provider.getBlockNumber()
  const fromBlock = Math.max(0, currentBlock - MBP_SCAN_BLOCKS)

  const result: MgmtBonusEvents = {
    createdTx:   new Map(),
    executedTx:  new Map(),
    cancelledTx: new Map(),
    voteTxBy:    new Map(),
  }

  // Sequential scan to avoid rate-limit on public RPC
  for (let f = fromBlock; f <= currentBlock; f += MBP_CHUNK + 1) {
    const t = Math.min(f + MBP_CHUNK, currentBlock)
    let logs: any[]
    try {
      logs = await provider.getLogs({ address: mbpAddr, fromBlock: f, toBlock: t })
    } catch {
      // Skip chunks that error (pruned history, transient RPC fail)
      continue
    }
    for (const log of logs) {
      let parsed
      try {
        parsed = iface.parseLog({ topics: [...log.topics], data: log.data })
      } catch {
        continue
      }
      if (!parsed) continue
      const id = Number(parsed.args[0])
      const tx = log.transactionHash
      if (parsed.name === 'OrderCreated') {
        result.createdTx.set(id, tx)
      } else if (parsed.name === 'OrderExecuted') {
        result.executedTx.set(id, tx)
      } else if (parsed.name === 'OrderCancelled') {
        result.cancelledTx.set(id, tx)
      } else if (parsed.name === 'OrderApproved') {
        const voter = (parsed.args[1] as string).toLowerCase()
        result.voteTxBy.set(`${id}-${voter}`, tx)
      }
    }
  }

  mbpEventsCache = { at: Date.now(), data: result }
  return result
}
