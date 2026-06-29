# SEED Distributor + Admin Console Phase 1 — Design Spec

**Date:** 2026-04-11
**Status:** Approved (rev 2 — post-review fixes)
**Scope:** SEED Distributor feature + Admin Console Phase 1 (Auth, Round Config, Distributors, Members, Stats)

---

## 0. Codebase Alignment Notes

### 0.1 Role enum
Existing `User.role` uses: `USER | AGENT | ADMIN`. Existing `requireAdmin` preHandler in `admin.ts` checks `role === 'ADMIN'`. There is no `OWNER` or `SUPER_ADMIN` in User model. The `AdminBoard` table has separate roles (OWNER, ADMIN, SENATOR, etc.) but those are governance roles, not auth roles.

**Decision:** Admin Console auth checks `User.role IN ('ADMIN')`. A single ADMIN role is sufficient for Phase 1. OWNER-level restrictions (if needed later) can use AdminBoard lookup.

### 0.2 Round status migration
Existing code uses: `PENDING | ACTIVE | INACTIVE` (in DB default, RoundGuard, useRoundConfig, admin API validation).

**Decision:** Migrate to `UPCOMING | ACTIVE | CLOSED`. ALL of these files must be updated together:
- `packages/db/prisma/schema.prisma` — default `"UPCOMING"`
- `apps/api/src/routes/admin.ts` — validation array
- `apps/web/hooks/useRoundConfig.ts` — TypeScript type
- `apps/web/components/ui/RoundGuard.tsx` — status checks
- Existing DB rows: migration script to rename `PENDING→UPCOMING`, `INACTIVE→CLOSED`

### 0.3 AgentGrant deprecation
Existing `AgentGrant` table and `/admin/agent-grants` endpoints are **superseded** by the new `Distributor` + `DistributorEarning` tables. The old table and endpoints will be kept but marked deprecated (no new usage). All new distributor commission logic uses the new tables exclusively.

### 0.4 SEED purchase endpoint
Currently no `POST /sales/seed/purchase` exists — purchases are on-chain events indexed by EventIndexer. For Phase 1 (DB-only, no smart contracts deployed), we **create a new `POST /sales/seed/purchase` endpoint** that:
- Accepts `{ amount, referrerUserId? }` + JWT auth
- Creates Purchase record in DB
- Checks distributor attribution
- This will be replaced by on-chain flow in Phase 2

### 0.5 Admin api.ts route corrections
Existing `apps/admin/lib/api.ts` has mismatched routes (e.g. `/admin/stats/overview` vs actual `/admin/stats`, `/admin/members` vs actual `/admin/users`). These will be corrected to match actual backend routes during implementation.

---

## 1. SEED Distributor

### 1.1 Concept

Admin grants "Distributor" role to specific wallets. When a buyer purchases SEED via a Distributor's referral link, the Distributor earns **20% commission on the full USDT order amount**. Commission rate is configurable per distributor (default 20%, admin can adjust).

- SEED Sale is 100% USDT payment (no 50/50 split like MICE)
- Example: Buyer purchases $1,000 SEED → Distributor earns $200 USDT
- Multiple Distributors allowed, each with their own referral link
- Admin can Grant / Enable / Disable / Delete Distributors
- Distributor MUST be a registered User (wallet exists in User table) — validated at grant time
- Duplicate wallet grant returns 409 CONFLICT

### 1.2 Data Flow

```
Admin Console                    Backend API                      Frontend (User)
┌──────────────┐   POST          ┌──────────────────┐             ┌──────────────┐
│ Grant wallet  │──/admin/───────>│ DB: Distributor   │             │ SEED Page    │
│ as Distributor│  distributors   │ isActive=true     │             │              │
└──────────────┘                 └────────┬─────────┘             │ ?ref=MC-xxx  │
                                          │                       └──────┬───────┘
                                          │                              │
                                    On SEED purchase:                    │
                                    POST /sales/seed/purchase            │
                                          │                              │
                                 ┌────────▼──────────────────┐          │
                                 │ 1. Create Purchase record  │          │
                                 │ 2. Lookup referrer wallet  │<─────────┘
                                 │ 3. Is referrer a Distributor│
                                 │    AND isActive=true?       │
                                 │ 4. YES → Create             │
                                 │    DistributorEarning        │
                                 │    commission = 20% × amount │
                                 │ 5. Update distributor        │
                                 │    totalEarned, totalOrders  │
                                 └─────────────────────────────┘
```

### 1.3 DB Schema

**Table: `Distributor`**

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| id | String (cuid) | auto | Primary key |
| wallet | String | required | Distributor wallet address (unique) |
| grantedBy | String | required | Admin wallet who granted |
| commissionRate | Decimal | 0.20 | Commission rate (20%) |
| isActive | Boolean | true | Enable/Disable toggle |
| totalEarned | Decimal | 0 | Accumulated USDT earned |
| totalOrders | Int | 0 | Count of referred purchases |
| notes | String? | null | Admin notes |
| createdAt | DateTime | now() | Created timestamp |
| updatedAt | DateTime | auto | Last updated |

