import { FastifyPluginAsync } from 'fastify'

// ─── Emission constants ───────────────────────────────────────────────────
//
// What stood here simulated EmissionControllerV1 from constants that were already wrong:
// E0_DAILY 22,907,500 was recalibrated to 750,000 on 2026-08-05, and HALF_LIFE_DAYS was
// 180 against the contract's 2,922. It then reported `dailyEmission: 0` while the chain
// was issuing 339 MIC/day, and `daysSinceLaunch: 20685` — fifty-six years.
//
// EmissionControllerV2 has no base rate, no decay curve and no factors. Every active
// licence earns a flat rate; issuance is that rate times the number of miners. These
// endpoints therefore read the chain instead of modelling a machine that no longer exists.

const MINING_POOL = 5_950_000_000
const MAX_MICE = 100_000
const TERM_DAYS = 360

export const miningRoutes: FastifyPluginAsync = async (app) => {
  // ─── GET /mining/info — Global mining stats ────────────────────
  // ─── GET /mining/info — emission state, read from the chain ────
  app.get('/info', async (req, reply) => {
    const bc = app.blockchain
    try {
      const { formatUnits } = await import('ethers')
      const ec = bc.emissionController
      const [emitted, daily, rate, minerBps, damper, remaining, active] = await Promise.all([
        ec.totalEmitted() as Promise<bigint>,
        ec.dailyEmission() as Promise<bigint>,
        ec.micPerLicencePerDay() as Promise<bigint>,
        ec.currentMinerBps() as Promise<bigint>,
        ec.damperBps() as Promise<bigint>,
        bc.micToken.remainingMiningPool() as Promise<bigint>,
        ec.activeLicences() as Promise<bigint>,
      ])

      const n = Number(active)
      const num = (v: bigint) => Number(formatUnits(v, 18))
      const perLicence = num(rate)

      return {
        data: {
          formula: 'E = N x r / minerShare x damper',
          activeLicences: n,
          maxMice: MAX_MICE,
          micPerLicencePerDay: perLicence.toFixed(4),
          minerSharePct: Number(minerBps) / 100,
          damper: Number(damper) / 10_000,
          dailyEmission: num(daily).toFixed(4),
          totalEmitted: num(emitted).toFixed(4),
          miningPool: MINING_POOL,
          poolRemaining: num(remaining).toFixed(0),
          poolUsedPct: ((num(emitted) / MINING_POOL) * 100).toFixed(6),
          // What one licence is worth over its whole term, which is also the ceiling on
          // what it can ever earn — V2 has no separate lifetime cap.
          perLicenceLifetime: (perLicence * TERM_DAYS).toFixed(0),
          termDays: TERM_DAYS,
        },
      }
    } catch (err: any) {
      app.log.error({ err: err?.message, stack: err?.stack }, '[mining/info] failed')
      return reply.status(503).send({ error: 'CHAIN_READ_FAILED', message: err?.shortMessage || err?.message })
    }
  })

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
  // ─── GET /mining/emission — issuance projection ────────────────
  /**
   * V1 served an exponential decay curve off E_base and a half-life. V2 has neither: what
   * is issued on a day is decided by how many licences are mining that day, and a licence
   * earns a flat rate for its own 360-day term and then stops. So the honest projection is
   * a function of the miner count, not of the calendar.
   */
  app.get('/emission', async (req, reply) => {
    const { licences: lStr } = req.query as { licences?: string }
    const bc = app.blockchain
    try {
      const { formatUnits } = await import('ethers')
      const ec = bc.emissionController
      const [rate, minerBps, activeRaw] = await Promise.all([
        ec.micPerLicencePerDay() as Promise<bigint>,
        ec.currentMinerBps() as Promise<bigint>,
        ec.activeLicences() as Promise<bigint>,
      ])

      const perLicence = Number(formatUnits(rate, 18))
      const minerShare = Number(minerBps) / 10_000
      const active = Number(activeRaw)
      const asked = lStr ? Math.min(MAX_MICE, Math.max(0, parseInt(lStr, 10) || 0)) : active

      // `share` defaults to what is running now, but a full-adoption projection must use
      // the STEADY-STATE share: the 90-day Early Staking Boost inflates issuance, and
      // projecting it across 360 days reported 6.08B against a 5.95B pool — a breach that
      // does not exist. At 59% the same projection is 5.08B.
      const steadyShare = Number(await ec.minersBps()) / 10_000
      const project = (n: number, share = minerShare) => {
        const toMiners = n * perLicence
        const issued = share > 0 ? toMiners / share : 0
        return {
          licences: n,
          toMinersPerDay: toMiners.toFixed(4),
          issuedPerDay: issued.toFixed(4),
          overFullTerm: (issued * TERM_DAYS).toFixed(0),
          fitsPool: issued * TERM_DAYS <= MINING_POOL,
        }
      }

      return {
        data: {
          basis: 'E = N x r / minerShare — no decay curve, no base rate',
          micPerLicencePerDay: perLicence.toFixed(4),
          minerSharePct: minerShare * 100,
          now: project(active),
          requested: project(asked),
          // The scale the design is sized for, so the pool constraint is checkable.
          atFullAdoption: { ...project(MAX_MICE, steadyShare), basis: 'steady-state miner share, boost expired' },
          miningPool: MINING_POOL,
        },
      }
    } catch (err: any) {
      app.log.error({ err: err?.message, stack: err?.stack }, '[mining/emission] failed')
      return reply.status(503).send({ error: 'CHAIN_READ_FAILED', message: err?.shortMessage || err?.message })
    }
  })
}
