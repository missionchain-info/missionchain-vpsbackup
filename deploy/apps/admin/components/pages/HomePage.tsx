'use client';

import { useEffect, useState } from 'react';
import { useAuth, getRoleBadgeClass, getRoleLabel } from '@/lib/auth';
import { fetchStatsOverview, fetchDAOBoard } from '@/lib/api';

export default function HomePage() {
  const { user, logout } = useAuth();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(false);
  }, []);

  if (!user) return null;

  return (
    <>
      <div className="page-hd">
        <div>
          <div className="page-eyebrow">Personal Dashboard</div>
          <div className="page-title">Welcome Back</div>
          <div className="page-sub">Your governance session is active &middot; BSC Mainnet</div>
        </div>
        <button className="btn btn-outline btn-sm" onClick={() => { if (confirm('Disconnect wallet and end session?')) logout(); }}>
          {'\u{1F6AA}'} Disconnect
        </button>
      </div>

      {/* WELCOME BANNER */}
      <div className="welcome-banner">
        <div className="welcome-avatar">{user.userId || 'Admin'.slice(0, 2).toUpperCase()}</div>
        <div style={{ flex: 1 }}>
          <div className="welcome-greet">Welcome, <span>{user.userId || 'Admin'}</span></div>
          <div className="welcome-detail">{user.wallet}</div>
          <div className="welcome-meta">
            <span className={`badge ${user.role === 'ADMIN' ? 'b-gold' : 'b-purple'}`}>
              {'\u2B21'} {getRoleLabel(user.role)}
            </span>
            <span className="badge b-active">{'\u25CF'} Session Active</span>
            <span className="badge b-gray">{'\u{1F517}'} BSC Mainnet</span>
          </div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontFamily: 'var(--font-m)', fontSize: 9, color: 'var(--gray2)', letterSpacing: '.1em', textTransform: 'uppercase' }}>Last Login</div>
          <div style={{ fontSize: 12, color: 'var(--gray)', marginTop: 3 }}>2026-04-09 &middot; 07:42 UTC</div>
          <div style={{ fontFamily: 'var(--font-m)', fontSize: 9, color: 'var(--gray2)', letterSpacing: '.1em', textTransform: 'uppercase', marginTop: 10 }}>Session</div>
          <div style={{ fontSize: 12, color: 'var(--copper)', marginTop: 3, fontWeight: 600 }}>Active &middot; 0h 18m</div>
        </div>
      </div>

      <div className="g2" style={{ marginBottom: 16 }}>
        {/* PERSONAL INFO */}
        <div className="card card-p">
          <div className="card-title">Personal Information</div>
          <div className="info-row"><span className="info-key">Username</span><span className="info-val">{user.userId || 'Admin'}</span></div>
          <div className="info-row"><span className="info-key">Wallet Address</span><span className="info-val mono">{user.wallet.slice(0,6)}...{user.wallet.slice(-4)}</span></div>
          <div className="info-row"><span className="info-key">Role</span><span className="info-val"><span className={`sb-role-badge ${getRoleBadgeClass(user.role)}`} style={{ fontSize: 9 }}>{'\u2B21'} {getRoleLabel(user.role)}</span></span></div>
          <div className="info-row"><span className="info-key">Email</span><span className="info-val">{(user as any).email || '-'}</span></div>
          <div className="info-row"><span className="info-key">Telegram</span><span className="info-val" style={{ color: 'var(--purple2)' }}>{(user as any).telegram || '-'}</span></div>
          <div className="info-row"><span className="info-key">Telegram Chat ID</span><span className="info-val mono">{(user as any).telegramChatId || '-'}</span></div>
        </div>

        {/* NETWORK POSITION */}
        <div className="card card-g">
          <div className="card-title">My Network Position</div>
          <div className="info-row">
            <span className="info-key">MFP-NFTs Held</span>
            <span className="info-val">
              <strong style={{ color: 'var(--gold2)' }}>1,200</strong>
              <span style={{ color: 'var(--gray2)', fontSize: 11 }}> / 2,500 CAP</span>
              <div className="prog-bar"><div className="prog-fill g" style={{ width: '4.8%' }} /></div>
            </span>
          </div>
          <div className="info-row"><span className="info-key">MIC Staked</span><span className="info-val"><strong style={{ color: 'var(--gold2)' }}>4,200,000</strong> MIC</span></div>
          <div className="info-row">
            <span className="info-key">Vote Power</span>
            <span className="info-val">
              <strong style={{ color: 'var(--gold2)' }}>18.4%</strong> Constitutional
              <div className="prog-bar"><div className="prog-fill g" style={{ width: '18.4%' }} /></div>
            </span>
          </div>
          <div className="info-row"><span className="info-key">MICE Licenses</span><span className="info-val"><strong>24</strong> Active</span></div>
          <div className="info-row"><span className="info-key">Pending Rewards</span><span className="info-val" style={{ color: 'var(--copper)' }}>+128,400 MIC</span></div>
        </div>
      </div>

      {/* REWARDS */}
      <div className="card" style={{ marginBottom: 0 }}>
        <div className="card-title">Rewards &amp; Incentives</div>
        <div className="g4">
          <div className="stat-box">
            <div className="stat-icon">{'\u{1F48E}'}</div>
            <div className="stat-lbl">MFP Pool Share (Weekly)</div>
            <div className="stat-val g">+84,200</div>
            <div className="stat-delta up">MIC {'\u2191'} +3.2% vs last week</div>
          </div>
          <div className="stat-box">
            <div className="stat-icon">{'\u26CF\uFE0F'}</div>
            <div className="stat-lbl">MICE Mining Reward</div>
            <div className="stat-val g">+44,160</div>
            <div className="stat-delta up">MIC &middot; 24 active nodes</div>
          </div>
          <div className="stat-box">
            <div className="stat-icon">{'\u{1F5F3}\uFE0F'}</div>
            <div className="stat-lbl">DAO Governance Bonus</div>
            <div className="stat-val gold">+12,000</div>
            <div className="stat-delta">MIC &middot; Constitutional tier</div>
          </div>
          <div className="stat-box">
            <div className="stat-icon">{'\u{1F525}'}</div>
            <div className="stat-lbl">Total Burned This Month</div>
            <div className="stat-val c">-2.1M</div>
            <div className="stat-delta">MIC burned from MICE purchases</div>
          </div>
        </div>
      </div>
    </>
  );
}