Indexes: `@@unique([wallet])`
Relations: `earnings DistributorEarning[]`

**Table: `DistributorEarning`**

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| id | String (cuid) | auto | Primary key |
| distributorWallet | String | required | FK to Distributor.wallet |
| purchaseId | String | required | FK to Purchase.id |
| buyerWallet | String | required | Buyer's wallet |
| orderAmount | Decimal | required | Full USDT order amount |
| commission | Decimal | required | commissionRate × orderAmount |
| status | String | "PENDING" | PENDING / PAID / REJECTED |
| txHash | String? | null | On-chain tx when paid |
| createdAt | DateTime | now() | Created timestamp |

Relations:
- `distributor Distributor @relation(fields: [distributorWallet], references: [wallet])`
- `purchase Purchase @relation(fields: [purchaseId], references: [id])`

Indexes: `@@index([distributorWallet])`, `@@index([purchaseId])`

### 1.4 API Endpoints

| Route | Method | Auth | Description |
|-------|--------|------|-------------|
| `/admin/distributors` | GET | ADMIN | List all distributors (paginated, filterable) |
| `/admin/distributors/stats` | GET | ADMIN | Aggregate stats: totalDistributors, activeCount, totalEarned, totalOrders |
| `/admin/distributors` | POST | ADMIN | Grant wallet as distributor (409 if duplicate) |
| `/admin/distributors/:wallet` | PUT | ADMIN | Update: enable/disable/notes/commissionRate |
| `/admin/distributors/:wallet` | DELETE | ADMIN | Delete distributor (blocked if earnings exist; use disable instead) |
| `/admin/distributors/:wallet/earnings` | GET | ADMIN | Earnings history (paginated: ?page=1&limit=20) |

**POST body (grant):**
```json
{
  "wallet": "0x...",
  "commissionRate": 0.20,
  "notes": "SEED Agent for Vietnam market"
}
```

**PUT body (update):**
```json
{
  "isActive": false,
  "notes": "Temporarily disabled"
}
```

### 1.5 Purchase Flow Integration

New endpoint: `POST /sales/seed/purchase` (Phase 1 — DB-only, no on-chain):

1. Auth required (JWT). Extract buyer wallet from token.
2. Accept `{ amount: number, referrerUserId?: string }` from request body
3. Validate: amount >= minimum, SEED round is ACTIVE, buyer is KYC-approved
4. Create `Purchase` record (type: 'SEED', amount, wallet)
5. If `referrerUserId` provided:
   a. Lookup referrer in `User` table: `WHERE userId = referrerUserId`
   b. If found, query `Distributor` table: `WHERE wallet = referrerUser.wallet AND isActive = true`
   c. If distributor found → create `DistributorEarning` record with `commission = amount * distributor.commissionRate`
   d. Increment `Distributor.totalEarned += commission` and `Distributor.totalOrders += 1`
6. Return purchase confirmation

**Constraint:** Distributor must be a registered User. The `?ref=MC-xxx` URL param uses `userId` format (consistent with existing referral system). Frontend passes `referrerUserId` in the purchase request body.

### 1.6 Frontend (User DApp)

- SEED page: if `?ref=MC-xxx` and referrer is active Distributor → show subtle text "Introduced by Distributor" (no wallet/name exposed)
- No other UI changes for end users

---

## 2. Admin Console Phase 1

### 2.1 Architecture

```
Browser (admin.missionchain.io)
    │
    ▼
Next.js 14 (apps/admin, port 3004)
    │ JWT in Authorization header
    ▼
Fastify API (apps/api, port 4000)
    │ /admin/* routes (role-gated)
    ▼
Prisma + SQLite (packages/db)
```

### 2.2 Module 1: Auth (MetaMask → JWT)

**Current state:** Simulated auth with hardcoded user.
**Target:** Real wallet-based auth identical to user DApp.

**Flow:**
1. Admin opens app → sees Connect Wallet button
2. Connect MetaMask → `useAccount()` gets address
3. GET `/auth/nonce?wallet=0x...` → get nonce
4. `signMessageAsync(nonce)` → signature
5. POST `/auth/verify` → `{ wallet, signature }` → backend verifies, checks `User.role === 'ADMIN'`
6. If role not ADMIN → return 403 "Access Denied"
7. If OK → return JWT with role claim
8. Store in `localStorage('mc-admin-jwt')`
9. All subsequent API calls attach `Authorization: Bearer <jwt>`
10. Disconnect → clear JWT

**Files to modify:**
- `apps/admin/lib/auth.tsx` — Replace simulated login with real wagmi flow
- `apps/admin/lib/api.ts` — Add JWT auto-attach from localStorage
- `apps/admin/app/layout.tsx` — Add WagmiProvider + QueryClientProvider
- `apps/admin/lib/wagmi.ts` — New file, same config as web app
- `apps/admin/app/page.tsx` — Login page with Connect Wallet

### 2.3 Module 2: Round Config

**Purpose:** Admin controls round status, countdown, display values for all sale rounds.

**Round statuses (3 states):**

