import { FastifyPluginAsync } from 'fastify'
import {
  requireAdmin,
  requireCap,
  CAPABILITY_GROUPS,
  CAPABILITIES,
  LEGACY_LEVEL_CAPS,
  auditLog,
  auditCtx,
} from '../plugins/rbac.js'

/**
 * Admin roles — the Owner defines them, the code does not.
 *
 * A role is a name plus a set of capabilities. The capability vocabulary is fixed by the
 * code (every entry has a real gate); which bundles exist, what they are called and who
 * holds them is entirely the Owner's to decide here.
 *
 * Everything in this file needs `admin.manage`, which belongs to no role — so in practice
 * only the Owner wallet reaches it. That is deliberate: a role that could edit roles could
 * grant itself anything, which would make every other permission decorative.
 */

/** Seeded on first read so the Owner starts from something rather than a blank page. */
const SEED_ROLES = [
  { name: 'Người quan sát', description: 'Chỉ xem thông tin cơ bản. Không xuất dữ liệu, không thao tác.', level: 'OBSERVER' as const },
  { name: 'Nhà phân tích', description: 'Xem toàn bộ thông tin chi tiết và xuất Excel. Không sửa gì.', level: 'ANALYST' as const },
  { name: 'Vận hành', description: 'Duyệt KYC, quản lý Nhà phân phối, duyệt và chi trả. Không chạm cấu hình.', level: 'OPERATOR' as const },
  { name: 'Quản trị', description: 'Cấp phát NFT, MIC HĐQT, bổ nhiệm ghế Council. Không can thiệp vận hành.', level: 'GOVERNOR' as const },
]

