/**
 * Reward Engine — Community Growth Award (GV).
 *
 * Pure calculation. No database, no chain, no clock: feed it a tree, get a payout
 * plan back. That makes the money maths unit-testable and reproducible, which is the
 * whole point — a wrong number here pays the wrong person real USDT.
 *
 * Formula — White Paper §B.5.2 (differential override):
 *
 *   award(L) = rate(L) × personalVolume(L)
 *            + Σ over direct sub-groups c of  max(0, rate(L) − rate(c)) × groupVolume(c)
 *
 * where groupVolume(x) = personalVolume(x) + Σ groupVolume(children of x),
 * and rate(x) is the GV rank rate for groupVolume(x).
 *
 * Only the growth *gap* is paid out, so volume is never rewarded twice down a leg.
 */

import { gvRankFor, type GvRank } from './tiers'

/**
 * Which purchases count toward Group Volume.
 *
 * PRE-SALE and MICE only — White Paper §B.5.1. SEED is deliberately excluded:
 * the SEED round has no referral programme at all.
 *
 * ⚠️ MICE is priced 50% MIC (burned) + 50% USDT. Only the **USDT half** counts.
 * When the MICE indexer is written it must store that half in `Purchase.usdtAmount`,
 * exactly as `PreSaleEventSync` already does for PreSale — otherwise GV silently
 * doubles for every MICE buyer.
 */
export const GV_ELIGIBLE_PURCHASE_TYPES = ['PRESALE', 'MICE'] as const
export type GvEligibleType = (typeof GV_ELIGIBLE_PURCHASE_TYPES)[number]

export function countsTowardGv(purchaseType: string): boolean {
  return (GV_ELIGIBLE_PURCHASE_TYPES as readonly string[]).includes(purchaseType)
}

/** One member of the referral tree, with the volume they personally bought. */
export interface GvNode {
  wallet: string
  /** USDT this wallet personally purchased in the period's cumulative window. */
  personalVolume: number
  /** Wallets directly referred by this one. */
  children: GvNode[]
}

export interface GvAward {
  wallet: string
  groupVolume: number
  rank: GvRank
  /** Award from the wallet's own purchases. */
  fromPersonal: number
  /** Award from the differential against direct sub-groups. */
  fromSubGroups: number
  /** fromPersonal + fromSubGroups. */
  total: number
}

interface Resolved {
  node: GvNode
  groupVolume: number
  rank: GvRank
}

/** Depth-first roll-up of group volume, so each node knows its own rank. */
function resolve(node: GvNode, out: Map<string, Resolved>): number {
  let group = node.personalVolume
  for (const child of node.children) group += resolve(child, out)
  out.set(node.wallet, { node, groupVolume: group, rank: gvRankFor(group) })
  return group
}

/**
 * Compute the Community Growth Award for every wallet in the tree.
 *
 * @param roots Top-level wallets (those with no referrer).
 * @returns One entry per wallet, including zero awards — callers filter.
 */
export function calculateGvAwards(roots: GvNode[]): GvAward[] {
  const resolved = new Map<string, Resolved>()
  for (const r of roots) resolve(r, resolved)

  const awards: GvAward[] = []
  for (const { node, groupVolume, rank } of resolved.values()) {
    const fromPersonal = (node.personalVolume * rank.rate) / 100

    let fromSubGroups = 0
    for (const child of node.children) {
      const c = resolved.get(child.wallet)
      if (!c) continue
      const gap = rank.rate - c.rank.rate
      if (gap > 0) fromSubGroups += (c.groupVolume * gap) / 100
    }

    awards.push({
      wallet: node.wallet,
      groupVolume,
      rank,
      fromPersonal,
      fromSubGroups,
      total: fromPersonal + fromSubGroups,
    })
  }
  return awards
}

/**
 * Build the tree from flat rows. Rows referencing a missing/unknown referrer are
 * treated as roots rather than dropped — losing a buyer's volume would silently
 * understate their upline's award.
 */
export function buildGvTree(
  rows: { wallet: string; referrer: string | null; personalVolume: number }[],
): GvNode[] {
  const byWallet = new Map<string, GvNode>()
  for (const r of rows) {
    byWallet.set(r.wallet, { wallet: r.wallet, personalVolume: r.personalVolume, children: [] })
  }

  const roots: GvNode[] = []
  for (const r of rows) {
    const node = byWallet.get(r.wallet)!
    const parent = r.referrer ? byWallet.get(r.referrer) : undefined
    if (parent && parent !== node) parent.children.push(node)
    else roots.push(node)
  }

  // A cycle (A→B→A) would make resolve() recurse forever. Keep only nodes reachable
  // from a root; anything left over is re-rooted so its volume is still counted once.
  const seen = new Set<string>()
  const walk = (n: GvNode): boolean => {
    if (seen.has(n.wallet)) return false
    seen.add(n.wallet)
    n.children = n.children.filter(walk)
    return true
  }
  roots.forEach(walk)
  for (const [wallet, node] of byWallet) {
    if (!seen.has(wallet)) {
      seen.add(wallet)
      node.children = node.children.filter(walk)
      roots.push(node)
    }
  }
  return roots
}
