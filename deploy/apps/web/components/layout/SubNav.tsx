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

interface SubNavItem {
  label: string
  href: string
  badge?: string
  menuId?: string  // maps to menu-config item id
}

interface SubNavProps {
  items: SubNavItem[]
}

/* ── Pre-defined groups ── */
export const SALES_TABS: SubNavItem[] = [
  { label: 'SEED', href: '/seed', badge: 'HOT', menuId: 'seed' },
  { label: 'Pre-Sale', href: '/presale', menuId: 'presale' },
  { label: 'MICE Licenses', href: '/mice', menuId: 'mice' },
]

export const EARN_TABS: SubNavItem[] = [
  { label: 'MICE & Mining Pool', href: '/mining', menuId: 'mining' },
  { label: 'Staking', href: '/staking', menuId: 'staking' },
  { label: 'Building', href: '/network', menuId: 'network' },
  { label: 'NFT', href: '/nft', menuId: 'nft' },
  { label: 'Vesting', href: '/vesting', menuId: 'vesting' },
]

export const PROFILE_TABS: SubNavItem[] = [
  { label: 'Profile', href: '/profile', menuId: 'profile' },
  { label: 'DAO Governance', href: '/dao', menuId: 'dao' },
]

export const EXPLORE_TABS: SubNavItem[] = [
  { label: 'P2P Exchange', href: '/p2p', menuId: 'p2p' },
  { label: 'Swap', href: '/swap', menuId: 'swap' },
  { label: 'Infos', href: '/info', menuId: 'info' },
  { label: 'NIRA AI', href: '/nira', badge: 'AI', menuId: 'nira' },
]

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'

// Short-lived cache (10s) shared across SubNav instances on the same page render,
// so multiple SubNavs mounted together don't all hit the network at once.
// After 10s, the next mount re-fetches — guarantees admin toggles propagate quickly.
const CACHE_TTL_MS = 10_000
let _menuCache: { items: MenuItem[]; expiresAt: number } | null = null
let _menuPromise: Promise<MenuItem[]> | null = null

function fetchMenuConfig(): Promise<MenuItem[]> {
  const now = Date.now()
  if (_menuCache && _menuCache.expiresAt > now) return Promise.resolve(_menuCache.items)
  if (_menuPromise) return _menuPromise
  _menuPromise = fetch(`${API_BASE}/menu-config`, { cache: 'no-store' })
    .then(res => res.json())
    .then(data => {
      if (data.data && Array.isArray(data.data)) {
        _menuCache = { items: data.data, expiresAt: Date.now() + CACHE_TTL_MS }
        _menuPromise = null
        return data.data as MenuItem[]
      }
      _menuPromise = null
      return []
    })
    .catch(() => {
      _menuPromise = null
      return []
    })
  return _menuPromise
}

export default function SubNav({ items }: SubNavProps) {
  const pathname = usePathname()
  const [menuItems, setMenuItems] = useState<MenuItem[]>(_menuCache?.items || [])

  useEffect(() => {
    fetchMenuConfig().then(setMenuItems)
  }, [pathname])

  // Build a map of menuId → status
  const statusMap = new Map<string, string>()
  menuItems.forEach(m => statusMap.set(m.id, m.status))

  return (
    <nav className="sub-nav">
      {items.map((item) => {
        const isActive = pathname === item.href || pathname.startsWith(item.href + '/')
        const menuStatus = item.menuId ? statusMap.get(item.menuId) : undefined

        // Match Sidebar behavior: 'cleared' = hide entirely, 'disabled' = show as gray
        if (menuStatus === 'cleared') return null

        const isDisabled = menuStatus === 'disabled'

        if (isDisabled) {
          return (
            <span
              key={item.href}
              className="sub-nav-tab sub-nav-disabled"
            >
              <span>{item.label}</span>
              {item.badge && <span className={`sub-nav-badge sub-nav-badge-${item.badge.toLowerCase()}`}>{item.badge}</span>}
            </span>
          )
        }

        return (
          <Link
            key={item.href}
            href={item.href}
            className={`sub-nav-tab ${isActive ? 'active' : ''}`}
          >
            <span>{item.label}</span>
            {item.badge && <span className={`sub-nav-badge sub-nav-badge-${item.badge.toLowerCase()}`}>{item.badge}</span>}
          </Link>
        )
      })}
    </nav>
  )
}
