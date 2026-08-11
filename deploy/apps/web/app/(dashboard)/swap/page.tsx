'use client'

import SwapPanel from '@/components/SwapPanel'

/**
 * SWAP — the pool's own market, not a router into someone else's.
 *
 * Everything about what is tradeable right now is read from LiquidityPoolV6 by the panel
 * itself: whether the pool has been seeded, whether the sell side has opened, the fee,
 * the per-trade cap. Nothing here is gated by a flag we maintain, so the page cannot show
 * an open market that is not open.
 */
export default function SwapPage() {
  return (
    <div style={{ padding: '20px 0 40px' }}>
      <div className="page-title" style={{ marginBottom: 6, textAlign: 'center' }}>Swap</div>
      <p style={{
        fontSize: '0.8rem', opacity: 0.72, lineHeight: 1.7, marginBottom: 22,
        maxWidth: 560, marginLeft: 'auto', marginRight: 'auto', textAlign: 'center',
      }}>
        Trade USDT for MIC against Mission Chain&rsquo;s own liquidity pool. Buying is open
        from the moment the pool is funded; selling opens 30 days later, so the pool has
        time to build depth before it has to absorb outflow.
      </p>
      <SwapPanel />
    </div>
  )
}
