'use client';
import { useAuth } from '@/lib/auth';
import { MODULE_LABELS } from '@/lib/rbac';

interface TopbarProps {
  currentModule: string;
  currentPage: string;
}

export default function Topbar({ currentModule, currentPage }: TopbarProps) {
  const { user, logout } = useAuth();

  return (
    <div id="topbar">
      <div className="topbar-left">
        <div className="page-breadcrumb">
          <span>Admin</span> / <span>{MODULE_LABELS[currentModule] || 'Core'}</span> / <span style={{ color: 'var(--white)' }}>{currentPage}</span>
        </div>
      </div>
      <div className="topbar-right">
        <div className="topbar-search">
          <span style={{ color: 'var(--muted)', fontSize: '13px' }}>🔍</span>
          <input type="text" placeholder="Search..." />
        </div>
        <div className="env-badge">TESTNET</div>
        <div className="alert-bell">
          🔔<div className="alert-dot" />
        </div>
        <div className="role-selector">
          <span style={{ fontSize: '11px', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '1px' }}>Role:</span>
          <span style={{ color: 'var(--white)', fontFamily: 'var(--font-ui)', fontSize: '12px', fontWeight: 600 }}>
            {user?.role || 'SUPER_ADMIN'}
          </span>
        </div>
        <button onClick={logout} className="btn btn-outline btn-sm" style={{ marginLeft: '4px' }}>Logout</button>
      </div>
    </div>
  );
}
