import { FastifyPluginAsync } from 'fastify'
import { formatUnits } from 'ethers'

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
  app.get('/overview', async (req, reply) => {
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

    // ── Load admin-configurable constants ────────────────────────────
    const [
      TOTAL_SUPPLY,
      PRE_ISSUED,
      MINING_POOL,
      MFP_TOTAL,
      MICE_MAX_SUPPLY,
      micPrice,
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
      getConfig(app.prisma, 'mic_price', '0.0025'),
      getConfigNum(app.prisma, 'emission_miners_pct', 60),
      getConfigNum(app.prisma, 'emission_staking_pct', 25),
      getConfigNum(app.prisma, 'emission_dao_pct', 10),
      getConfigNum(app.prisma, 'emission_community_nft_pct', 5),
      getConfigNum(app.prisma, 'daily_output', 22_907_500),
    ])

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
                      + liquidityPoolV5Balance + listingReserveBalance + deployerWalletBalance

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

    // Burned MIC (from MICE purchases)
    // For now read from DB; in future can read on-chain burn address balance
    const burnedFromMice = await app.prisma.purchase.aggregate({
      where: { type: 'MICE' },
      _sum: { micAmount: true },
    })
    const totalBurned = Number(burnedFromMice._sum.micAmount ?? 0)

    return {
      data: {
        // Admin-configurable tokenomics
        totalSupply: TOTAL_SUPPLY,
        preIssued: PRE_ISSUED,
        miningPool: MINING_POOL,

        // Admin-configurable price
        micPrice,

        // ★ ON-CHAIN computed values
        circulatingSupply: Math.max(0, Math.round(circulatingSupply)).toString(),
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
          liquidityPool: parseFloat(formatUnits(liquidityPoolBalance, 18)).toFixed(0),
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
        communityNfts: communityNftCount,

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

    return {
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
  })
}
