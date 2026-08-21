import { FastifyPluginAsync } from 'fastify'
import { readFileSync } from 'fs'
import { join } from 'path'
import { buildProvider } from '../services/blockchain.js'

// ─── NFT Constants ────────────────────────────────────────────────────────

const MFP_MAX_SUPPLY = 2_500
const MFP_EXPANSION_MAX = 0
const MFP_IMAGE_BASE = 'https://api.missionchain.io/static/mfp-art/'
const MFP_THUMB_BASE = 'https://api.missionchain.io/static/mfp-art/thumb/'
const MFP_SERIES = 'MISSION FOUNDING PASS'

// Load verse pool (synchronous on startup, cached)
interface VerseEntry {
  id: number
  imageId: number
  title: string
  soulLine: string
  verse: { text: string; ref: string }
}
let _versePool: Record<number, VerseEntry> = {}
try {
  const candidates = [
    // canonical: file lives in packages/sdk/ (not src/)
    join(process.cwd(), '../../packages/sdk/verse-pool.json'),
    join(process.cwd(), 'packages/sdk/verse-pool.json'),
    '/opt/missionchain/deploy/packages/sdk/verse-pool.json',
    // legacy: in case generator moves it into src/
    join(process.cwd(), '../../packages/sdk/src/verse-pool.json'),
    join(process.cwd(), 'packages/sdk/src/verse-pool.json'),
    '/opt/missionchain/deploy/packages/sdk/src/verse-pool.json',
  ]
  for (const p of candidates) {
    try {
      const data = JSON.parse(readFileSync(p, 'utf8'))
      _versePool = Object.fromEntries(data.entries.map((e: VerseEntry) => [e.id, e]))
      break
    } catch { /* try next */ }
  }
} catch {
  console.warn('[nft] verse-pool.json not found — metadata endpoint will use placeholders')
}

function imageFileName(imageId: number): string {
  return `MFP-ART-${imageId.toString().padStart(3, '0')}.png`
}

function pad4(n: number): string {
  return n.toString().padStart(4, '0')
}

const COMMUNITY_TIERS = [
  {
    tier: 'Builder',
    formerName: 'Silver',
    multiplier: 1.0,
    durationDays: 60,
    supply: 'Unlimited',
    primaryBenefit: 'Reward-pool participation',
  },
  {
    tier: 'Maker',
    formerName: 'Gold',
    multiplier: 2.5,
    durationDays: 90,
    supply: 'Unlimited',
    primaryBenefit: 'Reward-pool participation',
  },
  {
    tier: 'Luminary',
    formerName: 'Platinum',
    multiplier: 5.0,
    durationDays: 180,
    supply: 'Unlimited',
    primaryBenefit: 'Reward-pool participation',
  },
] as const

