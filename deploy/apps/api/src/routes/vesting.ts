import { FastifyPluginAsync } from 'fastify'
import { ethers } from 'ethers'

// ─── Vesting Schedule Parameters ──────────────────────────────────────────

const VESTING_PARAMS: Record<string, {
  cliffMonths: number
  initialUnlockPct: number
  monthlyUnlockPct: number
}> = {
  SEED:      { cliffMonths: 6,  initialUnlockPct: 10,  monthlyUnlockPct: 2.5 },
  PRESALE:   { cliffMonths: 6,  initialUnlockPct: 10,  monthlyUnlockPct: 2.5 },
  AIRDROP:   { cliffMonths: 6,  initialUnlockPct: 10,  monthlyUnlockPct: 2.5 },
  FOUNDERS:  { cliffMonths: 24, initialUnlockPct: 10,  monthlyUnlockPct: 2.5 },
  COMMUNITY: { cliffMonths: 24, initialUnlockPct: 10,  monthlyUnlockPct: 2.5 },
}

// ─── On-chain fallback: LockManager ABI (minimal) ────────────────────────

const LOCK_MANAGER_ABI = [
  'function lockedOf(address account) external view returns (uint256)',
  'function availableOf(address account) external view returns (uint256)',
  'function getSchedules(address account) external view returns (tuple(uint256 totalAmount, uint256 startTime, uint256 cliffDuration, uint256 cliffUnlockBps, uint256 monthlyUnlockBps)[])',
  'function scheduleCount(address account) external view returns (uint256)',
]

const MIC_TOKEN_ABI = [
  'function balanceOf(address account) external view returns (uint256)',
  'function lockedBalanceOf(address account) external view returns (uint256)',
  'function availableBalanceOf(address account) external view returns (uint256)',
]

/**
 * Calculate unlocked amount for a given vesting schedule at current time.
 * Uses Hybrid Token-Level Lock model (tokens in wallet, locked via LockManager).
 */
function calculateUnlocked(
  totalAmount: number,
  startTime: Date,
  cliffMonths: number,
  initialUnlockBps: number,  // 1000 = 10%
  monthlyUnlockBps: number,  // 250 = 2.5%
  now: Date = new Date(),
): { unlocked: number; locked: number; nextUnlockDate: Date | null; nextUnlockAmount: number } {
  const startMs = startTime.getTime()
  const nowMs = now.getTime()
  const monthMs = 30 * 24 * 60 * 60 * 1000 // ~30 days

  const cliffEnd = startMs + cliffMonths * monthMs

  if (nowMs < cliffEnd) {
    // Before cliff — nothing unlocked
    return {
      unlocked: 0,
      locked: totalAmount,
      nextUnlockDate: new Date(cliffEnd),
      nextUnlockAmount: totalAmount * (initialUnlockBps / 10000),
    }
  }

  // Initial cliff unlock
  let unlocked = totalAmount * (initialUnlockBps / 10000)

  // Months elapsed since cliff
  const monthsSinceCliff = Math.floor((nowMs - cliffEnd) / monthMs)
  const monthlyUnlock = totalAmount * (monthlyUnlockBps / 10000)
  unlocked += monthsSinceCliff * monthlyUnlock

  // Cap at total
  unlocked = Math.min(unlocked, totalAmount)
  const locked = Math.max(0, totalAmount - unlocked)

  // Next unlock date
  let nextUnlockDate: Date | null = null
  let nextUnlockAmount = 0
  if (unlocked < totalAmount) {
    const nextMonth = monthsSinceCliff + 1
    nextUnlockDate = new Date(cliffEnd + nextMonth * monthMs)
    nextUnlockAmount = Math.min(monthlyUnlock, locked)
  }

  return { unlocked, locked, nextUnlockDate, nextUnlockAmount }
}

/**
 * Fetch on-chain vesting data as fallback when DB is stale or empty.
 * Returns null if on-chain call fails (graceful degradation).
 */
