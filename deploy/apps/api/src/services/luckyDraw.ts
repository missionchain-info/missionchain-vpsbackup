/**
 * Weekly Lucky Draw — the last reward programme without a caller.
 *
 * `LuckyDraw` has been live and funded since the Pre-Sale deploy and no draw has ever run.
 * Everything it needs is on chain; what was missing is the two-step dance that makes the
 * result trustworthy.
 *
 * ## Commit–reveal, and why the gap between the steps matters
 *
 * The operator picks the seed, so without a commitment they could keep re-rolling until a
 * wallet they like wins. `drawCommitment` binds the seed **and the participant list in
 * order** — the shuffle depends on order, so sealing the seed alone would still leave room
 * to reorder entrants afterwards.
 *
 * That protection only exists if the commitment is published *before* the reveal, with
 * long enough in between for anyone to see it. Committing and revealing in one tick is
 * theatre: nobody could have checked. So the seed is sealed on one run and revealed on a
 * later one, at least `MIN_REVEAL_GAP` afterwards and well inside the contract's 3-day
 * window.
 *
 * ## The seed has to survive a restart
 *
 * Between the two steps the seed exists nowhere but here. Lose it — a redeploy, a crash —
 * and the commitment can never be opened: the draw stalls until `cancelExpiredCommit`
 * three days later and that week's prize rolls over. So it is written to `SystemConfig`
 * before the commit transaction is sent, never after.
 *
 * Storing it there means anyone with database access can see the seed early. That is not
 * a weakening: the operator chose the seed and has always known it. What the commitment
 * protects against is changing it, and a stored copy cannot change what is already sealed
 * on chain.
 *
 * ## Who is entered
 *
 * Community NFTs **active at any point during the week** — not only those minted in it,
 * which is the weekly *reward* rule and a different thing. MFP passes are not eligible.
 * Entry is by serial, so a wallet holding three NFTs appears three times and has three
 * times the chance; tier does not change the odds.
 */
import { Contract, Wallet, formatUnits, keccak256, AbiCoder, solidityPackedKeccak256 } from 'ethers'
import type { FastifyInstance } from 'fastify'
import { getActiveAddresses } from '@missionchain/sdk'
import { readAllNfts, weekStart, weekLabel } from './rewardKeeper.js'

const ZERO = '0x0000000000000000000000000000000000000000'
const DAY = 86_400

/** Entrants the contract demands before it will run a draw. */
const PRIZE_COUNT = 18

/** Least time between sealing a draw and opening it, so the commitment is observable. */
const MIN_REVEAL_GAP = 3600

/**
 * Smallest pot worth drawing, in USDT. Below this the week rolls over.
 *
 * The contract has no such floor — `WEEKLY_CAP` is a ceiling — so without one the keeper
 * would happily split whatever had arrived across 18 prizes. At the $1.25 the pool held on
 * 2026-08-21 that is a first prize of 37 cents and a consolation of three, which costs more
 * in gas than it pays and makes the draw look like a joke rather than a prize.
 *
 * Rolling over loses nothing: the USDT stays in the contract and joins next week's pot.
 *
 * Adjustable at runtime through SystemConfig `lucky_draw_min_usdt` — the Owner can lower
 * it for a test week or raise it later without a deploy.
 */
const DEFAULT_MIN_POOL_USDT = 500

async function minPoolUsdt(app: FastifyInstance): Promise<number> {
  try {
    const row = await (app as any).prisma.systemConfig.findUnique({
      where: { key: 'lucky_draw_min_usdt' },
    })
    const v = Number(row?.value)
    return Number.isFinite(v) && v >= 0 ? v : DEFAULT_MIN_POOL_USDT
  } catch {
    return DEFAULT_MIN_POOL_USDT
  }
}

/** Where the pending seed lives between the two steps. */
const STATE_KEY = 'luckydraw_pending'

const DRAW_ABI = [
  'function commitment() view returns (bytes32)',
  'function revealDeadline() view returns (uint256)',
  'function currentBalance() view returns (uint256)',
  'function drawCount() view returns (uint256)',
  'function drawCommitment(address[] participants, uint256 seed) view returns (bytes32)',
  'function commitDraw(bytes32 commitmentHash)',
  'function startDraw(address[] participants, uint256 randomSeed)',
  'function cancelExpiredCommit()',
] as const

const NFT_ABI = [
  'function totalSerials() view returns (uint256)',
  'function ownerOf(uint256) view returns (address)',
  'function tierOf(uint256) view returns (uint256)',
  'function createdAt(uint256) view returns (uint256)',
  'function expiresAt(uint256) view returns (uint256)',
] as const

type Pending = {
  label: string
  seed: string           // decimal string — a uint256 does not survive JSON as a number
  participants: string[]
  committedAt: number
}

/**
 * Everyone entered for a given week.
 *
 * An NFT counts if its life overlapped the week at all — minted before the week ended and
 * still unexpired when it began. Requiring it to sit entirely inside the week would
 * exclude every long-standing holder, which is the weekly *reward* rule, not this one.
 */
export function participantsForWeek(
  nfts: Array<{ owner: string; mintTime: number; expiryTime: number }>,
  weekStartSec: number,
  weekEndSec: number,
): string[] {
  return nfts
    .filter((n) => n.mintTime < weekEndSec && n.expiryTime > weekStartSec)
    .map((n) => n.owner)
}

