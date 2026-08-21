/**
 * GET /mining/network-stats — Live network mining statistics (PUBLIC)
 * Reads directly from on-chain contracts for real-time data.
 */
import { FastifyPluginAsync } from 'fastify'
import { formatUnits, id as ethersId } from 'ethers'

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
        // MiningPool has no epochs — it runs a continuous accumulator. Calling a name the
        // ABI does not carry throws SYNCHRONOUSLY, before the .catch() can attach, so this
        // one line took the whole handler into its outer catch and served zeros.
        Promise.resolve(0n),
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
            // getRoundForToken returns 1..5 already. The + 1 that used to sit here
            // reported every round-1 licence as Round 2, price and all.
            round,
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

      // The deployed MiningPool has no epochs. It runs a continuous accumulator:
      // `claimableOf(account, licenceIds)` returns `accrued[account]` — earnings banked
      // when a licence expired or changed hands — plus the live `pendingOf` of each
      // licence still running.
      //
      // What stood here called currentEpoch/pendingReward/claimed, none of which exist on
      // this contract. Every call threw, every throw was swallowed by its own catch, and
      // the page showed a flat 0 for mined and claimable while the chain was streaming
      // 83.33 MIC a day. The SDK ABI was the epoch-era one, so nothing flagged it.
      const licenceIds = licenses.map(l => BigInt(l.id))
      let totalPending = 0
      try {
        const claimable = await bc.miningPool.claimableOf(wallet, licenceIds)
        totalPending = parseFloat(formatUnits(claimable, 18))
      } catch (e: any) {
        app.log.warn({ err: e?.shortMessage || e?.message, wallet }, '[mining/my-mice] claimableOf failed')
      }

      // What a wallet has withdrawn is recorded by POST /mining/record-claim, which takes
      // the amount from the transaction receipt rather than from the client. Before that
      // route existed the page called it, got a 404, and swallowed the error — so nothing
      // earlier than 2026-08-20 was ever recorded and this total starts there.
      //
      // It is NOT derived from rate x time-since-activation. That was tried and shipped
      // briefly and was wrong: it assumes the pool paid from the second of activation,
      // while the first distribution ran a day later, and it reported one wallet as having
      // taken out 112.79 MIC when the whole system had paid 23.93.
      const dbRewards = await app.prisma.miningReward.aggregate({
        where: { wallet: wallet.toLowerCase() },
        _sum: { amount: true },
      }).catch(() => null)
      const totalClaimed = Number(dbRewards?._sum.amount ?? 0)

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
          claimedMic: totalClaimed.toFixed(4),
          // Recording began on 2026-08-20; anything withdrawn before that is not in this
          // figure, and the UI says so rather than presenting it as a lifetime total.
          claimedKnown: true,
          claimedSince: '2026-08-20',
          totalMined: (totalClaimed + totalPending).toFixed(4),
          // Kept in the response shape for older clients. This pool has no epochs.
          currentEpoch: 0,
          licenses,
        },
      }
    } catch (err: any) {
      // pino takes the context object first; err.message as the second argument is
      // dropped, which is how this route logged failures as a bare label for weeks.
      app.log.error({ err: err?.message, stack: err?.stack }, '[mining/my-mice] failed')
      return {
        data: {
          totalMice: 0, activeMice: 0, inMining: 0, idle: 0, expiredMice: 0,
          claimableMic: '0', totalMined: '0', currentEpoch: 0, licenses: [],
        },
      }
    }
  })
  // ─── POST /mining/record-claim ─────────────────────────────────────
  /**
   * Record a withdrawal that has already happened on chain.
   *
   * MiningPool keeps no per-wallet claimed total — only a global one — so what a given
   * wallet has taken out lives in `Claimed` events, and reading those needs `eth_getLogs`,
   * which no reachable endpoint serves. This is the other half: the client reports the
   * transaction, and the amount is taken from the RECEIPT, not from the client.
   *
   * `eth_getTransactionReceipt` is a plain call every RPC answers, so this works with the
   * endpoints already configured. Nothing the caller sends is trusted except the hash.
   *
   * The page used to call a route of this name that did not exist; it 404'd and the
   * frontend's `.catch` hid it, which is why CLAIMED read zero however often anyone
   * withdrew.
   */
  app.post('/record-claim', async (req, reply) => {
    const { txHash } = (req.body ?? {}) as { txHash?: string }
    if (!txHash || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
      return reply.status(400).send({ error: 'BAD_TX_HASH' })
    }

    const bc = app.blockchain
    try {
      const rc = await bc.provider.getTransactionReceipt(txHash)
      if (!rc) return reply.status(404).send({ error: 'TX_NOT_FOUND' })
      if (rc.status !== 1) return reply.status(400).send({ error: 'TX_REVERTED' })

      const pool = bc.addr.MiningPool.toLowerCase()
      const mic = bc.addr.MICToken.toLowerCase()
      const TRANSFER = ethersId('Transfer(address,address,uint256)')

      // Sum every MIC that moved OUT of the pool in this transaction, and to whom. Taking
      // the amount from the receipt is what makes this safe to expose without auth.
      let recipient: string | null = null
      let total = 0n
      for (const log of rc.logs) {
        if (log.address.toLowerCase() !== mic) continue
        if (log.topics[0] !== TRANSFER || log.topics.length < 3) continue
        const from = '0x' + log.topics[1].slice(26)
        const to = '0x' + log.topics[2].slice(26)
        if (from.toLowerCase() !== pool) continue
        recipient = to
        total += BigInt(log.data)
      }

      if (!recipient || total === 0n) {
        return reply.status(400).send({ error: 'NOT_A_MINING_CLAIM' })
      }

      const wallet = recipient.toLowerCase()
      const amount = Number(formatUnits(total, 18))
      const block = await bc.provider.getBlock(rc.blockNumber)
      const day = Math.floor(Number(block?.timestamp ?? Date.now() / 1000) / 86_400)

      // One row per wallet per day, accumulating — a holder may claim more than once.
      const existing = await app.prisma.miningReward.findUnique({
        where: { wallet_day: { wallet, day } },
      }).catch(() => null)

      if (existing?.txHash === txHash) {
        return { data: { recorded: false, reason: 'already recorded', wallet, amount } }
      }

      await app.prisma.miningReward.upsert({
        where: { wallet_day: { wallet, day } },
        create: {
          wallet, day, amount, txHash,
          // Legacy columns from the epoch-era schema. They are not read anywhere.
          miceTokenId: '', hindex: 0, poolShare: 0,
        },
        update: { amount: { increment: amount }, txHash },
      })

      app.log.info({ wallet, amount, txHash }, 'mining: claim recorded')
      return { data: { recorded: true, wallet, amount, day } }
    } catch (err: any) {
      app.log.error({ err: err?.message, stack: err?.stack, txHash }, '[mining/record-claim] failed')
      return reply.status(500).send({ error: 'RECORD_FAILED' })
    }
  })

}