| Status | Meaning | Frontend behavior |
|--------|---------|-------------------|
| UPCOMING | Not yet open, has countdown | "Coming Soon" + countdown timer |
| ACTIVE | Open for purchase | Full purchase UI |
| CLOSED | Ended or sold out | "Round Closed" or "Sold Out" |

**Admin UI — Round Config page:**
- Grid of cards, one per round: SEED, PRESALE, MICE, MINING, STAKING, DAO
- Each card shows: current status (badge), countdown end, displayCap, totalSold, MIC price
- Click card → modal/inline edit: toggle status dropdown, date picker for countdown, number inputs for cap/sold
- Save → PUT `/admin/rounds/:roundType`

**API:** Already exists at `/admin/rounds` (GET) and `/admin/rounds/:roundType` (PUT). Update RoundConfig model to use new status enum.

**DB change:** Update `RoundConfig.status` default from `"PENDING"` to `"UPCOMING"`.

### 2.4 Module 3: Distributor Management

**Admin UI — Distributors page:**

**Top stats row:**
- Total Distributors (active/inactive)
- Total USDT Earned (all distributors)
- Total Orders (via distributors)

**Actions:**
- "Grant Distributor" button → modal: wallet input, commission rate (default 20%), notes
- Table: wallet, status (Active/Disabled badge), commission rate, total earned, total orders, created date, actions
- Actions per row: Enable/Disable toggle, Edit (notes/rate), Delete (with confirmation), View Earnings

**Earnings detail view:**
- Click "View Earnings" → expandable row or modal
- Table: buyer wallet (truncated), order amount, commission, status (PENDING/PAID), date

### 2.5 Module 4: Members

**Current state:** Page exists with fallback data. API exists at `/admin/users`.

**Connect real data:**
- Fetch from `/admin/users?page=X&search=Y&role=Z`
- Display: userId, wallet, role, KYC status, NFT count, MIC staked, joined date
- Actions:
  - View detail → `/admin/users/:wallet` (all relations)
  - Approve/Reject KYC → PUT `/admin/users/:wallet/kyc`
  - Change role → PUT `/admin/users/:wallet/role`
  - Block/Unblock (future)

### 2.6 Module 5: Stats Overview

**Current state:** Page exists with hardcoded data. API exists at `/admin/stats`.

**Connect real data from:**
- `/admin/stats` — member count, MICE count
- `/admin/sales/stats` — SEED/PreSale/MICE revenue aggregates
- `/admin/revenue` — revenue breakdown by allocation %
- New: distributor stats from `/admin/distributors` aggregate

**Dashboard cards:**
- Total Members (with weekly delta)
- SEED Sales: sold / displayCap, total USDT raised
- Distributor Payouts: total USDT committed
- Active Rounds: which rounds are ACTIVE

### 2.7 Admin Sidebar

```
📊  Dashboard        → /stats
👥  Members          → /members
⚙️  Round Config     → /rounds (NEW page)
🤝  Distributors     → /distributors (NEW page)
🔧  System Settings  → /system
```

Remove: Funds (phase 2), DAO (phase 2), NIRA (phase 2), Components (dev only).

---

## 3. Files Inventory

### New Files

| File | Description |
|------|-------------|
| `packages/db/prisma/schema.prisma` | Add Distributor + DistributorEarning models |
| `apps/api/src/routes/distributor.ts` | New route plugin for distributor CRUD |
| `apps/admin/lib/wagmi.ts` | Wagmi config for admin app |
| `apps/admin/app/(dashboard)/rounds/page.tsx` | Round Config page |
| `apps/admin/app/(dashboard)/distributors/page.tsx` | Distributor management page |

### Modified Files

| File | Changes |
|------|---------|
| `apps/api/src/index.ts` | Register distributor routes |
| `apps/api/src/routes/sales.ts` | SEED purchase → check distributor → create earning |
| `apps/admin/lib/auth.tsx` | Replace simulated auth with real wagmi flow |
| `apps/admin/lib/api.ts` | Add JWT auto-attach, add distributor API functions |
| `apps/admin/app/layout.tsx` | Add WagmiProvider |
| `apps/admin/app/page.tsx` | Real login page with Connect Wallet |
| `apps/admin/components/layout/Sidebar.tsx` | Update nav items |
| `apps/admin/app/(dashboard)/stats/page.tsx` | Connect to real API |
| `apps/admin/app/(dashboard)/members/page.tsx` | Connect to real API |
| `apps/web/app/(dashboard)/seed/page.tsx` | Show "via Distributor" if applicable |
| `apps/web/components/ui/RoundGuard.tsx` | Update status check: UPCOMING/ACTIVE/CLOSED |
| `apps/web/hooks/useRoundConfig.ts` | Update RoundStatus type to UPCOMING/ACTIVE/CLOSED |
| `apps/api/src/routes/admin.ts` | Update round status validation array |

---

## 4. Out of Scope (Phase 2)

- Funds/Treasury management
- DAO Board management
- NIRA AI config
- System Config advanced settings
- On-chain contract deployment
- Smart contract integration (purchases are DB-only for now)
- Distributor on-chain payout (manual for Phase 1, tracked via txHash)
