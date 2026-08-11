/**
 * Reward Engine — Weekly / Monthly NFT reward pools.
 *
 * Pure calculation, integer-exact, held as bigint and never as floats:
 * `NFTRewardPool.creditCommunity()` takes exact uint256 values and reverts if the
 * credited total exceeds the pool balance.
 *
 * ⚠️ UNITS. Every function here is unit-agnostic — it only ever splits a total in
 * proportion to weights, so the output is in whatever unit the input was. That makes it
 * the caller's job to be right, and on BSC there is exactly one right answer:
 * **BSC-USD is 18 decimals**, not the 6 of Ethereum's USDT.
 *
 * Read the pool balance from chain and pass those wei straight through to
 * `creditCommunity`. Do not convert. This header used to say "USDT base units (6
 * decimals)", which is wrong and is the same mistake that priced a 181,500,000 MIC
 * allocation at nothing in SeedSaleV7 — and it survived because tests that mint and
 * assert in the same wrong unit pass against any unit at all.
 *
 * Split, mirroring NFTRewardPool.receiveUSDT():
 *   community = amount × communityBps / 10000
 *   mfp       = amount − community          (remainder absorbs the rounding dust)
 *
 * Within each side the pool is shared pro-rata by weight. Leftover base units from
 * integer division are handed out by largest remainder, so the credited total equals
 * the pool exactly — no dust stranded, no over-credit revert.
 *
 * One deliberate exception: if a side has no eligible holders (e.g. nobody owns an MFP
 * yet), that slice is NOT credited to anyone. It stays in the contract and rolls into
 * the next period. Forcing it onto the other side would silently change the published
 * 5% / 0.5% split.
 */

import { DEFAULT_TIER_WEIGHT_BPS, MFP_WEIGHT_BPS, TIER, type CommunityTier } from './tiers'

const BPS_TOTAL = 10_000n

/**
 * One Community NFT as indexed from chain.
 *
 * Times are unix seconds, matching CommunityNFTv2's `mintTime` / `expiryTime`.
 */
export interface NftRecord {
  tokenId: number
  owner: string
  tier: CommunityTier
  mintTime: number
  expiryTime: number
}

/**
 * ⚠️ THE WEEKLY AND MONTHLY POOLS HAVE DIFFERENT ELIGIBILITY. White Paper §E.6.1 / §E.6.2:
 *
 *   Weekly  (5%)   — only NFTs **issued within that week**. Rewards NEW activity.
 *   Monthly (7.5%) — **ALL active** NFTs regardless of issue date. Rewards LOYALTY.
 *
 * Getting this wrong is silent and expensive: feeding the weekly pool every active NFT
 * would pay long-standing holders from a pool meant for the week's new participants.
 * Always build the snapshot with one of the two functions below rather than by hand.
 */

/** Weekly pool: NFTs minted inside [weekStartSec, weekEndSec) and still active at close. */
export function snapshotForWeekly(
  nfts: NftRecord[],
  weekStartSec: number,
  weekEndSec: number,
  mfpCountByWallet: Map<string, number> = new Map(),
): HolderSnapshot[] {
  return groupByOwner(
    nfts.filter(
      (n) => n.mintTime >= weekStartSec && n.mintTime < weekEndSec && n.expiryTime > weekEndSec,
    ),
    mfpCountByWallet,
  )
}

/** Monthly pool: every NFT still active at the snapshot instant, whenever it was issued. */
export function snapshotForMonthly(
  nfts: NftRecord[],
  atSec: number,
  mfpCountByWallet: Map<string, number> = new Map(),
): HolderSnapshot[] {
  return groupByOwner(
    nfts.filter((n) => n.expiryTime > atSec && n.mintTime <= atSec),
    mfpCountByWallet,
  )
}

function groupByOwner(nfts: NftRecord[], mfp: Map<string, number>): HolderSnapshot[] {
  const byOwner = new Map<string, HolderSnapshot>()
  for (const n of nfts) {
    let snap = byOwner.get(n.owner)
    if (!snap) {
      snap = { wallet: n.owner, activeByTier: {}, mfpCount: mfp.get(n.owner) ?? 0 }
      byOwner.set(n.owner, snap)
    }
    snap.activeByTier[n.tier] = (snap.activeByTier[n.tier] ?? 0) + 1
  }
  // MFP holders with no Community NFT still qualify for the MFP slice.
  for (const [wallet, count] of mfp) {
    if (count > 0 && !byOwner.has(wallet)) {
      byOwner.set(wallet, { wallet, activeByTier: {}, mfpCount: count })
    }
  }
  return [...byOwner.values()].sort((a, b) => (a.wallet < b.wallet ? -1 : 1))
}

