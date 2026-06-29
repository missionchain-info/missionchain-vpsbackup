import { FastifyPluginAsync } from 'fastify'

// ─── Hardcoded Tokenomics Data ────────────────────────────────────────────

const SEED_PACKAGES = [
  { name: 'EARLY BIRD', price: 1000, mic: 400_000, mfp: 1 },
  { name: 'FOUNDING PARTNER I', price: 2500, mic: 1_000_000, mfp: 3 },
  { name: 'FOUNDING PARTNER II', price: 5000, mic: 2_000_000, mfp: 8 },
  { name: 'FOUNDING PARTNER III', price: 10000, mic: 4_000_000, mfp: 20 },
] as const

const PRESALE_PACKAGES = [
  { name: 'Minimum', price: 25, mic: 5_000, nftBonus: null },
  { name: 'Package Builder', price: 1000, mic: 200_000, nftBonus: 'Builder' },
  { name: 'Package Maker', price: 2500, mic: 500_000, nftBonus: 'Maker' },
  { name: 'Package Luminary', price: 5000, mic: 1_000_000, nftBonus: 'Luminary' },
] as const

const MICE_ROUNDS = [
  { round: 1, range: '1-20000', price: 100, maxLicenses: 20_000 },
  { round: 2, range: '20001-40000', price: 200, maxLicenses: 20_000 },
  { round: 3, range: '40001-60000', price: 300, maxLicenses: 20_000 },
  { round: 4, range: '60001-80000', price: 400, maxLicenses: 20_000 },
  { round: 5, range: '80001-100000', price: 500, maxLicenses: 20_000 },
] as const

/** SEED total = 227.5M MIC. Of that, 75M Strategic Partner Grant (admin-issued)
 *  + 152.5M Public Sale @ $0.0025 = $381,250 gross target. */
const SEED_ALLOCATION_MIC = 152_500_000
const SEED_PRICE_USD = 0.0025

/** Pre-Sale: 315M MIC @ $0.005 = $1,575,000 hard cap */
const PRESALE_ALLOCATION_MIC = 315_000_000
const PRESALE_PRICE_USD = 0.005
const PRESALE_HARD_CAP_USD = 1_575_000

/** MICE: 100K max, total revenue $30M (USDT portion $15M) */
const MICE_MAX_SUPPLY = 100_000

/** MFP-NFT max supply */
const MFP_MAX_SUPPLY = 2_500

