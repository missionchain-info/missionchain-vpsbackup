import { FastifyPluginAsync } from 'fastify'

// ─── GV Rank Thresholds ───────────────────────────────────────────────────

const GV_RANKS = [
  { name: 'Believer', threshold: 0, rate: 0 },
  { name: 'Builder', threshold: 5_000, rate: 3 },
  { name: 'Connector', threshold: 20_000, rate: 5 },
  { name: 'Champion', threshold: 50_000, rate: 7 },
  { name: 'Ambassador', threshold: 150_000, rate: 8 },
  { name: 'Legend', threshold: 500_000, rate: 9 },
] as const

/** Determine GV rank from total volume (USDT) */
function getGVRank(totalGV: number): typeof GV_RANKS[number] {
  let rank: typeof GV_RANKS[number] = GV_RANKS[0]
  for (const r of GV_RANKS) {
    if (totalGV >= r.threshold) rank = r
  }
  return rank
}

export const referralRoutes: FastifyPluginAsync = async (app) => {
  // ─── GET /referral/info — Referral tree info (auth) ────────────
  app.get('/info', {
    preHandler: [app.authenticate],
  }, async (req, reply) => {
    const { wallet: authWallet } = req.user as { wallet: string }
    const { wallet } = req.query as { wallet?: string }

    const targetWallet = (wallet ?? authWallet).toLowerCase()
    const { role } = req.user as { role: string }
    if (targetWallet !== authWallet && role !== 'ADMIN') {
      return reply.status(403).send({ error: 'FORBIDDEN', message: 'Cannot view other users referral data' })
    }

    const user = await app.prisma.user.findUnique({
      where: { wallet: targetWallet },
      select: { wallet: true, referrer: true, gvRank: true, totalGV: true },
    })

    if (!user) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'User not found' })
    }

    // F1 count (direct referrals)
    const f1Count = await app.prisma.user.count({
      where: { referrer: targetWallet },
    })

    // F2 count (referrals of referrals)
    const f1Wallets = await app.prisma.user.findMany({
      where: { referrer: targetWallet },
      select: { wallet: true },
    })
    const f2Count = f1Wallets.length > 0
      ? await app.prisma.user.count({
          where: { referrer: { in: f1Wallets.map((f) => f.wallet) } },
        })
      : 0

    // Total referral earnings (F1 + F2 commissions)
    const commissions = await app.prisma.rewardClaim.aggregate({
      where: {
        wallet: targetWallet,
        type: 'REFERRAL_RESERVE',
      },
      _sum: { amount: true },
    })

    return {
      data: {
        wallet: targetWallet,
        referrer: user.referrer,
        f1Count,
        f2Count,
        totalEarned: (commissions._sum.amount ?? 0).toString(),
        gvRank: user.gvRank,
        totalGV: user.totalGV.toString(),
        referralRates: { f1: 7, f2: 3, unit: 'pct of USDT' },
        appliesTo: ['PRESALE', 'MICE'],
      },
    }
  })

  // ─── GET /referral/commissions — Commission history (auth) ─────
  app.get('/commissions', {
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
      return reply.status(403).send({ error: 'FORBIDDEN', message: 'Cannot view other users commissions' })
    }

    const page = Math.max(1, parseInt(pageStr ?? '1', 10) || 1)
    const limit = Math.min(100, Math.max(1, parseInt(limitStr ?? '20', 10) || 20))
    const skip = (page - 1) * limit

    const [claims, total] = await Promise.all([
      app.prisma.rewardClaim.findMany({
        where: {
          wallet: targetWallet,
          type: 'REFERRAL_RESERVE',
        },
        orderBy: { claimedAt: 'desc' },
        skip,
        take: limit,
      }),
      app.prisma.rewardClaim.count({
        where: { wallet: targetWallet, type: 'REFERRAL_RESERVE' },
      }),
    ])

    return {
      data: claims.map((c) => ({
        ...c,
        amount: c.amount.toString(),
      })),
      pagination: { page, limit, total },
    }
  })

  // ─── GET /referral/gv — Group Volume data (auth) ───────────────
  app.get('/gv', {
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
      return reply.status(403).send({ error: 'FORBIDDEN', message: 'Cannot view other users GV data' })
    }

    const user = await app.prisma.user.findUnique({
      where: { wallet: targetWallet },
      select: { totalGV: true, gvRank: true },
    })

    if (!user) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'User not found' })
    }

    const totalGV = Number(user.totalGV)
    const rank = getGVRank(totalGV)

    // Next rank
    const currentIdx = GV_RANKS.findIndex((r) => r.name === rank.name)
    const nextRank = currentIdx < GV_RANKS.length - 1 ? GV_RANKS[currentIdx + 1] : null

    // GV history
    const page = Math.max(1, parseInt(pageStr ?? '1', 10) || 1)
    const limit = Math.min(100, Math.max(1, parseInt(limitStr ?? '20', 10) || 20))
    const skip = (page - 1) * limit

    const [gvHistory, total] = await Promise.all([
      app.prisma.groupVolume.findMany({
        where: { wallet: targetWallet },
        orderBy: { period: 'desc' },
        skip,
        take: limit,
      }),
      app.prisma.groupVolume.count({ where: { wallet: targetWallet } }),
    ])

    return {
      data: {
        wallet: targetWallet,
        totalGV: totalGV.toFixed(2),
        rank: rank.name,
        bonusRate: rank.rate,
        bonusRateFormatted: `${rank.rate}% on GV`,
        nextRank: nextRank
          ? {
              name: nextRank.name,
              threshold: nextRank.threshold,
              rate: nextRank.rate,
              remaining: Math.max(0, nextRank.threshold - totalGV).toFixed(2),
            }
          : null,
        history: gvHistory.map((g) => ({
          ...g,
          totalVolume: g.totalVolume.toString(),
          bonusPaid: g.bonusPaid.toString(),
        })),
      },
      ranks: GV_RANKS,
      pagination: { page, limit, total },
    }
  })

  // ─── GET /referral/network — Network tree (auth) ───────────────
  app.get('/network', {
    preHandler: [app.authenticate],
  }, async (req, reply) => {
    const { wallet: authWallet } = req.user as { wallet: string }
    const { wallet } = req.query as { wallet?: string }

    const targetWallet = (wallet ?? authWallet).toLowerCase()
    const { role } = req.user as { role: string }
    if (targetWallet !== authWallet && role !== 'ADMIN') {
      return reply.status(403).send({ error: 'FORBIDDEN', message: 'Cannot view other users network' })
    }

    // F1 list with their data
    const f1Users = await app.prisma.user.findMany({
      where: { referrer: targetWallet },
      select: {
        userId: true,
        wallet: true,
        createdAt: true,
        seedPurchased: true,
        preSalePurchased: true,
        totalGV: true,
        gvRank: true,
      },
      orderBy: { createdAt: 'desc' },
    })

    // For each F1, get their F2 count and volume
    const network = await Promise.all(
      f1Users.map(async (f1) => {
        const f2Count = await app.prisma.user.count({
          where: { referrer: f1.wallet },
        })

        // Get F2 purchase volume for this F1's downline
        const f2Purchases = await app.prisma.purchase.aggregate({
          where: {
            wallet: { in: await app.prisma.user.findMany({
              where: { referrer: f1.wallet },
              select: { wallet: true },
            }).then(users => users.map(u => u.wallet)) },
            type: { in: ['PRESALE', 'MICE'] },
          },
          _sum: { usdtAmount: true },
        })

        return {
          userId: f1.userId,
          wallet: f1.wallet,
          createdAt: f1.createdAt.toISOString(),
          seedPurchased: f1.seedPurchased,
          preSalePurchased: f1.preSalePurchased,
          totalGV: f1.totalGV.toString(),
          gvRank: f1.gvRank,
          f2Count,
          f2Volume: (f2Purchases._sum.usdtAmount ?? 0).toString(),
        }
      }),
    )

    return {
      data: {
        wallet: targetWallet,
        f1Count: network.length,
        network,
      },
    }
  })
}