export const nftRoutes: FastifyPluginAsync = async (app) => {
  // ─── GET /nft/overview — NFT dashboard summary ────────────────
  /**
   * Cached for a minute. The MFP supply is read from chain — correct, but it is one
   * round trip on every page load for a number that changes when someone mints.
   */
  let overviewCache: { at: number; body: any } | null = null
  const OVERVIEW_TTL_MS = 60_000

  app.get('/overview', async () => {
    if (overviewCache && Date.now() - overviewCache.at < OVERVIEW_TTL_MS) return overviewCache.body

    const [dbMfp, builder, maker, luminary] = await Promise.all([
      app.prisma.nFTItem.count({ where: { contractType: 'MFP', active: true } }),
      app.prisma.nFTItem.count({ where: { contractType: 'COMMUNITY', tier: 'Builder', active: true } }),
      app.prisma.nFTItem.count({ where: { contractType: 'COMMUNITY', tier: 'Maker', active: true } }),
      app.prisma.nFTItem.count({ where: { contractType: 'COMMUNITY', tier: 'Luminary', active: true } }),
    ])

    /**
     * How many MFP passes exist, asked of the contract that mints them.
     *
     * This counted rows in `NFTItem` instead, which is an indexer's copy — and the copy
     * had drifted: 23 minted on chain, 3 recorded here. The published figure was a
     * seventh of the truth, on the page people open to see how many exist.
     *
     * The chain is the authority for a supply number. The table stays as the fallback
     * for when the RPC cannot be reached, and it is labelled as such in the response so
     * a stale figure is never mistaken for a fresh one.
     */
    let totalMfp = dbMfp
    let mfpSource: 'chain' | 'index' = 'index'
    try {
      const { ethers } = await import('ethers')
      const { getActiveAddresses, getActiveChain } = await import('@missionchain/sdk')
      const A = getActiveAddresses() as Record<string, string>
      const ZERO = '0x0000000000000000000000000000000000000000'
      if (A.MFPNFT && A.MFPNFT !== ZERO) {
        const p = buildProvider()
        const c = new ethers.Contract(
          A.MFPNFT, ['function totalSupply() view returns (uint256)'], p,
        )
        totalMfp = Number(await c.totalSupply())
        mfpSource = 'chain'
      }
    } catch {
      // Leave the indexed count in place rather than reporting zero.
    }

    const body = {
      totalMfp,
      mfpSource,
      indexedMfp: dbMfp,
      maxMfp: MFP_MAX_SUPPLY,
      communityNfts: { builder, maker, luminary },
      userNfts: [],
    }

    overviewCache = { at: Date.now(), body }
    return body
  })

  // ─── GET /nft/holdings — User NFT holdings (auth) ─────────────
  app.get('/holdings', {
    preHandler: [app.authenticate],
  }, async (req, reply) => {
    const { wallet: authWallet } = req.user as { wallet: string }
    const { wallet } = req.query as { wallet?: string }

    const targetWallet = (wallet ?? authWallet).toLowerCase()
    const { role } = req.user as { role: string }
    if (targetWallet !== authWallet && role !== 'ADMIN') {
      return reply.status(403).send({ error: 'FORBIDDEN', message: 'Cannot view other users NFTs' })
    }

    const nfts = await app.prisma.nFTItem.findMany({
      where: { wallet: targetWallet },
      orderBy: { mintedAt: 'desc' },
    })

    const now = new Date()

    // Separate MFP and Community NFTs
    const mfpNfts = nfts.filter((n) => n.contractType === 'MFP')
    const communityNfts = nfts.filter((n) => n.contractType === 'COMMUNITY')

    return {
      data: {
        wallet: targetWallet,
        mfp: {
          count: mfpNfts.length,
          items: mfpNfts.map((n) => ({
            tokenId: n.tokenId,
            mintedAt: n.mintedAt.toISOString(),
            active: n.active,
            rewardPoolWeight: 10,
            governanceEligible: true,
            lifetime: true,
          })),
        },
        community: communityNfts.map((n) => {
          const isExpired = n.expiresAt ? now > n.expiresAt : false
          return {
            tokenId: n.tokenId,
            tier: n.tier,
            mintedAt: n.mintedAt.toISOString(),
            expiresAt: n.expiresAt?.toISOString() ?? null,
            active: n.active && !isExpired,
            isExpired,
            // The holdings table links each NFT to its mint tx on BSCScan.
            mintTxHash: n.mintTxHash,
            rewardPoolWeight: COMMUNITY_TIERS.find((t) => t.tier === n.tier)?.multiplier ?? 1,
            primaryBenefit: COMMUNITY_TIERS.find((t) => t.tier === n.tier)?.primaryBenefit ?? 'Reward-pool participation',
          }
        }),
        totalCount: nfts.length,
      },
    }
  })

  // ─── GET /nft/mfp/info — MFP global info ──────────────────────
  app.get('/mfp/info', async (req, reply) => {
    const totalMinted = await app.prisma.nFTItem.count({
      where: { contractType: 'MFP', active: true },
    })

    return {
      data: {
        name: 'Mission Founders Pass (MFP)',
        type: 'ERC-721',
        maxSupply: MFP_MAX_SUPPLY,
        expansionMax: MFP_EXPANSION_MAX,
        expansionNote: 'Canonical April 2026 scope: no additional MFP expansion is configured',
        totalMinted,
        remaining: Math.max(0, MFP_MAX_SUPPLY - totalMinted),
        rewardPoolWeight: 10,
        duration: 'Lifetime (Permanent)',
        daoVoting: true,
        daoRequirement: 'MFP-NFT + at least 100,000 MIC staked + lock >= 360 days remaining',
        stakingRelation: 'MFP-NFT does not change staking rewards; it only gates DAO voting eligibility',
      },
    }
  })

  // ─── GET /nft/community/info — Community NFT tier info ─────────
  app.get('/community/info', async (req, reply) => {
    // Count per tier
    const tierCounts = await Promise.all(
      COMMUNITY_TIERS.map(async (t) => {
        const count = await app.prisma.nFTItem.count({
          where: { contractType: 'COMMUNITY', tier: t.tier, active: true },
        })
        return { tier: t.tier, activeCount: count }
      }),
    )

    return {
      data: {
        name: 'Community NFTs',
        type: 'ERC-1155',
        supply: 'Unlimited (minted based on KPI/performance)',
        daoVoting: false,
        tiers: COMMUNITY_TIERS.map((t) => ({
          ...t,
          activeCount: tierCounts.find((c) => c.tier === t.tier)?.activeCount ?? 0,
        })),
      },
    }
  })

  // ════════════════════════════════════════════════════════════════════════
  // Community NFT Reward Pool Endpoints
  // ════════════════════════════════════════════════════════════════════════

  const TIER_WEIGHTS: Record<string, { weight: number; durationDays: number }> = {
    Builder:  { weight: 100, durationDays: 60 },
    Maker:    { weight: 250, durationDays: 90 },
    Luminary: { weight: 500, durationDays: 180 },
  }

  // ─── GET /nft/pool/stats — Pool statistics (public) ───────────
  app.get('/pool/stats', async () => {
    const entries = await app.prisma.nftPoolEntry.groupBy({
      by: ['tier', 'status'],
      _count: true,
      _sum: { weight: true },
    })

    const active = entries.filter((e) => e.status === 'ACTIVE')
    const burned = entries.filter((e) => e.status === 'BURNED')

    const tierBreakdown: Record<string, { count: number; weight: number }> = {}
    for (const e of active) {
      tierBreakdown[e.tier.toLowerCase()] = { count: e._count, weight: e._sum.weight || 0 }
    }

    const totalActive = active.reduce((s, e) => s + e._count, 0)
    const totalBurned = burned.reduce((s, e) => s + e._count, 0)
    const totalWeight = active.reduce((s, e) => s + (e._sum.weight || 0), 0)

    /*
     * The pool contract is the truth; the table is a cache that nothing fills.
     *
     * `nftPoolEntry` is written by an indexer that is not running, so this endpoint
     * reported zero weight and zero active NFTs while the pool itself held 85,000 — the
     * member had enrolled three NFTs, seen the transactions confirm, and the panel still
     * read "-". Weight is a live figure and belongs to the contract that computes it.
     *
     * `totalWeight` is in ten-thousandths (a Luminary is 50,000 = x5.0), which is the unit
     * the pool does its arithmetic in. It is converted here rather than in the DApp so
     * every caller shows the same multiplier.
     */
    let chainWeight: number | null = null
    let chainActive: number | null = null
    let chainMinted: number | null = null
    let chainRetired: number | null = null
    let chainTiers: Record<string, { count: number; weight: number }> | null = null
    try {
      const { Contract } = await import('ethers')
      const { getActiveAddresses } = await import('@missionchain/sdk')
      const poolAddr = (getActiveAddresses() as Record<string, string>).CommunityNFTRewardPool
      if (poolAddr && !/^0x0+$/.test(poolAddr)) {
        const c = new Contract(poolAddr, [
          'function totalWeight() view returns (uint256)',
          'function heapSize() view returns (uint256)',
          'function tokenWeight(uint256) view returns (uint256)',
        ], buildProvider())
        const [w, n] = await Promise.all([c.totalWeight(), c.heapSize()])
        chainWeight = Number(w) / 10_000
        chainActive = Number(n)

        /*
         * Per-tier split, minted total and retired count — all from the chain, for the same
         * reason as the weight above: the table behind them is empty, so the admin panel
         * showed six active entries inside a total of zero, and every tier as "-".
         *
         * The collection is small and capped by how many credentials have ever been issued,
         * so walking it is cheap and exact. `tokenWeight` is zero for a token that was never
         * enrolled or has since been retired, which is what separates the two counts.
         */
        const nftAddr = (getActiveAddresses() as Record<string, string>).CommunityNFTv2
        if (nftAddr && !/^0x0+$/.test(nftAddr)) {
          const nft = new Contract(nftAddr, [
            'function totalSupply() view returns (uint256)',
            'function tokenByIndex(uint256) view returns (uint256)',
            'function tierOf(uint256) view returns (uint256)',
          ], buildProvider())

          const minted = Number(await nft.totalSupply())
          chainMinted = minted

          const TIER_NAME: Record<number, string> = { 1: 'builder', 2: 'maker', 3: 'luminary' }
          const split: Record<string, { count: number; weight: number }> = {}
          let retired = 0

          for (let i = 0; i < minted; i++) {
            const id = await nft.tokenByIndex(i)
            const [tier, tw] = await Promise.all([nft.tierOf(id), c.tokenWeight(id)])
            const name = TIER_NAME[Number(tier)]
            if (!name) continue
            const weight = Number(tw)
            if (weight === 0) { retired++; continue }
            const row = split[name] ?? (split[name] = { count: 0, weight: 0 })
            row.count += 1
            row.weight += weight / 10_000
          }

          chainTiers = split
          chainRetired = retired
        }
      }
    } catch {
      // Fall back to the table rather than failing the panel; the numbers are stale, not
      // wrong-shaped, and the DApp shows "-" for a null.
    }

    return {
      totalWeightedShares: chainWeight ?? totalWeight,
      activeEntries: chainActive ?? totalActive,
      /** `chain` when read live, `db` when the fallback was used. */
      source: chainWeight !== null ? 'chain' : 'db',
      burnedTotal: chainRetired ?? totalBurned,
      /** Every credential ever issued, active or not. */
      totalEntries: chainMinted ?? (totalActive + totalBurned),
      tierBreakdown: chainTiers ?? tierBreakdown,
    }
  })

  // ─── GET /nft/pool/my-entries — User's pool entries (auth) ────
  app.get('/pool/my-entries', { preHandler: [app.authenticate] }, async (req) => {
    const { wallet } = req.user as { wallet: string }
    const entries = await app.prisma.nftPoolEntry.findMany({
      where: { wallet },
      orderBy: [{ status: 'asc' }, { expiresAt: 'asc' }],
    })
    return entries
  })

  // ─── GET /nft/pool/eligible — Eligible NFTs not in pool (auth) ─
  app.get('/pool/eligible', { preHandler: [app.authenticate] }, async (req) => {
    const { wallet } = req.user as { wallet: string }
    const allNfts = await app.prisma.nFTItem.findMany({
      where: { wallet, contractType: 'COMMUNITY', active: true },
    })
    const inPool = await app.prisma.nftPoolEntry.findMany({
      where: { wallet, status: { in: ['ACTIVE', 'EXPIRED'] } },
      select: { instanceId: true },
    })
    const inPoolSet = new Set(inPool.map((e) => e.instanceId))
    const eligible = allNfts.filter((n) => !inPoolSet.has(n.tokenId))
    return eligible
  })

  // ─── GET /nft/pool/history — Claim history (auth) ─────────────
  app.get('/pool/history', { preHandler: [app.authenticate] }, async (req) => {
    const { wallet } = req.user as { wallet: string }
    const logs = await app.prisma.nftPoolRewardLog.findMany({
      where: { wallet },
      orderBy: { claimedAt: 'desc' },
      take: 50,
    })
    return logs.map((l) => ({ ...l, instanceIds: JSON.parse(l.instanceIds) }))
  })

  // ─── POST /nft/pool/record-join — Record on-chain join (auth) ─
  app.post('/pool/record-join', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { txHash, instanceIds } = req.body as { txHash: string; instanceIds: string[] }
    const { wallet } = req.user as { wallet: string }

    // Basic validation (full on-chain verification deferred to production deployment)
    if (!txHash || !instanceIds?.length) {
      return reply.status(400).send({ error: 'Missing txHash or instanceIds' })
    }

    const results = []
    for (const instanceId of instanceIds) {
      const nft = await app.prisma.nFTItem.findFirst({
        where: { tokenId: instanceId, wallet, contractType: 'COMMUNITY' },
      })
      if (!nft || !nft.tier) continue

      const params = TIER_WEIGHTS[nft.tier]
      if (!params) continue

      const joinedAt = new Date()
      const expiresAt = new Date(joinedAt.getTime() + params.durationDays * 86400000)

      try {
        const entry = await app.prisma.nftPoolEntry.create({
          data: {
            wallet,
            instanceId,
            tier: nft.tier,
            weight: params.weight,
            joinedAt,
            expiresAt,
            joinTxHash: txHash,
            status: 'ACTIVE',
          },
        })
        results.push(entry)
      } catch (err: any) {
        // Skip duplicate txHash (unique constraint)
        if (err.code === 'P2002') continue
        throw err
      }
    }

    return { entries: results }
  })

  // ─── POST /nft/pool/record-claim — Record on-chain claim (auth) ─
  app.post('/pool/record-claim', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { txHash, amount, instanceIds } = req.body as {
      txHash: string; amount: string; instanceIds: string[]
    }
    const { wallet } = req.user as { wallet: string }

    if (!txHash || !amount) {
      return reply.status(400).send({ error: 'Missing txHash or amount' })
    }

    const log = await app.prisma.nftPoolRewardLog.create({
      data: {
        wallet,
        instanceIds: JSON.stringify(instanceIds || []),
        amount: parseFloat(amount),
        txHash,
        claimedAt: new Date(),
      },
    })

    // Update totalClaimed proportional to weight
    if (instanceIds?.length) {
      const entries = await app.prisma.nftPoolEntry.findMany({
        where: { instanceId: { in: instanceIds }, wallet },
      })
      const totalWeight = entries.reduce((s, e) => s + e.weight, 0)
      const totalAmount = parseFloat(amount)
      for (const entry of entries) {
        const share = totalWeight > 0 ? (totalAmount * entry.weight) / totalWeight : 0
        await app.prisma.nftPoolEntry.update({
          where: { id: entry.id },
          data: {
            totalClaimed: { increment: share },
            lastClaimedAt: new Date(),
          },
        })
      }
    }

    return { rewardLog: log }
  })

  // ─── GET /nft/pool/admin/entries — Admin pool entries (admin) ─
  app.get('/pool/admin/entries', async (req) => {
    const { status, tier, search, page = '1' } = req.query as any
    const pageNum = parseInt(page)
    const where: any = {}
    if (status && status !== 'All') where.status = status
    if (tier) where.tier = tier
    if (search) where.OR = [
      { wallet: { contains: search } },
      { instanceId: { contains: search } },
    ]
    const [entries, total] = await Promise.all([
      app.prisma.nftPoolEntry.findMany({
        where, skip: (pageNum - 1) * 50, take: 50, orderBy: { createdAt: 'desc' },
      }),
      app.prisma.nftPoolEntry.count({ where }),
    ])
    return { entries, total, page: pageNum, pages: Math.ceil(total / 50) }
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // ─── MFP-NFT (Lazy Mint + Random Pair) ─────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════════════

  // ─── GET /nft/mfp/metadata/:tokenId — ERC-721 standard metadata JSON ──
  // Used by marketplaces (OpenSea / BSCScan) and by the DApp reveal modal.
  // Indexer can lag, so falls back to on-chain pairOf() when DB empty.
  app.get('/mfp/metadata/:tokenId', async (req, reply) => {
    const { tokenId } = req.params as { tokenId: string }
    const id = parseInt(tokenId.replace(/\.json$/i, ''), 10)
    if (Number.isNaN(id) || id < 1) {
      return reply.status(400).send({ error: 'BAD_REQUEST', message: 'invalid tokenId' })
    }

    let imageId: number | null = null
    let verseId: number | null = null

    const record = await app.prisma.mfpMintRecord.findUnique({ where: { tokenId: id } })
    if (record) {
      imageId = record.imageId
      verseId = record.verseId
    } else {
      // Fallback: read pair directly on-chain (indexer may not have caught up yet)
      try {
        const { JsonRpcProvider, Contract } = await import('ethers')

        const mfpAddr = process.env.MFPNFT_ADDRESS || '0xC53DfA185D29A10124a57c27eA4131c504B8097F'
        const provider = buildProvider()
        const ABI = [
          'function pairOf(uint256) view returns (uint8, uint8)',
          'function totalMinted() view returns (uint256)',
        ]
        const c = new Contract(mfpAddr, ABI, provider)
        const minted = Number(await c.totalMinted())
        if (id > minted) {
          return reply.status(404).send({ error: 'NOT_FOUND', message: 'Token not minted yet' })
        }
        const pair = await c.pairOf(BigInt(id))
        imageId = Number(pair[0])
        verseId = Number(pair[1])
      } catch (err: any) {
        req.log.error({ err: err?.message }, '[mfp metadata] on-chain fallback failed')
        return reply.status(503).send({ error: 'CHAIN_READ_FAILED', message: 'Could not read token pair on-chain' })
      }
    }

    const v = _versePool[verseId!]
    const imageFile = imageFileName(imageId!)
    const title = v?.title ?? `MFP #${pad4(id)}`
    const soulLine = v?.soulLine ?? ''
    const verseText = v?.verse?.text ?? ''
    const verseRef = v?.verse?.ref ?? ''

    reply.header('Cache-Control', 'public, max-age=86400')
    return {
      name: `MFP #${pad4(id)} — ${title}`,
      description:
        `${soulLine}\n\n"${verseText}" — ${verseRef}\n\n` +
        `Mission Founding Partner NFT, ${MFP_SERIES}. ` +
        `Lifetime governance credential with x10 staking weight on the MissionChain DAO.`,
      image: MFP_IMAGE_BASE + imageFile,
      image_thumbnail: MFP_THUMB_BASE + imageFile,
      external_url: `https://app.missionchain.io/nft?token=${id}`,
      attributes: [
        { trait_type: 'Series',     value: MFP_SERIES },
        { trait_type: 'Title',      value: title },
        { trait_type: 'Image ID',   value: imageId },
        { trait_type: 'Verse',      value: verseRef },
        { trait_type: 'Verse ID',   value: verseId },
        { trait_type: 'Serial',     value: id },
        { trait_type: 'Multiplier', value: '×10' },
        { trait_type: 'Type',       value: 'Governance NFT' },
      ],
    }
  })


  // ─── GET /nft/mfp/allowance/:wallet — read mint allowance for wallet ──
  app.get('/mfp/allowance/:wallet', async (req, reply) => {
    const { wallet } = req.params as { wallet: string }
    const w = wallet.toLowerCase()

    const [grants, mints] = await Promise.all([
      app.prisma.mfpGrant.aggregate({
        where: { wallet: w },
        _sum: { amount: true },
      }),
      app.prisma.mfpMintRecord.count({ where: { wallet: w } }),
    ])
    const granted = grants._sum.amount ?? 0
    const remaining = Math.max(0, granted - mints)

    return {
      wallet: w,
      granted,
      minted: mints,
      remaining,
    }
  })

  // ─── GET /nft/mfp/grants/:wallet — list all grants for wallet ─────────
  app.get('/mfp/grants/:wallet', async (req) => {
    const { wallet } = req.params as { wallet: string }
    const grants = await app.prisma.mfpGrant.findMany({
      where: { wallet: wallet.toLowerCase() },
      orderBy: { createdAt: 'desc' },
    })
    return { data: grants }
  })

  // ─── GET /nft/mfp/history/:wallet — mint history for wallet ───────────
  app.get('/mfp/history/:wallet', async (req) => {
    const { wallet } = req.params as { wallet: string }
    const records = await app.prisma.mfpMintRecord.findMany({
      where: { wallet: wallet.toLowerCase() },
      orderBy: { tokenId: 'asc' },
    })
    return { data: records }
  })

  // ─── GET /nft/mfp/pair/:tokenId — single token's (image, verse) pair ──
  app.get('/mfp/pair/:tokenId', async (req, reply) => {
    const { tokenId } = req.params as { tokenId: string }
    const id = parseInt(tokenId, 10)
    if (Number.isNaN(id) || id < 1) {
      return reply.status(400).send({ error: 'BAD_REQUEST', message: 'invalid tokenId' })
    }
    const record = await app.prisma.mfpMintRecord.findUnique({ where: { tokenId: id } })
    if (!record) return reply.status(404).send({ error: 'NOT_FOUND' })
    return { data: record }
  })

  // ─── GET /nft/mfp/stats — global MFP stats (cap, granted, minted) ─────
  app.get('/mfp/stats', async () => {
    const [grantedAgg, mintedCount] = await Promise.all([
      app.prisma.mfpGrant.aggregate({ _sum: { amount: true } }),
      app.prisma.mfpMintRecord.count(),
    ])
    const granted = grantedAgg._sum.amount ?? 0
    return {
      maxSupply: MFP_MAX_SUPPLY,
      granted,
      minted: mintedCount,
      availablePool: Math.max(0, MFP_MAX_SUPPLY - granted),
      remainingMintable: Math.max(0, granted - mintedCount),
    }
  })

  // ─── GET /nft/mfp/pool/spread — image distribution stats ──────────────
  app.get('/mfp/pool/spread', async () => {
    const records = await app.prisma.mfpMintRecord.findMany({
      select: { imageId: true, verseId: true },
    })
    const imageCounts: Record<number, number> = {}
    const verseCounts: Record<number, number> = {}
    for (const r of records) {
      imageCounts[r.imageId] = (imageCounts[r.imageId] ?? 0) + 1
      verseCounts[r.verseId] = (verseCounts[r.verseId] ?? 0) + 1
    }
    return {
      totalMinted: records.length,
      uniqueImages: Object.keys(imageCounts).length,
      uniqueVerses: Object.keys(verseCounts).length,
      imageCounts,
      verseCounts,
    }
  })

  // ─── GET /nft/pool/admin/activity — Admin activity log ────────
  app.get('/pool/admin/activity', async () => {
    const [joins, claims] = await Promise.all([
      app.prisma.nftPoolEntry.findMany({ take: 30, orderBy: { createdAt: 'desc' } }),
      app.prisma.nftPoolRewardLog.findMany({ take: 30, orderBy: { claimedAt: 'desc' } }),
    ])
    const activity = [
      ...joins.map((j) => ({
        time: j.createdAt,
        action: j.status === 'BURNED' ? 'Burned' : 'Joined',
        serial: j.instanceId,
        wallet: j.wallet,
        tx: j.joinTxHash,
      })),
      ...claims.map((c) => ({
        time: c.claimedAt,
        action: 'Claimed',
        serial: '-',
        wallet: c.wallet,
        tx: c.txHash,
      })),
    ].sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime()).slice(0, 50)
    return activity
  })

  // ─── GET /nft/rewards/:wallet — everything a holder can claim ────────────
  //
  // Four programmes pay Community and MFP holders, in two different currencies, from
  // four different contracts. A holder should not have to know that: this returns one
  // list of what they are owed and where to claim it.
  //
  //   Weekly  — USDT, Community 5% + MFP 0.5%, only NFTs minted inside that week
  //   Monthly — USDT, Community 7.5% + MFP 0.5%, every NFT still valid at the cut-off
  //   Mining  — MIC, Community 5% + MFP 1% of daily emission, accrues by the second
  //   Lucky Draw — USDT, drawn weekly among that week's active Community NFTs
  //
  // Everything is read from chain. `claimable` on the USDT pools is what the operator has
  // credited for closed periods; the mining figure accrues continuously, so it is a live
  // number rather than a stored one.
  app.get<{ Params: { wallet: string } }>('/rewards/:wallet', async (req, reply) => {
    const wallet = req.params.wallet
    if (!/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
      return reply.status(400).send({ error: 'BAD_WALLET', message: 'Not a wallet address' })
    }

    const { ethers } = await import('ethers')
    const { getActiveAddresses } = await import('@missionchain/sdk')
    const A = getActiveAddresses() as Record<string, string>
    const ZERO = '0x0000000000000000000000000000000000000000'

    const p = buildProvider()

    const live = (a?: string) => !!a && a !== ZERO

    const usdtPoolAbi = [
      'function claimable(address) view returns (uint256)',
      'function communityBalance() view returns (uint256)',
      'function mfpBalance() view returns (uint256)',
      'function poolName() view returns (string)',
    ]
    const micPoolAbi = [
      'function claimable(address) view returns (uint256)',
      'function weightOf(address) view returns (uint256)',
      'function totalWeight() view returns (uint256)',
      'function rewardPerDay() view returns (uint256)',
    ]
    const drawAbi = ['function claimable(address) view returns (uint256)']

    const fmt = (v: bigint) => ethers.formatUnits(v, 18)

    async function readUsdtPool(address?: string) {
      if (!live(address)) return null
      try {
        const c = new ethers.Contract(address!, usdtPoolAbi, p)
        const [mine, community, mfp, name] = await Promise.all([
          c.claimable(wallet), c.communityBalance(), c.mfpBalance(), c.poolName(),
        ])
        return {
          address,
          name,
          // What the pool is holding for the period in progress — not yet anyone's.
          poolCommunity: fmt(community),
          poolMfp: fmt(mfp),
          // What has been credited to this wallet for periods already closed.
          claimable: fmt(mine),
          currency: 'USDT',
        }
      } catch (e: any) {
        app.log.warn({ err: e?.message, address }, 'nft rewards: usdt pool read failed')
        return null
      }
    }

    async function readMicPool(address?: string) {
      if (!live(address)) return null
      try {
        const c = new ethers.Contract(address!, micPoolAbi, p)
        const [mine, weight, total, perDay] = await Promise.all([
          c.claimable(wallet), c.weightOf(wallet), c.totalWeight(), c.rewardPerDay(),
        ])
        const w = weight as bigint
        const t = total as bigint
        return {
          address,
          claimable: fmt(mine),
          myWeight: w.toString(),
          totalWeight: t.toString(),
          // What this wallet earns per day at the current rate and the current field of
          // holders. It moves as NFTs are minted and as they expire.
          myRewardPerDay: t > 0n ? fmt(((perDay as bigint) * w) / t) : '0',
          currency: 'MIC',
        }
      } catch (e: any) {
        app.log.warn({ err: e?.message, address }, 'nft rewards: mic pool read failed')
        return null
      }
    }

    const [weekly, monthly, mining, mfpMining] = await Promise.all([
      readUsdtPool(A.NFTRewardPoolWeekly),
      readUsdtPool(A.NFTRewardPoolMonthly),
      readMicPool(A.CommunityNFTRewardPool),
      readMicPool(A.MFPRewardPool),
    ])

    // ── Total accumulated / claimed / unclaimed, split by NFT type ────────
    //
    // The pools above answer "what are you owed right now". They cannot say what a wallet
    // has already taken out, and the USDT pools cannot say which NFT type earned it -- one
    // bucket per wallet, credited by two different calls. nftRewardHistory recovers both
    // from the chain's own record; see that file for why the split is exact and not an
    // apportionment.
    const { readUsdtLedger, readMicLedger } = await import('../services/nftRewardHistory.js')

    const ledgerOr = async <T>(fn: () => Promise<T>, label: string): Promise<T | null> => {
      try {
        return await fn()
      } catch (e: any) {
        app.log.warn({ err: e?.shortMessage || e?.message, label }, 'nft rewards: ledger read failed')
        return null
      }
    }

    const [weeklyLedger, monthlyLedger, communityMicLedger, mfpMicLedger] = await Promise.all([
      live(A.NFTRewardPoolWeekly)
        ? ledgerOr(() => readUsdtLedger(p, A.NFTRewardPoolWeekly, wallet), 'weekly') : null,
      live(A.NFTRewardPoolMonthly)
        ? ledgerOr(() => readUsdtLedger(p, A.NFTRewardPoolMonthly, wallet), 'monthly') : null,
      live(A.CommunityNFTRewardPool)
        ? ledgerOr(() => readMicLedger(p, A.CommunityNFTRewardPool, wallet), 'communityMic') : null,
      live(A.MFPRewardPool)
        ? ledgerOr(() => readMicLedger(p, A.MFPRewardPool, wallet), 'mfpMic') : null,
    ])

    const addLedgers = (...rows: Array<{ accumulated: string; claimed: string; unclaimed: string } | null | undefined>) => {
      const sum = (k: 'accumulated' | 'claimed' | 'unclaimed') =>
        rows.reduce((t, r) => t + Number(r?.[k] ?? 0), 0).toFixed(6)
      return { accumulated: sum('accumulated'), claimed: sum('claimed'), unclaimed: sum('unclaimed') }
    }

    // A null USDT ledger means the split failed its own consistency check. Rolling it into
    // a total would quietly understate what the holder is owed, so the flag travels with
    // the figures and the UI falls back to the merged balance.
    const usdSplitReliable = weeklyLedger !== null && monthlyLedger !== null

    const ledgers = {
      // A missing MIC ledger used to collapse to {0,0,0}, which reported a wallet holding
      // 1.0119 MIC as holding nothing. The ledger needs eth_getLogs — for accumulated and
      // claimed, which are history — but UNCLAIMED is current state and was already read
      // straight from the pool a few lines above. So the history is reported as unknown
      // and the balance is reported as what it is.
      community: {
        usd: addLedgers(weeklyLedger?.community, monthlyLedger?.community),
        mic: communityMicLedger ?? {
          accumulated: null, claimed: null, unclaimed: mining?.claimable ?? '0',
        },
        micHistoryKnown: communityMicLedger !== null,
      },
      mfp: {
        usd: addLedgers(weeklyLedger?.mfp, monthlyLedger?.mfp),
        mic: mfpMicLedger ?? {
          accumulated: null, claimed: null, unclaimed: mfpMining?.claimable ?? '0',
        },
        micHistoryKnown: mfpMicLedger !== null,
      },
      usdSplitReliable,
      // Where each Claim button must send its transaction.
      pools: {
        usdWeekly: live(A.NFTRewardPoolWeekly) ? A.NFTRewardPoolWeekly : null,
        usdMonthly: live(A.NFTRewardPoolMonthly) ? A.NFTRewardPoolMonthly : null,
        communityMic: live(A.CommunityNFTRewardPool) ? A.CommunityNFTRewardPool : null,
        mfpMic: live(A.MFPRewardPool) ? A.MFPRewardPool : null,
      },
    }

    let luckyDraw: { address: string; claimable: string; prizePool: string | null; currency: string } | null = null
    if (live(A.LuckyDraw)) {
      try {
        const c = new ethers.Contract(A.LuckyDraw, drawAbi, p)
        // `claimable` is this wallet's share; the page also shows the week's prize pool,
        // which is simply what the contract holds. Without it the pool rendered as "-"
        // while $1.25 sat in the contract.
        const balAbi = ['function currentBalance() view returns (uint256)']
        const pool = await new ethers.Contract(A.LuckyDraw, balAbi, p).currentBalance().catch(() => null)
        luckyDraw = {
          address: A.LuckyDraw,
          claimable: fmt(await c.claimable(wallet)),
          prizePool: pool === null ? null : fmt(pool),
          currency: 'USDT',
        }
      } catch { /* the draw contract predates this getter on some deploys */ }
    }

    const totalUsdt =
      Number(weekly?.claimable ?? 0) +
      Number(monthly?.claimable ?? 0) +
      Number(luckyDraw?.claimable ?? 0)
    const totalMic = Number(mining?.claimable ?? 0) + Number(mfpMining?.claimable ?? 0)

    return {
      data: {
        wallet,
        weekly,
        monthly,
        mining,
        mfpMining,
        luckyDraw,
        ledgers,
        totals: { usdt: totalUsdt.toFixed(6), mic: totalMic.toFixed(6) },
        // Stated so the UI never has to guess why a figure is zero.
        note:
          totalUsdt === 0 && totalMic === 0
            ? 'Nothing is claimable yet. Weekly and monthly rewards become claimable once the period closes and the pool is credited; mining rewards accrue every second you hold an active NFT.'
            : null,
      },
    }
  })

  // ─── GET /nft/enrollable?wallet=0x… ────────────────────────────────
  /**
   * Which of this wallet's NFTs are earning, and which are not yet.
   *
   * Holding the NFT is not enough. NftRewardPoolV2 pays by `weightOf[holder]`, and that
   * only becomes non-zero once `enroll(tokenId)` has been called — the pool cannot observe
   * a mint or a transfer on its own. A wallet can therefore sit on funded NFTs earning
   * exactly nothing, which is what happened here: the Community pool held 16.99 MIC
   * streaming to a single enrolled holder while others saw zero and assumed a bug.
   */
  app.get('/enrollable', async (req, reply) => {
    const { wallet } = req.query as { wallet?: string }
    if (!wallet) return reply.status(400).send({ error: 'MISSING_WALLET' })
    const who = wallet   // narrowed once, so the closures below do not each re-check it

    const { ethers } = await import('ethers')
    const { getActiveAddresses } = await import('@missionchain/sdk')
    const A = getActiveAddresses() as Record<string, string>
    const ZERO = '0x0000000000000000000000000000000000000000'
    const live = (a?: string) => !!a && a !== ZERO
    const p = buildProvider()

    const POOL_ABI = [
      'function nft() view returns (address)',
      'function tokenWeight(uint256) view returns (uint256)',
      'function tokenHolder(uint256) view returns (address)',
    ]
    // MFPNFT is ERC721Enumerable; CommunityNFTv2 is not, so its ids are found by scanning
    // ownerOf across a supply that is small and capped. Scanning an unbounded collection
    // would not be acceptable — this one is.
    const NFT_ABI = [
      'function balanceOf(address) view returns (uint256)',
      'function totalSupply() view returns (uint256)',
      'function ownerOf(uint256) view returns (address)',
      'function tokenOfOwnerByIndex(address,uint256) view returns (uint256)',
    ]

    async function idsOwnedBy(nftAddr: string): Promise<number[]> {
      // `pool.nft()` may be a read-only shim rather than the collection itself. MFPNftAdapter
      // supplies the tier, multiplier and expiry that NftRewardPoolV2 demands and MFPNFT does
      // not have — but it forwards only `ownerOf`, so enumerating against it returns nothing
      // and every holder reads as owning zero. Unwrap it to the real collection first.
      let addr = nftAddr
      const under = await new ethers.Contract(addr, ['function mfp() view returns (address)'], p)
        .mfp().catch(() => null)
      if (under && under !== ZERO) addr = under

      const c = new ethers.Contract(addr, NFT_ABI, p)
      const bal = Number(await c.balanceOf(who).catch(() => 0n))
      if (bal === 0) return []
      const out: number[] = []
      // Enumerable path first — one call per token, no scan.
      try {
        for (let i = 0; i < bal; i++) out.push(Number(await c.tokenOfOwnerByIndex(who, i)))
        return out
      } catch { /* not enumerable — fall through */ }
      const supply = Number(await c.totalSupply().catch(() => 0n))
      const SCAN_CAP = 2_500          // MFP hard cap; Community is smaller still
      for (let id = 1; id <= Math.min(supply, SCAN_CAP) && out.length < bal; id++) {
        try {
          if ((await c.ownerOf(id)).toLowerCase() === who.toLowerCase()) out.push(id)
        } catch { /* burned or never minted */ }
      }
      return out
    }

    async function readPool(poolAddr?: string, label = '') {
      if (!live(poolAddr)) return { pool: null, nft: null, wired: false, reason: 'pool not deployed', tokens: [] }
      const pool = new ethers.Contract(poolAddr!, POOL_ABI, p)
      const nftAddr: string = await pool.nft().catch(() => ZERO)
      if (!live(nftAddr)) {
        // NOT a misconfiguration. NftRewardPoolV2 has two modes, and its constructor accepts
        // either: an NFT pool with tiers and expiries, where holders call enroll(), or a
        // FLAT-WEIGHT pool with no NFT set, where an operator calls setWeight(holder, passes).
        // `setWeight` even refuses to run once an NFT is set. The MFP pool is deliberately
        // the second kind — Mission Founding Passes are undifferentiated and never expire —
        // so there is no enrolment for a holder to perform, and offering one would be wrong.
        const flat = await new ethers.Contract(poolAddr!, ['function flatWeight() view returns (uint256)'], p)
          .flatWeight().catch(() => 0n)
        return {
          pool: poolAddr, nft: null, wired: false,
          mode: flat > 0n ? 'flat-weight' : 'unconfigured',
          flatWeight: flat.toString(),
          reason: flat > 0n
            ? 'flat-weight pool — weight is assigned by the operator, not enrolled by holders'
            : 'reward pool has neither an NFT contract nor a flat weight',
          tokens: [],
        }
      }
      const ids = await idsOwnedBy(nftAddr)
      const tokens = await Promise.all(ids.map(async (id) => {
        const w = await pool.tokenWeight(id).catch(() => 0n)
        const holder = w > 0n ? await pool.tokenHolder(id).catch(() => ZERO) : ZERO
        return {
          id,
          enrolled: w > 0n,
          // Enrolled to a previous owner: the weight is still credited to them until
          // someone calls resync. The buyer needs to be told, not left wondering.
          staleHolder: w > 0n && holder.toLowerCase() !== who.toLowerCase(),
        }
      }))
      return { pool: poolAddr, nft: nftAddr, wired: true, reason: null, tokens }
    }

    try {
      const [community, mfp] = await Promise.all([
        readPool(A.CommunityNFTRewardPool, 'community'),
        readPool(A.MFPRewardPool, 'mfp'),
      ])
      const shape = (r: any) => ({
        ...r,
        owned: r.tokens.length,
        enrolled: r.tokens.filter((t: any) => t.enrolled && !t.staleHolder).length,
        enrollable: r.tokens.filter((t: any) => !t.enrolled).map((t: any) => t.id),
        needsResync: r.tokens.filter((t: any) => t.staleHolder).map((t: any) => t.id),
      })
      return { data: { wallet, community: shape(community), mfp: shape(mfp) } }
    } catch (err: any) {
      app.log.error({ err: err?.message, stack: err?.stack }, '[nft/enrollable] failed')
      return reply.status(500).send({ error: 'READ_FAILED' })
    }
  })

}

