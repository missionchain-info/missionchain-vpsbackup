import { FastifyPluginAsync } from 'fastify'
import { requireAdmin, isOwnerWallet } from '../plugins/rbac.js'
import { executeOldInvestorRequest } from '../services/oldInvestorRelayer.js'

/**
 * Old Investors 75M strategic partner allocation — pending-request workflow.
 *
 * Lifecycle: PENDING (24h cooldown for review) → DONE (executed on-chain) | CANCELLED.
 * Cooldown is a REVIEW WINDOW, not a rate limit. Server cron auto-executes after
 * cooldownEnd. authorized admin can Cancel during cooldown OR "Chuyển ngay" (immediate).
 *
 * Smart contract: SeedSale.adminGrantOldInvestor(recipient, micAmount, startTime)
 *   - 75M MIC pool tracked via oldInvestorsGranted
 *   - Backdateable startTime
 *
 * Endpoints:
 *   - GET  /admin/seed/old-investors/stats               — aggregate (any admin)
 *   - GET  /admin/seed/old-investors/requests            — paginated list (any admin)
 *   - POST /admin/seed/old-investors/request             — create PENDING (any admin)
 *   - POST /admin/seed/old-investors/request/:id/cancel  — authorized admin only
 *   - POST /admin/seed/old-investors/request/:id/execute — "Chuyển ngay" (authorized admin only)
 */

const ALLOCATION_MIC = 75_000_000
const COOLDOWN_HOURS = 24

