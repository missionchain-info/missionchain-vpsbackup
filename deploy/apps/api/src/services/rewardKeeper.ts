/**
 * Reward keeper — turns pool balances into individual entitlements, on a schedule.
 *
 * Every reward contract in Mission Chain was deployed complete and then left without a
 * caller. USDT arrives in the weekly and monthly pools on every sale, and sits there:
 * `communityBalance` grows while every holder's `claimable` stays at zero, so a holder who
 * presses Claim gets nothing and has no way to know why. This closes that loop.
 *
 * Two jobs, both idempotent, both safe to run more often than needed:
 *
 *  1. **notify** — `EmissionController.distributeDaily` mints MIC into the two NFT pools
 *     but never announces it, because the notify wiring was only added for the miner pool
 *     and the controller is already deployed. A streaming pool funded without being told
 *     leaves `rewardRate` at zero. So we read the day's `DailyDistributed` event and pass
 *     the amounts on.
 *
 *  2. **credit** — when a week or a month closes, work out who qualified and write their
 *     shares into the USDT pools, which holders then claim at their own pace.
 *
 * ## The eligibility rules are not the same, and the difference is expensive
 *
 *   Weekly  — only Community NFTs **minted inside that week**. Rewards new activity.
 *   Monthly — **every** Community NFT still valid at the cut-off. Rewards loyalty.
 *
 * Feeding the weekly pool every active NFT would quietly pay long-standing holders out of
 * a pool meant for the week's newcomers. `snapshotForWeekly` / `snapshotForMonthly` in the
 * reward engine are the only correct way to build either set; nothing here builds one by
 * hand.
 *
 * ## Time
 *
 * Every boundary is UTC. A month closes at 24:00 UTC on its last day — the Owner's
 * decision, taken specifically so the cut-off does not shift by an hour twice a year the
 * way UK local time does.
 */
import { JsonRpcProvider, Contract, Wallet, formatUnits } from 'ethers'
import type { FastifyInstance } from 'fastify'
import { getActiveAddresses } from '@missionchain/sdk'
import {
  snapshotForWeekly,
  snapshotForMonthly,
  planNftPool,
  type NftRecord,
} from './rewardEngine/nftPools.js'
import { TIER, type CommunityTier } from './rewardEngine/tiers.js'
import { buildSignerProvider } from './blockchain.js'

const ZERO = '0x0000000000000000000000000000000000000000'
const DAY = 86_400

/** Wallets written per transaction. Keeps a large cohort inside one block's gas. */
const CREDIT_BATCH = 100

const NFT_ABI = [
  'function totalSerials() view returns (uint256)',
  'function ownerOf(uint256) view returns (address)',
  'function tierOf(uint256) view returns (uint256)',
  'function createdAt(uint256) view returns (uint256)',
  'function expiresAt(uint256) view returns (uint256)',
] as const

const USDT_POOL_ABI = [
  'function communityBalance() view returns (uint256)',
  'function mfpBalance() view returns (uint256)',
  'function communityBps() view returns (uint256)',
  'function creditCommunity(address[] recipients, uint256[] amounts)',
  'function creditMFP(address[] recipients, uint256[] amounts)',
  'function poolName() view returns (string)',
] as const

const MIC_POOL_ABI = ['function notifyReward(uint256 amount)'] as const

const EMISSION_ABI = [
  'function lastDistribution() view returns (uint256)',
  'event DailyDistributed(uint256 day, uint256 total, uint256 toMiners, uint256 toStaking, uint256 toDAO, uint256 toCommunityNFT, uint256 toMFPReward)',
] as const

export function getKeeperSigner(): { wallet: Wallet; provider: JsonRpcProvider } | null {
  const raw = process.env.KEEPER_PK?.trim()
  if (!raw) return null
  const pk = raw.startsWith('0x') ? raw : '0x' + raw
  const provider = buildSignerProvider()
  return { wallet: new Wallet(pk, provider), provider }
}

