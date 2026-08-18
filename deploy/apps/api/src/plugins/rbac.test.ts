import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

/**
 * Guards the admin permission system.
 *
 * Roles are the Owner's to define at runtime, so this file asserts nothing about which
 * roles exist or what they contain. What it does assert is the machinery those roles rely
 * on: that the capability vocabulary is coherent, and — the one that matters — that EVERY
 * route under /admin is gated.
 *
 * Before 2026-08-10 the /admin prefix carried `requireAdmin` alone, so 67 of 73 endpoints
 * were reachable by any admin: an OBSERVER could grant distributors and approve payouts.
 * A new route added without a gate reopens exactly that hole, which is why this walks the
 * source rather than trusting a checklist.
 */

function findSrc(): string {
  let dir = process.cwd()
  for (let i = 0; i < 6; i++) {
    for (const c of [
      join(dir, 'src', 'plugins', 'rbac.ts'),
      join(dir, 'apps', 'api', 'src', 'plugins', 'rbac.ts'),
    ]) {
      if (existsSync(c)) return resolve(c, '..', '..')
    }
    dir = resolve(dir, '..')
  }
  throw new Error('could not locate apps/api/src from ' + process.cwd())
}

const SRC = findSrc()
const ROUTES = join(SRC, 'routes')
const rbacSrc = readFileSync(join(SRC, 'plugins', 'rbac.ts'), 'utf8')

const ADMIN_ROUTE_FILES = [
  'admin.ts', 'admin-roles.ts', 'distributor.ts', 'founders.ts',
  'old-investors.ts', 'operational-pool.ts', 'steward-council.ts',
]

/** Capability keys as declared in CAPABILITY_GROUPS: ['key', 'label'] pairs. */
const declared = new Set(
  [...rbacSrc.matchAll(/\['([a-z][a-z._]*)',\s*'/g)].map((m) => m[1])
)

/** Capability keys actually referenced by a route gate. */
function gatedCaps(): Map<string, string[]> {
  const byCap = new Map<string, string[]>()
  for (const f of ADMIN_ROUTE_FILES) {
    const src = readFileSync(join(ROUTES, f), 'utf8')
    for (const m of src.matchAll(/requireCap\('([^']+)'\)/g)) {
      if (!byCap.has(m[1])) byCap.set(m[1], [])
      byCap.get(m[1])!.push(f)
    }
  }
  return byCap
}

describe('Capability vocabulary', () => {
  test('is non-trivial — coarse buckets make roles meaningless', () => {
    assert.ok(declared.size >= 20, `only ${declared.size} capabilities declared`)
  })

  test('every declared capability is reachable', () => {
    // A capability nothing checks is a permission that grants nothing — it would appear as
    // a tickable box in the role editor and silently do no work.
    //
    // Some are enforced inside a handler rather than by a route gate: five configuration
    // domains share the generic `PUT /system-config/:key` writer, so their capability is
    // resolved from KEY_CAPABILITY at request time. Count those as reachable too.
    const used = gatedCaps()
    const adminSrc = readFileSync(join(ROUTES, 'admin.ts'), 'utf8')
    const keyMapped = new Set(
      [...adminSrc.matchAll(/'[a-z_-]+':\s*'([a-z][a-z._]*)',/g)].map((m) => m[1])
    )
    const orphans = [...declared].filter(
      (c) => !used.has(c) && !keyMapped.has(c) && c !== 'ops.feeds'
    )
    assert.deepEqual(orphans, [], 'declared but nothing checks it (ops.feeds is exempt — /feeds ships separately)')
  })

  test('every gate names a declared capability', () => {
    const unknown = [...gatedCaps().keys()].filter((c) => !declared.has(c))
    assert.deepEqual(unknown, [], 'gate references a capability that does not exist — it would deny everyone but the Owner')
  })
})

describe('Legacy fallback', () => {
  // Only consulted for an admin with no role attached. It must stay valid so nobody is
  // locked out between this shipping and the Owner defining roles.
  // Slice from the declaration, not from the first mention of the name — that one is in
  // the file header comment, and starting there swept in CAPABILITY_GROUPS.
  const legacy = rbacSrc.slice(rbacSrc.indexOf('export const LEGACY_LEVEL_CAPS'))

  test('references only declared capabilities', () => {
    const block = legacy.slice(0, legacy.indexOf('\n}'))
    const used = [...block.matchAll(/'([a-z][a-z._]*)'/g)].map((m) => m[1])
      .filter((c) => c.includes('.'))
    const unknown = [...new Set(used)].filter((c) => !declared.has(c))
    assert.deepEqual(unknown, [], 'fallback grants a capability that does not exist')
  })

  test('keeps granting and operating apart', () => {
    // The reason the numeric ladder was removed: whoever approves a payout must not also
    // be the one who grants the assets.
    const ops = legacy.slice(legacy.indexOf('OPERATOR:'), legacy.indexOf('GOVERNOR:'))
    const gov = legacy.slice(legacy.indexOf('GOVERNOR:'))
    assert.ok(!ops.includes("'grant."), 'OPERATOR fallback must hold no grant.* capability')
    assert.ok(!gov.includes("'ops."), 'GOVERNOR fallback must hold no ops.* capability')
  })

  test('no level grants settings.* or admin.manage — Owner only', () => {
    const block = legacy.slice(0, legacy.indexOf('\n}'))
    assert.ok(!block.includes("'settings."), 'settings.* belongs to no level')
    assert.ok(!block.includes("'admin.manage'"), 'admin.manage belongs to no level')
  })
})

describe('Route coverage', () => {
  const routeRe = /^\s*app\.(get|post|put|patch|delete)\(\s*'([^']*)',\s*(.*)$/

  test('every /admin route declares a requireCap gate', () => {
    const ungated: string[] = []
    let total = 0
    for (const f of ADMIN_ROUTE_FILES) {
      for (const line of readFileSync(join(ROUTES, f), 'utf8').split('\n')) {
        const m = routeRe.exec(line)
        if (!m) continue
        total++
        if (!m[3].includes('requireCap(')) ungated.push(`${f} ${m[1].toUpperCase()} ${m[2]}`)
      }
    }
    assert.ok(total >= 73, `expected at least 73 admin routes, found ${total}`)
    assert.deepEqual(ungated, [], 'these routes are reachable by any admin')
  })

  test('no route file re-declares its own requireAdmin', () => {
    // distributor.ts carried a private copy that skipped the `adminEnabled` check, so a
    // disabled admin kept all 15 endpoints — including approve-and-pay.
    const offenders = readdirSync(ROUTES)
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
      .filter((f) => /^\s*(async )?function requireAdmin\b/m.test(readFileSync(join(ROUTES, f), 'utf8')))
    assert.deepEqual(offenders, [], 'route files must use the shared requireAdmin')
  })

  test('role resolution is not cached across requests', () => {
    // Removing a capability from a role has to take effect immediately, not when a cache
    // happens to expire.
    assert.match(rbacSrc, /adminRole:\s*\{\s*select:/, 'requireAdmin must load the role per request')
  })
})
