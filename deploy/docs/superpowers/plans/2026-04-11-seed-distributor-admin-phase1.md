# SEED Distributor + Admin Console Phase 1 — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add SEED Distributor 20% commission feature and connect Admin Console to real backend (Auth, Round Config, Distributors, Members, Stats).

**Architecture:** Monorepo with Fastify API (apps/api), Next.js user DApp (apps/web), Next.js admin (apps/admin), Prisma DB (packages/db). All changes are DB-only for Phase 1 (no smart contracts). Admin authenticates via MetaMask wallet signing → JWT with ADMIN role check.

**Tech Stack:** TypeScript, Fastify, Prisma/SQLite, Next.js 14, wagmi v2, viem

**Spec:** `docs/superpowers/specs/2026-04-11-seed-distributor-admin-phase1-design.md`

---

## Chunk 1: Database + API Backend

### Task 1: Add Distributor + DistributorEarning models to Prisma schema

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (after line 320, after AgentGrant model)

- [ ] **Step 1: Add Distributor model**

Add after the `AgentGrant` model (line ~320):

```prisma
// ─── 16. Distributor — SEED distribution partners ─────────────────────
model Distributor {
  id              String    @id @default(cuid())
  wallet          String    @unique
  grantedBy       String
  commissionRate  Decimal   @default(0.20)
  isActive        Boolean   @default(true)
  totalEarned     Decimal   @default(0)
  totalOrders     Int       @default(0)
  notes           String?
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt
  earnings        DistributorEarning[]
}

// ─── 17. DistributorEarning — Per-purchase commission tracking ────────
model DistributorEarning {
  id                  String    @id @default(cuid())
  distributorWallet   String
  purchaseId          String
  buyerWallet         String
  orderAmount         Decimal
  commission          Decimal
  status              String    @default("PENDING") // PENDING | PAID | REJECTED
  txHash              String?
  createdAt           DateTime  @default(now())

  distributor         Distributor @relation(fields: [distributorWallet], references: [wallet])
  purchase            Purchase   @relation(fields: [purchaseId], references: [id])

  @@index([distributorWallet])
  @@index([purchaseId])
}
```

- [ ] **Step 2: Modify Purchase model for Phase 1 DB-only purchases**

In the existing `Purchase` model (around line 72), make `txHash` and `blockNumber` optional (Phase 1 has no on-chain tx), and add status + distributor relation:

```prisma
  txHash          String?      @unique   // Optional for Phase 1 DB-only purchases
  blockNumber     Int?                    // Optional for Phase 1 DB-only purchases
  status          String       @default("CONFIRMED") // CONFIRMED | PENDING | FAILED
```

Add relation field at end of model:
```prisma
  distributorEarnings DistributorEarning[]
```

- [ ] **Step 3: Migrate round status default from PENDING to UPCOMING**

In `RoundConfig` model (line 289), change:
```prisma
  status          String   @default("UPCOMING") // UPCOMING | ACTIVE | CLOSED
```

- [ ] **Step 4: Run Prisma generate + push**

```bash
cd packages/db && npx prisma generate && npx prisma db push
```

Expected: Schema synced, no errors.

- [ ] **Step 5: Migrate existing DB rows**

```bash
cd packages/db && npx prisma db execute --stdin <<'SQL'
UPDATE RoundConfig SET status = 'UPCOMING' WHERE status = 'PENDING';
UPDATE RoundConfig SET status = 'CLOSED' WHERE status = 'INACTIVE';
SQL
```

- [ ] **Step 6: Commit**

```bash
git add packages/db/prisma/schema.prisma
git commit -m "feat(db): add Distributor + DistributorEarning models, migrate round status to UPCOMING/ACTIVE/CLOSED"
```

---

### Task 2: Create distributor API routes

**Files:**
- Create: `apps/api/src/routes/distributor.ts`
- Modify: `apps/api/src/index.ts` (line ~89, add route registration)

- [ ] **Step 1: Create `apps/api/src/routes/distributor.ts`**

