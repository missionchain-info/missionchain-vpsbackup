/**
 * OPERATIONAL POOL — 20% of SEED revenue distributed to council members.
 *
 * Phase 2c-pivot 2 (May 8, 2026): admin Add/Edit/Delete member is now
 * sent on-chain FIRST via deployer relayer (OperationalSalaryPoolV3),
 * then mirrored to DB. If on-chain reverts, DB write is skipped.
 * V5c/V3 cutover (Jun 23, 2026): replaces V5b/V2.
 *
 *   - GET /         → reads OperationalSalaryPoolV3 + SeedBudgetV5c
 *   - POST /members → on-chain enrollMember() then DB cache
 *   - PUT /members  → on-chain updateMember() then DB cache
 *   - DELETE /members → on-chain removeMember() then DB delete
 *   - POST /claim   → returns contract address + ABI for FE wallet-signed call.
 *                     The actual claim() runs on-chain; FE posts txHash via
 *                     /governance/funds-distribution/seed/claim for history.
 */
import { FastifyPluginAsync } from 'fastify'
import { requireAdmin, isOwnerWallet, auditLog, auditCtx } from '../plugins/rbac.js'
import {
  readSeedBudgetAllSlots,
  readOperationalPoolAllMembers,
  readSeedBudgetFee,
  readCurrentWeekIdx,
} from '../services/seedTreasury.js'
import {
  submitEnrollOperational,
  submitUpdateOperational,
  submitRemoveOperational,
  extractRevertReason,
} from '../services/onChainAdminWrites.js'
import { getActiveAddresses } from '@missionchain/sdk'