async function fetchOnChainVesting(
  wallet: string,
  lockManagerAddress: string,
  micTokenAddress: string,
  rpcUrl: string,
) {
  try {
    const provider = new ethers.JsonRpcProvider(rpcUrl)
    const lockManager = new ethers.Contract(lockManagerAddress, LOCK_MANAGER_ABI, provider)
    const micToken = new ethers.Contract(micTokenAddress, MIC_TOKEN_ABI, provider)

    const [schedules, lockedTotal, availableTotal, walletBalance] = await Promise.all([
      lockManager.getSchedules(wallet),
      lockManager.lockedOf(wallet),
      lockManager.availableOf(wallet),
      micToken.balanceOf(wallet),
    ])

    return { schedules, lockedTotal, availableTotal, walletBalance }
  } catch (err) {
    // Graceful fallback — log but don't throw
    console.warn('[vesting] On-chain fallback failed:', (err as Error).message)
    return null
  }
}

export const vestingRoutes: FastifyPluginAsync = async (app) => {
  // ─── GET /vesting/overview — Vesting dashboard summary ─────────
  app.get('/overview', async () => {
    return {
      totalLocked: '0',
      totalUnlocked: '0',
      nextUnlock: null,
      schedules: [],
    }
  })

  // ─── GET /vesting/schedules — User vesting schedules (auth) ────
  app.get('/schedules', {
    preHandler: [app.authenticate],
  }, async (req, reply) => {
    const { wallet: authWallet } = req.user as { wallet: string }
    const { wallet } = req.query as { wallet?: string }

    const targetWallet = (wallet ?? authWallet).toLowerCase()
    const { role } = req.user as { role: string }
    if (targetWallet !== authWallet && role !== 'ADMIN') {
      return reply.status(403).send({ error: 'FORBIDDEN', message: 'Cannot view other users vesting' })
    }

    // 1. Try DB first
    const schedules = await app.prisma.vestingSchedule.findMany({
      where: { wallet: targetWallet },
      orderBy: { startTime: 'asc' },
    })

    const now = new Date()

    if (schedules.length > 0) {
      // DB has data — use it (enriched with source/category)
      const result = schedules.map((s) => {
        const totalAmount = Number(s.totalAmount)
        const calc = calculateUnlocked(
          totalAmount,
          s.startTime,
          s.cliffMonths,
          s.initialUnlockBps,
          s.monthlyUnlockBps,
          now,
        )

        return {
          id: s.id,
          source: s.source,
          totalAmount: totalAmount.toFixed(0),
          unlocked: calc.unlocked.toFixed(0),
          locked: calc.locked.toFixed(0),
          unlockedPct: totalAmount > 0 ? ((calc.unlocked / totalAmount) * 100).toFixed(2) : '0',
          cliffMonths: s.cliffMonths,
          initialUnlockPct: s.initialUnlockBps / 100,
          monthlyUnlockPct: s.monthlyUnlockBps / 100,
          startTime: s.startTime.toISOString(),
          nextUnlockDate: calc.nextUnlockDate?.toISOString() ?? null,
          nextUnlockAmount: calc.nextUnlockAmount.toFixed(0),
        }
      })

      return { data: result, source: 'db' }
    }

    // 2. DB empty → fallback to on-chain LockManager.getSchedules()
    const lockManagerAddress = process.env.LOCK_MANAGER_ADDRESS
    const micTokenAddress = process.env.MIC_TOKEN_ADDRESS
    const rpcUrl = process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org'

    if (!lockManagerAddress || !micTokenAddress) {
      return { data: [], source: 'db', message: 'No schedules found' }
    }

    const onChain = await fetchOnChainVesting(targetWallet, lockManagerAddress, micTokenAddress, rpcUrl)
    if (!onChain || onChain.schedules.length === 0) {
      return { data: [], source: 'onchain', message: 'No schedules found' }
    }

    const MONTH_SECONDS = 30 * 24 * 60 * 60

    const result = onChain.schedules.map((s: any, index: number) => {
      const totalAmount = Number(ethers.formatEther(s.totalAmount))
      const startTime = Number(s.startTime)
      const cliffDuration = Number(s.cliffDuration)
      const cliffUnlockBps = Number(s.cliffUnlockBps)
      const monthlyUnlockBps = Number(s.monthlyUnlockBps)
      const cliffMonths = Math.round(cliffDuration / MONTH_SECONDS)

      const calc = calculateUnlocked(
        totalAmount,
        new Date(startTime * 1000),
        cliffMonths,
        cliffUnlockBps,
        monthlyUnlockBps,
        now,
      )

      // Detect category from parameters
      let source = 'UNKNOWN'
      if (cliffMonths === 24 && monthlyUnlockBps === 25) source = 'COMMUNITY'
      else if (cliffMonths === 24) source = 'FOUNDERS'
      else if (cliffMonths === 6) source = 'PRESALE' // Could be SEED or AIRDROP too

      return {
        id: `onchain-${index}`,
        source,
        totalAmount: totalAmount.toFixed(0),
        unlocked: calc.unlocked.toFixed(0),
        locked: calc.locked.toFixed(0),
        unlockedPct: totalAmount > 0 ? ((calc.unlocked / totalAmount) * 100).toFixed(2) : '0',
        cliffMonths,
        initialUnlockPct: cliffUnlockBps / 100,
        monthlyUnlockPct: monthlyUnlockBps / 100,
        startTime: new Date(startTime * 1000).toISOString(),
        nextUnlockDate: calc.nextUnlockDate?.toISOString() ?? null,
        nextUnlockAmount: calc.nextUnlockAmount.toFixed(0),
      }
    })

    return { data: result, source: 'onchain' }
  })

  // ─── GET /vesting/summary — Aggregated vesting summary (auth) ──
  app.get('/summary', {
    preHandler: [app.authenticate],
  }, async (req, reply) => {
    const { wallet: authWallet } = req.user as { wallet: string }
    const { wallet } = req.query as { wallet?: string }

    const targetWallet = (wallet ?? authWallet).toLowerCase()
    const { role } = req.user as { role: string }
    if (targetWallet !== authWallet && role !== 'ADMIN') {
      return reply.status(403).send({ error: 'FORBIDDEN', message: 'Cannot view other users vesting' })
    }

    const schedules = await app.prisma.vestingSchedule.findMany({
      where: { wallet: targetWallet },
    })

    const now = new Date()
    let totalLocked = 0
    let totalUnlocked = 0
    let totalAmount = 0
    let earliestNextUnlock: Date | null = null
    let nextUnlockAmount = 0

    if (schedules.length > 0) {
      // Use DB data
      for (const s of schedules) {
        const amt = Number(s.totalAmount)
        totalAmount += amt

        const calc = calculateUnlocked(
          amt,
          s.startTime,
          s.cliffMonths,
          s.initialUnlockBps,
          s.monthlyUnlockBps,
          now,
        )

        totalUnlocked += calc.unlocked
        totalLocked += calc.locked

        if (calc.nextUnlockDate) {
          if (!earliestNextUnlock || calc.nextUnlockDate < earliestNextUnlock) {
            earliestNextUnlock = calc.nextUnlockDate
            nextUnlockAmount = calc.nextUnlockAmount
          }
        }
      }
    } else {
      // Fallback: on-chain LockManager
      const lockManagerAddress = process.env.LOCK_MANAGER_ADDRESS
      const micTokenAddress = process.env.MIC_TOKEN_ADDRESS
      const rpcUrl = process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org'

      if (lockManagerAddress && micTokenAddress) {
        const onChain = await fetchOnChainVesting(targetWallet, lockManagerAddress, micTokenAddress, rpcUrl)
        if (onChain) {
          totalLocked = Number(ethers.formatEther(onChain.lockedTotal))
          totalUnlocked = Number(ethers.formatEther(onChain.availableTotal))
          totalAmount = totalLocked + totalUnlocked
        }
      }
    }

    return {
      data: {
        wallet: targetWallet,
        totalAmount: totalAmount.toFixed(0),
        totalLocked: totalLocked.toFixed(0),
        totalUnlocked: totalUnlocked.toFixed(0),
        unlockedPct: totalAmount > 0 ? ((totalUnlocked / totalAmount) * 100).toFixed(2) : '0',
        nextUnlockDate: earliestNextUnlock?.toISOString() ?? null,
        nextUnlockAmount: nextUnlockAmount.toFixed(0),
        scheduleCount: schedules.length,
        vestingModel: 'Hybrid Token-Level Lock (tokens in wallet, locked via LockManager)',
      },
    }
  })
}