```typescript
import { FastifyInstance } from 'fastify'

export default async function distributorRoutes(app: FastifyInstance) {
  // Reuse the same requireAdmin preHandler pattern from admin.ts
  app.addHook('preHandler', async (req, reply) => {
    await (app as any).authenticate(req, reply)
    const user = req.user as { role?: string } | undefined
    if (!user || user.role !== 'ADMIN') {
      return reply.status(403).send({ error: 'FORBIDDEN', message: 'Admin access required' })
    }
  })

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

    return { data: distributors, total, page, limit }
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
      totalEarned: aggregates._sum.totalEarned || 0,
      totalOrders: aggregates._sum.totalOrders || 0,
    }
  })

  // ─── POST /admin/distributors — Grant new distributor ───────────────
  app.post('/', async (req, reply) => {
    const body = req.body as { wallet?: string; commissionRate?: number; notes?: string }
    const { wallet: adminWallet } = req.user as { wallet: string }

    if (!body.wallet) {
      return reply.status(400).send({ error: 'BAD_REQUEST', message: 'wallet is required' })
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
        commissionRate: body.commissionRate ?? 0.20,
        notes: body.notes || null,
      },
    })

    return reply.status(201).send({ data: distributor })
  })

  // ─── PUT /admin/distributors/:wallet — Update distributor ───────────
  app.put('/:wallet', async (req, reply) => {
    const { wallet } = req.params as { wallet: string }
    const body = req.body as { isActive?: boolean; commissionRate?: number; notes?: string }

    const distributor = await app.prisma.distributor.findUnique({ where: { wallet: wallet.toLowerCase() } })
    if (!distributor) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'Distributor not found' })
    }

    const updated = await app.prisma.distributor.update({
      where: { wallet: wallet.toLowerCase() },
      data: {
        ...(body.isActive !== undefined && { isActive: body.isActive }),
        ...(body.commissionRate !== undefined && { commissionRate: body.commissionRate }),
        ...(body.notes !== undefined && { notes: body.notes }),
      },
    })

    return { data: updated }
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

    return { data: earnings, total, page, limit }
  })
}
```

- [ ] **Step 2: Register route in `apps/api/src/index.ts`**

Add import at top (around line 14):
```typescript
import distributorRoutes from './routes/distributor'
```

