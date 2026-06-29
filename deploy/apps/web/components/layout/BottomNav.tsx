'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

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

/* ── Bottom-bar tab definitions ──
   Each tab represents a group of sidebar menu items.
   `match` lists all hrefs that belong to this tab.
   `firstEnabled` will be resolved at runtime from the API. */
interface TabDef {
  icon: string
  label: string
  fallbackHref: string
  match: string[]
  groupIds: string[]          // menu-item IDs that belong to this tab
}

const TAB_DEFS: TabDef[] = [
  {
    icon: '📊', label: 'HOME', fallbackHref: '/dashboard',
    match: ['/dashboard'],
    groupIds: ['dashboard'],
  },
  {
    icon: '💰', label: 'SALES', fallbackHref: '/seed',
    match: ['/seed', '/presale', '/mice'],
    groupIds: ['seed', 'presale', 'mice'],
  },
  {
    icon: '⛏️', label: 'EARN', fallbackHref: '/mining',
    match: ['/mining', '/staking', '/nft', '/network', '/vesting'],
    groupIds: ['mining', 'staking', 'nft', 'network', 'vesting'],
  },
  {
    icon: '🧭', label: 'EXPLORE', fallbackHref: '/swap',
    match: ['/swap', '/info', '/nira'],
    groupIds: ['swap', 'info', 'nira'],
  },
  {
    icon: '👤', label: 'PROFILE', fallbackHref: '/profile',
    match: ['/profile', '/dao'],
    groupIds: ['profile', 'dao'],
  },
]

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'

export default function BottomNav() {
  const pathname = usePathname()
  const [menuItems, setMenuItems] = useState<MenuItem[] | null>(null)

  useEffect(() => {
    fetch(`${API_BASE}/menu-config`, { cache: 'no-store' })
      .then(res => res.json())
      .then(data => {
        if (data.data && Array.isArray(data.data)) {
          setMenuItems(data.data)
        }
      })
      .catch(() => {})
  }, [pathname])

  return (
    <nav className="mobile-nav">
      {TAB_DEFS.map((tab) => {
        const isActive = tab.match.some((m) => pathname.startsWith(m))

        let isDisabled = false
        let href = tab.fallbackHref

        if (menuItems) {
          // Match Sidebar/SubNav: 'cleared' = treat as deleted, 'disabled' = visible but inactive.
          const groupItems = menuItems.filter(i => tab.groupIds.includes(i.id) && i.status !== 'cleared')
          const enabledItems = groupItems.filter(i => i.status === 'enabled')

          // If every item in this tab is 'cleared', hide the tab entirely.
          if (menuItems.length > 0 && groupItems.length === 0) return null

          // Tab is disabled if there are items but none enabled.
          isDisabled = groupItems.length > 0 && enabledItems.length === 0

          if (enabledItems.length > 0) {
            enabledItems.sort((a, b) => a.order - b.order)
            href = enabledItems[0].href
          }
        }

        if (isDisabled) {
          return (
            <span
              key={tab.label}
              className="mob-nav-btn mob-disabled"
            >
              <span className="mob-icon">{tab.icon}</span>
              <span className="mob-label">{tab.label}</span>
            </span>
          )
        }

        return (
          <Link
            key={tab.label}
            href={href}
            className={`mob-nav-btn ${isActive ? 'active' : ''}`}
          >
            <span className="mob-icon">{tab.icon}</span>
            <span className="mob-label">{tab.label}</span>
            {isActive && <span className="mob-indicator" />}
          </Link>
        )
      })}
    </nav>
  )
}
