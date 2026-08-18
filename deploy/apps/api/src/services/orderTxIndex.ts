/**
 * Creation transaction hashes for P2P MIC orders.
 *
 * The order book is read straight from the contract, which is what keeps it honest — but
 * a contract read cannot tell you which transaction created an order. That is only in the
 * `OrderCreated` / `BuyOrderCreated` logs.
 *
 * ## Why this is chunked, and cached
 *
 * The public endpoints answer `eth_getLogs` over a narrow window and refuse a wide one —
 * "could not coalesce error" at 440,000 blocks, fine at 4,000, filtered or not. So the
 * range from the escrow's deploy block to the head has to be walked in pieces.
 *
 * That walk happens once. A cursor remembers where it got to, results are kept in memory,
 * and each request does a bounded amount of work so no page load waits on a backfill.
 * A hash that has not been found yet is simply absent — the UI links the contract instead
 * of showing a blank, and fills in on a later load.
 *
 * Deliberately not the archive endpoint: this is recent history in small windows, exactly
 * what the free public nodes will serve, and the paid archive key is the scarce thing.
 */
import { JsonRpcProvider, id } from 'ethers'
import { deployBlockOf } from '@missionchain/sdk'

const CHUNK = 4_000
/** Chunks per request. ~110 covers the whole range, so a cold cache fills in a few loads. */
const CHUNK_BUDGET = 25

const LOG_RPCS = [
  'https://bsc-rpc.publicnode.com',
  'https://bsc.publicnode.com',
]

const SELL_TOPIC = id('OrderCreated(uint256,address,uint256,uint256,uint64)')
const BID_TOPIC = id('BuyOrderCreated(uint256,address,uint256,uint256,uint64)')

type Cache = {
  /** `sell:12` / `bid:3` → transaction hash */
  hashes: Map<string, string>
  /** Last block walked. Starts at the escrow's deploy block. */
  cursor: number
  scanning: boolean
  /** Consecutive failures on the CURRENT window. */
  misses: number
}

const cache: Cache = { hashes: new Map(), cursor: 0, scanning: false, misses: 0 }

/** Attempts on one window before it is written off and the cursor moves past it. */
const MAX_WINDOW_RETRIES = 3

async function logsProvider(): Promise<JsonRpcProvider | null> {
  for (const url of LOG_RPCS) {
    try {
      const p = new JsonRpcProvider(url, 56, { staticNetwork: true })
      await p.getBlockNumber()
      return p
    } catch { /* next */ }
  }
  return null
}

/**
 * Walk a bounded slice of the range, recording what it finds.
 *
 * Never throws: a missing hash degrades the display, it does not break the order book,
 * so a failure here must not fail the request that called it.
 */
export async function advanceOrderTxIndex(escrow: string): Promise<void> {
  if (cache.scanning) return
  cache.scanning = true
  try {
    const provider = await logsProvider()
    if (!provider) return

    if (cache.cursor === 0) {
      cache.cursor = deployBlockOf('P2PEscrowMIC') || 0
      if (cache.cursor === 0) return
    }

    const head = await provider.getBlockNumber()
    let done = 0

    while (cache.cursor <= head && done < CHUNK_BUDGET) {
      const to = Math.min(cache.cursor + CHUNK - 1, head)
      try {
        const logs = await provider.getLogs({
          address: escrow,
          topics: [[SELL_TOPIC, BID_TOPIC]],
          fromBlock: cache.cursor,
          toBlock: to,
        })
        for (const log of logs) {
          // topic1 is the indexed order id; the two books number independently, so the
          // event that produced it is part of the key.
          const kind = log.topics[0] === SELL_TOPIC ? 'sell' : 'bid'
          const orderId = BigInt(log.topics[1] ?? '0x0').toString()
          cache.hashes.set(`${kind}:${orderId}`, log.transactionHash)
        }
        cache.misses = 0
        cache.cursor = to + 1
      } catch {
        // Do NOT advance past a window that failed.
        //
        // The first version did, on the reasoning that one bad window must not stall the
        // backfill. The effect was worse: a public endpoint rate-limiting for a moment
        // silently skipped those blocks forever, and three of four orders ended up with no
        // transaction hash that no later pass would ever find. A window is retried a few
        // times and only then written off, so a transient refusal costs a retry rather
        // than a permanent hole.
        cache.misses++
        if (cache.misses >= MAX_WINDOW_RETRIES) {
          cache.misses = 0
          cache.cursor = to + 1
        } else {
          break
        }
      }
      done++
    }
  } finally {
    cache.scanning = false
  }
}

/** Hash for one order, or undefined while the backfill has not reached it. */
export function orderTxHash(kind: 'sell' | 'bid', id: number | string): string | undefined {
  return cache.hashes.get(`${kind}:${id}`)
}

/** How far the backfill has got — surfaced so the UI can say "still indexing" honestly. */
export function orderTxIndexState() {
  return { cursor: cache.cursor, known: cache.hashes.size }
}
