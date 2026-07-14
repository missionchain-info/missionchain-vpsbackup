'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { usePathname, useRouter } from 'next/navigation';

const TITLES: Record<string, string> = {
  '/': 'HOME',
  '/stats': 'DASHBOARD \u2014 Overview',
  '/members': 'MEMBER MANAGEMENT',
  '/rounds': 'ROUND SALES',
  '/distributors': 'DISTRIBUTOR MANAGEMENT',
  '/building': 'COMMUNITY BUILDING',
  '/funds': 'REVENUE & FUNDS',
  '/dao': 'DAO GOVERNANCE',
  '/nira': 'NIRA AI',
  '/components': 'COMPONENTS',
  '/interface': 'FRONTEND MENU INTERFACE',
  '/system': 'SYSTEM CONFIGURATION',
  '/mining': 'MINING & STAKING',
  '/swap': 'SWAP CONTROL',
  '/council': 'STEWARD COUNCIL',
  '/access': 'ADMIN ACCESS',
  '/p2p': 'P2P EXCHANGE',
  '/resources': 'DOCUMENTS & LINKS',
};

function getStoredTheme(): 'dark' | 'light' {
  if (typeof window === 'undefined') return 'dark';
  return (localStorage.getItem('mc-admin-theme') as 'dark' | 'light') || 'dark';
}

interface TopbarProps {
  onToggleSidebar?: () => void;
}

export default function Topbar({ onToggleSidebar }: TopbarProps) {
  const pathname = usePathname();
  const router = useRouter();

  const handleDisconnect = useCallback(() => {
    localStorage.removeItem('mc-admin-jwt');
    localStorage.removeItem('mc-admin-theme');
    router.push('/login');
  }, [router]);
  const [time, setTime] = useState('');
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');

  // Initialize theme from localStorage
  useEffect(() => {
    const stored = getStoredTheme();
    setTheme(stored);
    document.documentElement.setAttribute('data-theme', stored);
  }, []);

  useEffect(() => {
    const tick = () => {
      setTime(new Date().toUTCString().slice(17, 25) + ' UTC');
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  const toggleTheme = useCallback(() => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('mc-admin-theme', next);
  }, [theme]);

  const title = TITLES[pathname] || pathname.toUpperCase().replace('/', '');

  return (
    <div className="topbar">
      <button
        className="hamburger"
        onClick={onToggleSidebar}
        type="button"
        aria-label="Toggle menu"
      >
        &#9776;
      </button>
      <div className="topbar-title">{title}</div>
      <div className="topbar-time">{time}</div>
      <div className="topbar-chip">
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--copper)', boxShadow: '0 0 6px var(--copper)', display: 'inline-block' }} />
        BSC &middot; Block #47,291,038
      </div>
      <button
        className="theme-toggle"
        onClick={toggleTheme}
        title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        type="button"
      >
        {theme === 'dark' ? '\u2600\uFE0F' : '\u{1F319}'}
      </button>
      <div className="topbar-bell">
        {'\u{1F514}'}
        <span className="notif-pip" />
      </div>
      <button
        onClick={handleDisconnect}
        title="Disconnect"
        style={{
          background: 'rgba(217,83,79,0.12)',
          border: '1px solid rgba(217,83,79,0.3)',
          borderRadius: 6,
          padding: '4px 10px',
          cursor: 'pointer',
          color: '#d9534f',
          fontSize: '0.58rem',
          fontWeight: 700,
          fontFamily: 'var(--font-m)',
          letterSpacing: '0.03em',
          marginLeft: 4,
        }}
      >
        Disconnect
      </button>
    </div>
  );
}