Add registration after admin routes (around line 89):
```typescript
app.register(distributorRoutes, { prefix: '/admin/distributors' })
```

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/routes/distributor.ts apps/api/src/index.ts
git commit -m "feat(api): add distributor CRUD routes (GET/POST/PUT/DELETE + stats + earnings)"
```

---

### Task 3: Add SEED purchase endpoint with distributor commission

**Files:**
- Modify: `apps/api/src/routes/sales.ts` (add after line ~226)

- [ ] **Step 1: Add POST /sales/seed/purchase endpoint**

Add at the end of the `salesRoutes` function, before the closing brace:

```typescript
  // ─── POST /sales/seed/purchase — Phase 1 DB-only SEED purchase ──────
  app.post('/seed/purchase', async (req, reply) => {
    const user = req.user as { wallet: string; role: string } | undefined
    if (!user) {
      return reply.status(401).send({ error: 'UNAUTHORIZED', message: 'Authentication required' })
    }

    const body = req.body as { amount: number; referrerUserId?: string }
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

    // Check KYC
    const dbUser = await app.prisma.user.findUnique({ where: { wallet: user.wallet } })
    if (!dbUser || dbUser.kycStatus !== 'APPROVED') {
      return reply.status(403).send({ error: 'KYC_REQUIRED', message: 'KYC approval required for SEED purchase' })
    }

    const micAmount = body.amount / MIC_PRICE

    // Wrap in transaction for atomicity
    const result = await app.prisma.$transaction(async (tx) => {
      // Create purchase record (txHash/blockNumber optional for Phase 1)
      const purchase = await tx.purchase.create({
        data: {
          wallet: user.wallet.toLowerCase(),
          type: 'SEED',
          usdtAmount: body.amount,
          micAmount,
          status: 'CONFIRMED',
          referrerWallet: null, // SEED has no regular referral
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

      return { purchase, distributorCommission }
    })

    return reply.status(201).send({
      data: {
        purchaseId: result.purchase.id,
        usdtAmount: body.amount,
        micAmount,
        status: 'CONFIRMED',
        distributorCommission: result.distributorCommission,
      },
    })
  })
```

- [ ] **Step 2: Commit**

```bash
git add apps/api/src/routes/sales.ts
git commit -m "feat(api): add POST /sales/seed/purchase with distributor commission tracking"
```

---

### Task 4: Migrate round status enum across API + Frontend

**Files:**
- Modify: `apps/api/src/routes/admin.ts` (line 239)
- Modify: `apps/web/hooks/useRoundConfig.ts` (line 5)
- Modify: `apps/web/components/ui/RoundGuard.tsx` (lines 19-40)

- [ ] **Step 1: Update admin.ts validation array**

In `apps/api/src/routes/admin.ts`, find line 239:
```typescript
// OLD:
const validStatuses = ['ACTIVE', 'PENDING', 'INACTIVE']
// NEW:
const validStatuses = ['UPCOMING', 'ACTIVE', 'CLOSED']
```

- [ ] **Step 2: Update useRoundConfig.ts type**

In `apps/web/hooks/useRoundConfig.ts`, find line 5:
```typescript
// OLD:
export type RoundStatus = 'ACTIVE' | 'PENDING' | 'INACTIVE'
// NEW:
export type RoundStatus = 'UPCOMING' | 'ACTIVE' | 'CLOSED'
```

- [ ] **Step 3: Update RoundGuard.tsx status checks**

In `apps/web/components/ui/RoundGuard.tsx`, replace PENDING/INACTIVE checks with UPCOMING/CLOSED:

Replace the status check logic (lines ~19-40):
- Change `status === 'PENDING'` → `status === 'UPCOMING'`
- Change `status === 'INACTIVE'` → `status === 'CLOSED'`
- Update display text: "Coming Soon" for UPCOMING, "Round Closed" for CLOSED

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/admin.ts apps/web/hooks/useRoundConfig.ts apps/web/components/ui/RoundGuard.tsx
git commit -m "refactor: migrate round status enum PENDING→UPCOMING, INACTIVE→CLOSED"
```

---

## Chunk 2: Admin Console — Auth + Layout + API Client

### Task 5: Admin Console — Real MetaMask auth

**Files:**
- Create: `apps/admin/lib/wagmi.ts`
- Modify: `apps/admin/lib/auth.tsx` (full rewrite)
- Modify: `apps/admin/lib/api.ts` (add JWT auto-attach)
- Modify: `apps/admin/app/layout.tsx` (add WagmiProvider)
- Modify: `apps/admin/app/page.tsx` (real login page)

- [ ] **Step 1: Create `apps/admin/lib/wagmi.ts`**

```typescript
import { createConfig, http } from 'wagmi'
import { bsc, bscTestnet } from 'wagmi/chains'
import { injected } from 'wagmi/connectors'

const chain = process.env.NEXT_PUBLIC_CHAIN === 'mainnet' ? bsc : bscTestnet

export const config = createConfig({
  connectors: [injected()],
  chains: [chain],
  transports: {
    [bscTestnet.id]: http('https://data-seed-prebsc-1-s1.binance.org:8545'),
    [bsc.id]: http('https://bsc-dataseed.binance.org/'),
  },
  ssr: false,
})
```

- [ ] **Step 2: Rewrite `apps/admin/lib/auth.tsx`**

Replace entire file with real wagmi-based auth that:
- Uses `useAccount()` and `useSignMessage()` from wagmi
- Implements `signIn()`: getNonce → signMessage → POST /auth/verify → check role === ADMIN → store JWT
- Implements `signOut()`: clear JWT + disconnect
- Stores JWT in `localStorage('mc-admin-jwt')`
- Exposes `{ user, isAuthenticated, signIn, signOut, loading }` via context

- [ ] **Step 3: Update `apps/admin/lib/api.ts` — Add JWT auto-attach**

Add to the `apiFetch` function headers:
```typescript
const jwt = typeof window !== 'undefined' ? localStorage.getItem('mc-admin-jwt') : null
if (jwt) headers['Authorization'] = `Bearer ${jwt}`
```

Fix mismatched routes:
- `/admin/stats/overview` → `/admin/stats`
- `/admin/members` → `/admin/users`

Add new API functions:
```typescript
// Distributors
export async function fetchDistributors(params?) { ... }
export async function fetchDistributorStats() { ... }
export async function grantDistributor(data) { ... }
export async function updateDistributor(wallet, data) { ... }
export async function deleteDistributor(wallet) { ... }
export async function fetchDistributorEarnings(wallet, params?) { ... }

// Rounds
export async function fetchRoundConfigs() { ... }
export async function updateRoundConfig(roundType, data) { ... }
```

- [ ] **Step 4: Update `apps/admin/app/layout.tsx`**

Add WagmiProvider + QueryClientProvider wrapping AuthProvider:
```tsx
<WagmiProvider config={config}>
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      {children}
    </AuthProvider>
  </QueryClientProvider>
</WagmiProvider>
```

- [ ] **Step 5: Rewrite `apps/admin/app/page.tsx` — Login page**

Replace with Connect Wallet button that triggers auth flow:
- Show "Mission Chain Admin" branding
- "Connect Wallet" button → triggers wagmi connect → auto signIn
- If role not ADMIN → show "Access Denied" message
- If OK → redirect to /stats

- [ ] **Step 6: Commit**

```bash
git add apps/admin/lib/wagmi.ts apps/admin/lib/auth.tsx apps/admin/lib/api.ts apps/admin/app/layout.tsx apps/admin/app/page.tsx
git commit -m "feat(admin): implement real MetaMask wallet auth with JWT + role check"
```

---

### Task 6: Admin Sidebar — Update navigation

**Files:**
- Modify: `apps/admin/components/layout/Sidebar.tsx` (lines 21-55)

- [ ] **Step 1: Replace NAV_ITEMS**

Update the navigation to Phase 1 items only:
```typescript
const NAV_ITEMS = [
  {
    group: 'Overview',
    items: [
      { icon: '📊', label: 'Dashboard', href: '/stats' },
    ],
  },
  {
    group: 'Management',
    items: [
      { icon: '👥', label: 'Members', href: '/members' },
      { icon: '⚙️', label: 'Round Config', href: '/rounds' },
      { icon: '🤝', label: 'Distributors', href: '/distributors' },
    ],
  },
  {
    group: 'Settings',
    items: [
      { icon: '🔧', label: 'System', href: '/system' },
    ],
  },
]
```

- [ ] **Step 2: Commit**

```bash
git add apps/admin/components/layout/Sidebar.tsx
git commit -m "feat(admin): update sidebar nav to Phase 1 items (Dashboard, Members, Rounds, Distributors, System)"
```

---

## Chunk 3: Admin Console — Pages (Round Config, Distributors, Stats, Members)

### Task 7: Round Config page

**Files:**
- Create: `apps/admin/app/(dashboard)/rounds/page.tsx`

- [ ] **Step 1: Create Round Config page**

Page layout:
- Page header: "Round Configuration" with subtitle
- Grid of 6 cards (SEED, PRESALE, MICE, MINING, STAKING, DAO)
- Each card shows: roundType name, status badge (UPCOMING=yellow, ACTIVE=green, CLOSED=gray), countdown end, displayCap / totalSold, MIC price
- Edit mode per card: status dropdown (UPCOMING/ACTIVE/CLOSED), datetime input for countdownEnd, number inputs for displayCap and totalSold
- Save button per card → calls `updateRoundConfig(roundType, data)`
- Fetch from `fetchRoundConfigs()` on mount

- [ ] **Step 2: Commit**

```bash
git add apps/admin/app/\(dashboard\)/rounds/page.tsx
git commit -m "feat(admin): add Round Config page with status/countdown/cap controls"
```

---

### Task 8: Distributors management page

**Files:**
- Create: `apps/admin/app/(dashboard)/distributors/page.tsx`

- [ ] **Step 1: Create Distributors page**

Page layout:
- Page header: "Distributor Management"
- Stats row (4 cards): Total Distributors, Active, Total Earned (USDT), Total Orders
- "Grant Distributor" button → inline form: wallet input, commission rate (default 20%), notes textarea, Submit button
- Table: wallet (truncated + copy), status badge (Active/Disabled), commission rate, total earned, total orders, created date, actions column
- Actions: Enable/Disable toggle button, Delete button (with confirm dialog), "Earnings" expand button
- Earnings expand: nested table showing buyer wallet, order amount, commission, status, date
- Pagination at bottom

API calls:
- `fetchDistributorStats()` for top cards
- `fetchDistributors({ page, status })` for table
- `grantDistributor({ wallet, commissionRate, notes })` for grant
- `updateDistributor(wallet, { isActive })` for toggle
- `deleteDistributor(wallet)` for delete
- `fetchDistributorEarnings(wallet, { page })` for earnings

- [ ] **Step 2: Commit**

```bash
git add apps/admin/app/\(dashboard\)/distributors/page.tsx
git commit -m "feat(admin): add Distributors page with grant/enable/disable/delete/earnings"
```

---

### Task 9: Stats page — Connect to real API

**Files:**
- Modify: `apps/admin/app/(dashboard)/stats/page.tsx` (full rewrite)

- [ ] **Step 1: Rewrite Stats page**

Replace hardcoded data with real API calls:
- `fetchStatsOverview()` → `/admin/stats` (member count, MICE count, etc.)
- Add: sales stats from `/admin/sales/stats`
- Add: distributor stats from `fetchDistributorStats()`
- Keep chart placeholders (data-driven charts are Phase 2)
- Show loading states while fetching

Cards:
- Total Members (real count)
- SEED Sales: totalSold / displayCap
- Distributor Payouts: total USDT earned
- Active Rounds: count of ACTIVE rounds

- [ ] **Step 2: Commit**

```bash
git add apps/admin/app/\(dashboard\)/stats/page.tsx
git commit -m "feat(admin): connect Stats page to real API data"
```

---

### Task 10: Members page — Connect to real API

**Files:**
- Modify: `apps/admin/app/(dashboard)/members/page.tsx`

- [ ] **Step 1: Update Members page**

Replace FALLBACK_MEMBERS with real API data:
- Fetch from `/admin/users?page=X&limit=20&search=Y&role=Z`
- Fix route in api.ts: `/admin/members` → `/admin/users`
- Map API response fields to table columns (wallet, userId, role, kycStatus, joined)
- Add KYC action buttons: Approve / Reject → PUT `/admin/users/:wallet/kyc`
- Add role dropdown: USER / AGENT / ADMIN → PUT `/admin/users/:wallet/role`
- Keep search, role filter, pagination working with real data
- Remove "Bonus & Incentives Grant" section (moved to Distributors page)

- [ ] **Step 2: Commit**

```bash
git add apps/admin/app/\(dashboard\)/members/page.tsx
git commit -m "feat(admin): connect Members page to real API with KYC + role management"
```

---

## Chunk 4: Frontend User DApp Updates

### Task 11: SEED page — Show distributor attribution

**Files:**
- Modify: `apps/web/app/(dashboard)/seed/page.tsx`

- [ ] **Step 1: Add distributor detection**

In the SEED page component:
- Read `?ref=` from URL search params (already exists for referral)
- If `referrerUserId` exists, pass it to any future purchase call
- Show subtle text below hero: "Introduced by Distributor" if the referrer is a distributor (can check via a lightweight API call or simply show for any ref link on SEED page since SEED has no regular referral)

- [ ] **Step 2: Commit**

```bash
git add apps/web/app/\(dashboard\)/seed/page.tsx
git commit -m "feat(web): show distributor attribution on SEED page"
```

---

### Task 12: Set test wallet as ADMIN in DB

**Files:**
- Run: DB command to set the test wallet role to ADMIN

- [ ] **Step 1: Update test wallet role**

```bash
cd packages/db && npx prisma db execute --stdin <<'SQL'
UPDATE User SET role = 'ADMIN' WHERE wallet = '<TEST_WALLET_ADDRESS>';
SQL
```

Replace `<TEST_WALLET_ADDRESS>` with the actual test wallet address (lowercase).

- [ ] **Step 2: Verify**

```bash
cd packages/db && npx prisma studio
```

Check User table — test wallet should show `role = ADMIN`.

---

### Task 13: Build and verify all apps

- [ ] **Step 1: Build API**

```bash
cd apps/api && npm run build
```

Expected: No TypeScript errors.

- [ ] **Step 2: Build Web app**

```bash
cd apps/web && npm run build
```

Expected: No build errors.

- [ ] **Step 3: Build Admin app**

```bash
cd apps/admin && npm run build
```

Expected: No build errors.

- [ ] **Step 4: Start API and test endpoints**

```bash
cd apps/api && npm run dev
```

Test distributor endpoints:
```bash
# Health check
curl http://localhost:4000/health

# Round configs
curl http://localhost:4000/rounds/config
```

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "build: verify all apps compile successfully"
```
