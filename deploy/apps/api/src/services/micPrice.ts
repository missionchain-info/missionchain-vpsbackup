/**
 * The MIC display price — one source, shared.
 *
 * There were three. `/rounds/mic-price` gated on `mic_price_mode`, `/rounds/system-info`
 * read the pool directly, and `/dashboard/overview` read the raw `mic_price` row and knew
 * nothing about either. So on 2026-08-12 the same token was quoted at $0.01 on one screen
 * and $0.005 on the next, which is worse than any one of them being wrong: a member cannot
 * tell which to believe.
 *
 * ## What this is, and is not
 *
 * A DISPLAY price. It is what a member is shown, and what market cap is computed from.
 *
 * It is NOT a sale price. Pre-Sale sells at its own contract's price and SEED at its own;
 * neither reads this, and neither should — a published sale price that quietly follows the
 * market is a different product from the one people were promised.
 */
import type { PrismaClient } from '@missionchain/db'
import { MIC_DISPLAY_PRICE_USD, getActiveAddresses } from '@missionchain/sdk'
import { buildProvider } from './blockchain.js'

/** 30s. One chain read per half-minute rather than one per page load. */
const CACHE_MS = 30_000
let cache: { at: number; price: number } | null = null

/** The AMM's spot price, or null when there is no market to read. */
export async function poolSpotPrice(): Promise<number | null> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.price

  const addr = (getActiveAddresses() as Record<string, string>).LiquidityPoolV6
  if (!addr || /^0x0+$/.test(addr)) return null

  try {
    const { Contract, formatUnits } = await import('ethers')
    const c = new Contract(addr, [
      'function isSeeded() view returns (bool)',
      'function spotPrice() view returns (uint256)',
    ], buildProvider())

    // An unseeded pool quotes zero. Reporting that as the price would wipe market cap to
    // nothing and read as a collapse rather than as "the market has not opened".
    if (!(await c.isSeeded())) return null

    const raw = Number(formatUnits(await c.spotPrice(), 18))
    if (!Number.isFinite(raw) || raw <= 0) return null

    // Six decimals. The raw figure is 0.01000003994003988 — every digit true, none of them
    // meaningful to a reader. Rounding once, here, is what keeps every screen agreeing.
    const price = Number(raw.toFixed(6))
    cache = { at: Date.now(), price }
    return price
  } catch {
    return null
  }
}

export type MicPrice = {
  price: string
  /** `swap` = the live market. `admin` = a figure someone typed, and it says so. */
  source: 'swap' | 'admin' | 'admin-fallback'
  note?: string
}

/**
 * Resolve the price every caller should show.
 *
 * `mic_price_mode` decides intent; the chain decides whether that intent can be honoured.
 * When the pool cannot be read the configured figure is returned labelled
 * `admin-fallback`, never dressed up as the market.
 */
export async function resolveMicPrice(prisma: PrismaClient): Promise<MicPrice> {
  const [modeRow, priceRow] = await Promise.all([
    prisma.systemConfig.findUnique({ where: { key: 'mic_price_mode' } }),
    prisma.systemConfig.findUnique({ where: { key: 'mic_price' } }),
  ])

  const configured = priceRow?.value ?? String(MIC_DISPLAY_PRICE_USD)
  // 'twap' is an accepted alias so an older config value keeps working rather than
  // silently dropping back to the typed figure.
  const wantsMarket = modeRow?.value === 'swap' || modeRow?.value === 'twap'

  if (!wantsMarket) return { price: configured, source: 'admin' }

  const live = await poolSpotPrice()
  if (live !== null) return { price: String(live), source: 'swap' }

  return {
    price: configured,
    source: 'admin-fallback',
    note: 'The pool is not seeded or could not be read; showing the configured price.',
  }
}