// ─────────────────────────────────────────────────────────────────────────────
// Period boundaries — all UTC
// ─────────────────────────────────────────────────────────────────────────────

/** Start of the ISO week (Monday 00:00 UTC) containing `atSec`. */
export function weekStart(atSec: number): number {
  const d = new Date(atSec * 1000)
  const day = d.getUTCDay() === 0 ? 7 : d.getUTCDay()   // Sunday counts as 7
  const monday = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - (day - 1))
  return Math.floor(monday / 1000)
}

/** Start of the month (1st, 00:00 UTC) containing `atSec`. */
export function monthStart(atSec: number): number {
  const d = new Date(atSec * 1000)
  return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000)
}

/** `2026-W33` — the label written alongside a weekly credit, for audit. */
export function weekLabel(startSec: number): string {
  const d = new Date(startSec * 1000)
  const jan1 = Date.UTC(d.getUTCFullYear(), 0, 1)
  const week = Math.floor((startSec * 1000 - jan1) / (7 * DAY * 1000)) + 1
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

export function monthLabel(startSec: number): string {
  const d = new Date(startSec * 1000)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

// ─────────────────────────────────────────────────────────────────────────────
// Reading the collection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Every Community NFT ever minted, with the three facts eligibility depends on.
 *
 * Read one token at a time rather than from an index we keep: mint time and expiry are
 * what decide who is paid, and a cached copy that drifts pays the wrong people without
 * anything looking wrong.
 */
export async function readAllNfts(nft: Contract): Promise<NftRecord[]> {
  const total = Number(await nft.totalSerials())
  const out: NftRecord[] = []
  for (let id = 1; id <= total; id++) {
    try {
      const [owner, tier, mintTime, expiryTime] = await Promise.all([
        nft.ownerOf(id), nft.tierOf(id), nft.createdAt(id), nft.expiresAt(id),
      ])
      out.push({
        tokenId: id,
        owner: String(owner),
        tier: Number(tier) as CommunityTier,
        mintTime: Number(mintTime),
        expiryTime: Number(expiryTime),
      })
    } catch {
      // Burned or never minted — skip rather than abort the whole run.
    }
  }
  return out
}

async function creditInBatches(
  app: FastifyInstance,
  pool: Contract,
  fn: 'creditCommunity' | 'creditMFP',
  rows: Array<{ wallet: string; amount: bigint }>,
): Promise<number> {
  const live = rows.filter((r) => r.amount > 0n)
  if (live.length === 0) return 0

  for (let i = 0; i < live.length; i += CREDIT_BATCH) {
    const slice = live.slice(i, i + CREDIT_BATCH)
    const tx = await (pool as any)[fn](
      slice.map((r) => r.wallet),
      slice.map((r) => r.amount),
    )
    await tx.wait()
    app.log.info({ fn, count: slice.length, tx: tx.hash }, 'rewardKeeper: credited')
  }
  return live.length
}

// ─────────────────────────────────────────────────────────────────────────────
// Jobs
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Pass the day's minted MIC on to the two streaming pools.
 *
 * Safe to run repeatedly: `notifyReward` folds anything already streaming into the new
 * period rather than adding a second stream, so a duplicate call stretches the payout
 * instead of doubling it.
 */
export async function notifyMicPools(app: FastifyInstance, signer: Wallet, A: Record<string, string>) {
  if (!A.EmissionController || A.EmissionController === ZERO) return

  const emission = new Contract(A.EmissionController, EMISSION_ABI, signer)
  const last = Number(await emission.lastDistribution())
  if (last === 0) return

  // Only the most recent distribution matters — earlier ones were notified on their day.
  const provider = signer.provider as JsonRpcProvider
  const head = await provider.getBlockNumber()
  const logs = await emission.queryFilter('DailyDistributed', head - 40_000, head).catch(() => [])
  if (logs.length === 0) return

  const latest: any = logs[logs.length - 1]
  const toCommunity: bigint = latest.args?.toCommunityNFT ?? 0n
  const toMfp: bigint = latest.args?.toMFPReward ?? 0n

  for (const [name, addr, amount] of [
    ['Community', A.CommunityNFTRewardPool, toCommunity],
    ['MFP', A.MFPRewardPool, toMfp],
  ] as const) {
    if (!addr || addr === ZERO || amount === 0n) continue
    try {
      const pool = new Contract(addr, MIC_POOL_ABI, signer)
      const tx = await pool.notifyReward(amount)
      await tx.wait()
      app.log.info({ pool: name, amount: formatUnits(amount, 18) }, 'rewardKeeper: MIC pool notified')
    } catch (e: any) {
      // "reward not funded" simply means this distribution was already notified.
      const msg = e?.shortMessage || e?.message || ''
      if (!/not funded/i.test(msg)) {
        app.log.warn({ pool: name, err: msg }, 'rewardKeeper: notify failed')
      }
    }
  }
}

/**
 * Credit a closed period.
 *
 * @param kind         which programme, and therefore which eligibility rule
 * @param periodStart  inclusive, UTC seconds
 * @param periodEnd    exclusive — the cut-off, UTC seconds
 */
export async function creditPeriod(
  app: FastifyInstance,
  signer: Wallet,
  A: Record<string, string>,
  kind: 'weekly' | 'monthly',
  periodStart: number,
  periodEnd: number,
): Promise<{ label: string; community: number; mfp: number } | null> {
  const poolAddr = kind === 'weekly' ? A.NFTRewardPoolWeekly : A.NFTRewardPoolMonthly
  if (!poolAddr || poolAddr === ZERO) return null
  if (!A.CommunityNFTv2 || A.CommunityNFTv2 === ZERO) return null

  const label = kind === 'weekly' ? weekLabel(periodStart) : monthLabel(periodStart)
  const pool = new Contract(poolAddr, USDT_POOL_ABI, signer)

  const [communityBalance, mfpBalance] = await Promise.all([
    pool.communityBalance(), pool.mfpBalance(),
  ])
  if ((communityBalance as bigint) === 0n && (mfpBalance as bigint) === 0n) {
    app.log.info({ kind, label }, 'rewardKeeper: pool empty, nothing to credit')
    return null
  }

  const nft = new Contract(A.CommunityNFTv2, NFT_ABI, signer)
  const nfts = await readAllNfts(nft)

  // MFP holders come from our own mint records; MFP passes never expire, so a count is
  // all the weighting needs.
  const mfpRows = await app.prisma.mfpMintRecord
    .groupBy({ by: ['wallet'], _count: { wallet: true } })
    .catch(() => [] as Array<{ wallet: string; _count: { wallet: number } }>)
  const mfpByWallet = new Map<string, number>(mfpRows.map((r) => [r.wallet, r._count.wallet]))

  // The two rules, taken from the engine rather than rebuilt here.
  const holders =
    kind === 'weekly'
      ? snapshotForWeekly(nfts, periodStart, periodEnd, mfpByWallet)
      : snapshotForMonthly(nfts, periodEnd, mfpByWallet)

  if (holders.length === 0) {
    app.log.info({ kind, label }, 'rewardKeeper: nobody qualified')
    return null
  }

  const total = (communityBalance as bigint) + (mfpBalance as bigint)
  const communityBps = Number(await pool.communityBps())
  const plan = planNftPool(total, communityBps, holders)

  const community = await creditInBatches(app, pool, 'creditCommunity',
    plan.community.map((a) => ({ wallet: a.wallet, amount: a.amount })))
  const mfp = await creditInBatches(app, pool, 'creditMFP',
    plan.mfp.map((a) => ({ wallet: a.wallet, amount: a.amount })))

  app.log.info(
    { kind, label, community, mfp, total: formatUnits(total, 18) },
    'rewardKeeper: period credited',
  )
  return { label, community, mfp }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tick
// ─────────────────────────────────────────────────────────────────────────────

/** Periods already credited, so a restart does not pay a week twice. */
const credited = new Set<string>()

export async function runRewardKeeperTick(app: FastifyInstance): Promise<void> {
  const signer = getKeeperSigner()
  if (!signer) return

  const A = getActiveAddresses() as Record<string, string>
  const now = Math.floor(Date.now() / 1000)

  try {
    await notifyMicPools(app, signer.wallet, A)
  } catch (e: any) {
    app.log.warn({ err: e?.shortMessage || e?.message }, 'rewardKeeper: notify step failed')
  }

  // Credit the period that has just closed, once it is fully in the past.
  const thisWeek = weekStart(now)
  const lastWeek = thisWeek - 7 * DAY
  const wKey = `w:${weekLabel(lastWeek)}`
  if (!credited.has(wKey)) {
    try {
      const done = await creditPeriod(app, signer.wallet, A, 'weekly', lastWeek, thisWeek)
      if (done) credited.add(wKey)
    } catch (e: any) {
      app.log.error({ err: e?.shortMessage || e?.message }, 'rewardKeeper: weekly credit failed')
    }
  }

  // Community NFTs earned by milestone or rank. Runs before the draw because a member
  // who just qualified should hold the credential before the week they qualified in is
  // settled.
  try {
    const { mintDueCommunityNfts } = await import('./autoMint.js')
    await mintDueCommunityNfts(app, signer.wallet)
  } catch (e: any) {
    app.log.error({ err: e?.shortMessage || e?.message }, 'rewardKeeper: auto-mint step failed')
  }

  // The weekly draw runs on the same clock as the credits, and is deliberately last:
  // a failure here must not hold up money people are already owed.
  try {
    const { runLuckyDrawTick } = await import('./luckyDraw.js')
    await runLuckyDrawTick(app, signer.wallet)
  } catch (e: any) {
    app.log.warn({ err: e?.shortMessage || e?.message }, 'rewardKeeper: lucky draw step failed')
  }

  const thisMonth = monthStart(now)
  const d = new Date(thisMonth * 1000)
  const lastMonth = Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1) / 1000)
  const mKey = `m:${monthLabel(lastMonth)}`
  if (!credited.has(mKey)) {
    try {
      // The cut-off is 24:00 UTC on the last day of the month, which is the same instant
      // as 00:00 UTC on the first of the next — expressed this way so it cannot drift.
      const done = await creditPeriod(app, signer.wallet, A, 'monthly', lastMonth, thisMonth)
      if (done) credited.add(mKey)
    } catch (e: any) {
      app.log.error({ err: e?.shortMessage || e?.message }, 'rewardKeeper: monthly credit failed')
    }
  }
}

/**
 * Start the keeper.
 *
 * An hour is chosen against what it waits for: a week and a month. Crediting an hour after
 * a period closes is invisible to a holder who claims whenever they like, and it keeps the
 * collection scan — one call per NFT — down to twenty-four passes a day.
 */
export function startRewardKeeper(app: FastifyInstance, intervalMs = 3_600_000): () => void {
  let running = false
  const id = setInterval(async () => {
    if (running) return
    running = true
    try {
      await runRewardKeeperTick(app)
    } catch (e: any) {
      app.log.error({ err: e }, 'rewardKeeper tick crashed')
    } finally {
      running = false
    }
  }, intervalMs)
  // Print the address the key actually derives to. A mistyped or wrong key produces a
  // valid wallet with no roles, so every call would revert and the whole reward chain
  // would stall in silence. This is the one line that makes that visible immediately.
  const who = getKeeperSigner()
  app.log.info(
    { intervalMs, keeper: who?.wallet.address ?? 'none' },
    'rewardKeeper started',
  )
  return () => clearInterval(id)
}
