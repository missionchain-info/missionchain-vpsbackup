'use client'

import SwapPanel from '@/components/SwapPanel'
import SubNav, { EXPLORE_TABS } from '@/components/layout/SubNav'

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
    <>
      {/* SubNav lists Swap as one of the Explore tabs, but this page was the only one of
          the four that never rendered it — so opening Swap made the whole strip vanish and
          left the bottom bar as the only way back. */}
      <SubNav items={EXPLORE_TABS} />
    {/* `p2p-page` is the 680px column the P2P page sits in. Without it this page ran the
        full width of the viewport, so the same hero card looked twice as wide there. */}
    <div className="p2p-page" style={{ padding: '20px 0 40px' }}>
      {/* The P2P hero, reused verbatim — same classes, so the two markets are the same
          size and weight on screen instead of one being a large centred `page-title`. */}
      <div className="p2p-hero">
        <div className="p2p-hero-bg" />
        <div className="p2p-hero-content">
          <div className="p2p-hero-icon">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 3h4v4"/><path d="M21 3l-7 7"/><path d="M7 21H3v-4"/><path d="M3 21l7-7"/>
            </svg>
          </div>
          <div>
            <div className="p2p-hero-label">SWAP &ndash; AMM Platform Protocol</div>
            <div className="p2p-hero-sub">Trade USDT for MIC against Mission Chain&rsquo;s own liquidity pool</div>
          </div>
        </div>
      </div>
      {/* The form is wrapped in the same raised card as the MIC market panel opposite —
          it was bare text on the page background, which is why it read as flat next to
          P2P's panels. */}
      <div className="nft-section-card">
        <div className="nft-pool-note" style={{ marginBottom: 16 }}>
          Buying is open from the moment the pool is funded; selling opens 30 days later, so
          the pool has time to build depth before it has to absorb outflow.
        </div>
        <SwapPanel />
      </div>
    </div>
    </>
  )
}
