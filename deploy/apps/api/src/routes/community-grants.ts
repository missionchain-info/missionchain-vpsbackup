/**
 * Community NFT discretionary grants — "Path 2".
 *
 * Two separate routes exist for getting a Community NFT, and they must not be confused:
 *
 *   Path 1 — hit a KPI, the contract mints automatically. Referral milestones (3/5/10
 *            qualifying F1) and Community Growth Award rank bonuses both live here. The
 *            NFT lands in the wallet the moment the condition is met and its expiry clock
 *            starts then. There is no Claim button on this path and this file does not
 *            touch it.
 *
 *   Path 2 — the Owner awards an NFT outside the automated programmes, for a case the
 *            KPIs do not cover. The recipient is notified and mints it to their own
 *            wallet themselves. That is what this file implements.
 *
 * ─── Why the allowance is stored here and not on chain ───────────────────────────────
 *
 * `CommunityNFTv2` has no allowance layer — no `mintAllowance`, no `remainingAllowance`,
 * no grant bookkeeping of any kind. Its `mint(to, tier)` checks `MINTER_ROLE` and mints
 * immediately. So "the Owner authorises now, the recipient mints later" has nowhere to
 * live on chain, and the pending grant is held in the database instead.
 *
 * The consequence is worth stating plainly: this ledger is the only record that a grant
 * was promised. It is authoritative for *permission*, while the chain stays authoritative
 * for *what was actually minted*.
 *
 * ─── What the weekly limits do and do not guarantee ──────────────────────────────────
 *
 * The caps (1 per wallet per week; 10 Builder / 5 Maker / 2 Luminary system-wide per week)
 * exist only in this file. They are not on chain and cannot be. `CommunityNFTv2.mint`
 * checks `MINTER_ROLE` and nothing else; `ClaimRewardsV2.mintRankBonus` checks
 * `CREDITOR_ROLE` and a 20-per-call batch ceiling. Neither counts grants per week, per
 * wallet, or per tier.
 *
 * Anyone holding one of those role keys can therefore mint straight from BscScan and this
 * ledger will never see it. These caps stop an operator making a mistake in a form; they
 * do not stop a key holder who means to exceed them. Enforcing them for real needs a new
 * contract — the Owner's call, not this route's.
 *
 * Enforcement lives in the API rather than the admin form because a form check is bypassed
 * by one `curl`. The form calls `/precheck` only to give a friendly message early.
 */
import { FastifyPluginAsync } from 'fastify'
import { requireAdmin, requireLevel, auditLog, auditCtx } from '../plugins/rbac.js'

/** SystemConfig row holding the whole ledger. A few rows a week is honest sizing for a
 *  JSON blob; a dedicated table would mean a migration against live production data for
 *  no benefit today. */
const CONFIG_KEY = 'community_nft_grants'

/** CommunityNFTv2 tiers — BUILDER=1, MAKER=2, LUMINARY=3, as the contract defines them.
 *  All three are grantable; confirmed by the Owner on 2026-08-11. */
export const TIERS = [
  { tier: 1, name: 'Builder', weeklyLimit: 10 },
  { tier: 2, name: 'Maker', weeklyLimit: 5 },
  { tier: 3, name: 'Luminary', weeklyLimit: 2 },
] as const

/** One NFT per recipient wallet per week, whatever the tier. */
const PER_WALLET_WEEKLY_LIMIT = 1

export type GrantStatus = 'PENDING' | 'MINTED'

export interface GrantRecord {
  id: string
  wallet: string
  tier: number
  quantity: number
  note: string
  status: GrantStatus
  txHash: string | null
  grantedBy: string
  grantedAt: string
  mintedAt: string | null
  /** ISO Monday of the week the grant was *issued* — quota is consumed at issue time, so
   *  a recipient sitting on an unminted grant cannot free up someone else's slot. */
  weekKey: string
  overLimit: boolean
}

/** Monday 00:00 UTC of the week containing `d` — same convention as the reward keeper. */
export function weekKeyOf(d: Date): string {
  const day = d.getUTCDay() === 0 ? 7 : d.getUTCDay()
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - (day - 1)),
  ).toISOString().slice(0, 10)
}

const tierMeta = (tier: number) => TIERS.find((t) => t.tier === tier)

/**
 * Single source of truth for "may this grant be issued". `/precheck` and the issuing
 * route both call it, so the two can never disagree about the rules.
 */