export const operationalPoolRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAdmin)

  // ─── GET /admin/seed-budget/operational — Pool stats + member list ────
  // On-chain reads from OperationalSalaryPoolV3 + SeedBudgetV5c.
  // Council DB metadata (memberId, role, active) merged in.
  app.get('/', async (_req, reply) => {
    try {
      const [slots, onChainMembers, weekIdx, fee, councilMembers] = await Promise.all([
        readSeedBudgetAllSlots(),
        readOperationalPoolAllMembers(),
        readCurrentWeekIdx(),
        readSeedBudgetFee(),
        app.prisma.stewardCouncilMember.findMany(),
      ])

      const councilByWallet = new Map(councilMembers.map((c) => [c.wallet.toLowerCase(), c]))
      const totalShareBps = onChainMembers.reduce((s, m) => s + m.sharePctBps, 0)
      const totalClaimable = onChainMembers.reduce((s, m) => s + m.claimable, 0)

      return reply.send({
        data: {
          members: onChainMembers.map((m) => {
            const c = councilByWallet.get(m.wallet)
            return {
              wallet:              m.wallet,
              memberId:            c?.memberId ?? '?',
              role:                c?.role ?? '',
              active:              c?.active ?? true,
              sharePctBps:         m.sharePctBps,
              weeklyMaxoutUsdt:    m.weeklyMaxoutUsdt,
              claimableUsdt:       m.claimable,
              totalClaimedUsdt:    m.totalClaimed,
              totalAllocatedUsdt:  (slots.operational.totalReceived * m.sharePctBps) / 10_000,
              allocatedThisWeek:   m.allocatedThisWeek,
            }
          }),
          totalShareBps,
          weekIdx,
          totalClaimable,
          totalAllocated:    slots.operational.totalReceived,
          totalClaimed:      slots.operational.totalReleased,
          slotBalance:       slots.operational.balance,
          fee: { feeBps: fee.feeBps, feeReceiver: fee.feeReceiver },
          contract: {
            seedBudgetV5c:            getActiveAddresses().SeedBudgetV5c,
            operationalSalaryPoolV3:  getActiveAddresses().OperationalSalaryPoolV3,
          },
        },
      })
    } catch (e: any) {
      app.log.error({ err: e?.message }, 'operational-pool GET on-chain read failed')
      return reply.status(502).send({ error: 'CHAIN_ERROR', message: 'Failed to read on-chain pool state' })
    }
  })

  // ─── POST /admin/seed-budget/operational/members — Owner enrolls in DB ──
  // After this, OWNER must also call OperationalSalaryPoolV3.enrollMember()
  // on-chain via wallet sign — this endpoint only persists the DB metadata.
  app.post('/members', async (req, reply) => {
    const { wallet: callerWallet } = req.user as { wallet: string }
    if (!isOwnerWallet(callerWallet)) {
      return reply.status(403).send({ error: 'FORBIDDEN', message: 'Forbidden' })
    }

    const body = req.body as {
      wallet?: string
      sharePctBps?: number
      weeklyMaxoutUsdt?: number
    }
    if (!body.wallet || body.sharePctBps == null || body.weeklyMaxoutUsdt == null) {
      return reply.status(400).send({ error: 'BAD_REQUEST', message: 'wallet, sharePctBps, weeklyMaxoutUsdt required' })
    }
    if (body.sharePctBps <= 0 || body.sharePctBps > 10000) {
      return reply.status(400).send({ error: 'BAD_REQUEST', message: 'sharePctBps must be 1-10000' })
    }
    if (body.weeklyMaxoutUsdt < 0) {
      return reply.status(400).send({ error: 'BAD_REQUEST', message: 'weeklyMaxoutUsdt must be >= 0' })
    }
    const wallet = body.wallet.toLowerCase()

    const council = await app.prisma.stewardCouncilMember.findUnique({ where: { wallet } })
    if (!council) {
      return reply.status(400).send({ error: 'NOT_COUNCIL', message: 'Wallet must be a Steward Council member first' })
    }

    const aggregate = await app.prisma.operationalPoolMember.aggregate({
      _sum: { sharePctBps: true },
    })
    const currentTotal = aggregate._sum.sharePctBps ?? 0
    if (currentTotal + body.sharePctBps > 10000) {
      return reply.status(400).send({
        error: 'BAD_REQUEST',
        message: `Total share would exceed 100% (current ${currentTotal}, adding ${body.sharePctBps})`,
      })
    }

    // Step 1 — on-chain enrollMember.
    let txHash: string
    try {
      const r = await submitEnrollOperational({
        wallet,
        sharePctBps: body.sharePctBps,
        weeklyMaxoutUsdt: body.weeklyMaxoutUsdt,
      })
      txHash = r.txHash
    } catch (e: any) {
      app.log.error({ err: e?.message, wallet }, 'operational-pool on-chain enrollMember failed')
      return reply.status(502).send({
        error: 'CHAIN_ERROR',
        message: `On-chain enrollMember reverted: ${extractRevertReason(e)}`,
      })
    }

    // Step 2 — mirror to DB.
    try {
      const created = await app.prisma.operationalPoolMember.create({
        data: {
          wallet,
          sharePctBps:      body.sharePctBps,
          weeklyMaxoutUsdt: body.weeklyMaxoutUsdt,
        },
      })
      auditLog(app, auditCtx(req, 'operational.pool.enroll', wallet, { ...body, txHash }))
      return reply.status(201).send({ data: created, txHash })
    } catch (e: any) {
      if (e?.code === 'P2002') {
        // On-chain succeeded but DB row already exists — surface as warning.
        app.log.warn({ wallet, txHash }, 'operational-pool on-chain ok but DB unique conflict')
        return reply.status(200).send({
          data: await app.prisma.operationalPoolMember.findUnique({ where: { wallet } }),
          txHash,
          warning: 'DB row already existed; on-chain tx confirmed.',
        })
      }
      throw e
    }
  })

  // ─── PUT /admin/seed-budget/operational/members/:wallet — Owner updates ──
  app.put<{ Params: { wallet: string } }>('/members/:wallet', async (req, reply) => {
    const { wallet: callerWallet } = req.user as { wallet: string }
    if (!isOwnerWallet(callerWallet)) {
      return reply.status(403).send({ error: 'FORBIDDEN', message: 'Forbidden' })
    }

    const wallet = req.params.wallet.toLowerCase()
    const body = req.body as {
      sharePctBps?: number
      weeklyMaxoutUsdt?: number
    }

    const existing = await app.prisma.operationalPoolMember.findUnique({ where: { wallet } })
    if (!existing) {
      return reply.status(404).send({ error: 'NOT_FOUND' })
    }

    const data: Record<string, unknown> = {}

    if (body.sharePctBps != null) {
      if (body.sharePctBps <= 0 || body.sharePctBps > 10000) {
        return reply.status(400).send({ error: 'BAD_REQUEST', message: 'sharePctBps must be 1-10000' })
      }
      const aggregate = await app.prisma.operationalPoolMember.aggregate({
        _sum: { sharePctBps: true },
      })
      const currentTotal = aggregate._sum.sharePctBps ?? 0
      const newTotal = currentTotal - existing.sharePctBps + body.sharePctBps
      if (newTotal > 10000) {
        return reply.status(400).send({
          error: 'BAD_REQUEST',
          message: `Total share would exceed 100% (would become ${newTotal})`,
        })
      }
      data.sharePctBps = body.sharePctBps
    }
    if (body.weeklyMaxoutUsdt != null) {
      if (body.weeklyMaxoutUsdt < 0) {
        return reply.status(400).send({ error: 'BAD_REQUEST', message: 'weeklyMaxoutUsdt must be >= 0' })
      }
      data.weeklyMaxoutUsdt = body.weeklyMaxoutUsdt
    }

    // Compute final values (use existing for any field not in body).
    const newSharePctBps    = (data.sharePctBps    as number | undefined) ?? existing.sharePctBps
    const newWeeklyMaxout   = Number((data.weeklyMaxoutUsdt as number | bigint | undefined) ?? existing.weeklyMaxoutUsdt)

    // Step 1 — on-chain updateMember.
    let txHash: string
    try {
      const r = await submitUpdateOperational({
        wallet,
        newSharePctBps,
        newWeeklyMaxoutUsdt: newWeeklyMaxout,
      })
      txHash = r.txHash
    } catch (e: any) {
      app.log.error({ err: e?.message, wallet }, 'operational-pool on-chain updateMember failed')
      return reply.status(502).send({
        error: 'CHAIN_ERROR',
        message: `On-chain updateMember reverted: ${extractRevertReason(e)}`,
      })
    }

    // Step 2 — mirror to DB.
    const updated = await app.prisma.operationalPoolMember.update({ where: { wallet }, data })
    auditLog(app, auditCtx(req, 'operational.pool.update', wallet, { ...data, txHash }))
    return reply.send({ data: updated, txHash })
  })

  // ─── DELETE /admin/seed-budget/operational/members/:wallet ────────────
  app.delete<{ Params: { wallet: string } }>('/members/:wallet', async (req, reply) => {
    const { wallet: callerWallet } = req.user as { wallet: string }
    if (!isOwnerWallet(callerWallet)) {
      return reply.status(403).send({ error: 'FORBIDDEN', message: 'Forbidden' })
    }

    const wallet = req.params.wallet.toLowerCase()

    // Step 1 — on-chain removeMember.
    let txHash: string
    try {
      const r = await submitRemoveOperational(wallet)
      txHash = r.txHash
    } catch (e: any) {
      app.log.error({ err: e?.message, wallet }, 'operational-pool on-chain removeMember failed')
      return reply.status(502).send({
        error: 'CHAIN_ERROR',
        message: `On-chain removeMember reverted: ${extractRevertReason(e)}`,
      })
    }

    // Step 2 — mirror to DB.
    try {
      await app.prisma.operationalPoolMember.delete({ where: { wallet } })
      auditLog(app, auditCtx(req, 'operational.pool.remove', wallet, { txHash }))
      return reply.send({ success: true, txHash })
    } catch (e: any) {
      if (e?.code === 'P2025') {
        // On-chain ok; DB row already missing — idempotent success.
        app.log.warn({ wallet, txHash }, 'operational-pool on-chain remove ok but DB row already missing')
        return reply.send({ success: true, txHash, warning: 'DB row was already missing.' })
      }
      throw e
    }
  })

  // ─── POST /admin/seed-budget/operational/claim ─ no longer used ───────
  // FE calls OperationalSalaryPoolV3.claim() directly via wallet sign,
  // then posts txHash to /governance/funds-distribution/seed/claim.
  app.post('/claim', async (_req, reply) => {
    return reply.status(410).send({
      error: 'GONE',
      message: 'Off-chain claim removed in Phase 2c-pivot. FE calls OperationalSalaryPoolV3.claim() on-chain directly, then POST /governance/funds-distribution/seed/claim with the txHash.',
      contract: getActiveAddresses().OperationalSalaryPoolV3,
      method: 'claim',
    })
  })

  // ─── GET /admin/seed-budget/operational/claims — Claim history ────────
  app.get('/claims', async (req, reply) => {
    const { wallet: callerWallet } = req.user as { wallet: string }
    const isOwner = isOwnerWallet(callerWallet)
    const where = isOwner ? {} : { wallet: callerWallet.toLowerCase() }

    const claims = await app.prisma.operationalPoolClaim.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
    })
    return reply.send({ data: claims })
  })
}
