/**
 * NFT rewards — what the platform owes in Community NFTs, and what the two reward pools
 * owe in MIC.
 *
 * Both programmes already exist on chain and neither had a caller. `ClaimRewardsV2`
 * carries `mintMilestoneNFT` and `mintRankBonus`; `CommunityNFTRewardPool` and
 * `MFPRewardPool` carry `distribute`. Nothing in the codebase invoked any of them, so the
 * reward engine's arithmetic ran into a wall: it could work out who was owed what and
 * then had no way to pay it.
 *
 * This route closes that gap on the read side only. **It signs nothing.**
 *
 * Minting an NFT is irreversible and distributing a pool moves real MIC, and both are
 * gated on chain by roles held by wallets that should never be represented by a key
 * sitting in a server's environment — CREDITOR_ROLE for the mints, DISTRIBUTOR_ROLE for
 * the pools. So this computes the proposal and the admin signs it from their own wallet
 * in the browser, exactly as the Treasury page does for vault withdrawals. The API is
 * the arithmetic; the authority stays with the key holder.
 *
 * Every figure that could be disputed is read from chain rather than from our database:
 * how many NFTs a wallet has already been minted, what each pool holds, and what each
 * holder currently owns. The database is used only for the referral tree and the purchase
 * history, which are indexed from chain in the first place.
 */
import { FastifyPluginAsync } from 'fastify'
import { requireAdmin } from '../plugins/rbac.js'
import {
  qualifyingF1Counts,
  proposeMilestones,
  MILESTONES,
  QUALIFYING_PURCHASE_USDT,
  type SaleRow,
} from '../services/rewardEngine/milestones.js'
import { planNftPool, type HolderSnapshot } from '../services/rewardEngine/nftPools.js'
import { TIER, type CommunityTier } from '../services/rewardEngine/tiers.js'

const ZERO = '0x0000000000000000000000000000000000000000'

/** Community NFT gets 5 of the 6 points of emission these two pools share; MFP gets 1. */
const COMMUNITY_BPS = 8333

type Addrs = {
  claimRewards: string
  communityNft: string
  communityPool: string
  mfpPool: string
}

async function addresses(): Promise<Addrs | null> {
  const { getActiveAddresses } = await import('@missionchain/sdk')
  const A = getActiveAddresses() as Record<string, string>
  const claimRewards = A.ClaimRewardsV2
  const communityNft = A.CommunityNFTv2 || A.CommunityNFT
  const communityPool = A.CommunityNFTRewardPool
  const mfpPool = A.MFPRewardPool
  if (!claimRewards || claimRewards === ZERO) return null
  return { claimRewards, communityNft, communityPool, mfpPool }
}

async function provider() {
  const { JsonRpcProvider } = await import('ethers')
  // The milestone count comes from `eth_getLogs`, which the public BSC endpoints refuse.
  const rpc = process.env.INDEXER_RPC_URL || process.env.BSC_RPC_URL
  if (!rpc) return null
  return new JsonRpcProvider(rpc)
}

