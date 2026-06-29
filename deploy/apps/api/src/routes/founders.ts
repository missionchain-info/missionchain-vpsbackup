import { FastifyPluginAsync } from 'fastify'
import { requireAdmin, isOwnerWallet } from '../plugins/rbac.js'
import { executeFounderRequest } from '../services/founderRelayer.js'

/**
 * Founders & Management 280M MIC allocation — pending-request workflow.
 *
 * Lifecycle: PENDING (48h cooldown for Owner review) → DONE (executed on-chain) | CANCELLED.
 * Cooldown is a REVIEW WINDOW. Server cron auto-executes after cooldownEnd.
 * Owner can Cancel during cooldown OR "Execute Now" (immediate).
 *
 * Smart contract: FoundersVault.distributeFounder(recipient, micAmount, 0, role)
 *   - mfpCount=0 — Founders MFP grants are managed separately via Grant Mint
 *   - 280M MIC pool tracked via totalMicDistributed
 *   - Vesting created on-chain by LockManager: 24m cliff + 10% + 2.5%/month
 *
 * Endpoints:
 *   - GET  /admin/founders/stats               — aggregate (any admin)
 *   - GET  /admin/founders/requests            — paginated list (any admin)
 *   - POST /admin/founders/request             — create PENDING (any admin)
 *   - POST /admin/founders/request/:id/cancel  — Owner only
 *   - POST /admin/founders/request/:id/execute — Owner-only "Execute Now"
 */

const ALLOCATION_MIC = 280_000_000
const COOLDOWN_HOURS = 48

export const foundersRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAdmin)

  // ─── GET /stats — aggregate dashboard numbers ─────────────────────────
  app.get('/stats', async (_req, reply) => {
    const done = await app.prisma.founderRequest.findMany({
      where: { status: 'DONE' },
      orderBy: { executedAt: 'desc' },
    })
    const pending = await app.prisma.founderRequest.count({ where: { status: 'PENDING' } })
    const cancelled = await app.prisma.founderRequest.count({ where: { status: 'CANCELLED' } })

    let grantedSum = 0
    const recipients = new Set<string>()
    for (const g of done) {
      grantedSum += Number(g.micAmount)
      recipients.add(g.recipient.toLowerCase())
    }
    // Pending requests reserve their amount toward the 280M cap (defensive)
    const pendingRows = await app.prisma.founderRequest.findMany({
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

  // ─── GET /requests — paginated list ────────────────────────────────────
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
      app.prisma.founderRequest.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      app.prisma.founderRequest.count({ where }),
    ])

    // Resolve userIds for non-recipient wallets (recipient already has memberId column)
    const wallets = new Set<string>()
    for (const r of rows) {
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
        memberId: r.memberId,
        recipient: r.recipient,
        micAmount: Number(r.micAmount),
        role: r.role,
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

  // ─── GET /lookup-member?memberId=... — resolve memberId → wallet ───────
  // Used by admin form to auto-fill recipient when typing memberId.
  app.get('/lookup-member', async (req, reply) => {
    const { memberId } = req.query as { memberId?: string }
    if (!memberId || !memberId.trim()) {
      return reply.status(400).send({ error: 'BAD_REQUEST', message: 'memberId required' })
    }
    const user = await app.prisma.user.findUnique({
      where: { userId: memberId.trim() },
      select: { userId: true, wallet: true, kycStatus: true, role: true },
    })
    if (!user) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'Member ID not found' })
    }
    return reply.send({ data: user })
  })

  // ─── POST /request — create PENDING (any admin) ────────────────────────
  app.post('/request', async (req, reply) => {
    const user = req.user as { wallet: string; role: string } | undefined
    if (!user) {
      return reply.status(401).send({ error: 'UNAUTHORIZED', message: 'Authentication required' })
    }

    const body = req.body as {
      memberId?: string
      micAmount?: number
      role?: string
      note?: string
    }

    if (!body.memberId || !body.memberId.trim()) {
      return reply.status(400).send({ error: 'BAD_REQUEST', message: 'memberId required' })
    }
    if (!body.micAmount || body.micAmount <= 0) {
      return reply.status(400).send({ error: 'BAD_REQUEST', message: 'micAmount must be > 0' })
    }
    if (!body.role || !body.role.trim()) {
      return reply.status(400).send({ error: 'BAD_REQUEST', message: 'role required' })
    }

    // Resolve memberId → wallet via User table
    const member = await app.prisma.user.findUnique({
      where: { userId: body.memberId.trim() },
      select: { userId: true, wallet: true },
    })
    if (!member) {
      return reply.status(400).send({
        error: 'BAD_REQUEST',
        message: `Member ID "${body.memberId}" not found in users table`,
      })
    }

    // Pool cap check (counts DONE + PENDING)
    const reservedAgg = await app.prisma.founderRequest.aggregate({
      where: { status: { in: ['DONE', 'PENDING'] } },
      _sum: { micAmount: true },
    })
    const reserved = Number(reservedAgg._sum.micAmount ?? 0)
    if (reserved + body.micAmount > ALLOCATION_MIC) {
      return reply.status(400).send({
        error: 'BAD_REQUEST',
        message: `Would exceed 280M pool. Available (excluding pending): ${ALLOCATION_MIC - reserved} MIC`,
      })
    }

    const now = new Date()
    const cooldownEnd = new Date(now.getTime() + COOLDOWN_HOURS * 3600 * 1000)

    const request = await app.prisma.founderRequest.create({
      data: {
        memberId: member.userId,
        recipient: member.wallet.toLowerCase(),
        micAmount: body.micAmount,
        role: body.role.trim(),
        note: body.note?.trim() || null,
        status: 'PENDING',
        requestedBy: user.wallet.toLowerCase(),
        cooldownEnd,
      },
    })

    return reply.status(201).send({ data: request })
  })

  // ─── POST /request/:id/cancel — Owner only ────────────────────────
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

      const existing = await app.prisma.founderRequest.findUnique({ where: { id } })
      if (!existing) {
        return reply.status(404).send({ error: 'NOT_FOUND', message: 'Request not found' })
      }
      if (existing.status !== 'PENDING') {
        return reply.status(409).send({
          error: 'CONFLICT',
          message: `Cannot cancel — current status: ${existing.status}`,
        })
      }

      const updated = await app.prisma.founderRequest.update({
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

  // ─── POST /request/:id/execute — Owner-only "Execute Now" ──────────────
  app.post<{ Params: { id: string } }>('/request/:id/execute', async (req, reply) => {
    const user = req.user as { wallet: string; role: string } | undefined
    if (!user) {
      return reply.status(401).send({ error: 'UNAUTHORIZED', message: 'Authentication required' })
    }
    if (!isOwnerWallet(user.wallet)) {
      return reply.status(403).send({ error: 'FORBIDDEN', message: 'Forbidden' })
    }

    const { id } = req.params
    const existing = await app.prisma.founderRequest.findUnique({ where: { id } })
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
      const result = await executeFounderRequest(app, existing.id, user.wallet.toLowerCase())
      return reply.send({ data: result })
    } catch (e: any) {
      app.log.error({ err: e, requestId: id }, 'Founder execute-now failed')
      return reply.status(500).send({
        error: 'EXECUTE_FAILED',
        message: e?.shortMessage || e?.message || 'On-chain execution failed',
      })
    }
  })
}
