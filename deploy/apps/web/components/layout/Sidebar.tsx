'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { useAccount, useConnect, useDisconnect } from 'wagmi'
import { useRouter } from 'next/navigation'
import { useRoundConfig } from '@/hooks/useRoundConfig'

interface MenuItem {
  id: string
  icon: string
  label: string
  href: string
  group: string
  status: 'enabled' | 'disabled' | 'cleared'
  mandatory: boolean
  order: number
  badge?: string
  roundType?: string
}

// Fallback menu items when API is unreachable
const FALLBACK_ITEMS: MenuItem[] = [
  { id: 'dashboard', icon: '📊', label: 'Dashboard', href: '/dashboard', group: 'Overview', status: 'enabled', mandatory: true, order: 0 },
  { id: 'profile', icon: '👤', label: 'Profile', href: '/profile', group: 'Overview', status: 'enabled', mandatory: true, order: 1 },
  { id: 'steward-council', icon: '◆', label: 'Steward Council', href: '/dao/council', group: 'DAO Governance', status: 'enabled', mandatory: false, order: 90 },
  { id: 'dao-management',  icon: '🏛', label: 'DAO Management', href: '/dao/management', group: 'DAO Governance', status: 'disabled', mandatory: false, order: 91 },
  { id: 'seed', icon: '🌱', label: 'SEED Sale', href: '/seed', group: 'Token Sales', status: 'enabled', mandatory: false, order: 3, badge: 'HOT', roundType: 'SEED' },
  { id: 'presale', icon: '💰', label: 'Pre-Sale', href: '/presale', group: 'Token Sales', status: 'enabled', mandatory: false, order: 4, roundType: 'PRESALE' },
  { id: 'mice', icon: '🪪', label: 'MICE License', href: '/mice', group: 'Token Sales', status: 'enabled', mandatory: false, order: 5, roundType: 'MICE' },
  { id: 'mining', icon: '💎', label: 'Mining', href: '/mining', group: 'Earn', status: 'disabled', mandatory: false, order: 6 },
  { id: 'staking', icon: '📈', label: 'Staking', href: '/staking', group: 'Earn', status: 'disabled', mandatory: false, order: 7 },
  { id: 'network', icon: '🌐', label: 'Building', href: '/network', group: 'Earn', status: 'enabled', mandatory: false, order: 8 },
  { id: 'nft', icon: '🎨', label: 'NFT', href: '/nft', group: 'Earn', status: 'disabled', mandatory: false, order: 9 },
  { id: 'vesting', icon: '🔒', label: 'Vesting', href: '/vesting', group: 'Earn', status: 'disabled', mandatory: false, order: 10 },
  { id: 'p2p', icon: '🔀', label: 'P2P Exchange', href: '/p2p', group: 'Explore', status: 'disabled', mandatory: false, order: 11 },
  { id: 'swap', icon: '🔄', label: 'Swap', href: '/swap', group: 'Explore', status: 'disabled', mandatory: false, order: 12 },
  { id: 'info', icon: 'ℹ️', label: 'Infos', href: '/info', group: 'Explore', status: 'disabled', mandatory: false, order: 13 },
  { id: 'nira', icon: '🤖', label: 'NIRA AI', href: '/nira', group: 'Explore', status: 'disabled', mandatory: false, order: 14, badge: 'AI' },
]

const GROUP_EMOJIS: Record<string, string> = {
  'Overview': '\u{1F4CA}',
  'Token Sales': '\u{1F3F7}\uFE0F',
  'Earn': '\u26CF\uFE0F',
  'Explore': '\u{1F4DA}',
  'DAO Governance': '\u{1F451}',
}

const BADGE_CLASS_MAP: Record<string, string> = {
  HOT: 'nav-badge-hot',
  NEW: 'nav-badge-new',
  AI: 'nav-badge-ai',
  SOON: 'nav-badge-soon',
}

