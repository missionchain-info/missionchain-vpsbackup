'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { sidebarConfig } from '@/lib/sidebar-config';

interface SidebarProps {
  currentModule: string;
}

export default function Sidebar({ currentModule }: SidebarProps) {
  const pathname = usePathname();
  const { user } = useAuth();
  const sections = sidebarConfig[currentModule] || [];
  const initials = user?.name ? user.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() : 'AD';

  return (
    <div id="sidebar">
      <div className="sb-logo">
        <img src="/images/mission-chain-logo-clear.png" alt="Mission Chain" className="sb-logo-img" />
        <div>
          <div className="sb-logo-title">MISSION CHAIN</div>
          <div className="sb-logo-sub">UNIFIED ADMIN</div>
        </div>
      </div>
      {sections.map((section, si) => (
        <div key={si}>
          <div className="sb-section">{section.title}</div>
          {section.items.map((item, ii) => {
            const isActive = pathname === item.href ||
              (item.href !== `/${currentModule}` && pathname.startsWith(item.href));
            return (
              <Link key={ii} href={item.href} className={`nav-item${isActive ? ' active' : ''}`}>
                <span className="nav-icon">{item.icon}</span>
                {item.label}
                {item.badge && (
                  <span className={`nav-badge${item.badgeClass ? ` ${item.badgeClass}` : ''}`}>
                    {item.badge}
                  </span>
                )}
              </Link>
            );
          })}
          {si < sections.length - 1 && <div className="sb-divider" />}
        </div>
      ))}
      <div className="sb-admin-info">
        <div className="admin-avatar">{initials}</div>
        <div>
          <div className="admin-name">{user?.name || 'Admin'}</div>
          <div className="admin-role" id="admin-role">{user?.role || 'SUPER_ADMIN'}</div>
        </div>
      </div>
    </div>
  );
}
