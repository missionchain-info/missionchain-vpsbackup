import { FastifyRequest, FastifyReply, FastifyInstance } from 'fastify'

/**
 * RBAC 4-Level Admin System
 *
 * GOVERNOR  (L4) — Full governance: vote/execute proposals, treasury control, emergency
 *   ↓
 * OPERATOR  (L3) — Full data, treasury view, system config, create proposals
 *   ↓
 * ANALYST   (L2) — Operational data, export, manage members
 *   ↓
 * OBSERVER  (L1) — Read-only, basic dashboard
 */

export const ADMIN_LEVELS = ['OBSERVER', 'ANALYST', 'OPERATOR', 'GOVERNOR'] as const
export type AdminLevel = (typeof ADMIN_LEVELS)[number]

const LEVEL_RANK: Record<AdminLevel, number> = {
  OBSERVER: 1,
  ANALYST: 2,
  OPERATOR: 3,
  GOVERNOR: 4,
}

const OWNER_WALLETS: Set<string> = new Set(
  (process.env.OWNER_WALLETS || '')
    .split(',')
    .map((w) => w.trim().toLowerCase())
    .filter(Boolean)
)

/** Identity check: is this wallet an owner? Source of truth for top-tier privilege. */
export function isOwnerWallet(wallet?: string | null): boolean {
  if (!wallet) return false
  return OWNER_WALLETS.has(wallet.toLowerCase())
}

/** Governance-tier check: owner-wallet OR adminLevel=GOVERNOR.
 *  Use for governance actions (treasury, MFP grants, council/pool member mgmt).
 *  Requires `requireAdmin` preHandler to have populated `req.adminLevel`.
 */
export function isGovernorOrOwner(req: FastifyRequest): boolean {
  const user = req.user as AuthUser
  if (isOwnerWallet(user.wallet)) return true
  const lvl = (req as any).adminLevel as string | null | undefined
  return lvl === 'GOVERNOR'
}

function effectiveRank(role: string, wallet: string, adminLevel?: string | null): number {
  if (isOwnerWallet(wallet)) return 5
  if (role === 'SUPER_ADMIN') return 5
  if (role !== 'ADMIN') return 0
  return LEVEL_RANK[(adminLevel as AdminLevel) ?? 'OBSERVER'] ?? 0
}

interface AuthUser {
  sub: string
  wallet: string
  role: string
  adminLevel?: string | null
}

/** Require role=ADMIN (or owner-wallet override), regardless of level. */
export async function requireAdmin(req: FastifyRequest, reply: FastifyReply) {
  await (req.server as any).authenticate(req, reply)
  const user = req.user as AuthUser
  const ownerOverride = isOwnerWallet(user.wallet)
  if (!ownerOverride && user.role !== 'ADMIN' && user.role !== 'SUPER_ADMIN') {
    return reply.status(403).send({ error: 'FORBIDDEN', message: 'Admin access required' })
  }

  // Load adminLevel + adminEnabled from DB and reject disabled admins
  const dbUser = await (req.server as any).prisma.user.findUnique({
    where: { wallet: user.wallet.toLowerCase() },
    select: { adminLevel: true, adminEnabled: true },
  })
  if (!dbUser && !ownerOverride) return reply.status(403).send({ error: 'FORBIDDEN', message: 'Admin record not found' })
  if (!ownerOverride && user.role === 'ADMIN' && dbUser?.adminEnabled === false) {
    return reply.status(403).send({ error: 'FORBIDDEN', message: 'Admin account disabled' })
  }
  ;(req as any).adminLevel = dbUser?.adminLevel
}

/** Require admin at minimum specified level (owner-wallet always passes). */
export function requireLevel(min: AdminLevel) {
  return async function (req: FastifyRequest, reply: FastifyReply) {
    await requireAdmin(req, reply)
    if (reply.sent) return
    const user = req.user as AuthUser
    const lvl = (req as any).adminLevel as string | null | undefined
    const have = effectiveRank(user.role, user.wallet, lvl)
    const need = LEVEL_RANK[min]
    if (have < need) {
      return reply.status(403).send({
        error: 'FORBIDDEN',
        message: `Requires admin level ≥ ${min}`,
      })
    }
  }
}

/** Require top-tier privilege (owner-wallet only). Generic 403 — never reveals tier name. */
export async function requireSuperAdmin(req: FastifyRequest, reply: FastifyReply) {
  await (req.server as any).authenticate(req, reply)
  const user = req.user as AuthUser
  if (!isOwnerWallet(user.wallet) && user.role !== 'SUPER_ADMIN') {
    return reply.status(403).send({ error: 'FORBIDDEN', message: 'Forbidden' })
  }
}

/** Audit log helper — fire-and-forget, never blocks the request. */
export function auditLog(
  app: FastifyInstance,
  ctx: {
    adminWallet: string
    adminLevel?: string | null
    action: string
    target?: string | null
    payload?: unknown
    ip?: string | null
    userAgent?: string | null
  }
): void {
  void (app as any).prisma.adminAuditLog
    .create({
      data: {
        adminWallet: ctx.adminWallet.toLowerCase(),
        adminLevel: ctx.adminLevel ?? null,
        action: ctx.action,
        target: ctx.target ?? null,
        payload: ctx.payload ? JSON.stringify(ctx.payload) : null,
        ip: ctx.ip ?? null,
        userAgent: ctx.userAgent ?? null,
      },
    })
    .catch((err: unknown) => app.log.warn({ err }, 'auditLog failed'))
}

/** Capture audit context from a Fastify request. */
export function auditCtx(req: FastifyRequest, action: string, target?: string, payload?: unknown) {
  const user = req.user as AuthUser
  return {
    adminWallet: user.wallet,
    adminLevel: (req as any).adminLevel as string | null | undefined ?? null,
    action,
    target,
    payload,
    ip: req.ip,
    userAgent: req.headers['user-agent'] ?? null,
  }
}