export const adminRoleRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAdmin)

  /** Create the four starter roles once, if the table is empty. */
  async function ensureSeeded() {
    if ((await app.prisma.adminRole.count()) > 0) return
    for (const r of SEED_ROLES) {
      await app.prisma.adminRole.create({
        data: {
          name: r.name,
          description: r.description,
          capabilities: [...LEGACY_LEVEL_CAPS[r.level]],
          isSystem: false, // the Owner may rename, re-scope or delete any of these
        },
      })
    }
    app.log.info('Seeded 4 starter admin roles')
  }

  // ─── GET /admin/roles ────────────────────────────────────────────────
  // Returns the roles, the capability vocabulary the editor renders, and how many admins
  // hold each role (the UI needs that to explain why a delete is refused).
  app.get('/', { preHandler: requireCap('admin.manage') }, async () => {
    await ensureSeeded()
    const roles = await app.prisma.adminRole.findMany({
      orderBy: { createdAt: 'asc' },
      include: { _count: { select: { users: true } } },
    })
    return {
      data: roles.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        capabilities: r.capabilities,
        isSystem: r.isSystem,
        userCount: r._count.users,
        createdAt: r.createdAt,
      })),
      vocabulary: CAPABILITY_GROUPS,
    }
  })

  /** Keep only keys the code actually gates. A typo would otherwise be stored as a
   *  permission that silently grants nothing. */
  function sanitize(caps: unknown): { ok: true; caps: string[] } | { ok: false; bad: string[] } {
    if (!Array.isArray(caps)) return { ok: false, bad: ['capabilities must be an array'] }
    const bad = caps.filter((c) => typeof c !== 'string' || !CAPABILITIES.includes(c))
    if (bad.length) return { ok: false, bad: bad.map(String) }
    return { ok: true, caps: [...new Set(caps as string[])] }
  }

  // ─── POST /admin/roles ───────────────────────────────────────────────
  app.post('/', { preHandler: requireCap('admin.manage') }, async (req, reply) => {
    const body = req.body as { name?: string; description?: string; capabilities?: unknown }
    const name = (body.name ?? '').trim()
    if (!name) return reply.status(400).send({ error: 'BAD_REQUEST', message: 'name is required' })

    const s = sanitize(body.capabilities ?? [])
    if (!s.ok) return reply.status(400).send({ error: 'BAD_REQUEST', message: `Unknown capabilities: ${s.bad.join(', ')}` })

    if (await app.prisma.adminRole.findUnique({ where: { name } })) {
      return reply.status(409).send({ error: 'CONFLICT', message: 'A role with that name already exists' })
    }

    const role = await app.prisma.adminRole.create({
      data: { name, description: body.description?.trim() || null, capabilities: s.caps },
    })
    auditLog(app, auditCtx(req, 'role.create', role.id, { name, capabilities: s.caps }))
    return reply.status(201).send({ data: role })
  })

  // ─── PUT /admin/roles/:id ────────────────────────────────────────────
  app.put('/:id', { preHandler: requireCap('admin.manage') }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const body = req.body as { name?: string; description?: string; capabilities?: unknown }

    const existing = await app.prisma.adminRole.findUnique({ where: { id } })
    if (!existing) return reply.status(404).send({ error: 'NOT_FOUND', message: 'Role not found' })

    let caps: string[] | undefined
    if (body.capabilities !== undefined) {
      const s = sanitize(body.capabilities)
      if (!s.ok) return reply.status(400).send({ error: 'BAD_REQUEST', message: `Unknown capabilities: ${s.bad.join(', ')}` })
      caps = s.caps
    }

    const name = body.name?.trim()
    if (name && name !== existing.name) {
      if (await app.prisma.adminRole.findUnique({ where: { name } })) {
        return reply.status(409).send({ error: 'CONFLICT', message: 'A role with that name already exists' })
      }
    }

    const role = await app.prisma.adminRole.update({
      where: { id },
      data: {
        ...(name && { name }),
        ...(body.description !== undefined && { description: body.description?.trim() || null }),
        ...(caps && { capabilities: caps }),
      },
    })

    // Capability changes take effect on the holders' very next request — requireAdmin reads
    // the role per request, so nothing has to be re-issued or logged out.
    auditLog(app, auditCtx(req, 'role.update', id, {
      before: { name: existing.name, capabilities: existing.capabilities },
      after: { name: role.name, capabilities: role.capabilities },
    }))
    return { data: role }
  })

  // ─── DELETE /admin/roles/:id ─────────────────────────────────────────
  app.delete('/:id', { preHandler: requireCap('admin.manage') }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const role = await app.prisma.adminRole.findUnique({
      where: { id },
      include: { _count: { select: { users: true } } },
    })
    if (!role) return reply.status(404).send({ error: 'NOT_FOUND', message: 'Role not found' })
    if (role.isSystem) {
      return reply.status(409).send({ error: 'CONFLICT', message: 'This role is protected and cannot be deleted' })
    }
    // The relation is onDelete: SetNull, so deleting a role in use would silently drop its
    // holders back to the legacy fallback — a permission change nobody asked for. Refuse and
    // make the Owner move them first.
    if (role._count.users > 0) {
      return reply.status(409).send({
        error: 'CONFLICT',
        message: `${role._count.users} admin(s) still hold this role. Reassign them first.`,
      })
    }

    await app.prisma.adminRole.delete({ where: { id } })
    auditLog(app, auditCtx(req, 'role.delete', id, { name: role.name }))
    return { success: true }
  })

  // ─── PUT /admin/roles/assign/:wallet ─────────────────────────────────
  // Attach a role to an admin, or detach with roleId: null.
  app.put('/assign/:wallet', { preHandler: requireCap('admin.manage') }, async (req, reply) => {
    const { wallet } = req.params as { wallet: string }
    const { roleId } = req.body as { roleId?: string | null }
    const w = wallet.toLowerCase()

    const user = await app.prisma.user.findUnique({ where: { wallet: w } })
    if (!user) return reply.status(404).send({ error: 'NOT_FOUND', message: 'Wallet is not a registered user' })
    if (user.role !== 'ADMIN' && user.role !== 'SUPER_ADMIN') {
      return reply.status(400).send({ error: 'BAD_REQUEST', message: 'Wallet is not an admin' })
    }

    if (roleId) {
      const role = await app.prisma.adminRole.findUnique({ where: { id: roleId } })
      if (!role) return reply.status(404).send({ error: 'NOT_FOUND', message: 'Role not found' })
    }

    const updated = await app.prisma.user.update({
      where: { wallet: w },
      data: { adminRoleId: roleId ?? null },
      select: { wallet: true, userId: true, adminRoleId: true, adminRole: { select: { name: true } } },
    })
    auditLog(app, auditCtx(req, 'role.assign', w, { roleId: roleId ?? null }))
    return { data: updated }
  })
}
