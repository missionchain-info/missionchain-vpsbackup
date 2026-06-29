import { FastifyPluginAsync } from "fastify"
import { formatUnits, formatEther } from "ethers"

/**
 * Network / On-chain API — reads live contract state
 * Prefix: /network
 */
export const networkRoutes: FastifyPluginAsync = async (app) => {

  // ─── GET /network/contracts — All contract addresses + live on-chain data ───
  app.get("/contracts", async () => {
    const bc = app.blockchain

    const [
      micTotalSupply,
      mfpTotalSupply,
      seedMicBal,
      preSaleMicBal,
      liquidityMicBal,
      saleData,
      miceData,
      blockNumber,
    ] = await Promise.all([
      bc.micToken.totalSupply().catch(() => 0n) as Promise<bigint>,
      bc.mfpNFT.totalSupply().catch(() => 0n) as Promise<bigint>,
      bc.micToken.balanceOf(bc.seedSale.target).catch(() => 0n) as Promise<bigint>,
      bc.micToken.balanceOf(bc.preSale.target).catch(() => 0n) as Promise<bigint>,
      bc.micToken.balanceOf(bc.addr.LiquidityPool).catch(() => 0n) as Promise<bigint>,
      bc.getSaleInfo().catch(() => ({ seed: { raised: "0", remaining: "227500000" }, preSale: { raised: "0", remaining: "315000000" } })),
      bc.getMICEInfo().catch(() => ({ totalSold: 0, currentRound: 1, currentPrice: 100 })),
      bc.getCurrentBlock(),
    ])

    return {
      data: {
        blockNumber,
        micToken: {
          totalSupply: formatUnits(micTotalSupply, 18),
          seedSaleBalance: formatUnits(seedMicBal, 18),
          preSaleBalance: formatUnits(preSaleMicBal, 18),
        },
        mfpNft: {
          totalMinted: Number(mfpTotalSupply),
          maxSupply: 2500,
        },
        sales: saleData,
        mice: miceData,
      },
    }
  })

  // ─── GET /network/wallet/:address — On-chain wallet balances ───
  app.get("/wallet/:address", async (req) => {
    const { address } = req.params as { address: string }
    const bc = app.blockchain

    const [tokenBal, nftHoldings, stakingPositions, referralInfo] = await Promise.all([
      bc.getTokenBalance(address),
      bc.getNFTHoldings(address),
      bc.getStakingPositions(address),
      bc.getReferralInfo(address),
    ])

    return {
      data: {
        wallet: address,
        mic: tokenBal,
        nfts: nftHoldings,
        staking: { positions: stakingPositions, count: stakingPositions.length },
        referral: referralInfo,
      },
    }
  })

  // ─── GET /network/health — Blockchain connectivity check ───
  app.get("/health", async () => {
    try {
      const block = await app.blockchain.getCurrentBlock()
      return { status: "ok", blockNumber: block }
    } catch {
      return { status: "error", blockNumber: 0 }
    }
  })

  // ─── GET /network/overview — Referral team summary for current user ───
  // Returns rank, GV, team counts/volumes, and income breakdown.
  // The `referrer` column stores WALLET addresses (not userIds), so all
  // lookups use wallet → wallet relations.
  app.get("/overview", {
    preHandler: [(app as any).authenticate],
  }, async (req, reply) => {
    const { wallet: authWallet } = req.user as { wallet: string }
    const targetWallet = authWallet.toLowerCase()

    const me = await app.prisma.user.findUnique({
      where: { wallet: targetWallet },
      select: { totalGV: true, gvRank: true },
    })
    if (!me) return reply.status(404).send({ error: "NOT_FOUND", message: "User not found" })

    const f1 = await app.prisma.user.findMany({
      where: { referrer: targetWallet },
      select: { wallet: true },
    })
    const f1Wallets = f1.map((u) => u.wallet)

    const f2 = f1Wallets.length
      ? await app.prisma.user.findMany({
          where: { referrer: { in: f1Wallets } },
          select: { wallet: true },
        })
      : []
    const f2Wallets = f2.map((u) => u.wallet)

    const [f1Vol, f2Vol] = await Promise.all([
      f1Wallets.length
        ? app.prisma.purchase.aggregate({
            where: { wallet: { in: f1Wallets }, type: { in: ["PRESALE", "MICE"] } },
            _sum: { usdtAmount: true },
          })
        : Promise.resolve({ _sum: { usdtAmount: null as any } }),
      f2Wallets.length
        ? app.prisma.purchase.aggregate({
            where: { wallet: { in: f2Wallets }, type: { in: ["PRESALE", "MICE"] } },
            _sum: { usdtAmount: true },
          })
        : Promise.resolve({ _sum: { usdtAmount: null as any } }),
    ])

    const f1Volume = (f1Vol._sum.usdtAmount ?? 0).toString()
    const f2Volume = (f2Vol._sum.usdtAmount ?? 0).toString()
    const groupVolume = (
      Number(f1Volume) + Number(f2Volume)
    ).toString()

    // Income breakdown from RewardClaim (REFERRAL_RESERVE + GV bonuses)
    const claims = await app.prisma.rewardClaim.groupBy({
      by: ["type"],
      where: { wallet: targetWallet },
      _sum: { amount: true },
    })
    const byType = Object.fromEntries(
      claims.map((c) => [c.type, (c._sum.amount ?? 0).toString()]),
    )

    // GV tier thresholds + next-rank calc
    const GV_TIERS = [
      { rank: "Believer", min: 0, max: 4_999, rate: 0 },
      { rank: "Builder", min: 5_000, max: 19_999, rate: 3 },
      { rank: "Connector", min: 20_000, max: 49_999, rate: 5 },
      { rank: "Champion", min: 50_000, max: 149_999, rate: 7 },
      { rank: "Ambassador", min: 150_000, max: 499_999, rate: 8 },
      { rank: "Legend", min: 500_000, max: Infinity, rate: 9 },
    ]
    const gv = Number(me.totalGV.toString())
    const currentTier = GV_TIERS.find((t) => gv >= t.min && gv <= t.max) ?? GV_TIERS[0]
    const nextTier = GV_TIERS[GV_TIERS.indexOf(currentTier) + 1] ?? null
    const needed = nextTier ? Math.max(0, nextTier.min - gv) : 0
    const pctProgress = nextTier
      ? Math.min(100, ((gv - currentTier.min) / (nextTier.min - currentTier.min)) * 100)
      : 100

    // NOTE: Frontend's NetworkData interface expects fields at the top level
    // (no { data: ... } wrapper), so we return the payload directly.
    return {
      rank: me.gvRank || currentTier.rank,
      gv,
      nextRank: nextTier?.rank,
      nextThreshold: nextTier?.min,
      needed,
      pctProgress,
      teamStats: {
        f1Members: f1Wallets.length,
        f1Volume,
        f2Members: f2Wallets.length,
        f2Volume,
        groupVolume,
        totalTeam: f1Wallets.length + f2Wallets.length,
      },
      income: {
        f1: byType["REFERRAL_F1"] ?? byType["REFERRAL_RESERVE"] ?? "0",
        f2: byType["REFERRAL_F2"] ?? "0",
        gv: byType["GV_BONUS"] ?? "0",
        total: Object.values(byType).reduce((a, b) => a + Number(b), 0).toString(),
      },
    }
  })

  // ─── GET /network/children?wallet=X — Direct children (F1) of a wallet ───
  // Used by the My Community tree to lazy-load each level. Auth required.
  // Returns: array of { userId, wallet, createdAt, gvRank, childCount }
  // sorted by createdAt DESC (newest first).
  app.get("/children", {
    preHandler: [(app as any).authenticate],
  }, async (req, reply) => {
    const { wallet } = req.query as { wallet?: string }
    const target = (wallet ?? (req.user as any).wallet).toLowerCase()

    const children = await app.prisma.user.findMany({
      where: { referrer: target },
      select: {
        userId: true,
        wallet: true,
        createdAt: true,
        gvRank: true,
      },
      orderBy: { createdAt: "desc" },
    })

    if (children.length === 0) {
      return { wallet: target, children: [] }
    }

    const childWallets = children.map((c) => c.wallet)

    // Per-child direct F1 count (grandchildren of target).
    const grandCounts = await app.prisma.user.groupBy({
      by: ["referrer"],
      where: { referrer: { in: childWallets } },
      _count: { _all: true },
    })
    const countByReferrer = new Map(
      grandCounts.map((g) => [g.referrer ?? "", g._count._all]),
    )

    // Per-child Personal Volume (their own USDT purchases).
    const pvRows = await app.prisma.purchase.groupBy({
      by: ["wallet"],
      where: { wallet: { in: childWallets } },
      _sum: { usdtAmount: true },
    })
    const pvByWallet = new Map(
      pvRows.map((r) => [r.wallet, (r._sum.usdtAmount ?? 0).toString()]),
    )

    // Per-child Group Volume (sum of ALL downstream purchases, recursive).
    // Prisma has no recursive relation traversal, so we use a CTE per child.
    type GvRow = { total: string | number }
    const gvResults = await Promise.all(
      childWallets.map(async (w) => {
        const res = await app.prisma.$queryRaw<GvRow[]>`
          WITH RECURSIVE downline AS (
            SELECT wallet FROM "User" WHERE referrer = ${w}
            UNION ALL
            SELECT u.wallet FROM "User" u
              INNER JOIN downline d ON u.referrer = d.wallet
          )
          SELECT COALESCE(SUM(p."usdtAmount"), 0)::text AS total
          FROM "Purchase" p
          WHERE p.wallet IN (SELECT wallet FROM downline)
        `
        return { wallet: w, gv: String(res[0]?.total ?? "0") }
      }),
    )
    const gvByWallet = new Map(gvResults.map((r) => [r.wallet, r.gv]))

    return {
      wallet: target,
      children: children.map((c) => ({
        userId: c.userId,
        wallet: c.wallet,
        createdAt: c.createdAt.toISOString(),
        gvRank: c.gvRank,
        childCount: countByReferrer.get(c.wallet) ?? 0,
        pv: pvByWallet.get(c.wallet) ?? "0",
        gv: gvByWallet.get(c.wallet) ?? "0",
      })),
    }
  })
}