/** A holder snapshot taken at period close. Counts must be ACTIVE (unexpired) only. */
export interface HolderSnapshot {
  wallet: string
  /** Active Community NFTs per tier — from CommunityNFTv2.activeCountOf(). */
  activeByTier: Partial<Record<CommunityTier, number>>
  /** MFP passes held. MFP never expires. */
  mfpCount?: number
}

export interface Allocation {
  wallet: string
  weight: bigint
  amount: bigint
}

export interface PoolPlan {
  communityPool: bigint
  mfpPool: bigint
  community: Allocation[]
  mfp: Allocation[]
  /** Sum of every credited amount — must equal the pool total. */
  creditedTotal: bigint
}

/** Weight of a holder's active Community NFTs, in basis points. */
export function communityWeightBps(
  snap: HolderSnapshot,
  tierWeightBps: Record<CommunityTier, number> = DEFAULT_TIER_WEIGHT_BPS,
): bigint {
  let w = 0n
  for (const tier of [TIER.BUILDER, TIER.MAKER, TIER.LUMINARY]) {
    const n = snap.activeByTier[tier] ?? 0
    if (n > 0) w += BigInt(n) * BigInt(tierWeightBps[tier])
  }
  return w
}

/**
 * Share `pool` across weighted entries. Exact: Σ amounts === pool (when pool > 0 and
 * total weight > 0). Remainders go to the largest fractional parts first, ties broken
 * by wallet so the result is deterministic and reproducible from the same snapshot.
 */
export function distributeProRata(
  pool: bigint,
  entries: { wallet: string; weight: bigint }[],
): Allocation[] {
  const eligible = entries.filter((e) => e.weight > 0n)
  const totalWeight = eligible.reduce((s, e) => s + e.weight, 0n)
  if (pool <= 0n || totalWeight === 0n) {
    return eligible.map((e) => ({ wallet: e.wallet, weight: e.weight, amount: 0n }))
  }

  const out = eligible.map((e) => {
    const exact = pool * e.weight
    return {
      wallet: e.wallet,
      weight: e.weight,
      amount: exact / totalWeight,
      remainder: exact % totalWeight,
    }
  })

  let leftover = pool - out.reduce((s, a) => s + a.amount, 0n)
  if (leftover > 0n) {
    const order = [...out].sort((a, b) =>
      a.remainder === b.remainder ? (a.wallet < b.wallet ? -1 : 1) : a.remainder > b.remainder ? -1 : 1,
    )
    for (const row of order) {
      if (leftover === 0n) break
      row.amount += 1n
      leftover -= 1n
    }
  }
  return out.map(({ wallet, weight, amount }) => ({ wallet, weight, amount }))
}

/**
 * Build the full credit plan for one Weekly or Monthly pool.
 *
 * @param poolAmount Total USDT (6-dec base units) received by the NFTRewardPool.
 * @param communityBps `communityBps` read from the pool contract (Weekly 9091 / Monthly 9375).
 * @param holders Snapshot of ACTIVE holders at period close.
 */
export function planNftPool(
  poolAmount: bigint,
  communityBps: number,
  holders: HolderSnapshot[],
  tierWeightBps: Record<CommunityTier, number> = DEFAULT_TIER_WEIGHT_BPS,
): PoolPlan {
  if (poolAmount < 0n) throw new Error('planNftPool: negative pool')
  if (communityBps < 0 || communityBps > 10_000) throw new Error('planNftPool: communityBps out of range')

  const communityPool = (poolAmount * BigInt(communityBps)) / BPS_TOTAL
  const mfpPool = poolAmount - communityPool

  const community = distributeProRata(
    communityPool,
    holders.map((h) => ({ wallet: h.wallet, weight: communityWeightBps(h, tierWeightBps) })),
  )
  const mfp = distributeProRata(
    mfpPool,
    holders.map((h) => ({
      wallet: h.wallet,
      weight: BigInt(h.mfpCount ?? 0) * BigInt(MFP_WEIGHT_BPS),
    })),
  )

  const creditedTotal =
    community.reduce((s, a) => s + a.amount, 0n) + mfp.reduce((s, a) => s + a.amount, 0n)

  return { communityPool, mfpPool, community, mfp, creditedTotal }
}
