'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth, getRoleBadgeClass, getRoleLabel, isOwnerWallet, OwnerCrown } from '@/lib/auth';

interface NavItem {
  href: string;
  icon: string;
  label: string;
  shortLabel?: string;
  badge?: string;
  ownerOnly?: boolean;
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
    ],
  },
  {
    group: 'Business & Finance',
    items: [
      { href: '/components', icon: '🧩', label: 'Components' },
      { href: '/rounds', icon: '💎', label: 'Round Sales' },
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

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/' || pathname === '';
    return pathname.startsWith(href);
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
              {visibleItems.map((item) => (
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
              ))}
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
