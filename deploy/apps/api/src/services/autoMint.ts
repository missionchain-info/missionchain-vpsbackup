/**
 * Automatic Community NFT minting — paths 2 and 3.
 *
 * Path 1 (a Pre-Sale package) mints inside `PreSale.buy()` and has always worked. Path 4
 * (an Owner grant) is a deliberate act. These two are the ones that are supposed to
 * happen on their own when a member earns them, and until now nothing called them:
 * `mintMilestoneNFT` and `mintRankBonus` existed, held the right role, and were reachable
 * only from a button somebody had to press.
 *
 *   Path 2 — referral milestones: 3 / 5 / 10 qualifying F1 → Builder / Maker / Luminary,
 *            repeating each time a circle of ten closes.
 *   Path 3 — Community Growth Award rank: Builder → 3×Builder, Connector → 3×Maker,
 *            Champion → 3×Luminary, Ambassador → 5×Luminary, Legend → 10×Luminary.
 *
 * ## Never twice
 *
 * Minting is irreversible, so what has already been issued is read from the contract's
 * own events rather than from our database. A row we failed to write would otherwise
 * become a second NFT, and nobody would notice until the supply was wrong.
 *
 * Rank is identified by the (tier, quantity) pair, not by tier alone — Champion,
 * Ambassador and Legend all award Luminary, and only the quantity tells them apart.
 */
import { Contract, Wallet, id, getAddress } from 'ethers'
import type { FastifyInstance } from 'fastify'
import { getActiveAddresses } from '@missionchain/sdk'
import {
  qualifyingF1Counts,
  proposeMilestones,
  MILESTONES,
  type SaleRow,
} from './rewardEngine/milestones.js'
import { gvRankFor } from './rewardEngine/tiers.js'

const ZERO = '0x0000000000000000000000000000000000000000'

const CLAIM_ABI = [
  'function mintMilestoneNFT(address user, uint256 milestoneIndex)',
  'function mintRankBonus(address user, uint256 tier, uint256 quantity)',
  'function CREDITOR_ROLE() view returns (bytes32)',
  'function hasRole(bytes32,address) view returns (bool)',
] as const

/** White Paper §B.5.1. The (tier, quantity) pair is what makes each rank distinguishable. */
const RANK_BONUS: Record<string, { tier: number; quantity: number }> = {
  Builder:     { tier: 1, quantity: 3 },
  Connector:   { tier: 2, quantity: 3 },
  Champion:    { tier: 3, quantity: 3 },
  Ambassador:  { tier: 3, quantity: 5 },
  Legend:      { tier: 3, quantity: 10 },
}

/** Minted per wallet, read from the contract that did the minting. */
async function readAlreadyMinted(signer: Wallet, claimAddr: string) {
  const provider = signer.provider!
  const head = await provider.getBlockNumber()

  const milestoneTopic = id('MilestoneNFTMinted(address,uint256,uint256)')
  const rankTopic = id('RankBonusNFTMinted(address,uint256,uint256,uint256)')

  const [mLogs, rLogs] = await Promise.all([
    provider.getLogs({ address: claimAddr, topics: [milestoneTopic], fromBlock: 0, toBlock: head }),
    provider.getLogs({ address: claimAddr, topics: [rankTopic], fromBlock: 0, toBlock: head }),
  ])

  const tierToIndex = new Map<number, number>(MILESTONES.map((m) => [m.tier as number, m.index]))
  const milestones = new Map<string, Map<number, number>>()
  for (const log of mLogs) {
    const wallet = getAddress('0x' + log.topics[1].slice(26)).toLowerCase()
    const tier = Number(BigInt(log.topics[2] ?? '0x0'))
    const index = tierToIndex.get(tier)
    if (index === undefined) continue
    const per = milestones.get(wallet) ?? new Map<number, number>()
    per.set(index, (per.get(index) ?? 0) + 1)
    milestones.set(wallet, per)
  }

  // `tier:quantity` — the only thing that distinguishes Champion from Ambassador.
  const ranks = new Set<string>()
  for (const log of rLogs) {
    const wallet = getAddress('0x' + log.topics[1].slice(26)).toLowerCase()
    const tier = Number(BigInt(log.topics[2] ?? '0x0'))
    const quantity = Number(BigInt('0x' + log.data.slice(2, 66) || '0x0'))
    ranks.add(`${wallet}:${tier}:${quantity}`)
  }

  return { milestones, ranks }
}

