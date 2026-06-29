import { FastifyPluginAsync } from 'fastify'

// ─── Pure MIC Staking Rules ────────────────────────────────────────────────

const LOCK_PERIODS = [
  { days: 30, multiplier: 1.0 },
  { days: 90, multiplier: 1.25 },
  { days: 180, multiplier: 1.5 },
  { days: 360, multiplier: 2.0 },
] as const

export const stakingRoutes: FastifyPluginAsync = async (app) => {
  // ─── GET /staking/info — Global staking stats ──────────────────
  app.get('/info', async (req, reply) => {
    const stats = await app.prisma.stakingPosition.aggregate({
      where: { active: true },
      _sum: { amount: true, weightedAmount: true },
      _count: true,
    })

    const totalStaked = Number(stats._sum.amount ?? 0)
    const totalWeighted = Number(stats._sum.weightedAmount ?? 0)

    // APY estimate: based on emission split (20% to staking) and total weighted
    // This is a simplified placeholder — real APY comes from EmissionController
    const stakingEmissionPct = 20
    const dailyEmissionBase = 22_907_500 // E0
    const stakingDailyEmission = dailyEmissionBase * (stakingEmissionPct / 100)
    const apyEstimate = totalStaked > 0
      ? ((stakingDailyEmission * 365) / totalStaked) * 100
      : 0

    return {
      data: {
        totalStaked: totalStaked.toFixed(0),
        totalWeightedStaked: totalWeighted.toFixed(0),
        activePositions: stats._count,
        stakingEmissionPct,
        estimatedAPY: Math.min(apyEstimate, 999).toFixed(2), // cap display at 999%
      },
    }
  })

  // ─── GET /staking/positions — User staking positions (auth) ────
  app.get('/positions', {
    preHandler: [app.authenticate],
  }, async (req, reply) => {
    const { wallet: authWallet } = req.user as { wallet: string }
    const { wallet, page: pageStr, limit: limitStr } = req.query as {
      wallet?: string
      page?: string
      limit?: string
    }

    const targetWallet = (wallet ?? authWallet).toLowerCase()
    const { role } = req.user as { role: string }
    if (targetWallet !== authWallet && role !== 'ADMIN') {
      return reply.status(403).send({ error: 'FORBIDDEN', message: 'Cannot view other users positions' })
    }

    const page = Math.max(1, parseInt(pageStr ?? '1', 10) || 1)
    const limit = Math.min(100, Math.max(1, parseInt(limitStr ?? '20', 10) || 20))
    const skip = (page - 1) * limit

    const [positions, total] = await Promise.all([
      app.prisma.stakingPosition.findMany({
        where: { wallet: targetWallet },
        orderBy: { stakeTime: 'desc' },
        skip,
        take: limit,
      }),
      app.prisma.stakingPosition.count({ where: { wallet: targetWallet } }),
    ])

    return {
      data: positions.map((p) => ({
        ...p,
        amount: p.amount.toString(),
        weightedAmount: p.weightedAmount.toString(),
      })),
      pagination: { page, limit, total },
    }
  })

  // ─── GET /staking/tiers — Tier info ────────────────────────────
  app.get('/tiers', async (req, reply) => {
    return {
      data: {
        model: 'PURE_MIC_STAKING',
        lockPeriods: LOCK_PERIODS,
        stakingRules: {
          nftAffectsStaking: false,
          caps: 'No staking cap',
          weighting: 'Stake amount × time-lock multiplier',
          rewardPool: '20% of daily emission',
        },
        daoRequirement: {
          nft: 'MFP-NFT',
          minStake: 100_000,
          minLockDays: 360,
          description: 'MFP-NFT + at least 100,000 MIC staked + lock >= 360 days remaining',
        },
      },
    }
  })

  // ─── GET /staking/rewards/:stakeId — Pending reward (auth) ─────
  app.get('/rewards/:stakeId', {
    preHandler: [app.authenticate],
  }, async (req, reply) => {
    const { stakeId } = req.params as { stakeId: string }
    const { wallet } = req.user as { wallet: string }

    const stakeIdNum = parseInt(stakeId, 10)
    if (isNaN(stakeIdNum)) {
      return reply.status(400).send({ error: 'BAD_REQUEST', message: 'Invalid stakeId' })
    }

    const position = await app.prisma.stakingPosition.findFirst({
      where: { stakeId: stakeIdNum, wallet },
    })

    if (!position) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'Staking position not found' })
    }

    // Pending reward calculation is on-chain via NFTStaking.pendingReward()
    // Here we return position data; the frontend can also call contract directly
    const now = new Date()
    const isLocked = now < position.unlockTime
    const daysRemaining = isLocked
      ? Math.ceil((position.unlockTime.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
      : 0

    return {
      data: {
        stakeId: position.stakeId,
        amount: position.amount.toString(),
        weightedAmount: position.weightedAmount.toString(),
        tier: position.tier,
        lockPeriod: position.lockPeriod,
        stakeTime: position.stakeTime.toISOString(),
        unlockTime: position.unlockTime.toISOString(),
        isLocked,
        daysRemaining,
        active: position.active,
        // pendingReward should be fetched from on-chain via blockchain service
        pendingRewardNote: 'Query NFTStaking.pendingReward() on-chain for real-time value (pure MIC staking; NFTs do not change staking weight)',
      },
    }
  })
}
