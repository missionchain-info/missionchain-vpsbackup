/**
 * GET /mining/network-stats — Live network mining statistics (PUBLIC)
 * Reads directly from on-chain contracts for real-time data.
 */
import { FastifyPluginAsync } from 'fastify'
import { formatUnits } from 'ethers'

export const miningNetworkRoutes: FastifyPluginAsync = async (app) => {

  // ─── GET /mining/network-stats — Global on-chain mining data ────
  /**
   * Emission state and pool figures, cached for a minute.
   *
   * This reads a dozen contracts per request and was timing out at the 60-second
   * gateway limit. None of it is per-user, and none of it moves faster than the daily
   * emission it describes — so a minute of staleness is invisible, while the burst it
   * removes is what made the page unusable.
   */
  let statsCache: { at: number; body: any } | null = null
  const STATS_TTL_MS = 60_000

  app.get('/network-stats', async (req, reply) => {
    if (statsCache && Date.now() - statsCache.at < STATS_TTL_MS) return statsCache.body

    const bc = app.blockchain

    try {
      const [
        dailyEmissionRaw,
        totalEmittedRaw,
        deployTimeRaw,
        poolRemainingRaw,
        totalMiceMinted,
        currentRound,
        activeLicencesRaw,
        ratePerLicenceRaw,
        minerBpsRaw,
        damperBpsRaw,
        minersBps,
        stakingBps,
        daoBps,
        communityNftBps,
        mfpRewardBps,
        lastDistributionRaw,
        currentEpoch,
      ] = await Promise.all([
        bc.emissionController.dailyEmission().catch(() => 0n),
        bc.emissionController.totalEmitted().catch(() => 0n),
        bc.emissionController.deployTime().catch(() => 0n),
        // The mining allocation still unminted — NOT MiningPool's MIC balance, which is
        // only what has been emitted and not yet claimed. Reading the balance showed
        // "pool remaining: 0" the moment the numbers became real; before that the whole
        // handler was falling into its catch, where 5.95B was hard-coded, so the wrong
        // read had never once been displayed.
        bc.micToken.remainingMiningPool().catch(() => 0n),
        bc.miceLicense.totalMinted().catch(() => 0n),
        bc.miceLicense.getCurrentRound().catch(() => 0n),
        bc.emissionController.activeLicences().catch(() => 0n),
        bc.emissionController.micPerLicencePerDay().catch(() => 0n),
        bc.emissionController.currentMinerBps().catch(() => 5900n),
        bc.emissionController.damperBps().catch(() => 10000n),
        bc.emissionController.minersBps().catch(() => 5900n),
        bc.emissionController.stakingBps().catch(() => 2500n),
        bc.emissionController.daoBps().catch(() => 1000n),
        bc.emissionController.communityNFTBps().catch(() => 500n),
        bc.emissionController.mfpRewardBps().catch(() => 100n),
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

      const body = {
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

          // What actually governs issuance under EmissionControllerV2.
          activeLicences: Number(activeLicencesRaw),
          micPerLicencePerDay: parseFloat(formatUnits(ratePerLicenceRaw, 18)),
          minerShare: Number(minerBpsRaw) / 100,
          damper: Number(damperBpsRaw) / 10000,

          // EmissionControllerV2 has no regulators. V1 multiplied six of them together —
          // E_base x D x L x G x W x A — and the product came to about 1/24,000, which is
          // why two licences drew 7.89 MIC/day instead of 166.67. V2 pays a flat rate per
          // licence and reads no price at all.
          //
          // These keys are kept at their neutral values so an older client still parses
          // the response. They are not placeholders for something missing: there is
          // genuinely no damping left to report. `brakeEngaged` is the one live signal —
          // it tracks the emergency damper, which ships disengaged.
          factors: {
            eBase: 0,
            demandFactor: 1,
            coverageDays: 0,
            coverageFactor: 1,
            trendFactor: 1,
            adoptionFactor: 1,
            brakeEngaged: Number(damperBpsRaw) < 10000,
            warmUpFactor: 1,
          },

          // Emission split (BPS)
          split: {
            miners: Number(minersBps) / 100,
            mfpReward: Number(mfpRewardBps) / 100,
            staking: Number(stakingBps) / 100,
            dao: Number(daoBps) / 100,
            communityNft: Number(communityNftBps) / 100,
          },

          // Epoch info
          currentEpoch: Number(currentEpoch),
          lastDistribution: lastDist,
        },
      }

      statsCache = { at: Date.now(), body }
      return body
    } catch (err: any) {
      // pino wants the context object first; passing it second dropped the reason and
      // every failure here logged as a bare label with nothing after it. That is how a
      // synchronous TypeError — calling eBase() on an ABI that no longer has it, which
      // throws before .catch() can attach — stayed invisible while the page showed dashes.
      app.log.error({ err: err?.message, stack: err?.stack }, '[mining/network-stats] failed')
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
          activeLicences: 0,
          micPerLicencePerDay: 0,
          minerShare: 59,
          damper: 1,
          factors: {
            eBase: 0, demandFactor: 1, coverageDays: 0, coverageFactor: 1,
            trendFactor: 1, adoptionFactor: 1, brakeEngaged: false, warmUpFactor: 1,
          },
          // 59/25/10/5/1 since 2026-08-05. MFP-NFT is its own pool, not part of
          // Community NFT — the two have different holders and different rules.
          split: { miners: 59, staking: 25, dao: 10, communityNft: 5, mfpReward: 1 },
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
      const licenseIds: bigint[] = await (async () => {
        const { Contract: C0 } = await import('ethers')
        const m0 = new C0(bc.miceLicense.target, ['function getUserLicenses(address) view returns (uint256[])'], bc.provider ?? (bc.miceLicense.runner as any))
        return m0.getUserLicenses(wallet).catch(() => [])
      })()

      // Check each license status
      // The contract publishes the state explicitly — NONE / PENDING / ACTIVE / EXPIRED /
      // RECYCLED — and `isActivatable`. Read those.
      //
      // This used to ask only `isActive()` and sort the answer into two buckets, active
      // and "expired". A licence that has been bought but not yet activated is not active,
      // so it landed in the expired pile: the buyer's brand-new MICE was reported to them
      // as EXPIRED, and `idle: 0` below meant the DApp counted zero pending and greyed out
      // the very button that would have activated it. Bought at 04:55, unusable by 05:00.
      const STATUS = ['NONE', 'PENDING', 'ACTIVE', 'EXPIRED', 'RECYCLED'] as const

      // Written out rather than taken from the SDK. `packages/sdk/abis/MICELicense.json`
      // is a build behind the deployed contract — it still carries `balanceOfBatch` from
      // the ERC-1155 era and has no `statusOf`, `isActivatable` or `activate`. Calls to
      // those resolve to undefined, and the `.catch()` around each one turns that into a
      // plausible-looking default instead of an error.
      const { Contract: _C } = await import('ethers')
      const mice = new _C(bc.miceLicense.target, [
        'function getUserLicenses(address) view returns (uint256[])',
        'function statusOf(uint256) view returns (uint8)',
        'function isActivatable(uint256) view returns (bool)',
        'function licenses(uint256) view returns (address owner,uint256 mintTime,uint256 activatedAt,uint256 expiryTime,uint256 pricePaid)',
        'function getRoundForToken(uint256) view returns (uint256)',
      ], bc.provider ?? (bc.miceLicense.runner as any))
      const licenses = await Promise.all(
        licenseIds.map(async (id: bigint) => {
          const [statusRaw, activatable, licenseData] = await Promise.all([
            mice.statusOf(id).catch(() => 0) as Promise<number>,
            mice.isActivatable(id).catch(() => false) as Promise<boolean>,
            mice.licenses(id).catch(() => [wallet, 0n, 0n, 0n, 0n]) as Promise<bigint[]>,
          ])
          const status = STATUS[Number(statusRaw)] ?? 'NONE'
          const mintTime = Number(licenseData[1])
          const activatedAt = Number(licenseData[2])
          // The term starts at activation, not at purchase. Deriving it from mintTime told
          // a pending licence it was already 0 days from expiry.
          const expiryTime = Number(licenseData[3])
          const round = Number(await mice.getRoundForToken(id).catch(() => 0n))
          const active = status === 'ACTIVE'
          return {
            id: Number(id),
            round: round + 1,
            mintTime,
            activatedAt,
            expiryTime,
            status,
            activatable,
            daysLeft: expiryTime > 0
              ? Math.max(0, Math.ceil((expiryTime - Math.floor(Date.now() / 1000)) / 86400))
              : null,
            active,
            // All active MICE auto-participate in mining via oracle
            inMining: active,
          }
        })
      )

      const activeLicenses  = licenses.filter(l => l.status === 'ACTIVE')
      const pendingLicenses = licenses.filter(l => l.status === 'PENDING')
      const expiredLicenses = licenses.filter(l => l.status === 'EXPIRED')

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
          // Bought but not yet activated. Was hardcoded to 0, which is what disabled the
          // Activate button for anyone who had just bought their first licence.
          idle: pendingLicenses.length,
          pendingMice: pendingLicenses.length,
          activatableMice: licenses.filter(l => l.activatable).length,
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
