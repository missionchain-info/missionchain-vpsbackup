import { FastifyPluginAsync } from 'fastify'
import { requireAdmin, requireLevel, ADMIN_LEVELS, auditLog, auditCtx, isOwnerWallet, type AdminLevel } from '../plugins/rbac.js'
import { buildXlsx, fileTimestamp } from '../services/xlsxBuilder.js'

export const adminRoutes: FastifyPluginAsync = async (app) => {
  // Apply admin auth to all routes in this plugin (any admin level + authorized admin)
  app.addHook('preHandler', requireAdmin)

  // ─── GET /admin/me — Caller's identity & effective permissions ─
  // Used by FE to gate render of restricted UI sections.
  // Generic field names — never reveal "owner" tier semantics in payload keys.
  app.get('/me', async (req) => {
    const user = req.user as { wallet: string; role: string }
    const lvl = (req as any).adminLevel as string | null | undefined
    return {
      wallet:      user.wallet,
      role:        user.role,
      adminLevel:  lvl ?? null,
      isOwner:     isOwnerWallet(user.wallet),
    }
  })

  // ═══════════════════════════════════════════════════════════════════════
  // ─── USERS ─────────────────────────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════════

  // ─── GET /admin/users — Paginated user list ───────────────────
  app.get('/users', async (req, reply) => {
    const {
      page: pageStr,
      limit: limitStr,
      search,
      kycStatus,
      role: roleFilter,
      sortBy,
      sortOrder,
    } = req.query as {
      page?: string
      limit?: string
      search?: string
      kycStatus?: string
      role?: string
      sortBy?: string
      sortOrder?: string
    }

    const page = Math.max(1, parseInt(pageStr ?? '1', 10) || 1)
    const limit = Math.min(100, Math.max(1, parseInt(limitStr ?? '20', 10) || 20))
    const skip = (page - 1) * limit

    // Member Management list excludes Owner (SUPER_ADMIN) — Owner is system, not a community member.
    const where: Record<string, unknown> = {
      role: { not: 'SUPER_ADMIN' },
    }

    if (search) {
      where.OR = [
        { wallet: { contains: search.toLowerCase() } },
        { userId: { contains: search } },
      ]
    }

    if (kycStatus) where.kycStatus = kycStatus
    if (roleFilter) {
      const validRoles = ['USER', 'AGENT', 'ADMIN']
      if (validRoles.includes(roleFilter.toUpperCase())) {
        where.role = roleFilter.toUpperCase()
      }
    }

    const validSortFields = ['createdAt', 'userId', 'wallet', 'kycStatus', 'totalGV']
    const orderField = validSortFields.includes(sortBy ?? '') ? sortBy! : 'createdAt'
    const order = sortOrder === 'asc' ? 'asc' : 'desc'

    const [users, total] = await Promise.all([
      app.prisma.user.findMany({
        where,
        orderBy: { [orderField]: order },
        skip,
        take: limit,
        select: {
          id: true, userId: true, wallet: true, referrer: true,
          kycStatus: true, role: true, gvRank: true, totalGV: true,
          mfpCount: true, seedPurchased: true, preSalePurchased: true, createdAt: true,
        },
      }),
      app.prisma.user.count({ where }),
    ])

    return {
      data: users.map((u) => ({ ...u, totalGV: u.totalGV.toString() })),
      pagination: { page, limit, total },
    }
  })

  // ─── GET /admin/users/export — Excel export (Member Management list) ──
  // Mirror UI columns, apply same filters as /admin/users, ignore pagination.
  // RBAC: ANALYST+ (read-only operational data — see plugins/rbac.ts).
  app.get('/users/export', { preHandler: requireLevel('ANALYST') }, async (req, reply) => {
    const { search, kycStatus, role: roleFilter, sortBy, sortOrder } = req.query as {
      search?: string
      kycStatus?: string
      role?: string
      sortBy?: string
      sortOrder?: string
    }

    const where: Record<string, unknown> = { role: { not: 'SUPER_ADMIN' } }
    if (search) {
      where.OR = [
        { wallet: { contains: search.toLowerCase() } },
        { userId: { contains: search } },
      ]
    }
    if (kycStatus) where.kycStatus = kycStatus
    if (roleFilter) {
      const validRoles = ['USER', 'AGENT', 'ADMIN']
      if (validRoles.includes(roleFilter.toUpperCase())) where.role = roleFilter.toUpperCase()
    }

    const validSortFields = ['createdAt', 'userId', 'wallet', 'kycStatus', 'totalGV']
    const orderField = validSortFields.includes(sortBy ?? '') ? sortBy! : 'createdAt'
    const order = sortOrder === 'asc' ? 'asc' : 'desc'

    const users = await app.prisma.user.findMany({
      where,
      orderBy: { [orderField]: order },
      select: {
        userId: true, wallet: true, email: true, phone: true,
        role: true, kycStatus: true,
        gvRank: true, mfpCount: true, createdAt: true,
      },
    })

    const buf = await buildXlsx({
      sheetName: 'Members',
      columns: [
        { header: 'User ID',   key: 'userId',    width: 18 },
        { header: 'Wallet',    key: 'wallet',    width: 44 },
        { header: 'Email',     key: 'email',     width: 28 },
        { header: 'Phone No.', key: 'phone',     width: 18 },
        { header: 'Role',      key: 'role',      width: 10 },
        { header: 'KYC',       key: 'kycStatus', width: 16 },
        { header: 'GV Rank',   key: 'gvRank',    width: 14 },
        { header: 'MFP',       key: 'mfpCount',  width: 6,  format: 'number' },
        { header: 'Joined',    key: 'createdAt', width: 18, format: 'datetime' },
        // Status derived from kycStatus (mirror /members UI logic: active = not rejected).
        { header: 'Status',    key: (u: any) => (u.kycStatus === 'rejected' ? 'Inactive' : 'Active'), width: 10 },
      ],
      rows: users,
    })

    auditLog(app, auditCtx(req, 'admin.users.export', 'members', { count: users.length }))

    const filename = `members-${fileTimestamp()}.xlsx`
    reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    reply.header('Content-Disposition', `attachment; filename="${filename}"`)
    reply.header('Cache-Control', 'no-store')
    return reply.send(buf)
  })

  // ─── GET /admin/users/:wallet — Full user detail ──────────────
  app.get('/users/:wallet', async (req, reply) => {
    const { wallet } = req.params as { wallet: string }
    const walletLower = wallet.toLowerCase()

    const user = await app.prisma.user.findUnique({
      where: { wallet: walletLower },
      include: {
        purchases: { orderBy: { createdAt: 'desc' }, take: 50 },
        stakingPositions: { orderBy: { stakeTime: 'desc' }, take: 20 },
        nftItems: { orderBy: { mintedAt: 'desc' } },
        vestingSchedules: true,
        miningRewards: { orderBy: { day: 'desc' }, take: 30 },
        rewardClaims: { orderBy: { claimedAt: 'desc' }, take: 50 },
        groupVolume: { orderBy: { period: 'desc' }, take: 12 },
        daoVotes: { orderBy: { createdAt: 'desc' }, take: 20 },
      },
    })

    if (!user) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'User not found' })
    }

    const f1Count = await app.prisma.user.count({ where: { referrer: walletLower } })

    return {
      data: {
        ...user,
        totalGV: user.totalGV.toString(),
        f1Count,
        purchases: user.purchases.map((p) => ({
          ...p,
          usdtAmount: p.usdtAmount.toString(),
          micAmount: p.micAmount.toString(),
          bnbAmount: p.bnbAmount.toString(),
          referralPaidF1: p.referralPaidF1.toString(),
          referralPaidF2: p.referralPaidF2.toString(),
        })),
        stakingPositions: user.stakingPositions.map((s) => ({
          ...s, amount: s.amount.toString(), weightedAmount: s.weightedAmount.toString(),
        })),
        vestingSchedules: user.vestingSchedules.map((v) => ({
          ...v, totalAmount: v.totalAmount.toString(),
        })),
        miningRewards: user.miningRewards.map((m) => ({
          ...m, amount: m.amount.toString(), hindex: m.hindex.toString(), poolShare: m.poolShare.toString(),
        })),
        rewardClaims: user.rewardClaims.map((r) => ({ ...r, amount: r.amount.toString() })),
        groupVolume: user.groupVolume.map((g) => ({
          ...g, totalVolume: g.totalVolume.toString(), bonusPaid: g.bonusPaid.toString(),
        })),
        daoVotes: user.daoVotes.map((v) => ({ ...v, weight: v.weight.toString() })),
      },
    }
  })

  // ─── PUT /admin/users/:wallet/kyc — Update KYC status ─────────
  app.put('/users/:wallet/kyc', async (req, reply) => {
    const { wallet } = req.params as { wallet: string }
    const { kycStatus } = req.body as { kycStatus: string }
    const walletLower = wallet.toLowerCase()

    const validStatuses = ['none', 'pending', 'approved', 'rejected']
    if (!kycStatus || !validStatuses.includes(kycStatus)) {
      return reply.status(400).send({
        error: 'BAD_REQUEST',
        message: `Invalid kycStatus. Must be one of: ${validStatuses.join(', ')}`,
      })
    }

    try {
      const updated = await app.prisma.user.update({
        where: { wallet: walletLower },
        data: { kycStatus },
        select: { wallet: true, userId: true, kycStatus: true, updatedAt: true },
      })
      auditLog(app, auditCtx(req, 'user.kyc.update', walletLower, { kycStatus }))
      return { data: updated }
    } catch {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'User not found' })
    }
  })

  // ─── PUT /admin/users/:wallet/role — Update user role ─────────
  app.put('/users/:wallet/role', async (req, reply) => {
    const { wallet } = req.params as { wallet: string }
    const { role: newRole } = req.body as { role: string }
    const walletLower = wallet.toLowerCase()
    const { role: adminRole } = req.user as { role: string }

    const validRoles = ['USER', 'AGENT', 'ADMIN']
    if (!newRole || !validRoles.includes(newRole.toUpperCase())) {
      return reply.status(400).send({
        error: 'BAD_REQUEST',
        message: `Invalid role. Must be one of: ${validRoles.join(', ')}`,
      })
    }

    const callerWallet = (req.user as { wallet: string }).wallet
    if (newRole.toUpperCase() === 'ADMIN' && !isOwnerWallet(callerWallet)) {
      return reply.status(403).send({ error: 'FORBIDDEN', message: 'Forbidden' })
    }

    try {
      const updated = await app.prisma.user.update({
        where: { wallet: walletLower },
        data: { role: newRole.toUpperCase() as any },
        select: { wallet: true, userId: true, role: true, updatedAt: true },
      })
      auditLog(app, auditCtx(req, 'user.role.update', walletLower, { newRole: newRole.toUpperCase() }))
      return { data: updated }
    } catch {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'User not found' })
    }
  })

  // ═══════════════════════════════════════════════════════════════════════
  // ─── ADMIN ACCESS MANAGEMENT ───────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════════

  // ─── GET /admin/access — List all admin users ─────────────────
  app.get('/access', async () => {
    const admins = await app.prisma.user.findMany({
      where: { role: { in: ['ADMIN', 'SUPER_ADMIN'] } },
      select: {
        wallet: true,
        userId: true,
        role: true,
        adminLevel: true,
        email: true,
        kycStatus: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: [{ role: 'desc' }, { createdAt: 'asc' }],
    })
    return { data: admins }
  })

  // ─── POST /admin/access — Grant admin access to a wallet ──────
  app.post('/access', async (req, reply) => {
    const { wallet: callerWallet } = req.user as { wallet: string }
    if (!isOwnerWallet(callerWallet)) {
      return reply.status(403).send({ error: 'FORBIDDEN', message: 'Forbidden' })
    }

    const body = req.body as { wallet: string; adminLevel?: string }
    if (!body.wallet) {
      return reply.status(400).send({ error: 'BAD_REQUEST', message: 'wallet is required' })
    }

    const validLevels = [...ADMIN_LEVELS] as readonly string[]
    const level = (body.adminLevel || 'OBSERVER').toUpperCase()
    if (!validLevels.includes(level)) {
      return reply.status(400).send({ error: 'BAD_REQUEST', message: `adminLevel must be: ${validLevels.join(', ')}` })
    }
    const typedLevel = level as AdminLevel

    try {
      const updated = await app.prisma.user.update({
        where: { wallet: body.wallet.toLowerCase() },
        data: { role: 'ADMIN', adminLevel: typedLevel, adminEnabled: true },
        select: { wallet: true, userId: true, role: true, adminLevel: true, adminEnabled: true },
      })
      auditLog(app, auditCtx(req, 'admin.access.grant', updated.wallet, { adminLevel: typedLevel }))
      return { data: updated }
    } catch {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'User wallet not found. User must register first.' })
    }
  })

  // ─── PUT /admin/access/:wallet — Update admin level / enabled ─
  app.put('/access/:wallet', async (req, reply) => {
    const { wallet: callerWallet } = req.user as { wallet: string }
    if (!isOwnerWallet(callerWallet)) {
      return reply.status(403).send({ error: 'FORBIDDEN', message: 'Forbidden' })
    }

    const { wallet } = req.params as { wallet: string }
    const body = req.body as { adminLevel?: string; adminEnabled?: boolean }
    const data: Record<string, unknown> = {}

    if (body.adminLevel) {
      const validLevels = [...ADMIN_LEVELS] as readonly string[]
      const upper = body.adminLevel.toUpperCase()
      if (!validLevels.includes(upper)) {
        return reply.status(400).send({ error: 'BAD_REQUEST', message: `adminLevel must be: ${validLevels.join(', ')}` })
      }
      data.adminLevel = upper as AdminLevel
    }
    if (typeof body.adminEnabled === 'boolean') data.adminEnabled = body.adminEnabled

    try {
      const updated = await app.prisma.user.update({
        where: { wallet: wallet.toLowerCase() },
        data,
        select: { wallet: true, userId: true, role: true, adminLevel: true, adminEnabled: true },
      })
      auditLog(app, auditCtx(req, 'admin.access.update', updated.wallet, data))
      return { data: updated }
    } catch {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'User not found' })
    }
  })

  // ─── DELETE /admin/access/:wallet — Revoke admin access ───────
  app.delete('/access/:wallet', async (req, reply) => {
    const { wallet: callerWallet } = req.user as { wallet: string }
    if (!isOwnerWallet(callerWallet)) {
      return reply.status(403).send({ error: 'FORBIDDEN', message: 'Forbidden' })
    }

    const { wallet } = req.params as { wallet: string }
    const walletLower = wallet.toLowerCase()

    const target = await app.prisma.user.findUnique({ where: { wallet: walletLower } })
    if (!target) return reply.status(404).send({ error: 'NOT_FOUND' })
    if (target.role === 'SUPER_ADMIN' || isOwnerWallet(target.wallet)) {
      return reply.status(403).send({ error: 'FORBIDDEN', message: 'Forbidden' })
    }

    await app.prisma.user.update({
      where: { wallet: walletLower },
      data: { role: 'USER', adminLevel: 'OBSERVER' },
    })
    auditLog(app, auditCtx(req, 'admin.access.revoke', walletLower))

    return { success: true }
  })

  // ═══════════════════════════════════════════════════════════════════════
  // ─── ROUND CONFIG ──────────────────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════════

  // ─── GET /admin/rounds — All round configs ─────────────────────
  app.get('/rounds', async () => {
    const rounds = await app.prisma.roundConfig.findMany({
      orderBy: { createdAt: 'asc' },
    })

    return {
      data: rounds.map((r) => ({
        ...r,
        displayCap: r.displayCap?.toString() ?? null,
        totalSold: r.totalSold.toString(),
        micPrice: r.micPrice?.toString() ?? null,
        countdownStart: r.countdownStart?.toISOString() ?? null,
        countdownEnd: r.countdownEnd?.toISOString() ?? null,
      })),
    }
  })

  // ─── PUT /admin/rounds/:roundType — Update round config ────────
  app.put('/rounds/:roundType', async (req, reply) => {
    const { roundType } = req.params as { roundType: string }
    const body = req.body as {
      status?: string
      displayCap?: number | null
      countdownStart?: string | null
      countdownEnd?: string | null
      unsoldAction?: string | null
      micPrice?: number | null
      notes?: string | null
    }
    const { wallet } = req.user as { wallet: string }

    const validStatuses = ['UPCOMING', 'ACTIVE', 'CLOSED']
    if (body.status && !validStatuses.includes(body.status)) {
      return reply.status(400).send({
        error: 'BAD_REQUEST',
        message: `Invalid status. Must be one of: ${validStatuses.join(', ')}`,
      })
    }

    const validUnsoldActions = ['BURN', 'LIQUIDITY', null]
    if (body.unsoldAction !== undefined && !validUnsoldActions.includes(body.unsoldAction)) {
      return reply.status(400).send({
        error: 'BAD_REQUEST',
        message: 'unsoldAction must be BURN, LIQUIDITY, or null',
      })
    }

    try {
      const updated = await app.prisma.roundConfig.update({
        where: { roundType: roundType.toUpperCase() },
        data: {
          ...(body.status !== undefined && { status: body.status }),
          ...(body.displayCap !== undefined && { displayCap: body.displayCap }),
          ...(body.countdownStart !== undefined && {
            countdownStart: body.countdownStart ? new Date(body.countdownStart) : null,
          }),
          ...(body.countdownEnd !== undefined && {
            countdownEnd: body.countdownEnd ? new Date(body.countdownEnd) : null,
          }),
          ...(body.unsoldAction !== undefined && { unsoldAction: body.unsoldAction }),
          ...(body.micPrice !== undefined && { micPrice: body.micPrice }),
          ...(body.notes !== undefined && { notes: body.notes }),
          updatedBy: wallet,
        },
      })

      return {
        data: {
          ...updated,
          displayCap: updated.displayCap?.toString() ?? null,
          totalSold: updated.totalSold.toString(),
          micPrice: updated.micPrice?.toString() ?? null,
          countdownStart: updated.countdownStart?.toISOString() ?? null,
          countdownEnd: updated.countdownEnd?.toISOString() ?? null,
        },
      }
    } catch {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'Round not found' })
    }
  })

  // ═══════════════════════════════════════════════════════════════════════
  // ─── SYSTEM CONFIG ─────────────────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════════

  // ─── GET /admin/system-config — All system configs ─────────────
  app.get('/system-config', async () => {
    const configs = await app.prisma.systemConfig.findMany({
      orderBy: { key: 'asc' },
    })

    return { data: configs }
  })

  // ─── PUT /admin/system-config/:key — Update single config ──────
  app.put('/system-config/:key', async (req, reply) => {
    const { key } = req.params as { key: string }
    const { value } = req.body as { value: string }
    const { wallet } = req.user as { wallet: string }

    if (value === undefined || value === null) {
      return reply.status(400).send({
        error: 'BAD_REQUEST',
        message: 'value is required',
      })
    }

    try {
      const updated = await app.prisma.systemConfig.upsert({
        where: { key },
        update: { value, updatedBy: wallet },
        create: { key, value, updatedBy: wallet },
      })

      return { data: updated }
    } catch (err) {
      return reply.status(500).send({ error: 'INTERNAL', message: 'Failed to update config' })
    }
  })

  // ─── PUT /admin/system-config — Bulk update configs ────────────
  app.put('/system-config', async (req, reply) => {
    const { configs } = req.body as { configs: { key: string; value: string }[] }
    const { wallet } = req.user as { wallet: string }

    if (!configs || !Array.isArray(configs)) {
      return reply.status(400).send({
        error: 'BAD_REQUEST',
        message: 'configs array is required',
      })
    }

    const results = await Promise.all(
      configs.map((c) =>
        app.prisma.systemConfig.upsert({
          where: { key: c.key },
          update: { value: c.value, updatedBy: wallet },
          create: { key: c.key, value: c.value, updatedBy: wallet },
        })
      )
    )

    return { data: results }
  })

  // ═══════════════════════════════════════════════════════════════════════
  // ─── ADMIN BOARD ───────────────────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════════

  // ─── GET /admin/board — List board members ─────────────────────
  app.get('/board', async () => {
    const members = await app.prisma.adminBoard.findMany({
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
    })

    return {
      data: members.map((m) => ({
        ...m,
        votePower: m.votePower.toString(),
        benefitRate: m.benefitRate.toString(),
        benefitCap: m.benefitCap.toString(),
      })),
    }
  })

  // ─── POST /admin/board — Add board member ──────────────────────
  app.post('/board', async (req, reply) => {
    const body = req.body as {
      wallet: string
      username: string
      role: string
      votePower?: number
      benefitRate?: number
      benefitCap?: number
      email?: string
      telegram?: string
      telegramChatId?: string
      notes?: string
    }

    const validRoles = ['OWNER', 'ADMIN', 'SENATOR', 'COUNCIL', 'GUARDIAN']
    if (!body.wallet || !body.username || !body.role) {
      return reply.status(400).send({
        error: 'BAD_REQUEST',
        message: 'wallet, username, and role are required',
      })
    }
    if (!validRoles.includes(body.role.toUpperCase())) {
      return reply.status(400).send({
        error: 'BAD_REQUEST',
        message: `Invalid role. Must be one of: ${validRoles.join(', ')}`,
      })
    }

    try {
      const member = await app.prisma.adminBoard.create({
        data: {
          wallet: body.wallet.toLowerCase(),
          username: body.username,
          role: body.role.toUpperCase(),
          votePower: body.votePower ?? 0,
          benefitRate: body.benefitRate ?? 0,
          benefitCap: body.benefitCap ?? 0,
          email: body.email,
          telegram: body.telegram,
          telegramChatId: body.telegramChatId,
          notes: body.notes,
        },
      })

      return {
        data: {
          ...member,
          votePower: member.votePower.toString(),
          benefitRate: member.benefitRate.toString(),
          benefitCap: member.benefitCap.toString(),
        },
      }
    } catch (err: any) {
      if (err.code === 'P2002') {
        return reply.status(409).send({
          error: 'CONFLICT',
          message: 'Board member with this wallet already exists',
        })
      }
      throw err
    }
  })

  // ─── PUT /admin/board/:wallet — Update board member ────────────
  app.put('/board/:wallet', async (req, reply) => {
    const { wallet } = req.params as { wallet: string }
    const body = req.body as {
      username?: string
      role?: string
      votePower?: number
      benefitRate?: number
      benefitCap?: number
      email?: string | null
      telegram?: string | null
      telegramChatId?: string | null
      status?: string
      notes?: string | null
    }

    const data: Record<string, unknown> = {}
    if (body.username !== undefined) data.username = body.username
    if (body.role !== undefined) data.role = body.role.toUpperCase()
    if (body.votePower !== undefined) data.votePower = body.votePower
    if (body.benefitRate !== undefined) data.benefitRate = body.benefitRate
    if (body.benefitCap !== undefined) data.benefitCap = body.benefitCap
    if (body.email !== undefined) data.email = body.email
    if (body.telegram !== undefined) data.telegram = body.telegram
    if (body.telegramChatId !== undefined) data.telegramChatId = body.telegramChatId
    if (body.status !== undefined) data.status = body.status
    if (body.notes !== undefined) data.notes = body.notes

    try {
      const updated = await app.prisma.adminBoard.update({
        where: { wallet: wallet.toLowerCase() },
        data,
      })

      return {
        data: {
          ...updated,
          votePower: updated.votePower.toString(),
          benefitRate: updated.benefitRate.toString(),
          benefitCap: updated.benefitCap.toString(),
        },
      }
    } catch {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'Board member not found' })
    }
  })

  // ─── DELETE /admin/board/:wallet — Remove board member ─────────
  app.delete('/board/:wallet', async (req, reply) => {
    const { wallet } = req.params as { wallet: string }

    try {
      await app.prisma.adminBoard.delete({
        where: { wallet: wallet.toLowerCase() },
      })
      return { success: true }
    } catch {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'Board member not found' })
    }
  })

  // ═══════════════════════════════════════════════════════════════════════
  // ─── AGENT GRANTS (SEED 20% Commission) ────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════════

  // ─── GET /admin/agent-grants — List agent grants ───────────────
  app.get('/agent-grants', async (req, reply) => {
    const {
      page: pageStr,
      limit: limitStr,
      status: statusFilter,
      agentWallet,
    } = req.query as {
      page?: string
      limit?: string
      status?: string
      agentWallet?: string
    }

    const page = Math.max(1, parseInt(pageStr ?? '1', 10) || 1)
    const limit = Math.min(100, Math.max(1, parseInt(limitStr ?? '20', 10) || 20))
    const skip = (page - 1) * limit

    const where: Record<string, unknown> = {}
    if (statusFilter) where.status = statusFilter.toUpperCase()
    if (agentWallet) where.agentWallet = agentWallet.toLowerCase()

    const [grants, total] = await Promise.all([
      app.prisma.agentGrant.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      app.prisma.agentGrant.count({ where }),
    ])

    return {
      data: grants.map((g) => ({
        ...g,
        amount: g.amount.toString(),
        usdtAmount: g.usdtAmount.toString(),
      })),
      pagination: { page, limit, total },
    }
  })

  // ─── POST /admin/agent-grants — Create agent grant ─────────────
  app.post('/agent-grants', async (req, reply) => {
    const body = req.body as {
      agentWallet: string
      seedPurchaseId?: string
      amount: number
      usdtAmount?: number
      notes?: string
    }
    const { wallet: adminWallet } = req.user as { wallet: string }

    if (!body.agentWallet || !body.amount) {
      return reply.status(400).send({
        error: 'BAD_REQUEST',
        message: 'agentWallet and amount are required',
      })
    }

    const grant = await app.prisma.agentGrant.create({
      data: {
        agentWallet: body.agentWallet.toLowerCase(),
        grantedBy: adminWallet,
        seedPurchaseId: body.seedPurchaseId,
        amount: body.amount,
        usdtAmount: body.usdtAmount ?? 0,
        status: 'PENDING',
        notes: body.notes,
      },
    })

    return {
      data: {
        ...grant,
        amount: grant.amount.toString(),
        usdtAmount: grant.usdtAmount.toString(),
      },
    }
  })

  // ─── PUT /admin/agent-grants/:id — Update grant status ─────────
  app.put('/agent-grants/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    const body = req.body as {
      status?: string
      txHash?: string
      notes?: string
    }

    const validStatuses = ['PENDING', 'APPROVED', 'PAID', 'REJECTED']
    if (body.status && !validStatuses.includes(body.status.toUpperCase())) {
      return reply.status(400).send({
        error: 'BAD_REQUEST',
        message: `Invalid status. Must be one of: ${validStatuses.join(', ')}`,
      })
    }

    try {
      const updated = await app.prisma.agentGrant.update({
        where: { id },
        data: {
          ...(body.status && { status: body.status.toUpperCase() }),
          ...(body.txHash && { txHash: body.txHash }),
          ...(body.notes !== undefined && { notes: body.notes }),
        },
      })

      return {
        data: {
          ...updated,
          amount: updated.amount.toString(),
          usdtAmount: updated.usdtAmount.toString(),
        },
      }
    } catch {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'Agent grant not found' })
    }
  })

  // ═══════════════════════════════════════════════════════════════════════
  // ─── SALES & REVENUE ───────────────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════════

  // ─── GET /admin/sales/stats — Sales statistics ────────────────
  app.get('/sales/stats', async () => {
    const [seedStats, presaleStats, miceStats] = await Promise.all([
      app.prisma.purchase.aggregate({
        where: { type: 'SEED' },
        _sum: { usdtAmount: true, micAmount: true },
        _count: true,
      }),
      app.prisma.purchase.aggregate({
        where: { type: 'PRESALE' },
        _sum: { usdtAmount: true, micAmount: true },
        _count: true,
      }),
      app.prisma.purchase.aggregate({
        where: { type: 'MICE' },
        _sum: { usdtAmount: true, micAmount: true },
        _count: true,
      }),
    ])

    const referralStats = await app.prisma.purchase.aggregate({
      _sum: { referralPaidF1: true, referralPaidF2: true },
    })

    const totalRaised = Number(seedStats._sum.usdtAmount ?? 0) +
      Number(presaleStats._sum.usdtAmount ?? 0) +
      Number(miceStats._sum.usdtAmount ?? 0)

    return {
      data: {
        totalRaisedUsdt: totalRaised.toFixed(2),
        seed: {
          count: seedStats._count,
          usdtRaised: (seedStats._sum.usdtAmount ?? 0).toString(),
          micSold: (seedStats._sum.micAmount ?? 0).toString(),
          allocation: 152_500_000,
          hardCap: 381_250,
        },
        presale: {
          count: presaleStats._count,
          usdtRaised: (presaleStats._sum.usdtAmount ?? 0).toString(),
          micSold: (presaleStats._sum.micAmount ?? 0).toString(),
          allocation: 315_000_000,
          hardCap: 1_575_000,
        },
        mice: {
          count: miceStats._count,
          usdtRaised: (miceStats._sum.usdtAmount ?? 0).toString(),
          micBurned: (miceStats._sum.micAmount ?? 0).toString(),
          maxSupply: 100_000,
        },
        referrals: {
          totalF1Paid: (referralStats._sum.referralPaidF1 ?? 0).toString(),
          totalF2Paid: (referralStats._sum.referralPaidF2 ?? 0).toString(),
        },
      },
    }
  })

  // ─── GET /admin/revenue — Revenue data ─────────────────────────
  app.get('/revenue', async () => {
    const [presaleRevenue, miceRevenue] = await Promise.all([
      app.prisma.purchase.aggregate({
        where: { type: 'PRESALE' },
        _sum: { usdtAmount: true },
      }),
      app.prisma.purchase.aggregate({
        where: { type: 'MICE' },
        _sum: { usdtAmount: true },
      }),
    ])

    const presaleUsdt = Number(presaleRevenue._sum.usdtAmount ?? 0)
    const miceUsdt = Number(miceRevenue._sum.usdtAmount ?? 0)
    const totalUsdt = presaleUsdt + miceUsdt

    return {
      data: {
        totalUsdtRevenue: totalUsdt.toFixed(2),
        presaleUsdt: presaleUsdt.toFixed(2),
        miceUsdt: miceUsdt.toFixed(2),
        allocationBreakdown: {
          marketing: (totalUsdt * 0.35).toFixed(2),
          management: (totalUsdt * 0.075).toFixed(2),
          daoTreasury: (totalUsdt * 0.125).toFixed(2),
          reservedStaking: (totalUsdt * 0.05).toFixed(2),
          liquidityPool: (totalUsdt * 0.40).toFixed(2),
          splits: {
            'Marketing & Sales': '35%',
            'Management & Operational': '7.5%',
            'DAO Treasury': '12.5%',
            'Reserved Staking': '5%',
            'Liquidity Pool & Buffer': '40%',
          },
        },
      },
    }
  })

  // ═══════════════════════════════════════════════════════════════════════
  // ─── DASHBOARD STATS (Admin Home) ──────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════════

  // ─── GET /admin/stats — Admin dashboard overview stats ─────────
  app.get('/stats', async () => {
    // 30 days ago for "new this month"
    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

    const [
      totalUsers,
      totalAgents,
      totalPurchases,
      seedStats,
      presaleStats,
      miceStats,
      stakingStats,
      miningStats,
      pendingKyc,
      kycVerified,
      newThisMonth,
      pendingGrants,
      referralStats,
      seedBuyers,
      presaleBuyers,
      miceBuyers,
    ] = await Promise.all([
      // Total Members excludes Owner (role=SUPER_ADMIN). Owner operates anonymously.
      app.prisma.user.count({ where: { role: { not: 'SUPER_ADMIN' } } }),
      app.prisma.user.count({ where: { role: 'AGENT' } }),
      app.prisma.purchase.count(),
      app.prisma.purchase.aggregate({
        where: { type: 'SEED' },
        _sum: { usdtAmount: true, micAmount: true },
        _count: true,
      }),
      app.prisma.purchase.aggregate({
        where: { type: 'PRESALE' },
        _sum: { usdtAmount: true, micAmount: true },
        _count: true,
      }),
      app.prisma.purchase.aggregate({
        where: { type: 'MICE' },
        _sum: { usdtAmount: true, micAmount: true },
        _count: true,
      }),
      app.prisma.stakingPosition.aggregate({
        where: { active: true },
        _sum: { amount: true, weightedAmount: true },
        _count: true,
      }),
      app.prisma.miningReward.aggregate({
        _sum: { amount: true },
      }),
      // All Member-counting queries exclude Owner (role=SUPER_ADMIN) for consistency with Total Members.
      app.prisma.user.count({ where: { kycStatus: 'pending', role: { not: 'SUPER_ADMIN' } } }),
      app.prisma.user.count({ where: { kycStatus: 'verified', role: { not: 'SUPER_ADMIN' } } }),
      app.prisma.user.count({ where: { createdAt: { gte: thirtyDaysAgo }, role: { not: 'SUPER_ADMIN' } } }),
      app.prisma.agentGrant.count({ where: { status: 'PENDING' } }),
      app.prisma.purchase.aggregate({
        _sum: { referralPaidF1: true, referralPaidF2: true },
      }),
      app.prisma.purchase.findMany({
        where: { type: 'SEED' },
        select: { wallet: true },
        distinct: ['wallet'],
      }),
      app.prisma.purchase.findMany({
        where: { type: 'PRESALE' },
        select: { wallet: true },
        distinct: ['wallet'],
      }),
      app.prisma.purchase.findMany({
        where: { type: 'MICE' },
        select: { wallet: true },
        distinct: ['wallet'],
      }),
    ])

    const seedUsdt = Number(seedStats._sum.usdtAmount ?? 0)
    const presaleUsdt = Number(presaleStats._sum.usdtAmount ?? 0)
    const miceUsdt = Number(miceStats._sum.usdtAmount ?? 0)
    const totalRaised = seedUsdt + presaleUsdt + miceUsdt

    // Revenue allocation (PreSale + MICE only for marketing/fund split)
    const revenueUsdt = presaleUsdt + miceUsdt

    return {
      data: {
        users: {
          total: totalUsers,
          agents: totalAgents,
          pendingKyc,
          kycVerified,
          newThisMonth,
        },
        sales: {
          totalRaisedUsdt: totalRaised.toFixed(2),
          totalPurchases,
          seedPurchases: seedStats._count,
          presalePurchases: presaleStats._count,
          seedMicSold: (seedStats._sum.micAmount ?? 0).toString(),
          presaleMicSold: (presaleStats._sum.micAmount ?? 0).toString(),
        },
        seed: {
          count: seedStats._count,
          buyers: seedBuyers.length,
          usdtRaised: seedUsdt.toFixed(2),
          micSold: (seedStats._sum.micAmount ?? 0).toString(),
          allocation: 152_500_000,
          hardCap: 381_250,
          mktCost: (seedUsdt * 0.50).toFixed(2),
          fundRaised: (seedUsdt * 0.50).toFixed(2),
        },
        presale: {
          count: presaleStats._count,
          buyers: presaleBuyers.length,
          usdtRaised: presaleUsdt.toFixed(2),
          micSold: (presaleStats._sum.micAmount ?? 0).toString(),
          allocation: 315_000_000,
          hardCap: 1_575_000,
          mktCost: (presaleUsdt * 0.35).toFixed(2),
          fundRaised: (presaleUsdt * 0.575).toFixed(2),
        },
        mice: {
          totalLicenses: miceStats._count,
          buyers: miceBuyers.length,
          maxSupply: 100_000,
          usdtRaised: miceUsdt.toFixed(2),
          micBurned: (miceStats._sum.micAmount ?? 0).toString(),
          mktCost: (miceUsdt * 0.35).toFixed(2),
          fundRaised: (miceUsdt * 0.575).toFixed(2),
        },
        staking: {
          activePositions: stakingStats._count,
          totalStaked: (stakingStats._sum.amount ?? 0).toString(),
          totalWeighted: (stakingStats._sum.weightedAmount ?? 0).toString(),
        },
        mining: {
          totalEmitted: (miningStats._sum.amount ?? 0).toString(),
        },
        referrals: {
          totalF1Paid: (referralStats._sum.referralPaidF1 ?? 0).toString(),
          totalF2Paid: (referralStats._sum.referralPaidF2 ?? 0).toString(),
        },
        revenue: {
          totalUsdt: revenueUsdt.toFixed(2),
          marketing: (revenueUsdt * 0.35).toFixed(2),
          management: (revenueUsdt * 0.075).toFixed(2),
          daoTreasury: (revenueUsdt * 0.125).toFixed(2),
          reservedStaking: (revenueUsdt * 0.05).toFixed(2),
          liquidityPool: (revenueUsdt * 0.40).toFixed(2),
        },
        agentGrants: {
          pending: pendingGrants,
        },
      },
    }
  })

  // ═══════════════════════════════════════════════════════════════════════
  // ─── SEED SUMMARY & PROMOTION ──────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════════

  // ─── GET /admin/sales/seed/summary — Detailed SEED stats for admin ──
  app.get('/sales/seed/summary', async () => {
    const seedStats = await app.prisma.purchase.aggregate({
      where: { type: 'SEED' },
      _sum: { usdtAmount: true, micAmount: true },
      _count: true,
    })

    const participantCount = await app.prisma.purchase.groupBy({
      by: ['wallet'],
      where: { type: 'SEED' },
    })

    // Distributor commission stats
    const distributorStats = await app.prisma.distributorEarning.aggregate({
      _sum: { commission: true, orderAmount: true },
      _count: true,
    })

    const paidCommission = await app.prisma.distributorEarning.aggregate({
      where: { status: 'PAID' },
      _sum: { commission: true },
    })

    const pendingCommission = await app.prisma.distributorEarning.aggregate({
      where: { status: 'PENDING' },
      _sum: { commission: true },
    })

    const totalRevenue = Number(seedStats._sum.usdtAmount ?? 0)
    const totalCommission = Number(distributorStats._sum.commission ?? 0)
    const netFunds = totalRevenue - totalCommission

    // MFP-NFT stats
    const mfpMinted = await app.prisma.nFTItem.count({ where: { contractType: 'MFP' } })

    // RoundConfig
    const seedConfig = await app.prisma.roundConfig.findFirst({ where: { roundType: 'SEED' } })

    return {
      data: {
        totalSoldMic: Number(seedStats._sum.micAmount ?? 0).toFixed(0),
        totalRevenue: totalRevenue.toFixed(2),
        participants: participantCount.length,
        purchaseCount: seedStats._count,
        allocationMic: 152_500_000,
        remainingMic: Math.max(0, 152_500_000 - Number(seedStats._sum.micAmount ?? 0)).toFixed(0),
        distributor: {
          totalCommission: totalCommission.toFixed(2),
          paidCommission: Number(paidCommission._sum.commission ?? 0).toFixed(2),
          pendingCommission: Number(pendingCommission._sum.commission ?? 0).toFixed(2),
          totalOrders: distributorStats._count,
        },
        netFunds: netFunds.toFixed(2),
        mfpMinted,
        mfpMaxSupply: 2_500,
        promotion: seedConfig ? {
          active: seedConfig.promotionActive,
          pct: seedConfig.promotionPct ? Number(seedConfig.promotionPct) : 0,
          start: seedConfig.promotionStart?.toISOString() ?? null,
          end: seedConfig.promotionEnd?.toISOString() ?? null,
        } : null,
        status: seedConfig?.status ?? 'UPCOMING',
      },
    }
  })

  // ─── PUT /admin/rounds/:roundType/promotion — Update promotion config ──
  app.put('/rounds/:roundType/promotion', async (req, reply) => {
    const { roundType } = req.params as { roundType: string }
    const body = req.body as {
      promotionActive?: boolean
      promotionPct?: number | null
      promotionStart?: string | null
      promotionEnd?: string | null
    }
    const { wallet } = req.user as { wallet: string }

    // Validate promotion percentage
    if (body.promotionPct !== undefined && body.promotionPct !== null) {
      if (body.promotionPct < 0 || body.promotionPct > 15) {
        return reply.status(400).send({
          error: 'BAD_REQUEST',
          message: 'Promotion percentage must be between 0 and 15%',
        })
      }
    }

    try {
      const updated = await app.prisma.roundConfig.update({
        where: { roundType: roundType.toUpperCase() },
        data: {
          ...(body.promotionActive !== undefined && { promotionActive: body.promotionActive }),
          ...(body.promotionPct !== undefined && { promotionPct: body.promotionPct }),
          ...(body.promotionStart !== undefined && {
            promotionStart: body.promotionStart ? new Date(body.promotionStart) : null,
          }),
          ...(body.promotionEnd !== undefined && {
            promotionEnd: body.promotionEnd ? new Date(body.promotionEnd) : null,
          }),
          updatedBy: wallet,
        },
      })

      return {
        data: {
          roundType: updated.roundType,
          promotionActive: updated.promotionActive,
          promotionPct: updated.promotionPct?.toString() ?? null,
          promotionStart: updated.promotionStart?.toISOString() ?? null,
          promotionEnd: updated.promotionEnd?.toISOString() ?? null,
        },
      }
    } catch {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'Round not found' })
    }
  })

  // ═══════════════════════════════════════════════════════════════════════
  // ─── MFP ARTWORK MANAGEMENT ────────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════════

  // ─── GET /admin/mfp-artwork — List all MFP artwork images ──────────
  app.get('/mfp-artwork', async () => {
    const artworks = await app.prisma.mfpArtwork.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        imageData: true,
        active: true,
        usedCount: true,
        createdAt: true,
      },
    })

    return { data: artworks }
  })

  // ─── POST /admin/mfp-artwork — Upload new MFP artwork image ────────
  app.post('/mfp-artwork', async (req, reply) => {
    const body = req.body as { name: string; imageData: string }

    if (!body.name || !body.imageData) {
      return reply.status(400).send({
        error: 'BAD_REQUEST',
        message: 'name and imageData (base64) are required',
      })
    }

    // Validate base64 image
    if (!body.imageData.startsWith('data:image/')) {
      return reply.status(400).send({
        error: 'BAD_REQUEST',
        message: 'imageData must be a base64 data URI (data:image/...)',
      })
    }

    const artwork = await app.prisma.mfpArtwork.create({
      data: {
        name: body.name,
        imageData: body.imageData,
      },
    })

    return {
      data: {
        id: artwork.id,
        name: artwork.name,
        active: artwork.active,
        usedCount: artwork.usedCount,
        createdAt: artwork.createdAt,
      },
    }
  })

  // ─── PUT /admin/mfp-artwork/:id — Toggle artwork active status ─────
  app.put('/mfp-artwork/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    const body = req.body as { active?: boolean; name?: string }

    try {
      const updated = await app.prisma.mfpArtwork.update({
        where: { id },
        data: {
          ...(body.active !== undefined && { active: body.active }),
          ...(body.name !== undefined && { name: body.name }),
        },
      })

      return {
        data: {
          id: updated.id,
          name: updated.name,
          active: updated.active,
          usedCount: updated.usedCount,
        },
      }
    } catch {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'Artwork not found' })
    }
  })

  // ─── DELETE /admin/mfp-artwork/:id — Remove artwork ────────────────
  app.delete('/mfp-artwork/:id', async (req, reply) => {
    const { id } = req.params as { id: string }

    try {
      // Check if any NFTs reference this artwork
      const artwork = await app.prisma.mfpArtwork.findUnique({ where: { id } })
      if (artwork && artwork.usedCount > 0) {
        return reply.status(400).send({
          error: 'IN_USE',
          message: `Cannot delete artwork used by ${artwork.usedCount} NFTs. Deactivate instead.`,
        })
      }

      await app.prisma.mfpArtwork.delete({ where: { id } })
      return { success: true }
    } catch {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'Artwork not found' })
    }
  })

  // ═══════════════════════════════════════════════════════════════════════
  // ─── EVENTS & SYNC ─────────────────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════════

  // ─── GET /admin/events — Recent blockchain events ─────────────
  app.get('/events', async (req) => {
    const {
      page: pageStr,
      limit: limitStr,
      contractName,
      eventName,
    } = req.query as {
      page?: string
      limit?: string
      contractName?: string
      eventName?: string
    }

    const page = Math.max(1, parseInt(pageStr ?? '1', 10) || 1)
    const limit = Math.min(100, Math.max(1, parseInt(limitStr ?? '50', 10) || 50))
    const skip = (page - 1) * limit

    const where: Record<string, unknown> = {}
    if (contractName) where.contractName = contractName
    if (eventName) where.eventName = eventName

    const [events, total] = await Promise.all([
      app.prisma.blockchainEvent.findMany({
        where,
        orderBy: { blockNumber: 'desc' },
        skip,
        take: limit,
      }),
      app.prisma.blockchainEvent.count({ where }),
    ])

    return {
      data: events,
      pagination: { page, limit, total },
    }
  })

  // ═══════════════════════════════════════════════════════════════════════
  // ─── MFP-NFT (Lazy mint allowance + Authors Pool royalty) ──────────────
  // ═══════════════════════════════════════════════════════════════════════

  // ─── GET /admin/mfp/grants — list all grants paginated ────────
  app.get('/mfp/grants', async (req) => {
    const q = req.query as { page?: string; source?: string; wallet?: string }
    const page = Math.max(1, parseInt(q.page ?? '1', 10))
    const limit = 50
    const skip = (page - 1) * limit

    const where: Record<string, unknown> = {}
    if (q.source) where.source = parseInt(q.source, 10)
    if (q.wallet) where.wallet = q.wallet.toLowerCase()

    const [grants, total] = await Promise.all([
      app.prisma.mfpGrant.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      app.prisma.mfpGrant.count({ where }),
    ])
    return { data: grants, pagination: { page, limit, total } }
  })

  // ─── GET /admin/mfp/stats — global mint allocation stats ──────
  app.get('/mfp/stats', async () => {
    const [grantedAgg, mintedCount, distinctWallets] = await Promise.all([
      app.prisma.mfpGrant.aggregate({ _sum: { amount: true } }),
      app.prisma.mfpMintRecord.count(),
      app.prisma.mfpGrant.groupBy({ by: ['wallet'], _count: { id: true } }),
    ])
    const granted = grantedAgg._sum.amount ?? 0
    const MAX = 2500
    return {
      maxSupply: MAX,
      granted,
      minted: mintedCount,
      availablePool: Math.max(0, MAX - granted),
      remainingMintable: Math.max(0, granted - mintedCount),
      uniqueRecipients: distinctWallets.length,
    }
  })

  // ─── GET /admin/mfp/recipients — list per-wallet aggregate ────
  app.get('/mfp/recipients', async () => {
    const grouped = await app.prisma.mfpGrant.groupBy({
      by: ['wallet'],
      _sum: { amount: true },
      _max: { source: true, createdAt: true },
    })
    const wallets = grouped.map((g) => g.wallet)
    const minted = await app.prisma.mfpMintRecord.groupBy({
      by: ['wallet'],
      where: { wallet: { in: wallets } },
      _count: { tokenId: true },
    })
    const mintedMap = Object.fromEntries(minted.map((m) => [m.wallet, m._count.tokenId]))

    const data = grouped.map((g) => {
      const totalGranted = g._sum.amount ?? 0
      const totalMinted = mintedMap[g.wallet] ?? 0
      return {
        wallet: g.wallet,
        granted: totalGranted,
        minted: totalMinted,
        remaining: Math.max(0, totalGranted - totalMinted),
        latestSource: g._max.source,
        latestGrantAt: g._max.createdAt,
      }
    })
    return { data }
  })

  // ─── POST /admin/mfp/grants — record manual grant (after on-chain tx) ──
  // Note: This endpoint is for AUDIT/UI tracking. Actual on-chain grant
  // happens when authorized admin calls grantMintAllowance() via DApp.
  app.post('/mfp/grants', async (req, reply) => {
    const { wallet: callerWallet } = req.user as { wallet: string }
    if (!isOwnerWallet(callerWallet)) {
      return reply.status(403).send({ error: 'FORBIDDEN', message: 'Forbidden' })
    }

    const body = req.body as { wallet: string; amount: number; note?: string; txHash: string; blockNumber: number; grantedBy: string }
    if (!body.wallet || !body.amount || !body.txHash) {
      return reply.status(400).send({ error: 'BAD_REQUEST', message: 'wallet, amount, txHash required' })
    }

    const created = await app.prisma.mfpGrant.create({
      data: {
        wallet: body.wallet.toLowerCase(),
        amount: body.amount,
        source: 1, // OWNER
        grantedBy: body.grantedBy.toLowerCase(),
        note: body.note ?? null,
        txHash: body.txHash,
        blockNumber: body.blockNumber,
      },
    })
    auditLog(app, auditCtx(req, 'mfp.grant', body.wallet.toLowerCase(), { amount: body.amount, txHash: body.txHash }))
    return { data: created }
  })

  // ─── GET /admin/mfp/royalty — current Authors Pool wallet ─────
  app.get('/mfp/royalty', async () => {
    const cfg = await app.prisma.systemConfig.findUnique({
      where: { key: 'mfp_royalty_receiver' },
    })
    return { royaltyReceiver: cfg?.value ?? null, royaltyBps: 1000 }
  })

  // ─── PUT /admin/mfp/royalty — set Authors Pool wallet ─────────
  app.put('/mfp/royalty', async (req, reply) => {
    const { wallet: callerWallet } = req.user as { wallet: string }
    if (!isOwnerWallet(callerWallet)) {
      return reply.status(403).send({ error: 'FORBIDDEN', message: 'Forbidden' })
    }
    const body = req.body as { receiver: string; txHash?: string }
    if (!body.receiver || !/^0x[a-fA-F0-9]{40}$/.test(body.receiver)) {
      return reply.status(400).send({ error: 'BAD_REQUEST', message: 'Invalid receiver address' })
    }
    const value = body.receiver.toLowerCase()
    await app.prisma.systemConfig.upsert({
      where: { key: 'mfp_royalty_receiver' },
      create: { key: 'mfp_royalty_receiver', value },
      update: { value },
    })
    auditLog(app, auditCtx(req, 'mfp.royalty.set', value, { txHash: body.txHash }))
    return { royaltyReceiver: value, royaltyBps: 1000 }
  })

  // ─── GET /admin/sync-status — Indexer sync status ─────────────
  app.get('/sync-status', async () => {
    const cursors = await app.prisma.syncCursor.findMany({
      orderBy: { contractName: 'asc' },
    })

    return {
      data: cursors.map((c) => ({
        contractName: c.contractName,
        lastBlock: c.lastBlock,
        updatedAt: c.updatedAt.toISOString(),
      })),
    }
  })
}