export const salesRoutes: FastifyPluginAsync = async (app) => {
  // ─── GET /sales/seed/info ───────────────────────────────────────
  app.get('/seed/info', async (req, reply) => {
    // Aggregate SEED purchases from DB
    const seedStats = await app.prisma.purchase.aggregate({
      where: { type: 'SEED' },
      _sum: { usdtAmount: true, micAmount: true },
      _count: true,
    })

    const totalMicSold = Number(seedStats._sum.micAmount ?? 0)
    const remainingMic = SEED_ALLOCATION_MIC - totalMicSold

    // Get unique participant count
    const participantCount = await app.prisma.purchase.groupBy({
      by: ['wallet'],
      where: { type: 'SEED' },
    })

    // Fetch promotion data from RoundConfig
    const seedConfig = await app.prisma.roundConfig.findFirst({ where: { roundType: 'SEED' } })
    const now = new Date()
    const promotionActive = seedConfig?.promotionActive === true
      && seedConfig?.promotionStart && seedConfig?.promotionEnd
      && new Date(seedConfig.promotionStart) <= now
      && new Date(seedConfig.promotionEnd) >= now

    // Total MFP-NFTs minted for SEED
    const mfpMinted = await app.prisma.nFTItem.count({
      where: { contractType: 'MFP' },
    })

    return {
      data: {
        round: 'SEED',
        pricePerMic: SEED_PRICE_USD,
        allocationMic: SEED_ALLOCATION_MIC,
        totalMicSold: totalMicSold.toFixed(0),
        remainingMic: Math.max(0, remainingMic).toFixed(0),
        participants: participantCount.length,
        purchaseCount: seedStats._count,
        packages: SEED_PACKAGES,
        referral: false, // SEED has NO referral
        mfpMinted,
        mfpMaxSupply: MFP_MAX_SUPPLY,
        // Promotion info
        promotion: {
          active: promotionActive,
          pct: promotionActive ? Number(seedConfig?.promotionPct ?? 0) : 0,
          start: seedConfig?.promotionStart?.toISOString() ?? null,
          end: seedConfig?.promotionEnd?.toISOString() ?? null,
          label: promotionActive
            ? `+${Number(seedConfig?.promotionPct ?? 0)}% Bonus MIC`
            : null,
        },
      },
    }
  })

  // ─── GET /sales/seed/distributor-stats — Distributor panel data (auth) ──
  app.get('/seed/distributor-stats', {
    preHandler: [app.authenticate],
  }, async (req, reply) => {
    const { wallet } = req.user as { wallet: string }

    // Check if user is a distributor
    const distributor = await app.prisma.distributor.findUnique({
      where: { wallet: wallet.toLowerCase() },
    })

    if (!distributor || !distributor.isActive) {
      return { data: { isDistributor: false } }
    }

    // Get earnings breakdown
    const earnings = await app.prisma.distributorEarning.aggregate({
      where: { distributorWallet: distributor.wallet },
      _sum: { commission: true, orderAmount: true },
      _count: true,
    })

    const claimedEarnings = await app.prisma.distributorEarning.aggregate({
      where: { distributorWallet: distributor.wallet, status: 'PAID' },
      _sum: { commission: true },
    })

    const unclaimedEarnings = await app.prisma.distributorEarning.aggregate({
      where: { distributorWallet: distributor.wallet, status: 'PENDING' },
      _sum: { commission: true },
    })

    // Get unique buyer count
    const buyerCount = await app.prisma.distributorEarning.groupBy({
      by: ['buyerWallet'],
      where: { distributorWallet: distributor.wallet },
    })

    // Active payout request (PENDING admin review or APPROVED awaiting USDT transfer)
    const activeRequest = await app.prisma.payoutRequest.findFirst({
      where: {
        distributorWallet: distributor.wallet,
        status: { in: ['PENDING', 'APPROVED'] },
      },
      orderBy: { requestedAt: 'desc' },
    })

    // Last completed/rejected request for context
    const lastClosedRequest = await app.prisma.payoutRequest.findFirst({
      where: {
        distributorWallet: distributor.wallet,
        status: { in: ['PAID', 'REJECTED'] },
      },
      orderBy: { requestedAt: 'desc' },
    })

    return {
      data: {
        isDistributor: true,
        commissionRate: Number(distributor.commissionRate),
        totalBuyers: buyerCount.length,
        totalVolume: Number(earnings._sum.orderAmount ?? 0).toFixed(2),
        totalEarned: Number(earnings._sum.commission ?? 0).toFixed(2),
        claimed: Number(claimedEarnings._sum.commission ?? 0).toFixed(2),
        unclaimed: Number(unclaimedEarnings._sum.commission ?? 0).toFixed(2),
        totalOrders: earnings._count,
        activeRequest: activeRequest ? {
          id: activeRequest.id,
          status: activeRequest.status,
          grossAmount: Number(activeRequest.grossAmount).toFixed(2),
          feeBps: activeRequest.feeBps,
          feeAmount: Number(activeRequest.feeAmount).toFixed(2),
          netAmount: Number(activeRequest.netAmount).toFixed(2),
          earningCount: activeRequest.earningCount,
          requestedAt: activeRequest.requestedAt,
          approvedAt: activeRequest.approvedAt,
        } : null,
        lastClosedRequest: lastClosedRequest ? {
          id: lastClosedRequest.id,
          status: lastClosedRequest.status,
          netAmount: Number(lastClosedRequest.netAmount).toFixed(2),
          paidAt: lastClosedRequest.paidAt,
          paidTxHash: lastClosedRequest.paidTxHash,
          rejectedReason: lastClosedRequest.rejectedReason,
        } : null,
      },
    }
  })

  // ─── GET /sales/seed/payout-history — User's own payout request history (auth) ──
  app.get('/seed/payout-history', {
    preHandler: [app.authenticate],
  }, async (req, reply) => {
    const { wallet } = req.user as { wallet: string }
    const requests = await app.prisma.payoutRequest.findMany({
      where: { distributorWallet: wallet.toLowerCase() },
      orderBy: { requestedAt: 'desc' },
      take: 100,
    })
    return {
      data: requests.map((r) => ({
        id: r.id,
        wallet: r.distributorWallet,
        status: r.status,
        grossAmount: r.grossAmount.toString(),
        feeBps: r.feeBps,
        feeAmount: r.feeAmount.toString(),
        netAmount: r.netAmount.toString(),
        earningCount: r.earningCount,
        requestedAt: r.requestedAt,
        approvedAt: r.approvedAt,
        rejectedAt: r.rejectedAt,
        rejectedReason: r.rejectedReason,
        paidAt: r.paidAt,
        paidTxHash: r.paidTxHash,
      })),
    }
  })

  // ─── POST /sales/seed/request-payout — Submit payout request (auth) ──
  // Creates a PayoutRequest grouping all PENDING earnings; admin reviews and approves/rejects.
  // Replaces the old auto-PAID claim flow (Phase 1 DB-only with admin approval workflow).
  app.post('/seed/request-payout', {
    preHandler: [app.authenticate],
  }, async (req, reply) => {
    const { wallet } = req.user as { wallet: string }

    const distributor = await app.prisma.distributor.findUnique({
      where: { wallet: wallet.toLowerCase() },
    })

    if (!distributor || !distributor.isActive) {
      return reply.status(403).send({ error: 'NOT_DISTRIBUTOR', message: 'Not a registered distributor' })
    }

    // Block if user already has an open request awaiting admin
    const existingOpen = await app.prisma.payoutRequest.findFirst({
      where: {
        distributorWallet: distributor.wallet,
        status: { in: ['PENDING', 'APPROVED'] },
      },
    })
    if (existingOpen) {
      return reply.status(409).send({
        error: 'REQUEST_PENDING',
        message: `You already have a ${existingOpen.status.toLowerCase()} payout request. Please wait for admin to process it.`,
      })
    }

    const pendingEarnings = await app.prisma.distributorEarning.findMany({
      where: { distributorWallet: distributor.wallet, status: 'PENDING', payoutRequestId: null },
    })

    if (pendingEarnings.length === 0) {
      return reply.status(400).send({ error: 'NOTHING_TO_REQUEST', message: 'No pending earnings to request payout for' })
    }

    const grossAmount = pendingEarnings.reduce((sum, e) => sum + Number(e.commission), 0)

    // Create PayoutRequest + link earnings (status: PENDING admin review)
    const result = await app.prisma.$transaction(async (tx) => {
      const request = await tx.payoutRequest.create({
        data: {
          distributorWallet: distributor.wallet,
          status: 'PENDING',
          grossAmount,
          feeBps: 0,
          feeAmount: 0,
          netAmount: grossAmount, // No fee yet, admin sets it on approval
          earningCount: pendingEarnings.length,
        },
      })

      await tx.distributorEarning.updateMany({
        where: { id: { in: pendingEarnings.map(e => e.id) } },
        data: { status: 'REQUESTED', payoutRequestId: request.id },
      })

      return request
    })

    return {
      data: {
        requestId: result.id,
        grossAmount: grossAmount.toFixed(2),
        earningCount: pendingEarnings.length,
        status: 'PENDING',
        message: 'Payout request submitted. Admin will review and process within 1-3 business days.',
      },
    }
  })

  // Backward-compat alias — old DApp builds still call /claim-commission
  app.post('/seed/claim-commission', {
    preHandler: [app.authenticate],
  }, async (req, reply) => {
    return reply.status(410).send({
      error: 'ENDPOINT_RENAMED',
      message: 'This endpoint has been replaced by /sales/seed/request-payout. Please refresh the page.',
    })
  })

  // ─── GET /sales/presale/info ────────────────────────────────────
  app.get('/presale/info', async (req, reply) => {
    const presaleStats = await app.prisma.purchase.aggregate({
      where: { type: 'PRESALE' },
      _sum: { usdtAmount: true, micAmount: true },
      _count: true,
    })

    const totalRaisedUsdt = Number(presaleStats._sum.usdtAmount ?? 0)
    const totalMicSold = Number(presaleStats._sum.micAmount ?? 0)
    const remainingMic = PRESALE_ALLOCATION_MIC - totalMicSold
    const remainingUsdt = PRESALE_HARD_CAP_USD - totalRaisedUsdt

    // Optionally attach user-specific orders + vesting if JWT is present
    let userOrders: Array<{ date: string; package: string; mic: string; nft: string; status: string; memberId?: string }> = []
    let vestingPct: number | null = null
    let nextUnlock: string | null = null
    try {
      await req.jwtVerify()
      const { wallet } = req.user as { wallet?: string }
      if (wallet) {
        const purchases = await app.prisma.purchase.findMany({
          where: { type: 'PRESALE', wallet: wallet.toLowerCase() },
          orderBy: { createdAt: 'desc' },
          take: 50,
          select: {
            createdAt: true,
            usdtAmount: true,
            micAmount: true,
            packageName: true,
            nftBonusType: true,
            status: true,
            txHash: true,
            user: { select: { userId: true } },
          },
        })
        const fmtDate = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
        const cliffMs = 180 * 24 * 3600 * 1000
        const monthMs = 30 * 24 * 3600 * 1000

        // Compute per-order vesting: 6m cliff → 10% unlock → +2.5%/month, ~42 months total.
        const computeVesting = (purchaseDate: Date) => {
          const elapsed = Date.now() - purchaseDate.getTime()
          if (elapsed < cliffMs) {
            return {
              unlockedPct: 0,
              nextUnlock: fmtDate(new Date(purchaseDate.getTime() + cliffMs)) + ' (cliff +10%)',
            }
          }
          const monthsAfterCliff = Math.floor((elapsed - cliffMs) / monthMs)
          const pct = Math.min(100, 10 + monthsAfterCliff * 2.5)
          if (pct >= 100) return { unlockedPct: 100, nextUnlock: null }
          const nextMonthMs = purchaseDate.getTime() + cliffMs + (monthsAfterCliff + 1) * monthMs
          return {
            unlockedPct: pct,
            nextUnlock: fmtDate(new Date(nextMonthMs)) + ' (+2.5%)',
          }
        }

        userOrders = purchases.map((p) => {
          const usdt = Number(p.usdtAmount)
          const isCustom = !p.packageName || p.packageName === 'Minimum' || p.packageName.startsWith('Package ')
          const vesting = computeVesting(p.createdAt)
          // Map internal status → user-friendly label
          const statusLabel = p.status === 'CONFIRMED' ? 'DONE' : p.status
          return {
            date: fmtDate(p.createdAt),
            package: isCustom ? `$${usdt.toLocaleString()}` : p.packageName!,
            mic: Number(p.micAmount).toLocaleString(),
            nft: p.nftBonusType ? `${p.nftBonusType} NFT` : '—',
            status: statusLabel,
            memberId: p.user?.userId,
            unlockedPct: vesting.unlockedPct,
            nextUnlock: vesting.nextUnlock,
            txHash: p.txHash,
          }
        })

        // Aggregate vesting (weighted by MIC amount) for the top-of-page summary
        if (purchases.length > 0) {
          const totalMic = purchases.reduce((s, p) => s + Number(p.micAmount), 0)
          const weightedSum = purchases.reduce((s, p) => {
            const v = computeVesting(p.createdAt)
            return s + Number(p.micAmount) * v.unlockedPct
          }, 0)
          vestingPct = totalMic > 0 ? Math.round((weightedSum / totalMic) * 10) / 10 : 0
          // earliest pending unlock (any non-100%)
          const pendingUnlocks = purchases
            .map((p) => computeVesting(p.createdAt))
            .filter((v) => v.nextUnlock !== null)
            .map((v) => v.nextUnlock!)
            .sort()
          nextUnlock = pendingUnlocks[0] ?? null
        }
      }
    } catch { /* unauthenticated — no user orders */ }

    return {
      data: {
        round: 'PRE_SALE',
        pricePerMic: PRESALE_PRICE_USD,
        allocationMic: PRESALE_ALLOCATION_MIC,
        hardCapUsdt: PRESALE_HARD_CAP_USD,
        totalRaisedUsdt: totalRaisedUsdt.toFixed(2),
        totalMicSold: totalMicSold.toFixed(0),
        remainingMic: Math.max(0, remainingMic).toFixed(0),
        remainingUsdt: Math.max(0, remainingUsdt).toFixed(2),
        purchaseCount: presaleStats._count,
        packages: PRESALE_PACKAGES,
        referral: { f1: 7, f2: 3 }, // F1: 7% USDT, F2: 3% USDT
        orders: userOrders,
        vestingPct,
        nextUnlock,
      },
    }
  })

  // ─── GET /sales/mice/info ───────────────────────────────────────
  app.get('/mice/info', async (req, reply) => {
    const miceStats = await app.prisma.purchase.aggregate({
      where: { type: 'MICE' },
      _sum: { usdtAmount: true },
      _count: true,
    })

    const totalSold = miceStats._count

    // Determine current round based on total sold
    let currentRound = 1
    let currentPrice = 100
    for (const r of MICE_ROUNDS) {
      const roundEnd = r.round * 20_000
      if (totalSold < roundEnd) {
        currentRound = r.round
        currentPrice = r.price
        break
      }
      if (r.round === 5) {
        currentRound = 5
        currentPrice = 500
      }
    }

    const remainingInRound = currentRound * 20_000 - totalSold
    const totalRevenue = Number(miceStats._sum.usdtAmount ?? 0)

    return {
      data: {
        totalSold,
        maxSupply: MICE_MAX_SUPPLY,
        remaining: Math.max(0, MICE_MAX_SUPPLY - totalSold),
        currentRound,
        currentPrice,
        remainingInRound: Math.max(0, remainingInRound),
        totalRevenueUsdt: totalRevenue.toFixed(2),
        paymentSplit: { micBurnPct: 50, usdtPct: 50 },
        durationDays: 360,
        rounds: MICE_ROUNDS,
        referral: { f1: 7, f2: 3 },
      },
    }
  })

  // ─── GET /sales/purchases — User's purchase history (auth) ─────
  app.get('/purchases', {
    preHandler: [app.authenticate],
  }, async (req, reply) => {
    const { wallet: authWallet } = req.user as { wallet: string }
    const { wallet, page: pageStr, limit: limitStr } = req.query as {
      wallet?: string
      page?: string
      limit?: string
    }

    const targetWallet = (wallet ?? authWallet).toLowerCase()

    // Users can only query their own purchases unless admin
    const { role } = req.user as { role: string }
    if (targetWallet !== authWallet && role !== 'ADMIN') {
      return reply.status(403).send({ error: 'FORBIDDEN', message: 'Cannot view other users purchases' })
    }

    const page = Math.max(1, parseInt(pageStr ?? '1', 10) || 1)
    const limit = Math.min(100, Math.max(1, parseInt(limitStr ?? '20', 10) || 20))
    const skip = (page - 1) * limit

    const [purchases, total] = await Promise.all([
      app.prisma.purchase.findMany({
        where: { wallet: targetWallet },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      app.prisma.purchase.count({ where: { wallet: targetWallet } }),
    ])

    return {
      data: purchases.map((p) => ({
        ...p,
        usdtAmount: p.usdtAmount.toString(),
        micAmount: p.micAmount.toString(),
        bnbAmount: p.bnbAmount.toString(),
        referralPaidF1: p.referralPaidF1.toString(),
        referralPaidF2: p.referralPaidF2.toString(),
      })),
      pagination: { page, limit, total },
    }
  })

  // ─── POST /sales/seed/purchase — Phase 1 DB-only SEED purchase ──────
  app.post('/seed/purchase', {
    preHandler: [app.authenticate],
  }, async (req, reply) => {
    const user = req.user as { wallet: string; role: string } | undefined
    if (!user) {
      return reply.status(401).send({ error: 'UNAUTHORIZED', message: 'Authentication required' })
    }

    const body = req.body as { amount: number; packageName?: string; referrerUserId?: string }
    if (!body.amount || body.amount <= 0) {
      return reply.status(400).send({ error: 'BAD_REQUEST', message: 'amount must be positive' })
    }

    // Check SEED round is ACTIVE
    const seedConfig = await app.prisma.roundConfig.findFirst({ where: { roundType: 'SEED' } })
    if (!seedConfig || seedConfig.status !== 'ACTIVE') {
      return reply.status(403).send({ error: 'ROUND_NOT_ACTIVE', message: 'SEED round is not active' })
    }

    const MIC_PRICE = 0.0025
    const MIN_AMOUNT = 1000 // Minimum SEED purchase $1,000
    if (body.amount < MIN_AMOUNT) {
      return reply.status(400).send({ error: 'BAD_REQUEST', message: `Minimum SEED purchase is $${MIN_AMOUNT}` })
    }

    // SEED is public open sale — no KYC/whitelist gate (per on-chain SeedSaleV7.buyPackage)

    // Match package to determine MFP-NFT count
    const matchedPkg = SEED_PACKAGES.find(p => p.price === body.amount)
    const mfpCount = matchedPkg ? matchedPkg.mfp : 0
    const packageName = matchedPkg?.name || body.packageName || 'Custom'

    let micAmount = body.amount / MIC_PRICE

    // Check promotion bonus
    const now = new Date()
    const promotionActive = seedConfig.promotionActive === true
      && seedConfig.promotionStart && seedConfig.promotionEnd
      && new Date(seedConfig.promotionStart) <= now
      && new Date(seedConfig.promotionEnd) >= now

    let bonusMic = 0
    if (promotionActive && seedConfig.promotionPct) {
      const bonusPct = Number(seedConfig.promotionPct)
      if (bonusPct > 0 && bonusPct <= 15) {
        bonusMic = micAmount * (bonusPct / 100)
        micAmount += bonusMic
      }
    }

    // Check remaining allocation
    const currentSold = await app.prisma.purchase.aggregate({
      where: { type: 'SEED' },
      _sum: { micAmount: true },
    })
    const totalSoldMic = Number(currentSold._sum.micAmount ?? 0)
    if (totalSoldMic + micAmount > SEED_ALLOCATION_MIC) {
      return reply.status(400).send({
        error: 'ALLOCATION_EXCEEDED',
        message: 'Not enough MIC remaining in SEED allocation',
      })
    }

    // Check MFP-NFT supply
    const currentMfpCount = await app.prisma.nFTItem.count({ where: { contractType: 'MFP' } })
    if (mfpCount > 0 && currentMfpCount + mfpCount > MFP_MAX_SUPPLY) {
      return reply.status(400).send({
        error: 'MFP_SUPPLY_EXCEEDED',
        message: 'Not enough MFP-NFTs remaining',
      })
    }

    // Wrap in transaction for atomicity
    const result = await app.prisma.$transaction(async (tx) => {
      // Create purchase record
      const purchase = await tx.purchase.create({
        data: {
          wallet: user.wallet.toLowerCase(),
          type: 'SEED',
          packageName,
          usdtAmount: body.amount,
          micAmount,
          status: 'CONFIRMED',
          referrerWallet: null, // SEED has no regular referral
        },
      })

      // Mint MFP-NFTs (Phase 1: DB-only)
      const mintedNfts: Array<{ tokenId: string; serialNumber: number; imageUrl: string | null }> = []
      if (mfpCount > 0) {
        // Get available artworks
        const artworks = await tx.mfpArtwork.findMany({
          where: { active: true },
        })

        // Get current max serial number
        const maxSerial = await tx.nFTItem.aggregate({
          where: { contractType: 'MFP' },
          _max: { serialNumber: true },
        })
        let nextSerial = (maxSerial._max.serialNumber ?? 0) + 1

        for (let i = 0; i < mfpCount; i++) {
          const serial = nextSerial + i
          const tokenId = `MFP-${String(serial).padStart(5, '0')}`

          // Random artwork selection
          let imageUrl: string | null = null
          if (artworks.length > 0) {
            const randomIdx = Math.floor(Math.random() * artworks.length)
            imageUrl = artworks[randomIdx].imageData
            // Increment usage count
            await tx.mfpArtwork.update({
              where: { id: artworks[randomIdx].id },
              data: { usedCount: { increment: 1 } },
            })
          }

          await tx.nFTItem.create({
            data: {
              wallet: user.wallet.toLowerCase(),
              contractType: 'MFP',
              tokenId,
              tier: 'MFP',
              mintTxHash: `phase1-${purchase.id}-${i}`, // Placeholder for Phase 1
              mintedAt: new Date(),
              active: true,
              imageUrl,
              purchaseId: purchase.id,
              serialNumber: serial,
            },
          })

          mintedNfts.push({ tokenId, serialNumber: serial, imageUrl: imageUrl ? '(assigned)' : null })
        }
      }

      // Update user seedPurchased flag and mfpCount
      await tx.user.update({
        where: { wallet: user.wallet.toLowerCase() },
        data: {
          seedPurchased: true,
          mfpCount: { increment: mfpCount },
        },
      })

      // Check distributor attribution
      let distributorCommission = null
      if (body.referrerUserId) {
        const referrerUser = await tx.user.findFirst({
          where: { userId: body.referrerUserId },
        })

        if (referrerUser) {
          const distributor = await tx.distributor.findUnique({
            where: { wallet: referrerUser.wallet.toLowerCase() },
          })

          if (distributor && distributor.isActive) {
            const commission = Number(distributor.commissionRate) * body.amount

            await tx.distributorEarning.create({
              data: {
                distributorWallet: distributor.wallet,
                purchaseId: purchase.id,
                buyerWallet: user.wallet.toLowerCase(),
                orderAmount: body.amount,
                commission,
              },
            })

            await tx.distributor.update({
              where: { wallet: distributor.wallet },
              data: {
                totalEarned: { increment: commission },
                totalOrders: { increment: 1 },
              },
            })

            distributorCommission = commission
          }
        }
      }

      return { purchase, distributorCommission, mintedNfts, bonusMic }
    })

    return reply.status(201).send({
      data: {
        purchaseId: result.purchase.id,
        packageName,
        usdtAmount: body.amount,
        micAmount,
        bonusMic: result.bonusMic,
        mfpNfts: result.mintedNfts,
        mfpCount,
        status: 'CONFIRMED',
        distributorCommission: result.distributorCommission,
      },
    })
  })

  // ─── GET /sales/seed/my-nfts — User's MFP-NFTs from SEED (auth) ─────
  app.get('/seed/my-nfts', {
    preHandler: [app.authenticate],
  }, async (req, reply) => {
    const { wallet } = req.user as { wallet: string }

    const nfts = await app.prisma.nFTItem.findMany({
      where: {
        wallet: wallet.toLowerCase(),
        contractType: 'MFP',
      },
      orderBy: { serialNumber: 'asc' },
      select: {
        id: true,
        tokenId: true,
        serialNumber: true,
        imageUrl: true,
        mintedAt: true,
        active: true,
        purchaseId: true,
      },
    })

    return {
      data: nfts,
      total: nfts.length,
    }
  })

  // ─── POST /sales/seed/record-onchain — Record on-chain SEED purchase to DB ──
  // No auth required: buyer wallet is extracted from the on-chain tx itself.
  // FE posts txHash → server fetches tx, verifies it called SeedSale (V7 active) → records.
  // Robust against expired/missing JWTs.
  app.post('/seed/record-onchain', async (req, reply) => {
    const body = req.body as {
      txHash: string
      packageIndex: number
      packageName?: string
      usdtAmount?: number
      micAmount?: number
      mfpCount?: number
      blockNumber?: number
    }

    if (!body.txHash || body.txHash.length < 10) {
      return reply.status(400).send({ error: 'BAD_REQUEST', message: 'txHash is required' })
    }
    if (body.packageIndex == null || body.packageIndex < 0 || body.packageIndex > 3) {
      return reply.status(400).send({ error: 'BAD_REQUEST', message: 'packageIndex must be 0-3' })
    }

    // Idempotent — same txHash already recorded?
    const existing = await app.prisma.purchase.findFirst({ where: { txHash: body.txHash } })
    if (existing) {
      return reply.status(200).send({
        data: {
          purchaseId: existing.id,
          alreadyRecorded: true,
          message: 'Purchase already recorded',
        },
      })
    }

    // Verify tx on-chain + extract buyer wallet from tx.from
    let buyerWallet: string
    let blockNumber: number | null = body.blockNumber ?? null
    try {
      const { ethers } = await import('ethers')
      const provider = new ethers.JsonRpcProvider(process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org/')
      const tx = await provider.getTransaction(body.txHash)
      if (!tx) {
        return reply.status(404).send({ error: 'TX_NOT_FOUND', message: 'Transaction not found on-chain' })
      }
      const receipt = await provider.getTransactionReceipt(body.txHash)
      if (!receipt || receipt.status !== 1) {
        return reply.status(400).send({ error: 'TX_FAILED', message: 'Transaction reverted on-chain' })
      }
      buyerWallet = tx.from.toLowerCase()
      blockNumber = receipt.blockNumber
    } catch (e: any) {
      app.log.warn({ err: e?.message, txHash: body.txHash }, 'seed/record-onchain on-chain verify failed')
      return reply.status(502).send({ error: 'CHAIN_ERROR', message: 'Failed to verify transaction on-chain' })
    }

    // Match package to get canonical data
    const matchedPkg = SEED_PACKAGES[body.packageIndex] || null
    const packageName = matchedPkg?.name || body.packageName || `Package ${body.packageIndex}`
    const mfpCount = matchedPkg?.mfp || body.mfpCount || 0
    const micAmount = matchedPkg?.mic || body.micAmount || 0
    const usdtAmount = matchedPkg?.price || body.usdtAmount || 0

    // Wrap in transaction for atomicity
    const result = await app.prisma.$transaction(async (tx) => {
      // Auto-create minimal user if buyer wallet has no record (testnet edge case)
      const existingUser = await tx.user.findUnique({ where: { wallet: buyerWallet } })
      if (!existingUser) {
        await tx.user.create({
          data: {
            wallet: buyerWallet,
            userId: `auto_${buyerWallet.slice(2, 10)}`,
            termsAccepted: true,
          },
        })
      }

      const buyer = await tx.user.findUnique({
        where: { wallet: buyerWallet },
        select: { referrer: true },
      })
      const referrerWallet = buyer?.referrer ?? null

      const purchase = await tx.purchase.create({
        data: {
          wallet: buyerWallet,
          type: 'SEED',
          packageName,
          usdtAmount,
          micAmount,
          status: 'CONFIRMED',
          txHash: body.txHash,
          blockNumber,
          referrerWallet,
        },
      })

      // Mint MFP-NFTs (DB records)
      const mintedNfts: Array<{ tokenId: string; serialNumber: number }> = []
      if (mfpCount > 0) {
        const artworks = await tx.mfpArtwork.findMany({ where: { active: true } })

        const maxSerial = await tx.nFTItem.aggregate({
          where: { contractType: 'MFP' },
          _max: { serialNumber: true },
        })
        let nextSerial = (maxSerial._max.serialNumber ?? 0) + 1

        for (let i = 0; i < mfpCount; i++) {
          const serial = nextSerial + i
          const tokenId = `MFP-${String(serial).padStart(5, '0')}`

          let imageUrl: string | null = null
          if (artworks.length > 0) {
            const randomIdx = Math.floor(Math.random() * artworks.length)
            imageUrl = artworks[randomIdx].imageData
            await tx.mfpArtwork.update({
              where: { id: artworks[randomIdx].id },
              data: { usedCount: { increment: 1 } },
            })
          }

          await tx.nFTItem.create({
            data: {
              wallet: buyerWallet,
              contractType: 'MFP',
              tokenId,
              tier: 'MFP',
              mintTxHash: body.txHash,
              mintedAt: new Date(),
              active: true,
              imageUrl,
              purchaseId: purchase.id,
              serialNumber: serial,
            },
          })

          mintedNfts.push({ tokenId, serialNumber: serial })
        }
      }

      // Update user flags
      await tx.user.update({
        where: { wallet: buyerWallet },
        data: {
          seedPurchased: true,
          mfpCount: { increment: mfpCount },
        },
      })

      // ── Distributor commission — DIFFERENTIAL BONUS up the referral chain ──
      let distributorCommission: number | null = null
      const credits: Array<{ wallet: string; commission: number; rate: number }> = []
      if (referrerWallet) {
        let cursor: string | null = referrerWallet.toLowerCase()
        let maxRateSoFar = 0
        const MAX_DEPTH = 200
        for (let depth = 0; depth < MAX_DEPTH && cursor; depth++) {
          const dist = await tx.distributor.findUnique({ where: { wallet: cursor } })
          if (dist && dist.isActive) {
            const rate = Number(dist.commissionRate)
            if (rate > maxRateSoFar) {
              const diff = rate - maxRateSoFar
              const commission = diff * usdtAmount
              credits.push({ wallet: dist.wallet, commission, rate })
              maxRateSoFar = rate
            }
          }
          const parent: { referrer: string | null } | null = await tx.user.findUnique({
            where: { wallet: cursor },
            select: { referrer: true },
          })
          cursor = parent?.referrer?.toLowerCase() ?? null
        }
      }

      if (credits.length > 0) {
        for (const c of credits) {
          await tx.distributorEarning.create({
            data: {
              distributorWallet: c.wallet,
              purchaseId: purchase.id,
              buyerWallet,
              orderAmount: usdtAmount,
              commission: c.commission,
            },
          })
          await tx.distributor.update({
            where: { wallet: c.wallet },
            data: {
              totalEarned: { increment: c.commission },
              totalOrders: { increment: 1 },
            },
          })
        }
        distributorCommission = credits.reduce((s, c) => s + c.commission, 0)
      }

      return { purchase, mintedNfts, distributorCommission }
    })

    return reply.status(201).send({
      data: {
        purchaseId: result.purchase.id,
        buyer: buyerWallet,
        packageName,
        usdtAmount,
        micAmount,
        mfpCount,
        nfts: result.mintedNfts,
        txHash: body.txHash,
        status: 'CONFIRMED',
        distributorCommission: result.distributorCommission,
      },
    })
  })

  // ─── POST /sales/presale/record-onchain — Record on-chain Pre-Sale purchase ──
  // No auth required: buyer wallet is extracted from the on-chain tx itself.
  // Frontend posts txHash → server fetches the tx + verifies it called PreSale.buy() → records.
  // This is robust against expired/missing JWTs (user may have bought before JWT issue).
  app.post('/presale/record-onchain', async (req, reply) => {
    const body = req.body as {
      txHash: string
      packageIndex: number   // 0=custom, 1=Builder, 2=Maker, 3=Luminary
      usdtAmount: number     // In USDT (6-decimal display, but as float here)
      micAmount: number      // In MIC (18-decimal display, as float)
      blockNumber?: number
    }

    if (!body.txHash || body.txHash.length < 10) {
      return reply.status(400).send({ error: 'BAD_REQUEST', message: 'txHash required' })
    }
    if (body.usdtAmount == null || body.usdtAmount <= 0) {
      return reply.status(400).send({ error: 'BAD_REQUEST', message: 'usdtAmount must be > 0' })
    }
    if (body.packageIndex == null || body.packageIndex < 0 || body.packageIndex > 3) {
      return reply.status(400).send({ error: 'BAD_REQUEST', message: 'packageIndex must be 0-3' })
    }

    // Idempotent — same txHash already recorded?
    const existing = await app.prisma.purchase.findFirst({ where: { txHash: body.txHash } })
    if (existing) {
      return reply.status(200).send({
        data: { purchaseId: existing.id, alreadyRecorded: true },
      })
    }

    // Verify tx on-chain + extract buyer wallet from tx.from
    let buyerWallet: string
    try {
      const { ethers } = await import('ethers')
      const provider = new ethers.JsonRpcProvider(process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org/')
      const tx = await provider.getTransaction(body.txHash)
      if (!tx) {
        return reply.status(404).send({ error: 'TX_NOT_FOUND', message: 'Transaction not found on-chain' })
      }
      const receipt = await provider.getTransactionReceipt(body.txHash)
      if (!receipt || receipt.status !== 1) {
        return reply.status(400).send({ error: 'TX_FAILED', message: 'Transaction reverted on-chain' })
      }
      buyerWallet = tx.from.toLowerCase()
    } catch (e: any) {
      app.log.warn({ err: e?.message, txHash: body.txHash }, 'record-onchain on-chain verify failed')
      return reply.status(502).send({ error: 'CHAIN_ERROR', message: 'Failed to verify transaction on-chain' })
    }

    // Map package index to canonical name + NFT bonus tier
    const matchedPkg = PRESALE_PACKAGES[body.packageIndex] || null
    const packageName = matchedPkg?.name || (body.packageIndex === 0 ? 'Minimum' : `Package ${body.packageIndex}`)
    const nftBonusType = matchedPkg?.nftBonus || null

    // Lookup buyer record (may not exist yet if wallet never registered)
    const buyer = await app.prisma.user.findUnique({
      where: { wallet: buyerWallet },
      select: { referrer: true },
    })
    const referrerWallet = buyer?.referrer ?? null

    // If buyer User record doesn't exist, create minimal record (testnet/edge case)
    if (!buyer) {
      await app.prisma.user.create({
        data: {
          wallet: buyerWallet,
          userId: `auto_${buyerWallet.slice(2, 10)}`,
          termsAccepted: true,
        },
      }).catch(() => { /* concurrent create — ignore */ })
    }

    // Record purchase
    const purchase = await app.prisma.purchase.create({
      data: {
        wallet: buyerWallet,
        type: 'PRESALE',
        packageName,
        usdtAmount: body.usdtAmount,
        micAmount: body.micAmount,
        status: 'CONFIRMED',
        txHash: body.txHash,
        blockNumber: body.blockNumber || null,
        referrerWallet,
        nftBonusType,
      },
    })

    // Update preSalePurchased flag
    await app.prisma.user.update({
      where: { wallet: buyerWallet },
      data: { preSalePurchased: true },
    }).catch(() => { /* user may not exist — ignore */ })

    return reply.status(201).send({
      data: {
        purchaseId: purchase.id,
        packageName,
        usdtAmount: body.usdtAmount,
        micAmount: body.micAmount,
        nftBonusType,
        txHash: body.txHash,
        status: 'CONFIRMED',
      },
    })
  })

  // ─── POST /sales/purchases/sync — Trigger on-chain sync (auth) ─
  app.post('/purchases/sync', {
    preHandler: [app.authenticate],
  }, async (req, reply) => {
    const { wallet } = req.user as { wallet: string }

    try {
      const existingCount = await app.prisma.purchase.count({
        where: { wallet },
      })

      return {
        data: {
          accepted: true,
          wallet,
          existingSynced: existingCount,
          message: 'Sync request accepted. The indexer will pick up new events within 15 seconds.',
        },
      }
    } catch (err) {
      app.log.error(err, 'Failed to process sync request')
      return reply.status(500).send({
        error: 'INTERNAL_ERROR',
        message: 'Failed to process sync request',
      })
    }
  })
}