export function evaluateGrant(
  history: GrantRecord[],
  wallet: string,
  tier: number,
  quantity: number,
  now: Date,
): { allowed: boolean; reason?: string } {
  const meta = tierMeta(tier)
  if (!meta) return { allowed: false, reason: `Unknown tier ${tier}` }
  if (!Number.isInteger(quantity) || quantity < 1) {
    return { allowed: false, reason: 'Quantity must be a whole number of at least 1' }
  }

  const wk = weekKeyOf(now)
  const thisWeek = history.filter((g) => g.weekKey === wk)
  const target = wallet.toLowerCase()

  const walletUsed = thisWeek
    .filter((g) => g.wallet === target)
    .reduce((n, g) => n + g.quantity, 0)
  if (walletUsed + quantity > PER_WALLET_WEEKLY_LIMIT) {
    // Two distinct failures share this rule and reading the wrong one wastes an
    // operator's time: the wallet is already at its cap, versus this single request
    // being larger than the cap allows in any week.
    return {
      allowed: false,
      reason: walletUsed > 0
        ? `This wallet already has ${walletUsed} NFT(s) granted this week. The operational limit is ${PER_WALLET_WEEKLY_LIMIT} per wallet per week.`
        : `Quantity ${quantity} exceeds the operational limit of ${PER_WALLET_WEEKLY_LIMIT} NFT per wallet per week.`,
    }
  }

  const tierUsed = thisWeek
    .filter((g) => g.tier === tier)
    .reduce((n, g) => n + g.quantity, 0)
  if (tierUsed + quantity > meta.weeklyLimit) {
    return {
      allowed: false,
      reason: `${meta.name}: ${tierUsed} of ${meta.weeklyLimit} granted this week. This request of ${quantity} would exceed the weekly operational limit.`,
    }
  }

  return { allowed: true }
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared ledger helpers
// ─────────────────────────────────────────────────────────────────────────────

async function readHistory(app: any): Promise<GrantRecord[]> {
  const row = await app.prisma.systemConfig.findUnique({ where: { key: CONFIG_KEY } })
  if (!row?.value) return []
  try {
    const parsed = JSON.parse(row.value)
    return Array.isArray(parsed) ? (parsed as GrantRecord[]) : []
  } catch {
    // Treating a corrupt blob as "no grants" would silently reopen the entire week's
    // quota, so this fails loudly instead.
    app.log.error({ key: CONFIG_KEY }, 'community grant ledger is not valid JSON')
    throw new Error('LEDGER_CORRUPT')
  }
}

async function writeHistory(app: any, rows: GrantRecord[], by: string) {
  await app.prisma.systemConfig.upsert({
    where: { key: CONFIG_KEY },
    create: { key: CONFIG_KEY, value: JSON.stringify(rows), updatedBy: by },
    update: { value: JSON.stringify(rows), updatedBy: by },
  })
}

function usageOf(history: GrantRecord[], now: Date) {
  const wk = weekKeyOf(now)
  const thisWeek = history.filter((g) => g.weekKey === wk)
  return {
    weekKey: wk,
    perWalletLimit: PER_WALLET_WEEKLY_LIMIT,
    tiers: TIERS.map((t) => ({
      tier: t.tier,
      name: t.name,
      weeklyLimit: t.weeklyLimit,
      used: thisWeek.filter((g) => g.tier === t.tier).reduce((n, g) => n + g.quantity, 0),
    })),
  }
}

const COMMUNITY_NFT_ABI = [
  'function mint(address to, uint256 tier) returns (uint256)',
  'function hasRole(bytes32,address) view returns (bool)',
]

/**
 * Can the server actually mint on a recipient's behalf right now?
 *
 * The recipient does not hold `MINTER_ROLE` and never will, so their "Mint" press has to
 * be executed by the keeper wallet. That wallet holds no minting role at the time of
 * writing, so this reports *why* rather than letting the UI offer a button that would
 * fail. The check is live so the feature switches itself on the moment the Owner grants
 * the role — no redeploy needed.
 */
async function mintCapability(app: any): Promise<{ enabled: boolean; reason: string | null; keeper: string | null }> {
  try {
    const { getKeeperSigner } = await import('../services/rewardKeeper.js')
    const signer = getKeeperSigner()
    if (!signer) {
      return { enabled: false, reason: 'Server minting wallet is not configured.', keeper: null }
    }
    const { getActiveAddresses } = await import('@missionchain/sdk')
    const A = getActiveAddresses() as Record<string, string>
    const nftAddr = A.CommunityNFTv2 || A.CommunityNFT
    if (!nftAddr || /^0x0+$/.test(nftAddr)) {
      return { enabled: false, reason: 'CommunityNFT contract is not configured.', keeper: null }
    }
    const { Contract, id } = await import('ethers')
    const nft = new Contract(nftAddr, COMMUNITY_NFT_ABI, signer.wallet)
    const keeper = await signer.wallet.getAddress()
    const ok = await nft.hasRole(id('MINTER_ROLE'), keeper)
    return ok
      ? { enabled: true, reason: null, keeper }
      : {
          enabled: false,
          reason: 'Self-mint is awaiting approval: the server minting wallet has not been granted MINTER_ROLE on CommunityNFTv2.',
          keeper,
        }
  } catch (err: any) {
    return { enabled: false, reason: `Mint capability check failed: ${err?.message ?? 'unknown error'}`, keeper: null }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin — issue and review grants
// ─────────────────────────────────────────────────────────────────────────────

export const communityGrantsAdminRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAdmin)

  // ─── GET /admin/community-grants ─────────────────────────────────────────
  app.get('/', async () => {
    const history = await readHistory(app)
    const cap = await mintCapability(app)
    return {
      data: {
        limits: {
          perWalletPerWeek: PER_WALLET_WEEKLY_LIMIT,
          perTierPerWeek: TIERS.map((t) => ({ tier: t.tier, name: t.name, limit: t.weeklyLimit })),
          /** The UI renders its caveat from this, so the wording cannot drift from reality. */
          enforcement: 'BACKEND_ONLY',
        },
        usage: usageOf(history, new Date()),
        selfMint: cap,
        history: [...history].reverse().slice(0, 100),
      },
    }
  })

  // ─── POST /admin/community-grants/precheck ───────────────────────────────
  // Read-only: lets the form warn before the Owner commits to anything.
  app.post('/precheck', { preHandler: [requireLevel('GOVERNOR')] }, async (req, reply) => {
    const { wallet, tier, quantity } = (req.body ?? {}) as { wallet?: string; tier?: number; quantity?: number }
    if (!wallet || !/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
      return reply.status(400).send({ error: 'BAD_WALLET', message: 'Enter a valid wallet address' })
    }
    const history = await readHistory(app)
    const now = new Date()
    return { data: { ...evaluateGrant(history, wallet, Number(tier), Number(quantity), now), usage: usageOf(history, now) } }
  })

  // ─── POST /admin/community-grants — issue an allowance ───────────────────
  // Nothing is minted here. This records the Owner's authorisation; the recipient mints.
  // Unlike the recording of an already-mined transaction, this CAN be refused outright —
  // nothing irreversible has happened yet, so an over-limit request is simply rejected.
  app.post('/', { preHandler: [requireLevel('GOVERNOR')] }, async (req, reply) => {
    const { wallet, tier, quantity, note } = (req.body ?? {}) as {
      wallet?: string; tier?: number; quantity?: number; note?: string
    }

    if (!wallet || !/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
      return reply.status(400).send({ error: 'BAD_WALLET', message: 'Enter a valid wallet address' })
    }
    const t = Number(tier)
    const q = Number(quantity)
    const meta = tierMeta(t)
    if (!meta) return reply.status(400).send({ error: 'BAD_TIER', message: `Unknown tier ${tier}` })

    const history = await readHistory(app)
    const now = new Date()

    // Authoritative check. `/precheck` is advice; this is the decision.
    const verdict = evaluateGrant(history, wallet, t, q, now)
    if (!verdict.allowed) {
      return reply.status(409).send({ error: 'LIMIT_EXCEEDED', message: verdict.reason })
    }

    const grantedBy = ((req.user as any)?.wallet ?? '').toLowerCase()
    const record: GrantRecord = {
      id: `${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
      wallet: wallet.toLowerCase(),
      tier: t,
      quantity: q,
      note: (note ?? '').slice(0, 500),
      status: 'PENDING',
      txHash: null,
      grantedBy,
      grantedAt: now.toISOString(),
      mintedAt: null,
      weekKey: weekKeyOf(now),
      overLimit: false,
    }

    const next = [...history, record]
    await writeHistory(app, next, grantedBy)

    auditLog(app, auditCtx(req, 'COMMUNITY_NFT_GRANT_ISSUED', wallet.toLowerCase(), {
      tier: t, tierName: meta.name, quantity: q, note: record.note,
    }))

    return { data: { record, usage: usageOf(next, now) } }
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Member — see and mint what was granted to you
// ─────────────────────────────────────────────────────────────────────────────

export const communityGrantsUserRoutes: FastifyPluginAsync = async (app) => {
  // ─── GET /nft/community-grants — my pending grants ───────────────────────
  app.get('/community-grants', { preHandler: [(app as any).authenticate] }, async (req) => {
    const wallet = ((req.user as any).wallet as string).toLowerCase()
    const history = await readHistory(app)
    const mine = history.filter((g) => g.wallet === wallet)
    const cap = await mintCapability(app)
    return {
      data: {
        grants: [...mine].reverse().map((g) => ({
          id: g.id,
          tier: g.tier,
          tierName: tierMeta(g.tier)?.name ?? `Tier ${g.tier}`,
          quantity: g.quantity,
          note: g.note,
          status: g.status,
          txHash: g.txHash,
          grantedAt: g.grantedAt,
          mintedAt: g.mintedAt,
        })),
        // The UI disables its button off this rather than inventing its own rule.
        canMint: cap.enabled,
        mintDisabledReason: cap.reason,
      },
    }
  })

  // ─── POST /nft/community-grants/:id/mint — mint my grant ─────────────────
  //
  // The recipient holds no `MINTER_ROLE`, so they cannot call the contract themselves.
  // They press the button, this verifies the grant belongs to them and is unspent, and
  // the keeper wallet mints to their address — so the recipient pays no gas.
  app.post('/community-grants/:id/mint', { preHandler: [(app as any).authenticate] }, async (req, reply) => {
    const wallet = ((req.user as any).wallet as string).toLowerCase()
    const { id } = req.params as { id: string }

    const cap = await mintCapability(app)
    if (!cap.enabled) {
      return reply.status(503).send({ error: 'MINT_NOT_ENABLED', message: cap.reason })
    }

    const history = await readHistory(app)
    const grant = history.find((g) => g.id === id)
    if (!grant || grant.wallet !== wallet) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'Grant not found' })
    }
    if (grant.status === 'MINTED') {
      return reply.status(409).send({ error: 'ALREADY_MINTED', message: 'This grant has already been minted.' })
    }

    // Claimed before the transaction is sent, not after. If the mint succeeds and the
    // process dies before we can write the result, a second press would otherwise mint a
    // duplicate that no one can take back. Losing the txHash of a real mint is a
    // recoverable bookkeeping error; minting twice is not.
    const marking = history.map((g) =>
      g.id === id ? { ...g, status: 'MINTED' as GrantStatus, mintedAt: new Date().toISOString() } : g,
    )
    await writeHistory(app, marking, wallet)

    try {
      const { getKeeperSigner } = await import('../services/rewardKeeper.js')
      const { getActiveAddresses } = await import('@missionchain/sdk')
      const { Contract } = await import('ethers')
      const signer = getKeeperSigner()!
      const A = getActiveAddresses() as Record<string, string>
      const nft = new Contract(A.CommunityNFTv2 || A.CommunityNFT, COMMUNITY_NFT_ABI, signer.wallet)

      // CommunityNFTv2.mint issues exactly one token per call, so a quantity of N is N
      // transactions. Only the last hash is stored; all of them are on chain regardless.
      let lastHash = ''
      for (let i = 0; i < grant.quantity; i++) {
        const tx = await nft.mint(grant.wallet, grant.tier)
        await tx.wait()
        lastHash = tx.hash
      }

      const done = marking.map((g) => (g.id === id ? { ...g, txHash: lastHash } : g))
      await writeHistory(app, done, wallet)

      return { data: { ok: true, txHash: lastHash, quantity: grant.quantity } }
    } catch (err: any) {
      // The mint did not go through, so hand the grant back rather than burning it.
      const reverted = history.map((g) =>
        g.id === id ? { ...g, status: 'PENDING' as GrantStatus, mintedAt: null } : g,
      )
      await writeHistory(app, reverted, wallet)
      app.log.error({ err, id }, 'community grant mint failed')
      return reply.status(502).send({
        error: 'MINT_FAILED',
        message: err?.shortMessage || err?.message || 'Mint failed — your grant is unchanged.',
      })
    }
  })
}
