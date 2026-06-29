'use client'

import { usePathname } from 'next/navigation'
import { useAccount } from 'wagmi'
import { useTheme } from '@/hooks/useTheme'
import { useApi } from '@/hooks/useApi'
import Link from 'next/link'

const PAGE_TITLES: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/profile': 'Profile',
  '/dao': 'DAO Governance',
  '/seed': 'SEED Sale',
  '/presale': 'Pre-Sale',
  '/mice': 'MICE License',
  '/mining': 'Mining',
  '/staking': 'Staking',
  '/nft': 'NFT Manager',
  '/network': 'Community Building',
  '/vesting': 'Vesting',
  '/swap': 'Swap',
  '/p2p': 'P2P Exchange',
  '/info': 'Information',
  '/nira': 'NIRA AI',
  '/mfpnft_demo': 'MFP-NFT Preview',
}

interface OverviewData {
  data: {
    micPrice?: string
  }
}

export default function Topbar() {
  const pathname = usePathname()
  const { toggleTheme, isDark } = useTheme()
  const { address } = useAccount()
  const { data: overview } = useApi<OverviewData>('/dashboard/overview')

  const micPrice = overview?.data?.micPrice ?? '--'
  const title = PAGE_TITLES[pathname] || 'Dashboard'

  return (
    <div className="topbar">
      {/* Mobile: logo + brand (visible <=768px) */}
      <div className="topbar-mobile-brand">
        <img src="/images/mission-chain-logo-clear.png" alt="MC" className="topbar-mobile-logo" />
        <span className="topbar-mobile-title">MISSION CHAIN</span>
      </div>

      {/* Desktop: page title (hidden <=768px) */}
      <h1 className="topbar-title">{title}</h1>

      <div className="topbar-right">
        <div className="price-tickers">
          <div className="price-ticker">
            <span className="price-ticker-label">MIC</span>
            <span className="price-ticker-value">${micPrice}</span>
          </div>
        </div>
        <button className="topbar-btn" aria-label="Notifications">🔔</button>
        <button className="topbar-btn" onClick={toggleTheme} aria-label="Toggle theme">
          {isDark ? '🌙' : '☀'}
        </button>
        <Link href="/" className="topbar-btn" style={{ textDecoration: 'none' }} aria-label="Home">↪</Link>
      </div>
    </div>
  )
}
