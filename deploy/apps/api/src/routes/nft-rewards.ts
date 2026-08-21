/**
 * NFT rewards — what the platform owes in Community NFTs, and what the two reward pools
 * owe in MIC.
 *
 * Both programmes already exist on chain and neither had a caller. `ClaimRewardsV2`
 * carries `mintMilestoneNFT` and `mintRankBonus`. Nothing in the codebase invoked them, so
 * the reward engine's arithmetic ran into a wall: it could work out who was owed what and
 * then had no way to pay it.
 *
 * The two reward pools are a different shape and no longer need a caller at all. Since
 * 2026-08-10 they are `NftRewardPoolV2`, which streams MIC into an accumulator that each
 * holder pulls from with `claim()`. There is no `distribute` to invoke; the pool section
 * below reports state and signs nothing.
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
import { deployBlockOf } from '@missionchain/sdk'
import { TIER, type CommunityTier } from '../services/rewardEngine/tiers.js'
import { buildArchiveProvider, archiveEndpoints } from '../services/blockchain.js'

const ZERO = '0x0000000000000000000000000000000000000000'

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
  // The milestone count comes from `eth_getLogs`, which the public BSC endpoints refuse —
  // so this needs the ARCHIVE provider, not the read one. buildProvider() puts the public
  // dataseeds first by design, which is right for state reads and useless here.
  if (archiveEndpoints().length === 0) return null
  return buildArchiveProvider()
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
      // `toBlock: 'latest'` rather than a block number fetched a moment earlier.
      //
      // The provider is load balanced across several nodes, so `eth_blockNumber` and the
      // `eth_getLogs` that followed it were answered by different machines. When the log
      // node was one block behind, it rejected its own sibling's head with
      // -32602 "block range extends beyond current head block" and this route 502'd — which
      // is what the Referral Milestones block was showing. Letting the node resolve
      // 'latest' itself removes the disagreement: a node cannot lag its own head.
      const topic = ethers.id('MilestoneNFTMinted(address,uint256,uint256)')
      const logs = await p.getLogs({
        address: A.claimRewards, topics: [topic],
        // ClaimRewardsV2's deploy block, not 0 — 96 million empty blocks per page load is
        // what exhausted the RPC quota on 2026-08-12.
        fromBlock: deployBlockOf('ClaimRewardsV2'), toBlock: 'latest',
      })
      const tierToIndex = new Map<number, number>(MILESTONES.map((m) => [m.tier, m.index]))
      // `event MilestoneNFTMinted(address indexed user, uint256 tier, uint256 tokenId)`
      // indexes ONE parameter. `tier` and `tokenId` sit in `data`; `topics[2]` does not
      // exist. Reading it gave 0 for every log, `tierToIndex.get(0)` was always undefined,
      // and every previous mint was skipped — so `alreadyMinted` came back empty no matter
      // how many NFTs had been issued, and this endpoint re-proposed all of them.
      //
      // Harmless while nothing has been minted; a double-mint machine the moment anything
      // has. Decode from `data`, and count the topics rather than trusting a position.
      const coder = ethers.AbiCoder.defaultAbiCoder()
      for (const log of logs) {
        if (log.topics.length < 2) continue
        const wallet = ethers.getAddress('0x' + log.topics[1].slice(26)).toLowerCase()
        let tier: number
        try {
          const [t] = coder.decode(['uint256', 'uint256'], log.data)
          tier = Number(t)
        } catch {
          continue
        }
        const index = tierToIndex.get(tier)
        if (index === undefined) continue
        const per = alreadyMinted.get(wallet) ?? new Map<number, number>()
        per.set(index, (per.get(index) ?? 0) + 1)
        alreadyMinted.set(wallet, per)
      }
    } catch (e: any) {
      const why = e?.shortMessage || e?.info?.error?.message || e?.message || 'unknown RPC failure'
      app.log.warn({ err: e?.message }, 'nft-rewards: could not read minted history')
      return reply.status(502).send({
        error: 'CHAIN_ERROR',
        // Carry the node's own words. Without them this reads as "the chain is down" and
        // sends the next person to check the wrong thing.
        message: `Could not read the mint history from chain — refusing to propose mints without it (RPC said: ${why})`,
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
  // What the two emission-funded pools hold, and what each holder can claim from them.
  //
  // ## Why this was rewritten
  //
  // It used to read `balance()` / `totalDistributed()` / `distributionCount()` and compute
  // a distribution plan for an operator to push out. Those are the functions of the
  // push-based pools that were replaced on 2026-08-10; the addresses in the SDK now point
  // at `NftRewardPoolV2`, which has none of them. Every call reverted, so this endpoint
  // returned 500 on every request — and the Distribute button it fed called a `distribute`
  // that no longer exists.
  //
  // V2 is claim-based: MIC streams into an accumulator and each holder pulls their own.
  // There is no plan to compute and nothing for an admin to push. What an admin needs is
  // what is actually true on chain — held, streaming, owed, claimed — so that is what this
  // returns.
  app.get('/pools', async (req, reply) => {
    const A = await addresses()
    if (!A) return reply.status(503).send({ error: 'NOT_DEPLOYED', message: 'Reward pools are not configured' })
    if (!A.communityPool || A.communityPool === ZERO) {
      return reply.status(503).send({ error: 'NOT_DEPLOYED', message: 'CommunityNFTRewardPool is not deployed yet' })
    }

    const p = await provider()
    if (!p) return reply.status(503).send({ error: 'NO_RPC', message: 'No archive-capable RPC configured' })

    const { ethers } = await import('ethers')

    /** The live `NftRewardPoolV2` surface — verified against the deployed bytecode. */
    const POOL_V2_ABI = [
      'function micToken() view returns (address)',
      'function totalNotified() view returns (uint256)',
      'function totalClaimed() view returns (uint256)',
      'function totalWeight() view returns (uint256)',
      'function rewardPerDay() view returns (uint256)',
      'function periodFinish() view returns (uint256)',
      'function pendingExpiries() view returns (uint256)',
      'function weightOf(address) view returns (uint256)',
      'function claimable(address) view returns (uint256)',
    ]

    const community = new ethers.Contract(A.communityPool, POOL_V2_ABI, p)
    const mfp = new ethers.Contract(A.mfpPool, POOL_V2_ABI, p)

    let micAddr: string
    try {
      micAddr = await community.micToken()
    } catch (e: any) {
      // The pool does not answer the V2 interface. Say exactly that rather than letting an
      // ethers decode error surface as a bare 500 — the previous version of this route
      // failed here for two days and the page only ever said "Internal Server Error".
      return reply.status(502).send({
        error: 'ABI_MISMATCH',
        message:
          `${A.communityPool} does not answer the NftRewardPoolV2 interface ` +
          `(${e?.shortMessage || e?.message}). The address in the SDK and the contract on ` +
          `chain have diverged — check packages/sdk/src/addresses.ts against the deployment.`,
      })
    }
    const mic = new ethers.Contract(micAddr, ['function balanceOf(address) view returns (uint256)'], p)

    const readPool = async (c: any, address: string) => {
      const [held, notified, claimed, weight, perDay, finish] = await Promise.all([
        mic.balanceOf(address),
        c.totalNotified(), c.totalClaimed(), c.totalWeight(), c.rewardPerDay(), c.periodFinish(),
      ])
      // Only the Community pool keeps an expiry heap; the MFP pool reverts on this.
      const pendingExpiries = await c.pendingExpiries().then(Number).catch(() => null)
      return {
        address,
        held: ethers.formatUnits(held, 18),
        totalNotified: ethers.formatUnits(notified, 18),
        totalClaimed: ethers.formatUnits(claimed, 18),
        // What is owed but not yet pulled. Derived, because the contract tracks the two
        // ends and not the middle.
        unclaimed: ethers.formatUnits((notified as bigint) - (claimed as bigint), 18),
        totalWeight: (weight as bigint).toString(),
        rewardPerDay: ethers.formatUnits(perDay, 18),
        streaming: Number(finish) * 1000 > Date.now(),
        periodFinish: Number(finish) === 0 ? null : new Date(Number(finish) * 1000).toISOString(),
        pendingExpiries,
      }
    }

    const [cPool, mPool] = await Promise.all([
      readPool(community, A.communityPool),
      readPool(mfp, A.mfpPool),
    ])

    // ── who is earning, and what they can pull right now ──
    //
    // Weight comes from `enroll`, not from the mint. A Community NFT that was minted but
    // never enrolled carries zero weight and earns nothing — so the holder set is built
    // from the pool's own `Enrolled` / `Resynced` events rather than from the NFT's mints.
    // Building it from mints would show wallets that are, in fact, earning nothing.
    const holders: Array<{
      wallet: string
      pool: 'community' | 'mfp'
      weight: string
      claimable: string
      activeByTier?: Partial<Record<CommunityTier, number>>
    }> = []
    let holderError: string | null = null

    try {
      const enrolled = ethers.id('Enrolled(uint256,address,uint256,uint256)')
      const resynced = ethers.id('Resynced(uint256,address,address)')
      // `toBlock: 'latest'` for the same reason as the milestones scan above — a head
      // fetched separately can be ahead of the node that answers the log query.
      const logs = await p.getLogs({
        address: A.communityPool, topics: [[enrolled, resynced]],
        fromBlock: deployBlockOf('CommunityNFTRewardPool'), toBlock: 'latest',
      })
      const wallets = new Set<string>()
      for (const log of logs) {
        if (log.topics[0] === enrolled) {
          wallets.add(ethers.getAddress('0x' + log.topics[2].slice(26)))
        } else {
          // Resynced(tokenId, from, to) — credit follows `to`, but `from` may still hold
          // settled MIC it has not claimed, so both stay in the set.
          if (log.topics[2]) wallets.add(ethers.getAddress('0x' + log.topics[2].slice(26)))
          if (log.topics[3]) wallets.add(ethers.getAddress('0x' + log.topics[3].slice(26)))
        }
      }

      const nft = A.communityNft && A.communityNft !== ZERO
        ? new ethers.Contract(A.communityNft, ['function activeCountOf(address,uint256) view returns (uint256)'], p)
        : null

      for (const w of wallets) {
        const [weight, owed] = await Promise.all([community.weightOf(w), community.claimable(w)])
        let activeByTier: Partial<Record<CommunityTier, number>> | undefined
        if (nft) {
          activeByTier = {}
          for (const tier of [TIER.BUILDER, TIER.MAKER, TIER.LUMINARY] as CommunityTier[]) {
            const n = await nft.activeCountOf(w, tier).then(Number).catch(() => 0)
            if (n > 0) activeByTier[tier] = n
          }
        }
        if ((weight as bigint) > 0n || (owed as bigint) > 0n) {
          holders.push({
            wallet: w, pool: 'community',
            weight: (weight as bigint).toString(),
            claimable: ethers.formatUnits(owed, 18),
            activeByTier,
          })
        }
      }
    } catch (e: any) {
      holderError = e?.shortMessage || e?.message || 'could not read Community pool holders'
      app.log.warn({ err: holderError }, 'nft-rewards: community holder read failed')
    }

    // ── MFP side ──
    //
    // The MFP pool has no enrol event: weight is written by `setWeight`, which emits
    // nothing. The mint records are the only list of candidate wallets we have, so the
    // weight for each is read back from the pool to see which were actually registered.
    const mfpMints = await app.prisma.mfpMintRecord.groupBy({
      by: ['wallet'],
      _count: { wallet: true },
    }).catch(() => [] as Array<{ wallet: string; _count: { wallet: number } }>)

    let mfpUnregistered = 0
    for (const row of mfpMints) {
      const w = ethers.getAddress(row.wallet)
      const [weight, owed] = await Promise.all([
        mfp.weightOf(w).catch(() => 0n),
        mfp.claimable(w).catch(() => 0n),
      ])
      if ((weight as bigint) === 0n) mfpUnregistered++
      if ((weight as bigint) > 0n || (owed as bigint) > 0n) {
        holders.push({
          wallet: w, pool: 'mfp',
          weight: (weight as bigint).toString(),
          claimable: ethers.formatUnits(owed, 18),
        })
      }
    }

    // ── Ownership drift ──
    //
    // The check above counts MINT records, which is not the same question. An MFP pass is
    // a transferable ERC-721: a wallet that bought one second-hand never appears in the
    // mint table, and a wallet that sold one still does. Weight written by `setWeight`
    // does not move with the token — the pool keeps paying the seller until an operator
    // rewrites it.
    //
    // So the only honest source is current ownership, read from the collection itself and
    // compared against the weight actually registered. Anything that disagrees is a wallet
    // being paid the wrong amount right now.
    const drift: Array<{
      wallet: string
      passes: number
      registeredPasses: number
      delta: number
      kind: 'unregistered' | 'stale-holder' | 'wrong-count'
    }> = []
    let driftError: string | null = null

    try {
      // Only meaningful while the pool is in FLAT-WEIGHT mode, where an operator writes
      // weight and it cannot follow a transfer. Since 2026-08-19 the MFP pool runs in NFT
      // mode: `enroll` and `resync` are permissionless, holders keep their own weight
      // current, and weight is denominated by the adapter (10,000/pass) rather than by
      // `flatWeight` (100,000). Dividing by flatWeight there would report every wallet as
      // unregistered — a false alarm, which is worse than no alarm.
      const nftSet = (await mfp.nft().catch(() => ZERO)) !== ZERO
      const flat = BigInt(await mfp.flatWeight())
      if (!nftSet && flat > 0n) {
        const nftAddr = (A as Record<string, string>).MFPNFT
        if (nftAddr && nftAddr !== ZERO) {
          const col = new ethers.Contract(nftAddr, [
            'function totalSupply() view returns (uint256)',
            'function ownerOf(uint256) view returns (address)',
          ], p)
          const supply = Number(await col.totalSupply())
          const HARD_CAP = 2_500                      // MFP's own cap; never scan past it
          const owned = new Map<string, number>()
          for (let id = 1; id <= Math.min(supply, HARD_CAP); id++) {
            try {
              const owner = ethers.getAddress(await col.ownerOf(id))
              owned.set(owner, (owned.get(owner) ?? 0) + 1)
            } catch { /* burned or never minted */ }
          }

          // Every wallet that holds passes, plus every wallet that carries weight — the
          // second set catches sellers still being paid for tokens they no longer own.
          const candidates = new Set<string>([
            ...owned.keys(),
            ...holders.filter(h => h.pool === 'mfp').map(h => ethers.getAddress(h.wallet)),
          ])

          for (const w of candidates) {
            const passes = owned.get(w) ?? 0
            const weight = BigInt(await mfp.weightOf(w).catch(() => 0n))
            const registered = Number(weight / flat)
            if (registered === passes) continue
            drift.push({
              wallet: w,
              passes,
              registeredPasses: registered,
              delta: passes - registered,
              kind: passes === 0 ? 'stale-holder' : registered === 0 ? 'unregistered' : 'wrong-count',
            })
          }
          drift.sort((a2, b2) => Math.abs(b2.delta) - Math.abs(a2.delta))
        }
      }
    } catch (e: any) {
      driftError = e?.shortMessage || e?.message || 'ownership drift check failed'
      app.log.warn({ err: driftError }, 'nft-rewards: MFP ownership drift check failed')
    }

    // Anything that would otherwise be read as a failure, said out loud.
    const notes: string[] = []
    if (holders.length === 0) {
      notes.push(
        'No wallet is earning from either pool yet. Weight comes from enrolment, not from ' +
        'the mint: a Community NFT must be passed to the pool\'s enroll(tokenId), and an MFP ' +
        'holder must be registered with setWeight, before either earns anything.',
      )
    }
    if (mfpUnregistered > 0) {
      notes.push(
        `${mfpUnregistered} wallet${mfpUnregistered === 1 ? ' holds an' : 's hold'} MFP pass` +
        `${mfpUnregistered === 1 ? '' : 'es'} but ${mfpUnregistered === 1 ? 'has' : 'have'} ` +
        'zero weight in the MFP pool — setWeight has not been called for them, so they are ' +
        'earning nothing.',
      )
    }
    if (drift.length > 0) {
      const stale = drift.filter(d => d.kind === 'stale-holder').length
      const short = drift.filter(d => d.delta > 0).length
      notes.push(
        `⚠ MFP weight is out of date for ${drift.length} wallet${drift.length === 1 ? '' : 's'}. ` +
        (stale > 0
          ? `${stale} no longer hold${stale === 1 ? 's' : ''} any pass but still carry weight — ` +
            'the pool is paying for tokens they have sold. '
          : '') +
        (short > 0
          ? `${short} hold${short === 1 ? 's' : ''} more passes than registered and ` +
            `${short === 1 ? 'is' : 'are'} underpaid. `
          : '') +
        'This pool is in flat-weight mode, where weight does not follow a transfer and only ' +
        'an operator can correct it: run scripts/set-mfp-weights.ts (EXECUTE=1). In NFT mode ' +
        'holders fix their own weight with resync() and this warning cannot arise.',
      )
    }
    if (driftError) {
      notes.push(
        'The MFP ownership check could not run, so weight drift is unknown rather than ' +
        `absent: ${driftError}`,
      )
    }
    if (cPool.pendingExpiries && cPool.pendingExpiries > 0) {
      notes.push(
        `${cPool.pendingExpiries} expired Community NFT${cPool.pendingExpiries === 1 ? '' : 's'} ` +
        'still carry weight — call sync() on the Community pool to retire them. Until then ' +
        'they take a share from the NFTs still running.',
      )
    }
    if (!cPool.streaming && !mPool.streaming) {
      notes.push(
        'Neither pool is streaming: EmissionController has not called notifyReward inside ' +
        'the last 24 hours. Nothing new is accruing to anybody.',
      )
    }

    return {
      data: {
        model: 'claim',
        pools: { community: cPool, mfp: mPool },
        holderCount: holders.length,
        holderError,
        holders: holders.sort((a, b) => Number(b.claimable) - Number(a.claimable)),
        notes,
      },
    }
  })
}

export default nftRewardsRoutes
