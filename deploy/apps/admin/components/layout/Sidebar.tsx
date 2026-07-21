'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth, getRoleBadgeClass, getRoleLabel, isOwnerWallet, OwnerCrown } from '@/lib/auth';

interface NavChild {
  href: string;
  label: string;
}

interface NavItem {
  href: string;
  icon: string;
  label: string;
  shortLabel?: string;
  badge?: string;
  ownerOnly?: boolean;
  children?: NavChild[];
}

interface NavGroup {
  group: string;
  items: NavItem[];
}

const NAV_ITEMS: NavGroup[] = [
  {
    group: 'Overview',
    items: [
      { href: '/stats', icon: '📊', label: 'Dashboard' },
    ],
  },
  {
    group: 'Management',
    items: [
      { href: '/members', icon: '👥', label: 'Members' },
      { href: '/distributors', icon: '🤝', label: 'Distributors' },
      { href: '/payment-requests', icon: '💸', label: 'Payment Requests' },
      { href: '/building', icon: '🌐', label: 'Community' },
      { href: '/feeds', icon: '📰', label: 'Feeds', badge: 'NEW' },
    ],
  },
  {
    group: 'Business & Finance',
    items: [
      { href: '/components', icon: '🧩', label: 'Components' },
      {
        href: '/rounds', icon: '💎', label: 'Sale Rounds',
        children: [
          { href: '/rounds?view=seed', label: 'SEED Round' },
          { href: '/rounds?view=presale', label: 'Pre-Sale' },
          { href: '/rounds?view=mice', label: 'MICE-License' },
        ],
      },
      { href: '/revenue-funds', icon: '💰', label: 'Revenue & Funds' },
      { href: '/mining', icon: '⛏️', label: 'Mining & Staking' },
      { href: '/p2p', icon: '🔀', label: 'P2P Exchange', shortLabel: 'P2P' },
      { href: '/swap', icon: '🔄', label: 'SWAP' },
    ],
  },
  {
    group: 'Governance',
    items: [
      { href: '/steward-council', icon: '◆', label: 'Steward Council' },
      { href: '/dao', icon: '🏛', label: 'DAO Governance' },
    ],
  },
  {
    group: 'Settings',
    items: [
      { href: '/access', icon: '🔐', label: 'Admin Access', ownerOnly: true },
      { href: '/interface', icon: '📱', label: 'Members Interface' },
      { href: '/nira', icon: '🤖', label: 'NIRA AI', badge: 'AI' },
      { href: '/system', icon: '🔧', label: 'System' },
    ],
  },
  {
    group: 'Resources',
    items: [
      { href: '/resources', icon: '📚', label: 'Documents & Links' },
    ],
  },
];

interface SidebarProps {
  isOpen?: boolean;
  onClose?: () => void;
}

export default function Sidebar({ isOpen, onClose }: SidebarProps) {
  const pathname = usePathname();
  const { user } = useAuth();
  const [openGroups, setOpenGroups] = React.useState<Record<string, boolean>>({});

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/' || pathname === '';
    // Compare on the path only (ignore ?query) so sub-view links still match the parent
    const base = href.split('?')[0];
    return pathname.startsWith(base);
  };

  return (
    <aside className={`sidebar ${isOpen ? 'open' : ''}`}>
      <div className="sidebar-head-v2">
        <img src="/images/mission-chain-logo-clear.png" alt="MC" className="sb-logo-center" />
        <div className="sb-brand-name">MISSION CHAIN</div>
        <div className="sb-brand-sub">ADMIN CONSOLE</div>
      </div>

      {user && (
        <div className="sb-wallet" style={{ padding: '8px 18px' }}>
          <span className={`sb-role-badge ${getRoleBadgeClass(user.role)}`}>
            {'\u2B21'} {getRoleLabel(user.role)}
            <OwnerCrown wallet={user.wallet} />
          </span>
        </div>
      )}

      <nav className="sidebar-nav">
        {NAV_ITEMS.map((group) => {
          // Filter ownerOnly items unless current user is owner-wallet
          const isSuperAdmin = isOwnerWallet(user?.wallet);
          const visibleItems = group.items.filter((it) => !it.ownerOnly || isSuperAdmin);
          if (visibleItems.length === 0) return null;
          return (
            <div className="nav-group" key={group.group}>
              <div className="nav-group-label">{group.group}</div>
              {visibleItems.map((item) => {
                // ── Parent with dropdown children (e.g. Sale Rounds) ──
                if (item.children && item.children.length > 0) {
                  const active = isActive(item.href);
                  const expanded = openGroups[item.href] ?? active;
                  return (
                    <div key={item.href} className="nav-parent">
                      <div className={`nav-item ${active ? 'active' : ''}`} style={{ display: 'flex', alignItems: 'center', gap: 0, paddingRight: 8 }}>
                        <Link href={item.children[0].href} style={{ display: 'flex', alignItems: 'center', flex: 1, color: 'inherit', textDecoration: 'none', gap: 0 }}>
                          <span className="nav-icon">{item.icon}</span>
                          {item.label}
                        </Link>
                        <button
                          type="button"
                          aria-label={expanded ? 'Collapse' : 'Expand'}
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpenGroups((g) => ({ ...g, [item.href]: !expanded })); }}
                          style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: 10, lineHeight: 1, padding: '2px 4px', opacity: 0.75 }}
                        >
                          {expanded ? '▾' : '▸'}
                        </button>
                      </div>
                      {expanded && (
                        <div className="nav-children" style={{ display: 'flex', flexDirection: 'column', margin: '2px 0 4px 30px', borderLeft: '1px solid var(--border)', paddingLeft: 8 }}>
                          {item.children.map((child) => (
                            <Link
                              key={child.href}
                              href={child.href}
                              className="nav-subitem"
                              style={{ padding: '6px 10px', fontSize: '0.85em', color: 'var(--gray)', textDecoration: 'none', borderRadius: 6 }}
                            >
                              {child.label}
                            </Link>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                }
                // ── Regular flat item ──
                return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`nav-item ${isActive(item.href) ? 'active' : ''}`}
                >
                  <span className="nav-icon">{item.icon}</span>
                  {item.shortLabel ? (
                    <>
                      <span className="nav-label-full">{item.label}</span>
                      <span className="nav-label-short">{item.shortLabel}</span>
                    </>
                  ) : (
                    item.label
                  )}
                  {item.badge && <span className="nav-badge">{item.badge}</span>}
                  {item.ownerOnly && <span className="nav-owner-only">OWNER</span>}
                </Link>
                );
              })}
            </div>
          );
        })}
      </nav>

      <SidebarFooter />
    </aside>
  );
}

function SidebarFooter() {
  const [time, setTime] = React.useState('');

  React.useEffect(() => {
    const tick = () => {
      setTime(new Date().toUTCString().slice(17, 25) + ' UTC');
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="sb-footer">
      <span>
        <span className="online-dot" />
        BSC Mainnet
      </span>
      <span>{time}</span>
    </div>
  );
}
