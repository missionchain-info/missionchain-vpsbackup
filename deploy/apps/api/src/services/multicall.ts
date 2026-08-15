/**
 * One HTTP request for many contract reads.
 *
 * The BSC dataseeds refuse JSON-RPC batching, so ethers is configured with
 * `batchMaxCount: 1` (see `blockchain.ts`) and every `eth_call` becomes its own round
 * trip. Reads that fan out then cost N trips: the council panel needed twenty-six, about
 * two seconds, before anything rendered.
 *
 * Multicall3 solves it at the other end. It is deployed at the same address on every
 * chain — verified present on BSC — and `aggregate3` performs the calls inside a single
 * `eth_call`, so the endpoint sees one request no matter how many reads are inside.
 *
 * `allowFailure` is set per call: a member row that reverts should not lose the other
 * four, so failures come back as `null` rather than throwing.
 */
import { Contract, Interface } from 'ethers'
import type { Provider } from 'ethers'

/** Same address on every chain Multicall3 is deployed to. */
export const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11'

const MULTICALL3_ABI = [
  'function aggregate3(tuple(address target, bool allowFailure, bytes callData)[] calls) view returns (tuple(bool success, bytes returnData)[])',
]

export type Call = {
  target: string
  iface: Interface
  fn: string
  args?: readonly unknown[]
}

/**
 * Runs every call in one request. Returns decoded results positionally; an entry is
 * `null` when that individual call reverted.
 */
export async function multicall(provider: Provider, calls: Call[]): Promise<(any[] | null)[]> {
  if (calls.length === 0) return []

  const mc = new Contract(MULTICALL3, MULTICALL3_ABI, provider)
  const encoded = calls.map((c) => ({
    target: c.target,
    allowFailure: true,
    callData: c.iface.encodeFunctionData(c.fn, c.args ?? []),
  }))

  const results: Array<{ success: boolean; returnData: string }> = await mc.aggregate3(encoded)

  return results.map((r, i) => {
    if (!r.success) return null
    try {
      return calls[i].iface.decodeFunctionResult(calls[i].fn, r.returnData) as unknown as any[]
    } catch {
      return null
    }
  })
}

/** Convenience for the common case of one call whose first return value is wanted. */
export function first<T>(decoded: any[] | null, fallback: T): T {
  return decoded && decoded.length ? (decoded[0] as T) : fallback
}
