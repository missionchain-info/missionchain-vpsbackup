/**
 * Mining keeper — the heartbeat of MICE · MINING · SWAP.
 *
 * A blockchain has no clock. `distributeDaily()` mints nothing until somebody sends a
 * transaction asking it to, and a skipped day is not deferred, it is destroyed: the
 * contract computes exactly one day's emission and then sets `lastDistribution` to now.
 * The same is true of expiring licences, of the pool's phase gate, and of the TWAP that
 * MICELicense prices its burn against. Without this service the whole layer is inert
 * while looking perfectly healthy on-chain.
 *
 * Order within a tick matters:
 *
 *   1. drain the expiry queue    — the pool holds its accumulator at the oldest expiry it
 *                                  has not processed, so live miners stall until it runs
 *   2. recycle expired licences  — frees the seat for the next buyer
 *   3. distributeDaily           — mints and announces the day's rewards
 *   4. poke                      — rolls the pool's price snapshots forward
 *   5. advancePhase              — opens the sell side once the pool holds enough real
 *                                  USDT (LiquidityPoolV7 gates on reserves, not on a day
 *                                  count), then Listed at $10M
 *
 * Every step is independent: one failing must not stop the others, because the cheapest
 * of them (a poke) failing should never be able to hold up the mint.
 *
 * The keeper wallet holds ORACLE-grade authority over none of this — every function it
 * calls is either permissionless or guarded by a condition the contract checks itself.
 * It only needs BNB for gas.
 */
import { JsonRpcProvider, Contract, Wallet } from 'ethers'
import type { FastifyInstance } from 'fastify'
import { getActiveAddresses } from '@missionchain/sdk'
import { buildSignerProvider } from './blockchain.js'

const BSC_MAINNET_RPC = 'https://bsc-dataseed.binance.org/'
const ZERO = '0x0000000000000000000000000000000000000000'

const EMISSION_ABI = [
  'function distributeDaily()',
  'function lastDistribution() view returns (uint256)',
] as const

const MINING_ABI = [
  'function sync()',
  'function pendingExpiries() view returns (uint256)',
] as const

const POOL_ABI = [
  'function isSeeded() view returns (bool)',
  'function poke()',
  'function advancePhase()',
  'function phase() view returns (uint8)',
  'function poolAgeDays() view returns (uint256)',
] as const

const MICE_ABI = [
  'function totalMinted() view returns (uint256)',
  'function recycledCount() view returns (uint256)',
  'function licenses(uint256) view returns (address owner,uint256 mintTime,uint256 activatedAt,uint256 expiryTime,uint256 pricePaid)',
  'function recycleBatch(uint256[] licenseIds)',
] as const

/** Licences swept per transaction. Keeps gas well inside a block. */
const RECYCLE_BATCH = 50

function getRpcUrl(): string {
  // INDEXER_RPC_URL first. The public endpoint broadcasts fine but is unreliable on the
  // read side, so `tx.wait()` throws for transactions that were mined perfectly well —
  // and a failed receipt lookup then gets logged as a failed write. That is the same
  // confusion that once put this platform's database out of step with the chain.
  return process.env.INDEXER_RPC_URL || process.env.BSC_RPC_URL || BSC_MAINNET_RPC
}

/**
 * The keeper's signer.
 *
 * `KEEPER_PK` is deliberately separate from `DEPLOYER_PK`. The deployer wallet holds
 * admin authority over the whole system; a service that sends a transaction every minute
 * is the last thing that should carry that key. If `KEEPER_PK` is unset the keeper does
 * not start — it will not quietly fall back to the deployer.
 */
export function getKeeperSigner(): { wallet: Wallet; provider: JsonRpcProvider } | null {
  const raw = process.env.KEEPER_PK?.trim()
  if (!raw) return null
  const pk = raw.startsWith('0x') ? raw : '0x' + raw
  const provider = buildSignerProvider()
  return { wallet: new Wallet(pk, provider), provider }
}

type Addrs = { emission: string; pool: string; mice: string; mining: string }