export const nftRewardsRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAdmin)

  // ─── GET /admin/nft-rewards/milestones ────────────────────────────────
  //
  // Who has earned a Community NFT by bringing in qualifying referrals, and how many are
  // still owed. Three tiers at 3 / 5 / 10 qualifying F1, repeating each time a circle of
  // ten closes.
  app.get('/milestones', async (req, reply) => {
    const A = await addresses()
    if (!A) return reply.status(503).send({ error: 'NOT_DEPLOYED', message: 'ClaimRewardsV2 is not configured' })

    const p = await provider()
    if (!p) return reply.status(503).send({ error: 'NO_RPC', message: 'No archive-capable RPC configured' })

    // ── the referral tree and the purchases, as indexed ──
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

    const sales: SaleRow[] = purchases.map((row) => ({
      buyer: row.wallet.toLowerCase(),
      type: row.type,
      usdtAmount: Number(row.usdtAmount),
    }))

    const counts = qualifyingF1Counts(referrerOf, sales)

    // ── what has already been minted, read from chain ──
    //
    // Deliberately not from our own tables. A double mint is unrecoverable, so the count
    // that decides whether to mint again has to come from the contract that did the
    // minting, not from a record we might have failed to write.
    const { ethers } = await import('ethers')
    const alreadyMinted = new Map<string, Map<number, number>>()

    try {
      const head = await p.getBlockNumber()
      const topic = ethers.id('MilestoneNFTMinted(address,uint256,uint256)')
      const logs = await p.getLogs({
        address: A.claimRewards, topics: [topic], fromBlock: 0, toBlock: head,
      })
      const tierToIndex = new Map<number, number>(MILESTONES.map((m) => [m.tier, m.index]))
      for (const log of logs) {
        const wallet = ethers.getAddress('0x' + log.topics[1].slice(26)).toLowerCase()
        const tier = Number(BigInt(log.topics[2] ?? '0x0'))
        const index = tierToIndex.get(tier)
        if (index === undefined) continue
        const per = alreadyMinted.get(wallet) ?? new Map<number, number>()
        per.set(index, (per.get(index) ?? 0) + 1)
        alreadyMinted.set(wallet, per)
      }
    } catch (e: any) {
      app.log.warn({ err: e?.message }, 'nft-rewards: could not read minted history')
      return reply.status(502).send({
        error: 'CHAIN_ERROR',
        message: 'Could not read the mint history from chain — refusing to propose mints without it',
      })
    }

    const proposals = proposeMilestones(counts, alreadyMinted)

    return {
      data: {
        contract: A.claimRewards,
        qualifyingPurchaseUsdt: QUALIFYING_PURCHASE_USDT,
        milestones: MILESTONES.map((m) => ({
          index: m.index, requiredF1: m.requiredF1, tier: m.tier, tierName: m.tierName,
        })),
        proposals: proposals.map((pr) => ({
          wallet: pr.wallet,
          qualifyingF1: pr.qualifyingF1,
          completedCircles: pr.completedCircles,
          pending: pr.pending.map((m) => ({
            milestoneIndex: m.index, tier: m.tier, tierName: m.tierName,
          })),
        })),
        totalPending: proposals.reduce((s, pr) => s + pr.pending.length, 0),
      },
    }
  })

  // ─── GET /admin/nft-rewards/pools ─────────────────────────────────────
  //
  // What the two emission-funded pools hold, and how it would be split across current NFT
  // holders. The split is pro-rata on tier weight, so it changes as NFTs are minted and
  // as they expire — which is why it is computed fresh rather than stored.
  app.get('/pools', async (req, reply) => {
    const A = await addresses()
    if (!A) return reply.status(503).send({ error: 'NOT_DEPLOYED', message: 'Reward pools are not configured' })
    if (!A.communityPool || A.communityPool === ZERO) {
      return reply.status(503).send({ error: 'NOT_DEPLOYED', message: 'CommunityNFTRewardPool is not deployed yet' })
    }

    const p = await provider()
    if (!p) return reply.status(503).send({ error: 'NO_RPC', message: 'No archive-capable RPC configured' })

    const { ethers } = await import('ethers')
    const poolAbi = ['function balance() view returns (uint256)', 'function totalDistributed() view returns (uint256)', 'function distributionCount() view returns (uint256)']

    const community = new ethers.Contract(A.communityPool, poolAbi, p)
    const mfp = new ethers.Contract(A.mfpPool, poolAbi, p)

    const [cBal, mBal, cTotal, mTotal, cCount, mCount] = await Promise.all([
      community.balance(), mfp.balance(),
      community.totalDistributed(), mfp.totalDistributed(),
      community.distributionCount(), mfp.distributionCount(),
    ])

    // ── who currently holds what ──
    //
    // Read from the NFT contract per wallet rather than from a holder table: a Community
    // NFT expires on its own schedule, so a stored list goes stale without anything
    // writing to it.
    const holders: HolderSnapshot[] = []
    let holderError: string | null = null

    if (A.communityNft && A.communityNft !== ZERO) {
      try {
        const head = await p.getBlockNumber()
        const minted = ethers.id('CommunityNFTMinted(address,uint256,uint256,uint256)')
        const logs = await p.getLogs({ address: A.communityNft, topics: [minted], fromBlock: 0, toBlock: head })
        const wallets = new Set<string>()
        for (const log of logs) wallets.add(ethers.getAddress('0x' + log.topics[1].slice(26)))

        const nft = new ethers.Contract(
          A.communityNft,
          ['function activeCountOf(address,uint256) view returns (uint256)'],
          p,
        )
        for (const w of wallets) {
          const activeByTier: Partial<Record<CommunityTier, number>> = {}
          for (const tier of [TIER.BUILDER, TIER.MAKER, TIER.LUMINARY] as CommunityTier[]) {
            const n = Number(await nft.activeCountOf(w, tier))
            if (n > 0) activeByTier[tier] = n
          }
          if (Object.keys(activeByTier).length > 0) holders.push({ wallet: w, activeByTier })
        }
      } catch (e: any) {
        holderError = e?.shortMessage || e?.message || 'could not read NFT holders'
        app.log.warn({ err: holderError }, 'nft-rewards: holder read failed')
      }
    }

    // ── MFP holders, from the mint records we already keep ──
    const mfpMints = await app.prisma.mfpMintRecord.groupBy({
      by: ['wallet'],
      _count: { wallet: true },
    }).catch(() => [] as Array<{ wallet: string; _count: { wallet: number } }>)

    for (const row of mfpMints) {
      const w = ethers.getAddress(row.wallet)
      const existing = holders.find((h) => h.wallet.toLowerCase() === w.toLowerCase())
      if (existing) existing.mfpCount = row._count.wallet
      else holders.push({ wallet: w, activeByTier: {}, mfpCount: row._count.wallet })
    }

    const total = (cBal as bigint) + (mBal as bigint)
    const plan = holders.length > 0 && total > 0n
      ? planNftPool(total, COMMUNITY_BPS, holders)
      : null

    return {
      data: {
        pools: {
          community: {
            address: A.communityPool,
            balance: ethers.formatUnits(cBal, 18),
            totalDistributed: ethers.formatUnits(cTotal, 18),
            distributionCount: Number(cCount),
          },
          mfp: {
            address: A.mfpPool,
            balance: ethers.formatUnits(mBal, 18),
            totalDistributed: ethers.formatUnits(mTotal, 18),
            distributionCount: Number(mCount),
          },
        },
        holderCount: holders.length,
        holderError,
        plan: plan && {
          communityPool: ethers.formatUnits(plan.communityPool, 18),
          mfpPool: ethers.formatUnits(plan.mfpPool, 18),
          creditedTotal: ethers.formatUnits(plan.creditedTotal, 18),
          community: plan.community.map((a) => ({
            wallet: a.wallet, amountWei: a.amount.toString(), amount: ethers.formatUnits(a.amount, 18),
          })),
          mfp: plan.mfp.map((a) => ({
            wallet: a.wallet, amountWei: a.amount.toString(), amount: ethers.formatUnits(a.amount, 18),
          })),
        },
        // Stated rather than left implicit: an empty plan when the pools hold MIC means
        // nobody currently qualifies, not that the endpoint failed.
        note: holders.length === 0
          ? 'No wallet holds an active Community NFT or an MFP pass yet, so there is nobody to distribute to.'
          : null,
      },
    }
  })
}

export default nftRewardsRoutes