export const oldInvestorsRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAdmin)

  // ─── GET /stats — aggregate dashboard numbers ─────────────────────────
  app.get('/stats', async (_req, reply) => {
    const done = await app.prisma.oldInvestorRequest.findMany({
      where: { status: 'DONE' },
      orderBy: { executedAt: 'desc' },
    })
    const pending = await app.prisma.oldInvestorRequest.count({ where: { status: 'PENDING' } })
    const cancelled = await app.prisma.oldInvestorRequest.count({ where: { status: 'CANCELLED' } })

    let grantedSum = 0
    const recipients = new Set<string>()
    for (const g of done) {
      grantedSum += Number(g.micAmount)
      recipients.add(g.recipient.toLowerCase())
    }
    // Pending requests reserve their amount toward the 75M cap (defensive)
    const pendingRows = await app.prisma.oldInvestorRequest.findMany({
      where: { status: 'PENDING' },
      select: { micAmount: true },
    })
    const pendingSum = pendingRows.reduce((s, r) => s + Number(r.micAmount), 0)

    const last = done[0] ?? null

    return reply.send({
      data: {
        allocationMic: ALLOCATION_MIC,
        grantedMic: grantedSum,
        pendingMic: pendingSum,
        remainingMic: Math.max(0, ALLOCATION_MIC - grantedSum - pendingSum),
        recipientsCount: recipients.size,
        grantsCount: done.length,
        pendingCount: pending,
        cancelledCount: cancelled,
        lastGrantAt: last?.executedAt ?? null,
        lastGrantedBy: last?.executedBy ?? null,
        cooldownHours: COOLDOWN_HOURS,
      },
    })
  })

  // ─── GET /requests — paginated list (all statuses, default newest first) ──
  app.get('/requests', async (req, reply) => {
    const {
      limit: limitStr,
      offset: offsetStr,
      status,
    } = req.query as { limit?: string; offset?: string; status?: string }

    const limit = Math.min(parseInt(limitStr || '50', 10) || 50, 200)
    const offset = parseInt(offsetStr || '0', 10) || 0

    const where = status ? { status } : {}

    const [rows, total] = await Promise.all([
      app.prisma.oldInvestorRequest.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      app.prisma.oldInvestorRequest.count({ where }),
    ])

    // Lookup userIds for recipient + requestedBy + executedBy + cancelledBy
    const wallets = new Set<string>()
    for (const r of rows) {
      wallets.add(r.recipient.toLowerCase())
      wallets.add(r.requestedBy.toLowerCase())
      if (r.executedBy && r.executedBy !== 'CRON') wallets.add(r.executedBy.toLowerCase())
      if (r.cancelledBy) wallets.add(r.cancelledBy.toLowerCase())
    }
    const users = await app.prisma.user.findMany({
      where: { wallet: { in: Array.from(wallets) } },
      select: { wallet: true, userId: true },
    })
    const userMap = new Map(users.map((u) => [u.wallet.toLowerCase(), u.userId]))

    return reply.send({
      data: rows.map((r) => ({
        id: r.id,
        recipient: r.recipient,
        recipientUserId: userMap.get(r.recipient.toLowerCase()) ?? null,
        micAmount: Number(r.micAmount),
        startTime: r.startTime,
        note: r.note,
        status: r.status,
        requestedBy: r.requestedBy,
        requestedByUserId: userMap.get(r.requestedBy.toLowerCase()) ?? null,
        cooldownEnd: r.cooldownEnd,
        executedAt: r.executedAt,
        executedBy: r.executedBy,
        executedByUserId:
          r.executedBy && r.executedBy !== 'CRON'
            ? userMap.get(r.executedBy.toLowerCase()) ?? null
            : r.executedBy === 'CRON'
              ? 'cron'
              : null,
        txHash: r.txHash,
        blockNumber: r.blockNumber,
        executeError: r.executeError,
        cancelledAt: r.cancelledAt,
        cancelledBy: r.cancelledBy,
        cancelReason: r.cancelReason,
        createdAt: r.createdAt,
      })),
      total,
      limit,
      offset,
    })
  })

  // ─── POST /request — create PENDING request (any admin) ────────────────
  app.post('/request', async (req, reply) => {
    const user = req.user as { wallet: string; role: string } | undefined
    if (!user) {
      return reply.status(401).send({ error: 'UNAUTHORIZED', message: 'Authentication required' })
    }

    const body = req.body as {
      recipient?: string
      micAmount?: number
      startTime?: string | number
      note?: string
    }

    if (!body.recipient || !/^0x[a-fA-F0-9]{40}$/.test(body.recipient)) {
      return reply.status(400).send({ error: 'BAD_REQUEST', message: 'Invalid recipient wallet' })
    }
    if (!body.micAmount || body.micAmount <= 0) {
      return reply.status(400).send({ error: 'BAD_REQUEST', message: 'micAmount must be > 0' })
    }
    if (!body.startTime) {
      return reply.status(400).send({ error: 'BAD_REQUEST', message: 'startTime required' })
    }

    const startTimeDate =
      typeof body.startTime === 'number'
        ? new Date(body.startTime * 1000)
        : new Date(body.startTime)
    if (isNaN(startTimeDate.getTime())) {
      return reply.status(400).send({ error: 'BAD_REQUEST', message: 'Invalid startTime' })
    }

    // Pool cap check (defensive — counts DONE + PENDING)
    const grantedAgg = await app.prisma.oldInvestorRequest.aggregate({
      where: { status: { in: ['DONE', 'PENDING'] } },
      _sum: { micAmount: true },
    })
    const reserved = Number(grantedAgg._sum.micAmount ?? 0)
    if (reserved + body.micAmount > ALLOCATION_MIC) {
      return reply.status(400).send({
        error: 'BAD_REQUEST',
        message: `Would exceed 75M pool. Available (excluding pending): ${ALLOCATION_MIC - reserved} MIC`,
      })
    }

    const now = new Date()
    const cooldownEnd = new Date(now.getTime() + COOLDOWN_HOURS * 3600 * 1000)

    const request = await app.prisma.oldInvestorRequest.create({
      data: {
        recipient: body.recipient.toLowerCase(),
        micAmount: body.micAmount,
        startTime: startTimeDate,
        note: body.note?.trim() || null,
        status: 'PENDING',
        requestedBy: user.wallet.toLowerCase(),
        cooldownEnd,
      },
    })

    return reply.status(201).send({ data: request })
  })

  // ─── POST /request/:id/cancel — authorized admin only ────────────────────────
  app.post<{ Params: { id: string }; Body: { reason?: string } }>(
    '/request/:id/cancel',
    async (req, reply) => {
      const user = req.user as { wallet: string; role: string } | undefined
      if (!user) {
        return reply.status(401).send({ error: 'UNAUTHORIZED', message: 'Authentication required' })
      }
      if (!isOwnerWallet(user.wallet)) {
        return reply.status(403).send({ error: 'FORBIDDEN', message: 'Forbidden' })
      }

      const { id } = req.params
      const reason = req.body?.reason?.trim() || null

      const existing = await app.prisma.oldInvestorRequest.findUnique({ where: { id } })
      if (!existing) {
        return reply.status(404).send({ error: 'NOT_FOUND', message: 'Request not found' })
      }
      if (existing.status !== 'PENDING') {
        return reply.status(409).send({
          error: 'CONFLICT',
          message: `Cannot cancel — current status: ${existing.status}`,
        })
      }

      const updated = await app.prisma.oldInvestorRequest.update({
        where: { id },
        data: {
          status: 'CANCELLED',
          cancelledAt: new Date(),
          cancelledBy: user.wallet.toLowerCase(),
          cancelReason: reason,
        },
      })

      return reply.send({ data: updated })
    },
  )

  // ─── POST /request/:id/execute — "Chuyển ngay" (authorized admin, server signs) ──
  app.post<{ Params: { id: string } }>('/request/:id/execute', async (req, reply) => {
    const user = req.user as { wallet: string; role: string } | undefined
    if (!user) {
      return reply.status(401).send({ error: 'UNAUTHORIZED', message: 'Authentication required' })
    }
    if (!isOwnerWallet(user.wallet)) {
      return reply.status(403).send({ error: 'FORBIDDEN', message: 'Forbidden' })
    }

    const { id } = req.params
    const existing = await app.prisma.oldInvestorRequest.findUnique({ where: { id } })
    if (!existing) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'Request not found' })
    }
    if (existing.status !== 'PENDING') {
      return reply.status(409).send({
        error: 'CONFLICT',
        message: `Cannot execute — current status: ${existing.status}`,
      })
    }

    try {
      const result = await executeOldInvestorRequest(app, existing.id, user.wallet.toLowerCase())
      return reply.send({ data: result })
    } catch (e: any) {
      app.log.error({ err: e, requestId: id }, 'Old Investor execute-now failed')
      return reply.status(500).send({
        error: 'EXECUTE_FAILED',
        message: e?.shortMessage || e?.message || 'On-chain execution failed',
      })
    }
  })
}