function resolveAddresses(): Addrs | null {
  const A = getActiveAddresses() as Record<string, string>
  const emission = A.EmissionController
  // LiquidityPoolV7 (0x70E28Ab…41aF), not V6. Two reasons this address matters here.
  //
  // `poke()` keeps the price accumulator moving on quiet days, and MICELicense prices its
  // MIC burn off this pool's min(spot, twap7d) — a stale average on the pool the licence
  // reads is not a cosmetic problem.
  //
  // `advancePhase()` is the other. V6 opens its own sell side 30 days after it was seeded,
  // and this keeper is what would call it: on 2026-09-11 it would have opened V6 for
  // selling with $10 of real USDT behind 50M MIC. V7 gates that call on real reserves
  // instead, so the same scheduled call now means what it says.
  const pool = (A as any).LiquidityPoolV7
  const mice = A.MICELicense
  // Before the MICE deploy these are all the zero address. Returning null keeps the
  // keeper silent rather than logging a failure every minute for something not yet built.
  if (!emission || emission === ZERO) return null
  if (!mice || mice === ZERO) return null
  const mining = A.MiningPool
  return {
    emission,
    pool: pool && pool !== ZERO ? pool : '',
    mice,
    mining: mining && mining !== ZERO ? mining : '',
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Steps
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sweep licences whose 360-day term has ended.
 *
 * Runs first so that today's emission is divided among licences that are genuinely
 * mining. `recycleLicense` is permissionless by design — anyone may call it, and buyers
 * have their own reason to once the 100,000 seats are gone — but nobody can be relied on
 * to, so the keeper does it.
 */
export async function recycleExpired(app: FastifyInstance, mice: Contract): Promise<number> {
  const now = Math.floor(Date.now() / 1000)
  const total = Number(await mice.totalMinted())
  if (total === 0) return 0

  const expired: bigint[] = []
  for (let id = 0; id < total; id++) {
    const lic = await mice.licenses(id)
    if (lic.owner === ZERO) continue          // already recycled
    if (lic.activatedAt === 0n) continue      // bought, never activated — never expires
    if (Number(lic.expiryTime) > now) continue
    expired.push(BigInt(id))
    if (expired.length >= RECYCLE_BATCH) break
  }

  if (expired.length === 0) return 0

  const tx = await mice.recycleBatch(expired)
  await tx.wait()
  app.log.info({ count: expired.length, tx: tx.hash }, 'miningKeeper: recycled expired licences')
  return expired.length
}

/**
 * Drain the pool's expiry queue.
 *
 * A licence stops earning at its own expiry second whether or not this runs — the
 * contract will not accrue past an unprocessed expiry. But it *pauses* there, so live
 * miners stop earning until the queue is drained. Draining it is therefore not about
 * correctness, it is about not stalling everyone else.
 *
 * `sync` retires up to 100 licences per call, so a backlog is worked through across
 * several ticks rather than in one transaction that might not fit in a block.
 */
export async function drainExpiries(app: FastifyInstance, mining: Contract): Promise<number> {
  const due = Number(await mining.pendingExpiries())
  if (due === 0) return 0

  const tx = await mining.sync()
  await tx.wait()
  app.log.info({ due, tx: tx.hash }, 'miningKeeper: retired expired licences')
  return due
}

/**
 * Mint and announce the day's emission, if a day has passed.
 *
 * The contract enforces the 24-hour spacing itself, so this check only avoids paying gas
 * for a guaranteed revert.
 */
export async function distributeIfDue(
  app: FastifyInstance,
  emission: Contract,
  pool?: Contract,
): Promise<boolean> {
  // Nothing may be emitted before the SWAP pool holds MIC.
  //
  // Emission is priced against the pool: `brakeEngaged()` compares the 7-day average to
  // half the opening price, and an unseeded pool reports zero — so the brake trips and
  // halves issuance over a fall that never happened. Worse, a day emitted early is not
  // recoverable: the contract mints one day's worth and moves its clock forward, so the
  // reduced amount is what that day is worth for good.
  //
  // The deploy runbook says "do not start the keeper before seeding". This is that
  // instruction written where it cannot be forgotten.
  if (pool) {
    try {
      const seeded = await (pool as any).isSeeded()
      if (!seeded) {
        app.log.info('miningKeeper: pool not seeded — holding emission')
        return false
      }
    } catch {
      // A pool that cannot answer is not a pool we should emit against.
      app.log.warn('miningKeeper: could not read pool seeding state — holding emission')
      return false
    }
  }

  const last = Number(await emission.lastDistribution())
  const now = Math.floor(Date.now() / 1000)
  if (now < last + 86_400) return false

  const tx = await emission.distributeDaily()
  const receipt = await tx.wait()
  app.log.info(
    { tx: tx.hash, block: receipt?.blockNumber },
    'miningKeeper: daily emission distributed',
  )
  return true
}

/**
 * Roll the pool's price snapshots forward and open the next phase when it is due.
 *
 * `advancePhase` reverts whenever its condition is not met, which is most of the time —
 * that revert is the normal case, not an error, so it is caught and dropped.
 */
export async function pokePool(app: FastifyInstance, pool: Contract): Promise<void> {
  // A dormant pool has no price to average, so `_accrue` returns immediately and the
  // transaction writes nothing at all. Sending it anyway spends gas every ten minutes to
  // achieve exactly nothing, and any hiccup reading the receipt shows up as a failure.
  let seeded = false
  try {
    seeded = await (pool as any).isSeeded()
  } catch { /* fall through — treated as dormant */ }

  if (!seeded) return

  try {
    const tx = await pool.poke()
    await tx.wait()
  } catch (e: any) {
    app.log.warn({ err: e?.shortMessage || e?.message }, 'miningKeeper: poke failed')
  }

  try {
    // Also skipped while dormant: `poolAgeDays` is zero until the seed, so the condition
    // cannot be met and this only ever reverts.
    const before = Number(await pool.phase())
    const tx = await pool.advancePhase()
    await tx.wait()
    const after = Number(await pool.phase())
    app.log.info({ from: before, to: after }, 'miningKeeper: pool phase advanced')
  } catch {
    // "LP6: condition not met" — the expected answer on all but two days in the pool's life.
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tick
// ─────────────────────────────────────────────────────────────────────────────

export async function runMiningKeeperTick(app: FastifyInstance): Promise<void> {
  const signer = getKeeperSigner()
  if (!signer) return

  const addrs = resolveAddresses()
  if (!addrs) return

  const mice = new Contract(addrs.mice, MICE_ABI, signer.wallet)
  const emission = new Contract(addrs.emission, EMISSION_ABI, signer.wallet)

  // Each step is guarded on its own. A failure to recycle must not stop the mint: the
  // emission is time-sensitive and lost forever if the day rolls over without it.
  // Retire expired licences before anything else: the pool holds its accumulator at the
  // oldest unprocessed expiry, so until this runs, nobody accrues.
  if (addrs.mining) {
    try {
      await drainExpiries(app, new Contract(addrs.mining, MINING_ABI, signer.wallet))
    } catch (e: any) {
      app.log.warn({ err: e?.shortMessage || e?.message }, 'miningKeeper: expiry drain failed')
    }
  }

  // Then free the seats themselves, so a buyer can take one.
  try {
    await recycleExpired(app, mice)
  } catch (e: any) {
    app.log.warn({ err: e?.shortMessage || e?.message }, 'miningKeeper: recycle step failed')
  }

  try {
    const poolContract = addrs.pool ? new Contract(addrs.pool, POOL_ABI, signer.wallet) : undefined
    await distributeIfDue(app, emission, poolContract)
  } catch (e: any) {
    app.log.error({ err: e?.shortMessage || e?.message }, 'miningKeeper: emission step failed')
  }

  if (addrs.pool) {
    try {
      await pokePool(app, new Contract(addrs.pool, POOL_ABI, signer.wallet))
    } catch (e: any) {
      app.log.warn({ err: e?.shortMessage || e?.message }, 'miningKeeper: pool step failed')
    }
  }
}

/**
 * Start the keeper.
 *
 * Ten minutes is chosen against what it is waiting for: the emission is due once a day,
 * so the worst case is that a day's rewards start streaming ten minutes late — invisible
 * against a 24-hour stream. Polling every minute would cost 1,440 RPC sweeps a day to
 * bring one transaction forward by nine minutes.
 */
export function startMiningKeeper(app: FastifyInstance, intervalMs = 600_000): () => void {
  let running = false
  const id = setInterval(async () => {
    if (running) return
    running = true
    try {
      await runMiningKeeperTick(app)
    } catch (e: any) {
      app.log.error({ err: e }, 'miningKeeper tick crashed')
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
    'miningKeeper started',
  )
  return () => clearInterval(id)
}
