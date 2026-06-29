import { FastifyPluginAsync } from 'fastify'
import { readFileSync } from 'fs'
import { join } from 'path'

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
  app.get('/overview', async () => {
    const [totalMfp, builder, maker, luminary] = await Promise.all([
      app.prisma.nFTItem.count({ where: { contractType: 'MFP', active: true } }),
      app.prisma.nFTItem.count({ where: { contractType: 'COMMUNITY', tier: 'Builder', active: true } }),
      app.prisma.nFTItem.count({ where: { contractType: 'COMMUNITY', tier: 'Maker', active: true } }),
      app.prisma.nFTItem.count({ where: { contractType: 'COMMUNITY', tier: 'Luminary', active: true } }),
    ])

    return {
      totalMfp,
      maxMfp: MFP_MAX_SUPPLY,
      communityNfts: { builder, maker, luminary },
      userNfts: [],
    }
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

    return {
      totalWeightedShares: totalWeight,
      activeEntries: totalActive,
      burnedTotal: totalBurned,
      tierBreakdown,
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
        const rpcUrl = process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org/'
        const mfpAddr = process.env.MFPNFT_ADDRESS || '0xC53DfA185D29A10124a57c27eA4131c504B8097F'
        const provider = new JsonRpcProvider(rpcUrl)
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
}