export async function mintDueCommunityNfts(app: FastifyInstance, signer: Wallet): Promise<void> {
  const A = getActiveAddresses() as Record<string, string>
  const claimAddr = A.ClaimRewardsV2
  if (!claimAddr || claimAddr === ZERO) return

  const claim = new Contract(claimAddr, CLAIM_ABI, signer)

  // Without the role every call reverts. Say so once, clearly, rather than logging a
  // failed transaction every hour.
  const me = await signer.getAddress()
  if (!(await claim.hasRole(await claim.CREDITOR_ROLE(), me))) {
    app.log.warn(
      { keeper: me, contract: claimAddr },
      'autoMint: keeper lacks CREDITOR_ROLE — no Community NFT can be issued automatically',
    )
    return
  }

  const [users, purchases] = await Promise.all([
    app.prisma.user.findMany({ select: { wallet: true, referrer: true } }),
    app.prisma.purchase.findMany({
      where: { status: 'CONFIRMED', type: { in: ['PRESALE', 'MICE'] } },
      select: { wallet: true, type: true, usdtAmount: true },
    }),
  ])

  const referrerOf = new Map<string, string>()
  for (const u of users) {
    if (u.referrer) referrerOf.set(u.wallet.toLowerCase(), u.referrer.toLowerCase())
  }
  const sales: SaleRow[] = purchases.map((r) => ({
    buyer: r.wallet.toLowerCase(),
    type: r.type,
    usdtAmount: Number(r.usdtAmount),
  }))

  let minted: { milestones: Map<string, Map<number, number>>; ranks: Set<string> }
  try {
    minted = await readAlreadyMinted(signer, claimAddr)
  } catch (e: any) {
    // Without the history there is no safe way to know what has been issued. Stopping
    // costs a cycle; guessing costs a duplicate that cannot be undone.
    app.log.error(
      { err: e?.shortMessage || e?.message },
      'autoMint: could not read mint history — skipping rather than risking a double mint',
    )
    return
  }

  // ── Path 2: referral milestones ──────────────────────────────────────
  const counts = qualifyingF1Counts(referrerOf, sales)
  for (const proposal of proposeMilestones(counts, minted.milestones)) {
    for (const m of proposal.pending) {
      try {
        const tx = await claim.mintMilestoneNFT(proposal.wallet, m.index)
        await tx.wait()
        app.log.info(
          { wallet: proposal.wallet, tier: m.tierName, tx: tx.hash },
          'autoMint: milestone NFT issued',
        )
      } catch (e: any) {
        app.log.error(
          { wallet: proposal.wallet, tier: m.tierName, err: e?.shortMessage || e?.message },
          'autoMint: milestone mint failed',
        )
      }
    }
  }

  // ── Path 3: Community Growth Award rank ──────────────────────────────
  //
  // Group volume is the sum a wallet's whole downline has bought. A rank bonus is issued
  // once, the first time that rank is reached — a later fall in volume does not take it
  // back, which is why the check is against what has been minted, not against rank alone.
  const gvByWallet = new Map<string, number>()
  for (const sale of sales) {
    let node: string | undefined = referrerOf.get(sale.buyer)
    const seen = new Set<string>()
    while (node && !seen.has(node)) {
      seen.add(node)
      gvByWallet.set(node, (gvByWallet.get(node) ?? 0) + sale.usdtAmount)
      node = referrerOf.get(node)
    }
  }

  for (const [wallet, gv] of gvByWallet) {
    const rank = gvRankFor(gv)?.name
    const bonus = rank ? RANK_BONUS[rank] : undefined
    if (!bonus) continue

    const key = `${wallet}:${bonus.tier}:${bonus.quantity}`
    if (minted.ranks.has(key)) continue

    try {
      const tx = await claim.mintRankBonus(wallet, bonus.tier, bonus.quantity)
      await tx.wait()
      minted.ranks.add(key)
      app.log.info(
        { wallet, rank, tier: bonus.tier, quantity: bonus.quantity, tx: tx.hash },
        'autoMint: rank bonus issued',
      )
    } catch (e: any) {
      app.log.error(
        { wallet, rank, err: e?.shortMessage || e?.message },
        'autoMint: rank bonus failed',
      )
    }
  }
}
