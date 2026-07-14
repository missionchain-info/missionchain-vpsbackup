import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify'
import { isOwnerWallet } from '../plugins/rbac.js'

// ─── Admin auth preHandler ────────────────────────────────────────────────

async function requireAdmin(req: FastifyRequest, reply: FastifyReply) {
  await (req.server as any).authenticate(req, reply)
  const user = req.user as { role?: string; wallet?: string } | undefined
  const ownerOverride = isOwnerWallet(user?.wallet)
  if (!user || (!ownerOverride && (user as any).role !== 'ADMIN' && (user as any).role !== 'SUPER_ADMIN')) {
    return reply.status(403).send({ error: 'FORBIDDEN', message: 'Admin access required' })
  }
}

export const distributorRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAdmin)

  // ─── GET /admin/distributors — List all distributors ────────────────
  app.get('/', async (req, reply) => {
    const { page: pageStr, limit: limitStr, status: statusFilter } = req.query as {
      page?: string; limit?: string; status?: string
    }
    const page = Math.max(1, parseInt(pageStr ?? '1', 10) || 1)
    const limit = Math.min(100, Math.max(1, parseInt(limitStr ?? '20', 10) || 20))
    const skip = (page - 1) * limit

    const where: any = {}
    if (statusFilter === 'active') where.isActive = true
    if (statusFilter === 'disabled') where.isActive = false

    const [distributors, total] = await Promise.all([
      app.prisma.distributor.findMany({ where, skip, take: limit, orderBy: { createdAt: 'desc' } }),
      app.prisma.distributor.count({ where }),
    ])

    return {
      data: distributors.map((d) => ({
        ...d,
        commissionRate: d.commissionRate.toString(),
        totalEarned: d.totalEarned.toString(),
      })),
      total,
      page,
      limit,
    }
  })

  // ─── GET /admin/distributors/stats — Aggregate stats ────────────────
  app.get('/stats', async (req, reply) => {
    const [total, active, aggregates] = await Promise.all([
      app.prisma.distributor.count(),
      app.prisma.distributor.count({ where: { isActive: true } }),
      app.prisma.distributor.aggregate({
        _sum: { totalEarned: true, totalOrders: true },
      }),
    ])
    return {
      totalDistributors: total,
      activeCount: active,
      disabledCount: total - active,
      totalEarned: (aggregates._sum.totalEarned ?? 0).toString(),
      totalOrders: aggregates._sum.totalOrders ?? 0,
    }
  })

  // ─── POST /admin/distributors — Grant new distributor ───────────────
  app.post('/', async (req, reply) => {
    const body = req.body as { wallet?: string; commissionRate?: number; notes?: string }
    const { wallet: adminWallet } = req.user as { wallet: string }

    if (!body.wallet) {
      return reply.status(400).send({ error: 'BAD_REQUEST', message: 'wallet is required' })
    }

    // Validate commissionRate (range 0–0.20 i.e. 0%–20%, business rule per anh Apr 30 2026)
    const rate = body.commissionRate ?? 0.20
    if (typeof rate !== 'number' || isNaN(rate) || rate < 0 || rate > 0.20) {
      return reply.status(400).send({
        error: 'BAD_REQUEST',
        message: 'commissionRate must be between 0 and 0.20 (0%–20%)',
      })
    }

    const wallet = body.wallet.toLowerCase()

    // Validate wallet is a registered user
    const user = await app.prisma.user.findUnique({ where: { wallet } })
    if (!user) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'Wallet is not a registered user' })
    }

    // Check duplicate
    const existing = await app.prisma.distributor.findUnique({ where: { wallet } })
    if (existing) {
      return reply.status(409).send({ error: 'CONFLICT', message: 'Wallet is already a distributor' })
    }

    const distributor = await app.prisma.distributor.create({
      data: {
        wallet,
        grantedBy: adminWallet,
        commissionRate: rate,
        notes: body.notes || null,
      },
    })

    return reply.status(201).send({
      data: {
        ...distributor,
        commissionRate: distributor.commissionRate.toString(),
        totalEarned: distributor.totalEarned.toString(),
      },
    })
  })

  // ─── PUT /admin/distributors/:wallet — Update distributor ───────────
  app.put('/:wallet', async (req, reply) => {
    const { wallet } = req.params as { wallet: string }
    const body = req.body as { isActive?: boolean; commissionRate?: number; notes?: string }
    const w = wallet.toLowerCase()

    const distributor = await app.prisma.distributor.findUnique({ where: { wallet: w } })
    if (!distributor) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'Distributor not found' })
    }

    // Validate commissionRate if provided (0–0.20 range, max 20%)
    if (body.commissionRate !== undefined) {
      if (typeof body.commissionRate !== 'number' || isNaN(body.commissionRate) ||
          body.commissionRate < 0 || body.commissionRate > 0.20) {
        return reply.status(400).send({
          error: 'BAD_REQUEST',
          message: 'commissionRate must be between 0 and 0.20 (0%–20%)',
        })
      }
    }

    const updated = await app.prisma.distributor.update({
      where: { wallet: w },
      data: {
        ...(body.isActive !== undefined && { isActive: body.isActive }),
        ...(body.commissionRate !== undefined && { commissionRate: body.commissionRate }),
        ...(body.notes !== undefined && { notes: body.notes }),
      },
    })

    return {
      data: {
        ...updated,
        commissionRate: updated.commissionRate.toString(),
        totalEarned: updated.totalEarned.toString(),
      },
    }
  })

  // ─── DELETE /admin/distributors/:wallet — Delete distributor ─────────
  app.delete('/:wallet', async (req, reply) => {
    const { wallet } = req.params as { wallet: string }
    const w = wallet.toLowerCase()

    const distributor = await app.prisma.distributor.findUnique({ where: { wallet: w } })
    if (!distributor) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'Distributor not found' })
    }

    // Block delete if earnings exist
    const earningsCount = await app.prisma.distributorEarning.count({ where: { distributorWallet: w } })
    if (earningsCount > 0) {
      return reply.status(409).send({
        error: 'CONFLICT',
        message: `Cannot delete: ${earningsCount} earnings exist. Disable instead.`,
      })
    }

    await app.prisma.distributor.delete({ where: { wallet: w } })
    return { success: true }
  })

  // ─── GET /admin/distributors/:wallet/earnings — Earnings history ────
  app.get('/:wallet/earnings', async (req, reply) => {
    const { wallet } = req.params as { wallet: string }
    const { page: pageStr, limit: limitStr } = req.query as { page?: string; limit?: string }
    const page = Math.max(1, parseInt(pageStr ?? '1', 10) || 1)
    const limit = Math.min(100, Math.max(1, parseInt(limitStr ?? '20', 10) || 20))
    const skip = (page - 1) * limit
    const w = wallet.toLowerCase()

    const [earnings, total] = await Promise.all([
      app.prisma.distributorEarning.findMany({
        where: { distributorWallet: w },
        skip, take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      app.prisma.distributorEarning.count({ where: { distributorWallet: w } }),
    ])

    return {
      data: earnings.map((e) => ({
        ...e,
        orderAmount: e.orderAmount.toString(),
        commission: e.commission.toString(),
      })),
      total,
      page,
      limit,
    }
  })

  // ─── POST /admin/distributors/backfill-commissions ───────────────────
  // Scans Purchase rows where referrerWallet is null but the buyer has a
  // registered referrer that IS an active Distributor. Creates the missing
  // DistributorEarning + updates Purchase.referrerWallet + Distributor stats.
  // Idempotent — safe to run multiple times. Re-running on already-fixed rows
  // is a no-op because Purchase.referrerWallet is no longer null after the fix.
  app.post('/backfill-commissions', async (req, reply) => {
    const orphans = await app.prisma.purchase.findMany({
      where: {
        referrerWallet: null,
        type: 'SEED',
      },
      select: {
        id: true,
        wallet: true,
        usdtAmount: true,
        type: true,
        createdAt: true,
      },
    })

    const fixed: Array<{ purchaseId: string; buyer: string; distributor: string; commission: number }> = []
    const skipped: Array<{ purchaseId: string; reason: string }> = []

    for (const p of orphans) {
      try {
        await app.prisma.$transaction(async (tx) => {
          const buyer = await tx.user.findUnique({
            where: { wallet: p.wallet },
            select: { referrer: true },
          })
          if (!buyer?.referrer) {
            skipped.push({ purchaseId: p.id, reason: 'buyer has no referrer' })
            return
          }

          const distributor = await tx.distributor.findUnique({
            where: { wallet: buyer.referrer.toLowerCase() },
          })
          if (!distributor || !distributor.isActive) {
            // Still fix referrerWallet on Purchase for accurate audit trail
            await tx.purchase.update({
              where: { id: p.id },
              data: { referrerWallet: buyer.referrer },
            })
            skipped.push({ purchaseId: p.id, reason: 'referrer is not an active distributor' })
            return
          }

          // Idempotency guard: skip if an earning already exists for this purchase
          const existingEarning = await tx.distributorEarning.findFirst({
            where: { purchaseId: p.id },
          })
          if (existingEarning) {
            await tx.purchase.update({
              where: { id: p.id },
              data: { referrerWallet: buyer.referrer },
            })
            skipped.push({ purchaseId: p.id, reason: 'earning already exists' })
            return
          }

          const orderAmount = Number(p.usdtAmount)
          const commission = Number(distributor.commissionRate) * orderAmount

          await tx.purchase.update({
            where: { id: p.id },
            data: { referrerWallet: distributor.wallet },
          })

          await tx.distributorEarning.create({
            data: {
              distributorWallet: distributor.wallet,
              purchaseId: p.id,
              buyerWallet: p.wallet,
              orderAmount,
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

          fixed.push({
            purchaseId: p.id,
            buyer: p.wallet,
            distributor: distributor.wallet,
            commission,
          })
        })
      } catch (err: any) {
        skipped.push({ purchaseId: p.id, reason: `error: ${err?.message ?? 'unknown'}` })
      }
    }

    return {
      data: {
        scanned: orphans.length,
        fixed: fixed.length,
        skipped: skipped.length,
        details: { fixed, skipped },
      },
    }
  })

  // ─── GET /admin/distributors/:wallet/detail — Full distributor breakdown ───
  // Returns: distributor info + downline orders + commission earnings + payout requests history
  app.get('/:wallet/detail', async (req, reply) => {
    const { wallet } = req.params as { wallet: string }
    const w = wallet.toLowerCase()

    const [distributor, earnings, requests] = await Promise.all([
      app.prisma.distributor.findUnique({ where: { wallet: w } }),
      app.prisma.distributorEarning.findMany({
        where: { distributorWallet: w },
        orderBy: { createdAt: 'desc' },
        include: {
          purchase: {
            select: {
              id: true,
              wallet: true,
              type: true,
              packageName: true,
              usdtAmount: true,
              micAmount: true,
              txHash: true,
              createdAt: true,
            },
          },
        },
      }),
      app.prisma.payoutRequest.findMany({
        where: { distributorWallet: w },
        orderBy: { requestedAt: 'desc' },
      }),
    ])

    if (!distributor) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'Distributor not found' })
    }

    return {
      data: {
        distributor: {
          ...distributor,
          commissionRate: distributor.commissionRate.toString(),
          totalEarned: distributor.totalEarned.toString(),
        },
        earnings: earnings.map((e) => ({
          id: e.id,
          status: e.status,
          buyerWallet: e.buyerWallet,
          orderAmount: e.orderAmount.toString(),
          commission: e.commission.toString(),
          createdAt: e.createdAt,
          claimedAt: e.claimedAt,
          payoutRequestId: e.payoutRequestId,
          purchase: e.purchase ? {
            id: e.purchase.id,
            type: e.purchase.type,
            packageName: e.purchase.packageName,
            usdtAmount: e.purchase.usdtAmount.toString(),
            micAmount: e.purchase.micAmount.toString(),
            txHash: e.purchase.txHash,
            createdAt: e.purchase.createdAt,
          } : null,
        })),
        payoutRequests: requests.map((r) => ({
          id: r.id,
          status: r.status,
          grossAmount: r.grossAmount.toString(),
          feeBps: r.feeBps,
          feeAmount: r.feeAmount.toString(),
          netAmount: r.netAmount.toString(),
          earningCount: r.earningCount,
          requestedAt: r.requestedAt,
          approvedAt: r.approvedAt,
          approvedBy: r.approvedBy,
          rejectedAt: r.rejectedAt,
          rejectedReason: r.rejectedReason,
          paidAt: r.paidAt,
          paidTxHash: r.paidTxHash,
        })),
      },
    }
  })

  // ─── GET /admin/distributors/payout-requests — All payout requests ───
  app.get('/payout-requests', async (req, reply) => {
    const { status, page: pageStr, limit: limitStr } = req.query as {
      status?: string; page?: string; limit?: string
    }
    const page = Math.max(1, parseInt(pageStr ?? '1', 10) || 1)
    const limit = Math.min(100, Math.max(1, parseInt(limitStr ?? '50', 10) || 50))
    const skip = (page - 1) * limit

    const where: any = {}
    if (status && ['PENDING', 'APPROVED', 'PAID', 'REJECTED'].includes(status)) {
      where.status = status
    }

    const [requests, total] = await Promise.all([
      app.prisma.payoutRequest.findMany({
        where, skip, take: limit,
        orderBy: { requestedAt: 'desc' },
      }),
      app.prisma.payoutRequest.count({ where }),
    ])

    return {
      data: requests.map((r) => ({
        id: r.id,
        distributorWallet: r.distributorWallet,
        status: r.status,
        grossAmount: r.grossAmount.toString(),
        feeBps: r.feeBps,
        feeAmount: r.feeAmount.toString(),
        netAmount: r.netAmount.toString(),
        earningCount: r.earningCount,
        requestedAt: r.requestedAt,
        approvedAt: r.approvedAt,
        approvedBy: r.approvedBy,
        paidAt: r.paidAt,
        paidBy: r.paidBy,
        paidTxHash: r.paidTxHash,
        rejectedAt: r.rejectedAt,
        rejectedBy: r.rejectedBy,
        rejectedReason: r.rejectedReason,
      })),
      total, page, limit,
    }
  })

  // ─── DEPRECATED: /payout-requests/:id/approve ───
  // Workflow simplified Apr 29: PENDING → PAID atomically via /approve-and-pay (Approve & Pay button).
  // No more intermediate APPROVED state. This endpoint is kept for backward compat but returns 410.
  app.post('/payout-requests/:id/approve', async (req, reply) => {
    return reply.status(410).send({
      error: 'ENDPOINT_DEPRECATED',
      message: 'Use POST /payout-requests/:id/approve-and-pay (executes USDT transfer + marks PAID in one call).',
    })
  })

  // ─── POST /admin/distributors/payout-requests/:id/reject ───
  app.post('/payout-requests/:id/reject', async (req, reply) => {
    const user = req.user as { wallet: string } | undefined
    const { id } = req.params as { id: string }
    const { reason } = (req.body ?? {}) as { reason?: string }

    if (!reason || reason.trim().length < 3) {
      return reply.status(400).send({ error: 'BAD_REASON', message: 'Rejection reason required (min 3 chars)' })
    }

    const request = await app.prisma.payoutRequest.findUnique({ where: { id } })
    if (!request) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'Payout request not found' })
    }
    if (!['PENDING', 'APPROVED'].includes(request.status)) {
      return reply.status(409).send({ error: 'BAD_STATE', message: `Cannot reject request in ${request.status} state` })
    }

    // Roll back earnings to PENDING for next request
    await app.prisma.$transaction(async (tx) => {
      await tx.distributorEarning.updateMany({
        where: { payoutRequestId: id },
        data: { status: 'PENDING', payoutRequestId: null },
      })
      await tx.payoutRequest.update({
        where: { id },
        data: {
          status: 'REJECTED',
          rejectedAt: new Date(),
          rejectedBy: user?.wallet,
          rejectedReason: reason.trim(),
        },
      })
    })

    return { data: { id, status: 'REJECTED', message: 'Request rejected. Earnings returned to pending.' } }
  })

  // ─── GET/PUT /admin/distributors/payout-config — Global fee % + receiver ───
  // SystemConfig keys: payout_fee_bps, payout_fee_receiver
  app.get('/payout-config', async (req, reply) => {
    const [feeRow, receiverRow] = await Promise.all([
      app.prisma.systemConfig.findUnique({ where: { key: 'payout_fee_bps' } }),
      app.prisma.systemConfig.findUnique({ where: { key: 'payout_fee_receiver' } }),
    ])
    return {
      data: {
        feeBps: feeRow ? Number(feeRow.value) : 0,
        feeReceiver: receiverRow?.value ?? '',
      },
    }
  })

  app.put('/payout-config', async (req, reply) => {
    const user = req.user as { wallet: string; role: string } | undefined
    if (!isOwnerWallet(user?.wallet)) {
      return reply.status(403).send({ error: 'FORBIDDEN', message: 'Forbidden' })
    }
    const { feeBps, feeReceiver } = (req.body ?? {}) as { feeBps?: number; feeReceiver?: string }

    const fee = Number(feeBps ?? 0)
    if (!Number.isInteger(fee) || fee < 0 || fee > 1000) {
      return reply.status(400).send({ error: 'BAD_FEE', message: 'feeBps must be 0-1000 (0%-10%)' })
    }
    if (fee > 0) {
      if (!feeReceiver || !/^0x[a-fA-F0-9]{40}$/.test(feeReceiver)) {
        return reply.status(400).send({ error: 'BAD_RECEIVER', message: 'Valid feeReceiver address required when fee > 0' })
      }
    }

    await app.prisma.systemConfig.upsert({
      where: { key: 'payout_fee_bps' },
      create: { key: 'payout_fee_bps', value: String(fee), updatedBy: user?.wallet },
      update: { value: String(fee), updatedBy: user?.wallet },
    })
    await app.prisma.systemConfig.upsert({
      where: { key: 'payout_fee_receiver' },
      create: { key: 'payout_fee_receiver', value: (feeReceiver ?? '').toLowerCase(), updatedBy: user?.wallet },
      update: { value: (feeReceiver ?? '').toLowerCase(), updatedBy: user?.wallet },
    })

    return { data: { feeBps: fee, feeReceiver: feeReceiver?.toLowerCase() ?? '', message: 'Payout config saved' } }
  })

  // ─── POST /admin/distributors/payout-requests/:id/approve-and-pay ───
  // Single-step: approve + immediately mark paid with txHash (admin executed USDT transfer client-side).
  // Combines /approve and /mark-paid for the new "Approve & Pay" button in Payment Requests page.
  // Fee policy: API ALWAYS reads saved global fee from SystemConfig (set by authorized admin via /payout-config).
  // Any admin (not just authorized admin) can call this — they simply use the global fee.
  app.post('/payout-requests/:id/approve-and-pay', async (req, reply) => {
    const user = req.user as { wallet: string; role: string } | undefined
    const { id } = req.params as { id: string }
    const { txHash } = (req.body ?? {}) as { txHash?: string }

    // Read saved global fee from SystemConfig (single source of truth)
    const savedFeeRow = await app.prisma.systemConfig.findUnique({ where: { key: 'payout_fee_bps' } })
    const fee = savedFeeRow ? Math.max(0, Math.min(1000, parseInt(savedFeeRow.value, 10) || 0)) : 0

    if (!txHash || txHash.length < 10) {
      return reply.status(400).send({ error: 'BAD_TX', message: 'Valid txHash required (USDT transfer must be executed before calling)' })
    }

    const request = await app.prisma.payoutRequest.findUnique({ where: { id } })
    if (!request) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'Payout request not found' })
    }
    if (request.status !== 'PENDING') {
      return reply.status(409).send({ error: 'BAD_STATE', message: `Request is ${request.status}, not PENDING` })
    }

    const gross = Number(request.grossAmount)
    const feeAmount = (gross * fee) / 10000
    const netAmount = gross - feeAmount
    const now = new Date()

    await app.prisma.$transaction(async (tx) => {
      await tx.payoutRequest.update({
        where: { id },
        data: {
          status: 'PAID',
          feeBps: fee,
          feeAmount,
          netAmount,
          approvedAt: now,
          approvedBy: user?.wallet,
          paidAt: now,
          paidBy: user?.wallet,
          paidTxHash: txHash,
        },
      })
      await tx.distributorEarning.updateMany({
        where: { payoutRequestId: id },
        data: { status: 'PAID', claimedAt: now, claimTxHash: txHash },
      })
    })

    return {
      data: {
        id, status: 'PAID', txHash, feeBps: fee, netAmount,
        message: `Payout completed. Net $${netAmount.toFixed(2)} sent. ${request.earningCount} earnings closed.`,
      },
    }
  })

  // ─── POST /admin/distributors/payout-requests/:id/mark-paid ───
  // Admin marks request as PAID after USDT transfer; records claimTxHash on each linked earning.
  app.post('/payout-requests/:id/mark-paid', async (req, reply) => {
    const user = req.user as { wallet: string } | undefined
    const { id } = req.params as { id: string }
    const { txHash } = (req.body ?? {}) as { txHash?: string }

    if (!txHash || txHash.length < 10) {
      return reply.status(400).send({ error: 'BAD_TX', message: 'Valid txHash required' })
    }

    const request = await app.prisma.payoutRequest.findUnique({ where: { id } })
    if (!request) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'Payout request not found' })
    }
    // Accept PENDING (skip APPROVED state — Apr 29 workflow simplification)
    if (!['PENDING', 'APPROVED'].includes(request.status)) {
      return reply.status(409).send({ error: 'BAD_STATE', message: `Request must be PENDING or APPROVED for mark-paid (current: ${request.status})` })
    }

    const now = new Date()
    await app.prisma.$transaction(async (tx) => {
      await tx.distributorEarning.updateMany({
        where: { payoutRequestId: id },
        data: { status: 'PAID', claimedAt: now, claimTxHash: txHash },
      })
      await tx.payoutRequest.update({
        where: { id },
        data: {
          status: 'PAID',
          approvedAt: request.approvedAt ?? now,
          approvedBy: request.approvedBy ?? user?.wallet,
          paidAt: now,
          paidBy: user?.wallet,
          paidTxHash: txHash,
        },
      })
    })

    return { data: { id, status: 'PAID', txHash, message: `Marked as PAID. ${request.earningCount} earnings closed.` } }
  })
}
