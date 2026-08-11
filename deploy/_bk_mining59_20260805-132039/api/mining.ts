import { FastifyPluginAsync } from 'fastify'

// ─── Emission Engine Constants ────────────────────────────────────────────

const E0_DAILY = 22_907_500       // Initial daily emission (MIC)
const HALF_LIFE_DAYS = 180        // Half-life in days
const MINING_POOL = 5_950_000_000 // Total mining pool (MIC)
const WARMUP_DAYS = 30            // WarmUp period

// Emission split (BPS)
const EMISSION_SPLIT = {
  miners: 60,    // 60% to MiningPool
  staking: 25,   // 25% to Staking
  dao: 10,       // 10% to DAO Treasury
  communityNftReward: 5,    //  5% to Community NFT Reward
}

/**
 * Calculate E_base(t) = E0 * e^(-lambda*t)
 * where lambda = ln(2) / T_half
 */
function calculateEBase(daysSinceLaunch: number): number {
  const lambda = Math.LN2 / HALF_LIFE_DAYS
  return E0_DAILY * Math.exp(-lambda * daysSinceLaunch)
}

/**
 * Calculate W(t) = min(1.0, t / 30) — WarmUp factor
 */
function calculateW(daysSinceLaunch: number): number {
  return Math.min(1.0, daysSinceLaunch / WARMUP_DAYS)
}

export const miningRoutes: FastifyPluginAsync = async (app) => {
  // ─── GET /mining/info — Global mining stats ────────────────────
  app.get('/info', async (req, reply) => {
    // Count total mining rewards emitted
    const rewardStats = await app.prisma.miningReward.aggregate({
      _sum: { amount: true },
      _max: { day: true },
    })

    const totalEmitted = Number(rewardStats._sum.amount ?? 0)
    const latestDay = rewardStats._max.day ?? 0

    // Count active MICE licenses
    const activeMice = await app.prisma.purchase.count({
      where: { type: 'MICE' },
    })

    // Calculate current emission factors
    const daysSinceLaunch = latestDay > 0 ? latestDay : 0
    const eBase = calculateEBase(daysSinceLaunch)
    const W = calculateW(daysSinceLaunch)

    // D(t) and R(t) would come from on-chain; provide placeholders
    const D = activeMice > 0 ? 0.5 + (activeMice / 100_000) : 0.5
    const R = 1.0 // Default ROI regulator

    const dailyEmission = activeMice > 0 ? eBase * D * R * W : 0
    const poolRemaining = MINING_POOL - totalEmitted

    return {
      data: {
        totalEmitted: totalEmitted.toFixed(0),
        miningPool: MINING_POOL,
        poolRemaining: Math.max(0, poolRemaining).toFixed(0),
        poolUsedPct: ((totalEmitted / MINING_POOL) * 100).toFixed(4),
        dailyEmission: dailyEmission.toFixed(0),
        daysSinceLaunch,
        activeMICE: activeMice,
        factors: {
          E_base: eBase.toFixed(2),
          D: D.toFixed(4),
          R: R.toFixed(4),
          W: W.toFixed(4),
        },
        emissionSplit: EMISSION_SPLIT,
        formula: 'E(t) = E_base(t) x D(t) x R(t) x W(t)',
      },
    }
  })

  // ─── GET /mining/rewards — User mining rewards (auth) ──────────
  app.get('/rewards', {
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
      return reply.status(403).send({ error: 'FORBIDDEN', message: 'Cannot view other users rewards' })
    }

    const page = Math.max(1, parseInt(pageStr ?? '1', 10) || 1)
    const limit = Math.min(100, Math.max(1, parseInt(limitStr ?? '50', 10) || 50))
    const skip = (page - 1) * limit

    const [rewards, total] = await Promise.all([
      app.prisma.miningReward.findMany({
        where: { wallet: targetWallet },
        orderBy: { day: 'desc' },
        skip,
        take: limit,
      }),
      app.prisma.miningReward.count({ where: { wallet: targetWallet } }),
    ])

    // Aggregate totals
    const totalReward = await app.prisma.miningReward.aggregate({
      where: { wallet: targetWallet },
      _sum: { amount: true },
    })

    return {
      data: rewards.map((r) => ({
        ...r,
        amount: r.amount.toString(),
        hindex: r.hindex.toString(),
        poolShare: r.poolShare.toString(),
      })),
      summary: {
        totalEarned: (totalReward._sum.amount ?? 0).toString(),
        daysActive: total,
      },
      pagination: { page, limit, total },
    }
  })

  // ─── GET /mining/emission — Emission curve data (for charts) ───
  app.get('/emission', async (req, reply) => {
    const { days: daysStr } = req.query as { days?: string }
    const days = Math.min(1095, Math.max(1, parseInt(daysStr ?? '365', 10) || 365)) // max 3 years

    const curve: Array<{ day: number; eBase: number; cumulative: number }> = []
    let cumulative = 0

    for (let d = 0; d <= days; d++) {
      const eBase = calculateEBase(d)
      cumulative += eBase
      // Only include every Nth day to keep response size reasonable
      if (d % Math.max(1, Math.floor(days / 365)) === 0 || d === days) {
        curve.push({
          day: d,
          eBase: Math.round(eBase),
          cumulative: Math.round(Math.min(cumulative, MINING_POOL)),
        })
      }
    }

    return {
      data: {
        curve,
        parameters: {
          E0_daily: E0_DAILY,
          halfLifeDays: HALF_LIFE_DAYS,
          warmupDays: WARMUP_DAYS,
          miningPool: MINING_POOL,
        },
      },
    }
  })
}
