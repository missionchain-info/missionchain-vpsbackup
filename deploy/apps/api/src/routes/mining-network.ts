/**
 * GET /mining/network-stats — Live network mining statistics (PUBLIC)
 * Reads directly from on-chain contracts for real-time data.
 */
import { FastifyPluginAsync } from 'fastify'
import { formatUnits } from 'ethers'

export const miningNetworkRoutes: FastifyPluginAsync = async (app) => {

  // ─── GET /mining/network-stats — Global on-chain mining data ────
  app.get('/network-stats', async (req, reply) => {
    const bc = app.blockchain

    try {
      const [
        dailyEmissionRaw,
        totalEmittedRaw,
        deployTimeRaw,
        poolRemainingRaw,
        totalMiceMinted,
        currentRound,
        eBaseRaw,
        demandFactorRaw,
        roiFactorRaw,
        warmUpFactorRaw,
        minersBps,
        stakingBps,
        daoBps,
        communityNftBps,
        lastDistributionRaw,
        currentEpoch,
      ] = await Promise.all([
        bc.emissionController.dailyEmission().catch(() => 0n),
        bc.emissionController.totalEmitted().catch(() => 0n),
        bc.emissionController.deployTime().catch(() => 0n),
        bc.micToken.balanceOf(bc.addr.MiningPool).catch(() => 0n),
        bc.miceLicense.totalMinted().catch(() => 0n),
        bc.miceLicense.getCurrentRound().catch(() => 0n),
        bc.emissionController.eBase().catch(() => 0n),
        bc.emissionController.demandFactor().catch(() => 10000n),
        bc.emissionController.roiFactor().catch(() => 10000n),
        bc.emissionController.warmUpFactor().catch(() => 10000n),
        bc.emissionController.minersBps().catch(() => 6000n),
        bc.emissionController.stakingBps().catch(() => 2500n),
        bc.emissionController.daoBps().catch(() => 1000n),
        bc.emissionController.communityNFTBps().catch(() => 500n),
        bc.emissionController.lastDistribution().catch(() => 0n),
        bc.miningPool.currentEpoch().catch(() => 0n),
      ])

      const nowUtc = Math.floor(Date.now() / 1000)
      const deployTime = Number(deployTimeRaw)
      const daysSinceStart = deployTime > 0 ? Math.max(0, Math.floor((nowUtc - deployTime) / 86400)) : 0

      // For live counter: client needs dailyEmission + UTC midnight timestamp
      const todayMidnightUtc = Math.floor(nowUtc / 86400) * 86400
      const lastDist = Number(lastDistributionRaw)

      const dailyEmission = parseFloat(formatUnits(dailyEmissionRaw, 18))
      const totalEmitted = parseFloat(formatUnits(totalEmittedRaw, 18))

      return {
        data: {
          // Live counter data
          dailyEmission,
          dailyEmissionWei: dailyEmissionRaw.toString(),
          totalEmitted,
          todayMidnightUtc,
          serverTimestamp: nowUtc,

          // Pool stats
          poolRemaining: parseFloat(formatUnits(poolRemainingRaw, 18)),
          poolTotal: 5_950_000_000,
          daysSinceStart,

          // MICE stats
          totalMiceMinted: Number(totalMiceMinted),
          currentRound: Number(currentRound),
          maxMice: 100_000,

          // Emission factors (BPS = basis points, 10000 = 1.0)
          factors: {
            eBase: parseFloat(formatUnits(eBaseRaw, 18)),
            demandFactor: Number(demandFactorRaw) / 10000,
            roiFactor: Number(roiFactorRaw) / 10000,
            warmUpFactor: Number(warmUpFactorRaw) / 10000,
          },

          // Emission split (BPS)
          split: {
            miners: Number(minersBps) / 100,
            staking: Number(stakingBps) / 100,
            dao: Number(daoBps) / 100,
            communityNft: Number(communityNftBps) / 100,
          },

          // Epoch info
          currentEpoch: Number(currentEpoch),
          lastDistribution: lastDist,
        },
      }
    } catch (err: any) {
      app.log.error('[mining/network-stats] Error:', err.message)
      return {
        data: {
          dailyEmission: 0,
          dailyEmissionWei: '0',
          totalEmitted: 0,
          todayMidnightUtc: Math.floor(Date.now() / 86400000) * 86400,
          serverTimestamp: Math.floor(Date.now() / 1000),
          poolRemaining: 5_950_000_000,
          poolTotal: 5_950_000_000,
          daysSinceStart: 0,
          totalMiceMinted: 0,
          currentRound: 1,
          maxMice: 100_000,
          factors: { eBase: 0, demandFactor: 1, roiFactor: 1, warmUpFactor: 0 },
          split: { miners: 60, staking: 25, dao: 10, communityNft: 5 },
          currentEpoch: 0,
          lastDistribution: 0,
        },
      }
    }
  })

  // ─── GET /mining/my-mice?wallet=0x... — User's MICE + mining status ──
  app.get('/my-mice', async (req, reply) => {
    const { wallet } = req.query as { wallet?: string }
    if (!wallet) return reply.status(400).send({ error: 'MISSING_WALLET' })

    const bc = app.blockchain
    try {
      // Get user's MICE license IDs from on-chain
      const licenseIds: bigint[] = await bc.miceLicense.getUserLicenses(wallet).catch(() => [])

      // Check each license status
      const licenses = await Promise.all(
        licenseIds.map(async (id: bigint) => {
          const [active, licenseData] = await Promise.all([
            bc.miceLicense.isActive(id).catch(() => false) as Promise<boolean>,
            bc.miceLicense.licenses(id).catch(() => [wallet, 0n, 0n]) as Promise<[string, bigint, bigint]>,
          ])
          const mintTime = Number(licenseData[1])
          const expiryTime = mintTime + 360 * 86400
          const round = Number(await bc.miceLicense.getRoundForToken(id).catch(() => 0n))
          return {
            id: Number(id),
            round: round + 1,
            mintTime,
            expiryTime,
            daysLeft: Math.max(0, Math.ceil((expiryTime - Math.floor(Date.now() / 1000)) / 86400)),
            active,
            // All active MICE auto-participate in mining via oracle
            inMining: active,
          }
        })
      )

      const activeLicenses = licenses.filter(l => l.active)
      const expiredLicenses = licenses.filter(l => !l.active)

      // Get pending rewards across recent epochs
      const currentEpoch = Number(await bc.miningPool.currentEpoch().catch(() => 0n))
      let totalPending = 0
      // Check last 7 epochs for unclaimed rewards
      for (let e = Math.max(0, currentEpoch - 7); e <= currentEpoch; e++) {
        try {
          const reward = await bc.miningPool.pendingReward(e, wallet)
          const claimed = await bc.miningPool.claimed(e, wallet)
          if (!claimed) {
            totalPending += parseFloat(formatUnits(reward, 18))
          }
        } catch { /* epoch may not exist */ }
      }

      // Get total claimed from DB
      const dbRewards = await app.prisma.miningReward.aggregate({
        where: { wallet: wallet.toLowerCase() },
        _sum: { amount: true },
      })
      const totalClaimed = Number(dbRewards._sum.amount ?? 0)

      return {
        data: {
          totalMice: licenses.length,
          activeMice: activeLicenses.length,
          inMining: activeLicenses.length,
          idle: 0,
          expiredMice: expiredLicenses.length,
          claimableMic: totalPending.toFixed(4),
          totalMined: (totalClaimed + totalPending).toFixed(4),
          currentEpoch,
          licenses,
        },
      }
    } catch (err: any) {
      app.log.error('[mining/my-mice] Error:', err.message)
      return {
        data: {
          totalMice: 0, activeMice: 0, inMining: 0, idle: 0, expiredMice: 0,
          claimableMic: '0', totalMined: '0', currentEpoch: 0, licenses: [],
        },
      }
    }
  })
}