async function loadPending(app: FastifyInstance): Promise<Pending | null> {
  const row = await app.prisma.systemConfig.findUnique({ where: { key: STATE_KEY } }).catch(() => null)
  if (!row?.value) return null
  try {
    return typeof row.value === 'string' ? JSON.parse(row.value) : (row.value as any)
  } catch {
    return null
  }
}

async function savePending(app: FastifyInstance, p: Pending | null) {
  if (p === null) {
    await app.prisma.systemConfig.deleteMany({ where: { key: STATE_KEY } }).catch(() => {})
    return
  }
  const value = JSON.stringify(p)
  await app.prisma.systemConfig.upsert({
    where: { key: STATE_KEY },
    create: { key: STATE_KEY, value },
    update: { value },
  })
}

/**
 * A seed nobody can anticipate.
 *
 * `Math.random` is not suitable here — it is seeded from process state and predictable
 * enough that someone who knew when the keeper started could narrow it down. This is the
 * one number the fairness of the draw rests on.
 */
function freshSeed(): bigint {
  const { randomBytes } = require('node:crypto') as typeof import('node:crypto')
  return BigInt('0x' + randomBytes(32).toString('hex'))
}

export async function runLuckyDrawTick(app: FastifyInstance, signer: Wallet): Promise<void> {
  const A = getActiveAddresses() as Record<string, string>
  if (!A.LuckyDraw || A.LuckyDraw === ZERO) return
  if (!A.CommunityNFTv2 || A.CommunityNFTv2 === ZERO) return

  const draw = new Contract(A.LuckyDraw, DRAW_ABI, signer)
  const now = Math.floor(Date.now() / 1000)

  const [commitment, revealDeadline] = await Promise.all([
    draw.commitment(), draw.revealDeadline(),
  ])
  const sealed = commitment !== '0x' + '0'.repeat(64)

  // ── an expired commitment blocks every future draw until it is cleared ──
  if (sealed && now > Number(revealDeadline)) {
    try {
      const tx = await draw.cancelExpiredCommit()
      await tx.wait()
      await savePending(app, null)
      app.log.warn({ tx: tx.hash }, 'luckyDraw: expired commitment cancelled, prize rolls over')
    } catch (e: any) {
      app.log.warn({ err: e?.shortMessage || e?.message }, 'luckyDraw: cancel failed')
    }
    return
  }

  // ── step 2: open a commitment that has been public long enough ──
  if (sealed) {
    const pending = await loadPending(app)
    if (!pending) {
      // Sealed on chain with no seed here. Nothing can open it; say so loudly rather than
      // retrying in silence for three days.
      app.log.error(
        { revealDeadline: Number(revealDeadline) },
        'luckyDraw: a commitment is open but its seed is missing — the draw will expire and roll over',
      )
      return
    }
    if (now - pending.committedAt < MIN_REVEAL_GAP) return

    try {
      const tx = await draw.startDraw(pending.participants, BigInt(pending.seed))
      await tx.wait()
      await savePending(app, null)
      app.log.info(
        { label: pending.label, entrants: pending.participants.length, tx: tx.hash },
        'luckyDraw: drawn — 18 winners credited',
      )
    } catch (e: any) {
      app.log.error({ err: e?.shortMessage || e?.message }, 'luckyDraw: reveal failed')
    }
    return
  }

  // ── step 1: seal a draw for the week that has closed ──
  const balance: bigint = await draw.currentBalance()
  if (balance === 0n) return

  // Too small to be worth drawing — roll it into next week rather than split it 18 ways.
  const min = await minPoolUsdt(app)
  const poolUsdt = Number(formatUnits(balance, 18))
  if (poolUsdt < min) {
    app.log.info(
      { pool: poolUsdt.toFixed(2), min },
      'luckyDraw: pot below the minimum, carrying over to next week',
    )
    return
  }

  const thisWeek = weekStart(now)
  const lastWeek = thisWeek - 7 * DAY
  const label = weekLabel(lastWeek)

  const nft = new Contract(A.CommunityNFTv2, NFT_ABI, signer)
  const nfts = await readAllNfts(nft)
  const participants = participantsForWeek(nfts, lastWeek, thisWeek)

  if (participants.length < PRIZE_COUNT) {
    app.log.info(
      { label, entrants: participants.length, needed: PRIZE_COUNT },
      'luckyDraw: not enough entrants, prize carries over',
    )
    return
  }

  const seed = freshSeed()
  const hash = await draw.drawCommitment(participants, seed)

  // Persist BEFORE sending. If the transaction lands and this row does not exist, the
  // seed is gone and the week is lost; a stored seed for a commit that never landed is
  // harmless by comparison — the next tick simply overwrites it.
  await savePending(app, {
    label, seed: seed.toString(), participants, committedAt: now,
  })

  try {
    const tx = await draw.commitDraw(hash)
    await tx.wait()
    app.log.info(
      { label, entrants: participants.length, pool: formatUnits(balance, 18), tx: tx.hash },
      'luckyDraw: sealed — opens on a later run',
    )
  } catch (e: any) {
    await savePending(app, null)
    app.log.error({ err: e?.shortMessage || e?.message }, 'luckyDraw: commit failed')
  }
}
