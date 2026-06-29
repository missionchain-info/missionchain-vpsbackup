/**
 * STEWARD COUNCIL — master member registry.
 *
 * Phase 2c-pivot 2 (May 8, 2026): every Owner Add/Edit/Delete is now sent
 * on-chain FIRST via the deployer relayer (StewardCouncil contract), then
 * mirrored to the DB. If the on-chain tx reverts, the DB write is skipped
 * and the route returns 502 — no more DB-ahead-of-chain drift.
 *
 * Owner-only Add/Edit/Delete. All admins can read.
 * Real Owner identity = isOwnerWallet(req.user.wallet).
 */
import { FastifyPluginAsync } from 'fastify'
import { requireAdmin, isOwnerWallet, auditLog, auditCtx } from '../plugins/rbac.js'
import {
  submitAddCouncilMember,
  submitUpdateCouncilMember,
  submitSetCouncilActive,
  submitRemoveCouncilMember,
  extractRevertReason,
} from '../services/onChainAdminWrites.js'

export const stewardCouncilRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAdmin)

  // ─── GET /admin/steward-council ───────────────────────────────────────
  app.get('/', async (req, reply) => {
    const members = await app.prisma.stewardCouncilMember.findMany({
      orderBy: { createdAt: 'asc' },
      include: { operationalShare: true },
    })
    return reply.send({ data: members })
  })

  // ─── GET /admin/steward-council/search-user?q= ─────────────────────────
  // Helper for council picker UI: find registered users by userId or wallet substring.
  app.get('/search-user', async (req, reply) => {
    const { q } = req.query as { q?: string }
    if (!q || q.length < 2) return reply.send({ data: [] })
    const term = q.toLowerCase()
    const users = await app.prisma.user.findMany({
      where: {
        OR: [
          { userId: { contains: term, mode: 'insensitive' as const } },
          { wallet: { contains: term, mode: 'insensitive' as const } },
        ],
      },
      select: { userId: true, wallet: true, kycStatus: true },
      take: 10,
    })
    return reply.send({ data: users })
  })

  // ─── GET /admin/steward-council/:wallet ───────────────────────────────
  app.get<{ Params: { wallet: string } }>('/:wallet', async (req, reply) => {
    const wallet = req.params.wallet.toLowerCase()
    const m = await app.prisma.stewardCouncilMember.findUnique({
      where: { wallet },
      include: { operationalShare: true },
    })
    if (!m) return reply.status(404).send({ error: 'NOT_FOUND' })
    return reply.send({ data: m })
  })

  // ─── POST /admin/steward-council — Owner adds new member ──────────────
  app.post('/', async (req, reply) => {
    const { wallet: callerWallet } = req.user as { wallet: string }
    if (!isOwnerWallet(callerWallet)) {
      return reply.status(403).send({ error: 'FORBIDDEN', message: 'Forbidden' })
    }

    const body = req.body as {
      memberId?: string
      wallet?: string
      role?: string
      rightLabel?: string
      note?: string
    }

    if (!body.memberId || !body.wallet || !body.role) {
      return reply.status(400).send({ error: 'BAD_REQUEST', message: 'memberId, wallet, role required' })
    }
    if (!/^0x[a-fA-F0-9]{40}$/.test(body.wallet)) {
      return reply.status(400).send({ error: 'BAD_REQUEST', message: 'Invalid wallet address' })
    }
    const wallet = body.wallet.toLowerCase()

    // Strict: User must already be registered (KYC + sign-nonce flow completed)
    const existingUser = await app.prisma.user.findUnique({
      where: { wallet },
      select: { userId: true, kycStatus: true },
    })
    if (!existingUser) {
      return reply.status(400).send({
        error: 'NOT_REGISTERED',
        message: 'Wallet must be a registered user (complete sign-up flow first)',
      })
    }
    // Member ID must match the registered userId
    if (existingUser.userId !== body.memberId) {
      return reply.status(400).send({
        error: 'MEMBER_ID_MISMATCH',
        message: `Member ID must match the registered userId for this wallet (registered as "${existingUser.userId}")`,
      })
    }

    // Step 1 — submit on-chain via deployer relayer. If revert, abort.
    let txHash: string
    try {
      const r = await submitAddCouncilMember({
        wallet,
        memberId: body.memberId,
        role: body.role,
        rightLabel: body.rightLabel || 'Admin',
        note: body.note ?? '',
      })
      txHash = r.txHash
    } catch (e: any) {
      app.log.error({ err: e?.message, wallet }, 'steward-council on-chain addMember failed')
      return reply.status(502).send({
        error: 'CHAIN_ERROR',
        message: `On-chain addMember reverted: ${extractRevertReason(e)}`,
      })
    }

    // Step 2 — mirror to DB. On-chain succeeded; DB is just a denormalized cache.
    try {
      const created = await app.prisma.stewardCouncilMember.create({
        data: {
          memberId:   body.memberId,
          wallet,
          role:       body.role,
          rightLabel: body.rightLabel || 'Admin',
          note:       body.note ?? null,
          active:     true,
        },
      })
      auditLog(app, auditCtx(req, 'steward.council.add', wallet, { memberId: body.memberId, role: body.role, txHash }))
      return reply.status(201).send({ data: created, txHash })
    } catch (e: any) {
      if (e?.code === 'P2002') {
        // On-chain succeeded but DB already has this row (rare race). Surface as warning, not failure.
        app.log.warn({ wallet, txHash }, 'steward-council on-chain ok but DB unique conflict — already mirrored')
        return reply.status(200).send({
          data: await app.prisma.stewardCouncilMember.findUnique({ where: { wallet } }),
          txHash,
          warning: 'DB row already existed; on-chain tx confirmed.',
        })
      }
      throw e
    }
  })

  // ─── PUT /admin/steward-council/:wallet — Owner edits member ──────────
  app.put<{ Params: { wallet: string } }>('/:wallet', async (req, reply) => {
    const { wallet: callerWallet } = req.user as { wallet: string }
    if (!isOwnerWallet(callerWallet)) {
      return reply.status(403).send({ error: 'FORBIDDEN', message: 'Forbidden' })
    }

    const wallet = req.params.wallet.toLowerCase()
    const body = req.body as {
      role?: string
      rightLabel?: string
      note?: string
      active?: boolean
    }

    // Need current row to fill any field the user didn't change (contract.updateMember
    // requires all 3 string fields; setActive is separate).
    const existing = await app.prisma.stewardCouncilMember.findUnique({ where: { wallet } })
    if (!existing) {
      return reply.status(404).send({ error: 'NOT_FOUND' })
    }

    const data: Record<string, unknown> = {}
    if (body.role !== undefined) data.role = body.role
    if (body.rightLabel !== undefined) data.rightLabel = body.rightLabel
    if (body.note !== undefined) data.note = body.note
    if (body.active !== undefined) data.active = body.active

    const txs: string[] = []

    // Step 1a — if role/rightLabel/note changed, submit updateMember on-chain.
    const metaChanged =
      body.role !== undefined || body.rightLabel !== undefined || body.note !== undefined
    if (metaChanged) {
      try {
        const r = await submitUpdateCouncilMember({
          wallet,
          role: body.role ?? existing.role,
          rightLabel: body.rightLabel ?? existing.rightLabel,
          note: body.note ?? existing.note ?? '',
        })
        txs.push(r.txHash)
      } catch (e: any) {
        app.log.error({ err: e?.message, wallet }, 'steward-council on-chain updateMember failed')
        return reply.status(502).send({
          error: 'CHAIN_ERROR',
          message: `On-chain updateMember reverted: ${extractRevertReason(e)}`,
        })
      }
    }

    // Step 1b — if active flag changed, submit setActive on-chain.
    if (body.active !== undefined && body.active !== existing.active) {
      try {
        const r = await submitSetCouncilActive({ wallet, active: body.active })
        txs.push(r.txHash)
      } catch (e: any) {
        app.log.error({ err: e?.message, wallet }, 'steward-council on-chain setActive failed')
        return reply.status(502).send({
          error: 'CHAIN_ERROR',
          message: `On-chain setActive reverted: ${extractRevertReason(e)}`,
        })
      }
    }

    // Step 2 — mirror to DB.
    try {
      const updated = await app.prisma.stewardCouncilMember.update({
        where: { wallet },
        data,
      })
      auditLog(app, auditCtx(req, 'steward.council.update', wallet, { ...data, txs }))
      return reply.send({ data: updated, txs })
    } catch (e: any) {
      if (e?.code === 'P2025') {
        return reply.status(404).send({ error: 'NOT_FOUND' })
      }
      throw e
    }
  })

  // ─── DELETE /admin/steward-council/:wallet — Owner removes member ─────
  app.delete<{ Params: { wallet: string } }>('/:wallet', async (req, reply) => {
    const { wallet: callerWallet } = req.user as { wallet: string }
    if (!isOwnerWallet(callerWallet)) {
      return reply.status(403).send({ error: 'FORBIDDEN', message: 'Forbidden' })
    }

    const wallet = req.params.wallet.toLowerCase()

    // Step 1 — remove on-chain first.
    let txHash: string
    try {
      const r = await submitRemoveCouncilMember(wallet)
      txHash = r.txHash
    } catch (e: any) {
      app.log.error({ err: e?.message, wallet }, 'steward-council on-chain removeMember failed')
      return reply.status(502).send({
        error: 'CHAIN_ERROR',
        message: `On-chain removeMember reverted: ${extractRevertReason(e)}`,
      })
    }

    // Step 2 — mirror to DB.
    try {
      await app.prisma.stewardCouncilMember.delete({ where: { wallet } })
      auditLog(app, auditCtx(req, 'steward.council.delete', wallet, { txHash }))
      return reply.send({ success: true, txHash })
    } catch (e: any) {
      if (e?.code === 'P2025') {
        // On-chain succeeded; DB already missing the row. Idempotent — treat as success.
        app.log.warn({ wallet, txHash }, 'steward-council on-chain delete ok but DB row already missing')
        return reply.send({ success: true, txHash, warning: 'DB row was already missing.' })
      }
      throw e
    }
  })
}
