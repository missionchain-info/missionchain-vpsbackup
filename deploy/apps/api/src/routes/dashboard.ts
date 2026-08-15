import { FastifyPluginAsync } from 'fastify'
import { Contract, formatUnits } from 'ethers'
import { MIC_DISPLAY_PRICE_USD } from '@missionchain/sdk'
import { resolveMicPrice } from '../services/micPrice.js'
import { buildProvider } from '../services/blockchain.js'

// ─── Helper: load SystemConfig values (Admin-configurable) ──────────────
async function getConfig(prisma: any, key: string, fallback: string): Promise<string> {
  const row = await prisma.systemConfig.findUnique({ where: { key } })
  return row?.value ?? fallback
}

async function getConfigNum(prisma: any, key: string, fallback: number): Promise<number> {
  const val = await getConfig(prisma, key, String(fallback))
  return Number(val) || fallback
}

// ─── Known wallets/contracts that hold pre-issued MIC ───────────────────
const DEPLOYER_WALLET = '0xD32e666381b56f979D60C57831838f05F33AD6c2'

export const dashboardRoutes: FastifyPluginAsync = async (app) => {
  // ─── GET /dashboard/overview — Global stats (PUBLIC — no auth) ──
  /**
   * Platform-wide figures, cached for a minute.
   *
   * This makes fourteen on-chain reads, and one throttled RPC response stalls the whole
   * `Promise.all` — measured at 90 to 115 seconds against a 120-second gateway timeout,
   * which is why the dashboard sat on a spinner and every tile read "-".
   *
   * Nothing here is per-user or fast-moving: total supply, vault balances, emission
   * totals. A minute of staleness is invisible, and it turns a burst of fourteen calls
   * per visitor into fourteen per minute for everyone.
   */
  let overviewCache: { at: number; body: unknown } | null = null
  const OVERVIEW_TTL_MS = 60_000

  app.get('/overview', async (req, reply) => {
    if (overviewCache && Date.now() - overviewCache.at < OVERVIEW_TTL_MS) {
      return overviewCache.body
    }

    const bc = app.blockchain

    // ── On-chain reads (parallel) ────────────────────────────────────
    // "Locked" pre-issued MIC = tokens NOT in user wallets. Includes:
    //   • Sale/distribution contracts (SeedSale, PreSale, LiquidityPool, Airdrop)
    //   • Treasury & founders vaults (TreasuryManager, FoundersVault)
    //   • Phase 0 mainnet additions: LiquidityPoolV5 (31.5M LP) + ListingReserveVault (73.5M CEX reserve)
    //   • Deployer EOA balance (315M PreSale Phase 1 reserve, held in Owner wallet)
    //   • LockManager.lockedOf() for deployer + registered users (vesting schedules)
    const safeBal = (addr: string | undefined) =>
      addr && addr !== '0x0000000000000000000000000000000000000000'
        ? bc.micToken.balanceOf(addr).then((v: bigint) => v).catch(() => 0n)
        : Promise.resolve(0n)

    const _addr = bc.addr as any
    const [
      onChainTotalSupply,
      seedSaleBalance,
      preSaleBalance,
      liquidityPoolBalance,
      airdropBalance,
      treasuryManagerBalance,
      foundersVaultBalance,
      // Phase 0 mainnet additions
      liquidityPoolV5Balance,
      /* The AMM pool actually in service. It was missing from this list, so the
         49,999,900 MIC seeded into it on 2026-08-12 counted as circulating supply and
         inflated the market cap by the same 50M. The two older pools stay in the list —
         both read zero now, but a stray transfer to either must still not read as
         circulating. */
      liquidityPoolV6Balance,
      listingReserveBalance,
      deployerWalletBalance,
      // LockManager locked for deployer (any leftover admin holdings)
      deployerLocked,
      mfpMinted,
      emissionData,
      saleData,
      miceData,
    ] = await Promise.all([
      bc.micToken.totalSupply().then((v: bigint) => v).catch(() => 0n),
      safeBal(_addr.SeedSale),
      safeBal(_addr.PreSale),
      safeBal(_addr.LiquidityPool),
      safeBal(_addr.AirdropDistributor),
      safeBal(_addr.TreasuryManager),
      safeBal(_addr.FoundersVault),
      safeBal(_addr.LiquidityPoolV5),
      safeBal(_addr.LiquidityPoolV6),
      safeBal(_addr.ListingReserveVault),
      safeBal(DEPLOYER_WALLET),
      bc.lockManager.lockedOf(DEPLOYER_WALLET).then((v: bigint) => v).catch(() => 0n),
      bc.mfpNFT.totalSupply().then((v: bigint) => Number(v)).catch(() => 0),
      bc.getEmissionData().catch(() => ({ currentRate: '0', totalEmitted: '0', daysSinceStart: 0, poolRemaining: '5950000000' })),
      bc.getSaleInfo().catch(() => ({ seed: { raised: '0', remaining: '227500000' }, preSale: { raised: '0', remaining: '315000000' } })),
      bc.getMICEInfo().catch(() => ({ totalSold: 0, currentRound: 1, currentPrice: 100 })),
    ])

    // ── DB reads (parallel) ──────────────────────────────────────────
    // Total Members = registered users EXCLUDING Owner (role=SUPER_ADMIN).
    // Owner is the contract owner / top-tier admin — operates anonymously,
    // not counted as a community member. Steward Council members (role=ADMIN)
    // ARE counted because they were registered Members first, then promoted.
    const [
      totalUsers,
      totalPurchases,
      seedStats,
      presaleStats,
      miceCount,
      stakingStats,
      communityNftCount,
    ] = await Promise.all([
      app.prisma.user.count({ where: { role: { not: 'SUPER_ADMIN' } } }),
      app.prisma.purchase.count(),
      app.prisma.purchase.aggregate({
        where: { type: 'SEED' },
        _sum: { usdtAmount: true, micAmount: true },
      }),
      app.prisma.purchase.aggregate({
        where: { type: 'PRESALE' },
        _sum: { usdtAmount: true, micAmount: true },
      }),
      app.prisma.purchase.count({ where: { type: 'MICE' } }),
      app.prisma.stakingPosition.aggregate({
        where: { active: true },
        _sum: { amount: true },
        _count: true,
      }),
      app.prisma.nFTItem.count({
        where: { contractType: 'COMMUNITY' },
      }),
    ])

    /*
     * The card is labelled "On-chain total (all tiers)", so it has to come from the chain.
     * The DB count above only sees mints the indexer wrote, and the indexer cannot read
     * logs without an archive endpoint — three tokens were minted and the card still read
     * zero. `CommunityNFTv2` is ERC721Enumerable, so `totalSupply()` is the whole answer in
     * one call. The DB count stays as the fallback for when the RPC is unreachable.
     *
     * `bc.communityNFT` is NOT usable here: it still points at the superseded ERC-1155
     * contract, whose ABI has no `totalSupply()`.
     */
    let communityNftOnChain: number | null = null
    try {
      const { getActiveAddresses } = await import('@missionchain/sdk')
      const communityAddr = (getActiveAddresses() as Record<string, string>).CommunityNFTv2
      if (communityAddr) {
        const c = new Contract(communityAddr, ['function totalSupply() view returns (uint256)'], buildProvider())
        communityNftOnChain = Number(await c.totalSupply())
      }
    } catch {
      // Fall through to the DB count — a stale number beats a blank card.
    }
    const communityNftTotal = communityNftOnChain ?? communityNftCount

    // ── Load admin-configurable constants ────────────────────────────
    const [
      TOTAL_SUPPLY,
      PRE_ISSUED,
      MINING_POOL,
      MFP_TOTAL,
      MICE_MAX_SUPPLY,
      emissionMinersPct,
      emissionStakingPct,
      emissionDaoPct,
      emissionCommunityNftPct,
      dailyOutput,
    ] = await Promise.all([
      getConfigNum(app.prisma, 'total_supply', 7_000_000_000),
      getConfigNum(app.prisma, 'pre_issued', 1_050_000_000),
      getConfigNum(app.prisma, 'mining_pool', 5_950_000_000),
      getConfigNum(app.prisma, 'mfp_total', 2_500),
      getConfigNum(app.prisma, 'mice_max_supply', 100_000),
      getConfigNum(app.prisma, 'emission_miners_pct', 60),
      getConfigNum(app.prisma, 'emission_staking_pct', 25),
      getConfigNum(app.prisma, 'emission_dao_pct', 10),
      getConfigNum(app.prisma, 'emission_community_nft_pct', 5),
      getConfigNum(app.prisma, 'daily_output', 22_907_500),
    ])

    // Resolved through the shared helper, so this screen cannot drift from the others.
    const micPriceInfo = await resolveMicPrice(app.prisma)

    const totalStaked = Number(stakingStats._sum.amount ?? 0)

    // ── Compute on-chain locked & circulating ────────────────────────
    // Locked = MIC NOT in user wallets (= cannot freely circulate yet).
    //
    // Phase 0 mainnet pre-issued breakdown (15% = 1,050M MIC):
    //   SeedSaleV7      221.1M  (152.5M public + 75M Old Investors grant, V7 active Jun 23 2026)
    //   FoundersVault   280.0M  (Founders allocation, distributed via Owner)
    //   LiquidityPoolV5  31.5M  (DEX liquidity reserve, locked)
    //   ListingReserve   73.5M  (CEX listing reserve, DAO-controlled)
    //   TreasuryManager 105.0M  (DAO Treasury, dormant Phase 1)
    //   Airdrop          17.5M  (Merkle-claim pool)
    //   Deployer EOA    315.0M  (PreSale Phase 1 expansion reserve, held in Owner wallet)
    //   = 1,050M total — ALL LOCKED until each respective distribution event fires
    //
    // After SEED/PreSale purchase, MIC moves from sale contract → buyer wallet, but
    // a vesting schedule is created in LockManager. Buyer's MIC = locked, NOT circulating.
    const inContracts = seedSaleBalance + preSaleBalance + liquidityPoolBalance + airdropBalance
                      + treasuryManagerBalance + foundersVaultBalance
                      + liquidityPoolV5Balance + liquidityPoolV6Balance
                      + listingReserveBalance + deployerWalletBalance

    // ── Sum LockManager.lockedOf() for all known wallets that may have schedules ──
    // After SEED/PreSale purchase, MIC moves from sale contract → buyer wallet, but
    // a vesting schedule is created in LockManager. Buyer's MIC = locked, NOT circulating.
    // Without a contract-level total, we enumerate via DB User table (wipe-friendly:
    // only registered users matter; admin wallet + buyers).
    let userLockedTotal = 0n
    try {
      const allUsers = await app.prisma.user.findMany({ select: { wallet: true } })
      const lockedReads = await Promise.all(
        allUsers.map(u =>
          bc.lockManager.lockedOf(u.wallet).then((v: bigint) => v).catch(() => 0n)
        )
      )
      userLockedTotal = lockedReads.reduce((sum, v) => sum + v, 0n)
    } catch (err) {
      app.log.warn({ err: (err as Error)?.message }, 'Failed to sum user lockedOf — falling back to 0')
    }

    // Split into 2 distinct buckets (refined Option 2, 2026-05-10):
    //   inContractReserves  = MIC sitting in vault/treasury/sale contracts AND deployer EOA
    //                         (not yet distributed to end users)
    //   vestingLocked       = MIC delivered to user wallets but still cliffed/vesting via LockManager
    // Total locked = inContractReserves + vestingLocked. Splitting them gives a clearer
    // dashboard: reserves drop when distributions fire; vestingLocked drops as cliffs/months pass.
    // NOTE: `inContracts` already includes deployerWalletBalance (line 151–153); do not double-count.
    const inContractReservesBigInt = inContracts
    const inContractReservesNum = parseFloat(formatUnits(inContractReservesBigInt, 18))

    const vestingLockedBigInt = deployerLocked + userLockedTotal
    const vestingLockedNum = parseFloat(formatUnits(vestingLockedBigInt, 18))

    const totalLockedBigIntRaw = inContractReservesBigInt + vestingLockedBigInt
    const totalLockedNumRaw = parseFloat(formatUnits(totalLockedBigIntRaw, 18))
    const totalLockedNum = Math.min(totalLockedNumRaw, 1_050_000_000)

    // Total supply from on-chain (should be 7B * 1e18)
    const totalSupplyOnChain = parseFloat(formatUnits(onChainTotalSupply, 18))

    // Pre-issued = 15% = 1,050,000,000 (already minted to various contracts/wallets)
    // Mining pool = 85% = 5,950,000,000 (held by MICToken contract, not circulating)
    const totalEmitted = parseFloat(emissionData.totalEmitted)

    // Circulating = Pre-Issued - locked_in_contracts - locked_via_LockManager + emitted_to_miners
    // But emitted tokens could also be staked, so:
    // Circulating = Pre-Issued + Emitted - Locked - Staked (simplified)
    const circulatingSupply = PRE_ISSUED + totalEmitted - totalLockedNum - totalStaked

    // ── Burned MIC — derived on-chain, not from the DB ────────────────
    // Every MIC that ever existed was either pre-issued at deploy (a fixed
    // 1,050,000,000 cap) or minted by EmissionController (totalMiningMinted).
    // Anything missing from totalSupply was burned, wherever the burn happened:
    //
    //   burned = PRE_ISSUED_CAP + totalMiningMinted − totalSupply
    //
    // This is self-maintaining — the 31,500,000 MIC destroyed from
    // LiquidityPoolV5 on 2026-08-05 (tx 0xb2f0d013…4924b) and every future MICE
    // burn both land here with no code change. The old DB sum only ever counted
    // MICE purchases and missed the LP5 burn entirely.
    //
    // PRE_ISSUED is admin-configurable, so the cap is pinned as a constant: it is
    // an immutable property of the token, not a display setting.
    const PRE_ISSUED_CAP = 1_050_000_000
    const miningMinted = await bc.micToken
      .totalMiningMinted()
      .then((v: bigint) => parseFloat(formatUnits(v, 18)))
      .catch(() => totalEmitted)
    const totalBurned = Math.max(0, PRE_ISSUED_CAP + miningMinted - totalSupplyOnChain)

    // Burned MIC never circulates again, so it comes off the pre-issued base.
    const circulatingSupplyNet = circulatingSupply - totalBurned

    return {
      data: {
        // Admin-configurable tokenomics
        /*
         * Three different quantities that were all being called "supply".
         *
         * `totalSupply` kept its old meaning and its old value so nothing downstream
         * shifts under it — the admin stats page already reads it as `hardCap`, which is
         * what it always was. The two honest figures are added beside it rather than
         * quietly redefining a field: renaming a number's meaning in place is precisely
         * how the DApp came to print "1.05B of 7.00B total" months after 31.5M was burned.
         */

        /** Design cap: 15% pre-issued + 85% mined, once all mining has happened. */
        totalSupply: TOTAL_SUPPLY,
        maxSupply: TOTAL_SUPPLY,

        /** What exists on chain right now, read from MICToken. Falls back to the derived
         *  figure only if the token could not be reached. */
        currentSupply: Math.round(totalSupplyOnChain || (PRE_ISSUED + totalEmitted - totalBurned)).toString(),

        /** Issued at genesis — a historical fact, unchanged by later burns. */
        preIssued: PRE_ISSUED,

        /** How much of that genesis issuance still exists. 31,500,000 of it was burned on
         *  2026-08-05 when LiquidityPool v5 turned out to have no withdrawal path. */
        preIssuedNow: Math.round(PRE_ISSUED - totalBurned).toString(),
        miningPool: MINING_POOL,

        // The live market price when there is a market, the configured figure when there
        // is not — resolved by the one helper every route shares. This used to read the
        // `mic_price` row directly and so kept showing $0.005 after the AMM opened at
        // $0.01, disagreeing with /rounds/system-info on the same screen refresh.
        micPrice: micPriceInfo.price,
        micPriceSource: micPriceInfo.source,

        // ★ ON-CHAIN computed values
        circulatingSupply: Math.max(0, Math.round(circulatingSupplyNet)).toString(),
        totalEmitted: Math.round(totalEmitted).toString(),
        totalStaked: totalStaked.toFixed(0),
        totalBurned: totalBurned.toFixed(0),
        totalLocked: Math.round(totalLockedNum).toString(),
        // ★ Split breakdown (refined Option 2): UI can render two separate cards.
        inContractReserves: Math.round(inContractReservesNum).toString(),
        vestingLocked:      Math.round(vestingLockedNum).toString(),

        // Breakdown of locked
        lockedBreakdown: {
          seedSaleContract: parseFloat(formatUnits(seedSaleBalance, 18)).toFixed(0),
          preSaleContract: parseFloat(formatUnits(preSaleBalance, 18)).toFixed(0),
          liquidityPool: parseFloat(formatUnits(liquidityPoolBalance + liquidityPoolV6Balance, 18)).toFixed(0),
          airdropDistributor: parseFloat(formatUnits(airdropBalance, 18)).toFixed(0),
          vestingLockManager: parseFloat(formatUnits(deployerLocked, 18)).toFixed(0),
        },

        // Daily output
        dailyOutput,

        // Emission split (Admin-configurable)
        emissionSplit: {
          miners: emissionMinersPct,
          staking: emissionStakingPct,
          dao: emissionDaoPct,
          communityNft: emissionCommunityNftPct,
        },

        // NFT stats
        mfpTotal: MFP_TOTAL,
        mfpMinted: mfpMinted,
        communityNfts: communityNftTotal,

        // MICE
        activeMice: miceData.totalSold,
        miceMaxSupply: MICE_MAX_SUPPLY,
        miceCurrentRound: miceData.currentRound,
        miceCurrentPrice: miceData.currentPrice,

        // Emission on-chain
        emission: {
          currentRate: emissionData.currentRate,
          totalEmitted: emissionData.totalEmitted,
          daysSinceStart: emissionData.daysSinceStart,
          poolRemaining: emissionData.poolRemaining,
        },

        // Sales on-chain
        sales: {
          seedRaisedUsdt: (seedStats._sum.usdtAmount ?? 0).toString(),
          presaleRaisedUsdt: (presaleStats._sum.usdtAmount ?? 0).toString(),
          seedMicRemaining: saleData.seed.remaining,
          presaleMicRemaining: saleData.preSale.remaining,
        },

        // Users & Sales
        totalUsers,
        totalPurchases,
        activeStakingPositions: stakingStats._count,
      },
    }
  })

  // ─── GET /dashboard/portfolio — User portfolio (auth) ──────────
  app.get('/portfolio', {
    preHandler: [app.authenticate],
  }, async (req, reply) => {
    const { wallet: authWallet } = req.user as { wallet: string }
    const { wallet } = req.query as { wallet?: string }

    const targetWallet = (wallet ?? authWallet).toLowerCase()
    const { role } = req.user as { role: string }
    if (targetWallet !== authWallet && role !== 'ADMIN') {
      return reply.status(403).send({ error: 'FORBIDDEN', message: 'Cannot view other users portfolio' })
    }

    const bc = app.blockchain

    // On-chain token balance + locked
    const tokenBalance = await bc.getTokenBalance(targetWallet)

    const [
      user,
      purchases,
      stakingPositions,
      miningRewards,
      nfts,
      rewardClaims,
    ] = await Promise.all([
      app.prisma.user.findUnique({
        where: { wallet: targetWallet },
        select: {
          userId: true,
          wallet: true,
          gvRank: true,
          mfpCount: true,
          totalGV: true,
          kycStatus: true,
        },
      }),

      app.prisma.purchase.aggregate({
        where: { wallet: targetWallet },
        _sum: { micAmount: true, usdtAmount: true },
        _count: true,
      }),

      app.prisma.stakingPosition.aggregate({
        where: { wallet: targetWallet, active: true },
        _sum: { amount: true, weightedAmount: true },
        _count: true,
      }),

      app.prisma.miningReward.aggregate({
        where: { wallet: targetWallet },
        _sum: { amount: true },
        _count: true,
      }),

      app.prisma.nFTItem.findMany({
        where: { wallet: targetWallet, active: true },
        select: { contractType: true, tier: true, tokenId: true, expiresAt: true },
      }),

      app.prisma.rewardClaim.aggregate({
        where: { wallet: targetWallet },
        _sum: { amount: true },
      }),
    ])

    if (!user) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'User not found' })
    }

    const totalPurchasedMic = Number(purchases._sum.micAmount ?? 0)
    const totalStaked = Number(stakingPositions._sum.amount ?? 0)
    const totalMined = Number(miningRewards._sum.amount ?? 0)
    const totalClaimed = Number(rewardClaims._sum.amount ?? 0)

    const miceCount = await app.prisma.purchase.count({
      where: { wallet: targetWallet, type: 'MICE' },
    })

    const now = new Date()
    const mfpNfts = nfts.filter((n) => n.contractType === 'MFP')
    const communityNfts = nfts.filter((n) => n.contractType === 'COMMUNITY')
    const activeCommunityNfts = communityNfts.filter((n) => !n.expiresAt || n.expiresAt > now)

    return {
      data: {
        user: {
          userId: user.userId,
          wallet: user.wallet,
          kycStatus: user.kycStatus,
          gvRank: user.gvRank,
        },
        balances: {
          // ★ ON-CHAIN balance (what MetaMask shows)
          micBalance: tokenBalance.balance,
          micLocked: tokenBalance.locked,
          micAvailable: tokenBalance.available,
          // DB-derived
          totalPurchased: totalPurchasedMic.toFixed(0),
          totalStaked: totalStaked.toFixed(0),
          weightedStaked: (stakingPositions._sum.weightedAmount ?? 0).toString(),
          totalMined: totalMined.toFixed(0),
          totalRewardsClaimed: totalClaimed.toFixed(0),
          totalSpentUsdt: (purchases._sum.usdtAmount ?? 0).toString(),
        },
        nfts: {
          mfpCount: mfpNfts.length,
          mfpTokenIds: mfpNfts.map((n) => n.tokenId),
          communityActive: activeCommunityNfts.length,
          communityAll: communityNfts.map((n) => ({
            tokenId: n.tokenId,
            tier: n.tier,
            expiresAt: n.expiresAt?.toISOString() ?? null,
            active: !n.expiresAt || n.expiresAt > now,
          })),
        },
        mining: {
          miceCount,
          totalMined: totalMined.toFixed(0),
          daysActive: miningRewards._count,
        },
        staking: {
          activePositions: stakingPositions._count,
          totalStaked: totalStaked.toFixed(0),
        },
        purchases: {
          count: purchases._count,
        },
      },
    }
  })

  // ─── GET /dashboard/wallet?wallet=0x... — User wallet summary (PUBLIC) ──
  app.get('/wallet', async (req, reply) => {
    const { wallet } = req.query as { wallet?: string }
    if (!wallet) return reply.status(400).send({ error: 'MISSING_WALLET' })

    const walletLower = wallet.toLowerCase()
    const bc = app.blockchain

    // ★ On-chain token balance
    const tokenBalance = await bc.getTokenBalance(walletLower)

    const [
      purchases,
      stakingPositions,
      miningRewards,
      nfts,
      usdtClaimed,
      usdtUnclaimed,
      micClaimed,
      micUnclaimed,
    ] = await Promise.all([
      app.prisma.purchase.aggregate({
        where: { wallet: walletLower },
        _sum: { micAmount: true, usdtAmount: true },
      }),

      app.prisma.stakingPosition.aggregate({
        where: { wallet: walletLower, active: true },
        _sum: { amount: true },
      }),

      app.prisma.miningReward.aggregate({
        where: { wallet: walletLower },
        _sum: { amount: true },
      }),

      app.prisma.nFTItem.findMany({
        where: { wallet: walletLower, active: true },
        select: { contractType: true, tier: true, expiresAt: true },
      }),

      app.prisma.rewardClaim.aggregate({
        where: { wallet: walletLower, currency: 'USDT', status: 'CLAIMED' },
        _sum: { amount: true },
      }),

      app.prisma.rewardClaim.aggregate({
        where: { wallet: walletLower, currency: 'USDT', status: { in: ['PENDING', 'CLAIMABLE'] } },
        _sum: { amount: true },
      }),

      app.prisma.rewardClaim.aggregate({
        where: { wallet: walletLower, currency: 'MIC', status: 'CLAIMED' },
        _sum: { amount: true },
      }),

      app.prisma.rewardClaim.aggregate({
        where: { wallet: walletLower, currency: 'MIC', status: { in: ['PENDING', 'CLAIMABLE'] } },
        _sum: { amount: true },
      }),
    ])

    const totalStaked = Number(stakingPositions._sum.amount ?? 0)

    // NFT counts
    const now = new Date()
    const mfpCount = nfts.filter(n => n.contractType === 'MFP').length
    const activeCommunity = nfts.filter(n => n.contractType === 'COMMUNITY' && (!n.expiresAt || n.expiresAt > now))
    const builders = activeCommunity.filter(n => n.tier === 'Builder').length
    const makers = activeCommunity.filter(n => n.tier === 'Maker').length
    const luminaries = activeCommunity.filter(n => n.tier === 'Luminary').length

    const body = {
      data: {
        // ★ ON-CHAIN values (from LockManager + MICToken.balanceOf)
        micTotal: tokenBalance.balance,          // What MetaMask shows
        micAvailable: tokenBalance.available,    // Can transfer/sell
        micVesting: tokenBalance.locked,         // Locked by LockManager
        micStaked: totalStaked.toFixed(0),        // Locked by MICStaking (from DB)
        usdtBalance: (purchases._sum.usdtAmount ?? 0).toString(),
        bnbBalance: '0',
        mfpNfts: mfpCount,
        builders,
        makers,
        luminaries,
        incomeUsdt: {
          claimed: Number(usdtClaimed._sum.amount ?? 0).toFixed(2),
          unclaimed: Number(usdtUnclaimed._sum.amount ?? 0).toFixed(2),
        },
        incomeMic: {
          claimed: Number(micClaimed._sum.amount ?? 0).toFixed(0),
          unclaimed: Number(micUnclaimed._sum.amount ?? 0).toFixed(0),
        },
      },
    }

    overviewCache = { at: Date.now(), body }
    return body
  })
}