function shortenAddress(addr: string) {
  return addr.slice(0, 6) + '...' + addr.slice(-4)
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'

export default function Sidebar() {
  const pathname = usePathname()
  const { address, isConnected } = useAccount()
  const { connect, connectors } = useConnect()
  const { disconnect } = useDisconnect()
  const router = useRouter()
  const { getRoundStatus } = useRoundConfig()

  const [menuItems, setMenuItems] = useState<MenuItem[]>(FALLBACK_ITEMS)

  // Fetch menu config from API (no-store: admin toggles must propagate without hard refresh)
  useEffect(() => {
    fetch(`${API_BASE}/menu-config`, { cache: 'no-store' })
      .then(res => res.json())
      .then(data => {
        if (data.data && Array.isArray(data.data)) {
          const items = data.data
            .filter((i: MenuItem) => i.status !== 'cleared')
            .sort((a: MenuItem, b: MenuItem) => a.order - b.order)
          setMenuItems(items)
        }
      })
      .catch(() => {})
  }, [pathname])

  const handleConnect = () => {
    const connector = connectors[0]
    if (connector) {
      connect({ connector })
    }
  }

  const handleDisconnect = () => {
    disconnect()
    localStorage.removeItem('mc-jwt')
    localStorage.removeItem('mc-userId')
    localStorage.removeItem('mc-wallet')
    router.push('/')
  }

  // Group items maintaining order
  const groups: string[] = []
  menuItems.forEach(i => {
    if (!groups.includes(i.group)) groups.push(i.group)
  })

  return (
    <aside className="sidebar">
      {/* Centered logo header — Orbit style */}
      <div className="sidebar-head-v2">
        <div className="sb-head-glow" />
        <div className="sb-orbit-logo">
          <div className="sb-orbit-ring sb-orbit-ring-1"><div className="sb-orbit-dot" /></div>
          <div className="sb-orbit-ring sb-orbit-ring-2"><div className="sb-orbit-dot" /><div className="sb-orbit-dot sb-orbit-dot-opposite" /></div>
          <div className="sb-orbit-ring sb-orbit-ring-3"><div className="sb-orbit-dot" /></div>
          <img src="/images/mission-chain-logo-clear.png" alt="MC" className="sb-logo-center" />
        </div>
        <div className="sb-brand-name">MISSION CHAIN</div>
        <div className="sb-brand-sub">Membership Dashboard</div>
      </div>

      <nav className="sidebar-nav">
        {groups.map((group) => {
          const groupItems = menuItems.filter(i => i.group === group)
          return (
            <div className="sidebar-section" key={group}>
              <div className="sidebar-section-title">
                <span className="sidebar-section-emoji">{GROUP_EMOJIS[group] || '📁'}</span>
                {group}
              </div>
              {groupItems.map((item) => {
                const isActive = pathname === item.href
                const isDisabled = item.status === 'disabled'

                if (isDisabled) {
                  return (
                    <span
                      key={item.href}
                      className="nav-link nav-link-disabled"
                    >
                      <span className="nav-link-icon">{item.icon}</span>
                      <span className="nav-link-label">{item.label}</span>
                      <span className={`nav-badge ${BADGE_CLASS_MAP.SOON}`}>
                        SOON
                      </span>
                    </span>
                  )
                }

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`nav-link ${isActive ? 'active' : ''}`}
                  >
                    <span className="nav-link-icon">{item.icon}</span>
                    <span className="nav-link-label">{item.label}</span>
                    {item.badge && (
                      <span className={`nav-badge ${BADGE_CLASS_MAP[item.badge] || ''}`}>
                        {item.badge}
                      </span>
                    )}
                  </Link>
                )
              })}
            </div>
          )
        })}
      </nav>

      <div className="sidebar-footer">
        {isConnected ? (
          <div className="sidebar-wallet-card">
            <div className="sidebar-wallet-top">
              <span className="wallet-indicator connected" />
              <span className="sidebar-wallet-addr">
                {address ? shortenAddress(address) : ''}
              </span>
            </div>
            <button className="btn-disconnect-wallet" onClick={handleDisconnect} type="button">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
              Disconnect
            </button>
          </div>
        ) : (
          <button className="btn-connect-wallet" onClick={handleConnect} type="button">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4h-4z"/></svg>
            Connect Wallet
          </button>
        )}
      </div>
    </aside>
  )
}
