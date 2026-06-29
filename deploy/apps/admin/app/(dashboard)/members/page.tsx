'use client';

import { useEffect, useState, useCallback } from 'react';
import { fetchMembers, updateMemberKyc, updateMemberRole } from '@/lib/api';
import { useMcUi } from '@/components/ui/McUi';
import { isOwnerWallet, OwnerCrown } from '@/lib/auth';
import ExportButton from '@/components/ExportButton';

interface Member {
  id: string;
  userId: string;
  wallet: string;
  role: string;
  kycStatus: string;
  gvRank: string;
  totalGV: string;
  mfpCount: number;
  seedPurchased: boolean;
  preSalePurchased: boolean;
  createdAt: string;
  isActive?: boolean;
}

const KYC_COLORS: Record<string, string> = {
  none: '#666',
  pending: '#f0ad4e',
  approved: '#5cb85c',
  rejected: '#d9534f',
};

const ROLE_COLORS: Record<string, string> = {
  USER: '#888',
  BELIEVER: '#888',
  AGENT: '#5bc0de',
  ADMIN: '#C9A84C',
};

const SZ = '0.62rem';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

const fmt = (n: number) => (!n || isNaN(n)) ? '-' : n.toLocaleString();

export default function MembersPage() {
  const mcUi = useMcUi();
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [kycFilter, setKycFilter] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [currentUserWallet, setCurrentUserWallet] = useState<string>('');

  useEffect(() => {
    try {
      const jwt = localStorage.getItem('mc-admin-jwt');
      if (jwt) {
        const payload = JSON.parse(atob(jwt.split('.')[1] || ''));
        setCurrentUserWallet(payload?.wallet || '');
      }
    } catch { /* ignore */ }
  }, []);

  const isOwner = isOwnerWallet(currentUserWallet);

  const loadMembers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchMembers({
        page, limit: 20, search: search || undefined,
        role: roleFilter || undefined, kycStatus: kycFilter || undefined,
      });
      const list: Member[] = res.data || [];
      // Hide owner rows from non-owner viewers
      setMembers(isOwner ? list : list.filter((m) => !isOwnerWallet(m.wallet)));
      setTotal(res.pagination?.total || 0);
    } catch (err) {
      console.error('Failed to load members', err);
    } finally {
      setLoading(false);
    }
  }, [page, search, roleFilter, kycFilter, isOwner]);

  useEffect(() => { loadMembers(); }, [loadMembers]);

  const handleToggleStatus = async (wallet: string, enable: boolean) => {
    const action = enable ? 'Activate' : 'Deactivate';
    if (!confirm(`${action} this member?`)) return;
    try {
      const jwt = typeof window !== 'undefined' ? localStorage.getItem('mc-admin-jwt') : null;
      await fetch(`${API_BASE}/admin/users/${wallet}/kyc`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
        },
        body: JSON.stringify({ kycStatus: enable ? 'approved' : 'rejected' }),
      });
      await loadMembers();
    } catch (err: any) {
      mcUi.toast({ type: 'error', message: `${action} failed: ` + (err.message || 'Unknown error') });
    }
  };

  const handleSearch = () => {
    setSearch(searchInput);
    setPage(1);
  };



  return (
    <>
      <div className="page-hd">
        <div>
          <div className="page-eyebrow">Management</div>
          <div className="page-title">Members</div>
          <div className="page-sub">User management, KYC approval, role assignment</div>
          <div style={{
            display: 'inline-block', marginTop: 8, padding: '6px 16px',
            background: 'rgba(201,168,76,0.08)', border: '1px solid rgba(201,168,76,0.2)',
            borderRadius: 8, fontSize: SZ, fontFamily: 'var(--font-m)',
          }}>
            <span style={{ color: 'var(--gray)' }}>Total Members: </span>
            <span style={{ color: 'var(--gold)', fontWeight: 700 }}>{fmt(total)}</span>
          </div>
        </div>
      </div>

      {/* Search + Filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ flex: '1 1 280px', display: 'flex', gap: 6 }}>
          <input
            type="text"
            placeholder="0x... or userId"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(); }}
            style={{
              flex: 1, padding: '5px 10px', borderRadius: 6,
              background: 'var(--card-bg)', color: 'var(--white)',
              border: '1px solid var(--border)', fontSize: SZ,
              fontFamily: 'var(--font-m)',
            }}
          />
          <button className="btn btn-gold btn-sm" style={{ fontSize: SZ, fontFamily: 'var(--font-m)', padding: '5px 12px' }} onClick={handleSearch}>Search</button>
          {search && (
            <button className="btn btn-outline btn-sm" style={{ fontSize: SZ, fontFamily: 'var(--font-m)', padding: '5px 10px' }} onClick={() => { setSearch(''); setSearchInput(''); setPage(1); }}>Clear</button>
          )}
        </div>

        <select value={roleFilter} onChange={(e) => { setRoleFilter(e.target.value); setPage(1); }}
          style={{ padding: '5px 10px', borderRadius: 6, background: 'var(--card-bg)', color: 'var(--white)', border: '1px solid var(--border)', fontSize: SZ, fontFamily: 'var(--font-m)' }}>
          <option value="">All Roles</option>
          <option value="USER">USER</option>
          <option value="AGENT">AGENT</option>
          <option value="ADMIN">ADMIN</option>
        </select>

        <select value={kycFilter} onChange={(e) => { setKycFilter(e.target.value); setPage(1); }}
          style={{ padding: '5px 10px', borderRadius: 6, background: 'var(--card-bg)', color: 'var(--white)', border: '1px solid var(--border)', fontSize: SZ, fontFamily: 'var(--font-m)' }}>
          <option value="">All Status</option>
          <option value="none">None</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </select>

        <div style={{ marginLeft: 'auto' }}>
          <ExportButton
            endpoint="/admin/users/export"
            query={{ search, kycStatus: kycFilter, role: roleFilter }}
            fallbackFilename="members.xlsx"
            disabled={loading}
          />
        </div>
      </div>

      {/* Members table */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="tbl-wrap">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={thStyle}>User ID</th>
                <th style={thStyle}>Wallet</th>
                <th style={thStyle}>Role</th>
                <th style={thStyle}>KYC</th>
                <th style={thStyle}>GV Rank</th>
                <th style={thStyle}>MFP</th>
                <th style={thStyle}>Joined</th>
                <th style={{ ...thStyle, textAlign: 'center' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} style={{ padding: 20, textAlign: 'center', color: 'var(--muted)', fontSize: SZ }}>Loading...</td></tr>
              ) : members.length === 0 ? (
                <tr><td colSpan={8} style={{ padding: 20, textAlign: 'center', color: 'var(--muted)', fontSize: SZ }}>No members found</td></tr>
              ) : members.map((m) => {
                const isActive = m.kycStatus !== 'rejected';
                return (
                  <tr key={m.id} style={{ borderBottom: '1px solid var(--border)', opacity: isActive ? 1 : 0.5 }}>
                    <td style={tdStyle}>{m.userId}</td>
                    <td style={{ ...tdStyle, fontFamily: 'var(--font-m)', textAlign: 'left' }}>
                      <span
                        title="Click to copy"
                        style={{ color: 'var(--gold)', cursor: 'pointer', wordBreak: 'break-all', lineHeight: 1.3 }}
                        onClick={() => { navigator.clipboard.writeText(m.wallet); }}
                      >
                        {m.wallet}
                      </span>
                    </td>
                    <td style={tdStyle}>
                      <span style={{
                        padding: '1px 6px', borderRadius: 4, fontWeight: 700,
                        fontSize: SZ,
                        color: ROLE_COLORS[m.role] || '#fff',
                        background: `${ROLE_COLORS[m.role] || '#666'}18`,
                        border: `1px solid ${ROLE_COLORS[m.role] || '#666'}40`,
                        textTransform: 'uppercase', letterSpacing: '0.04em',
                      }}>
                        {m.role}
                        <OwnerCrown wallet={m.wallet} />
                      </span>
                    </td>
                    <td style={tdStyle}>
                      <span style={{
                        padding: '1px 6px', borderRadius: 10, fontWeight: 600,
                        fontSize: SZ,
                        color: KYC_COLORS[m.kycStatus] || '#999',
                        background: `${KYC_COLORS[m.kycStatus] || '#999'}18`,
                      }}>
                        {m.kycStatus}
                      </span>
                    </td>
                    <td style={tdStyle}>{m.gvRank}</td>
                    <td style={{ ...tdStyle, color: m.mfpCount > 0 ? 'var(--gold)' : 'var(--muted)' }}>{fmt(m.mfpCount)}</td>
                    <td style={{ ...tdStyle, color: 'var(--muted)' }}>{new Date(m.createdAt).toLocaleDateString()}</td>
                    <td style={{ ...tdStyle, textAlign: 'center' }}>
                      <div style={{ display: 'inline-flex', borderRadius: 6, overflow: 'hidden', border: '1px solid var(--border)' }}>
                        <button
                          onClick={() => { if (!isActive) handleToggleStatus(m.wallet, true); }}
                          style={{
                            padding: '3px 10px', border: 'none', cursor: isActive ? 'default' : 'pointer',
                            fontSize: SZ, fontWeight: 700, fontFamily: 'var(--font-m)',
                            background: isActive ? 'rgba(92,184,92,0.25)' : 'transparent',
                            color: isActive ? '#5cb85c' : 'var(--muted)',
                          }}
                        >
                          Active
                        </button>
                        <button
                          onClick={() => { if (isActive) handleToggleStatus(m.wallet, false); }}
                          style={{
                            padding: '3px 10px', border: 'none', cursor: isActive ? 'pointer' : 'default',
                            fontSize: SZ, fontWeight: 700, fontFamily: 'var(--font-m)',
                            background: !isActive ? 'rgba(217,83,79,0.25)' : 'transparent',
                            color: !isActive ? '#d9534f' : 'var(--muted)',
                            borderLeft: '1px solid var(--border)',
                          }}
                        >
                          Inactive
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div style={{ padding: '10px 16px', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: SZ, fontFamily: 'var(--font-m)', color: 'var(--gray)' }}>Showing {members.length.toLocaleString()} of {total.toLocaleString()}</span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn btn-outline btn-sm" style={{ fontSize: SZ, fontFamily: 'var(--font-m)', padding: '4px 10px' }} onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>{'\u2190'} Prev</button>
            <span style={{ lineHeight: '24px', fontSize: SZ, fontFamily: 'var(--font-m)', color: 'var(--gray)' }}>Page {page}</span>
            <button className="btn btn-outline btn-sm" style={{ fontSize: SZ, fontFamily: 'var(--font-m)', padding: '4px 10px' }} onClick={() => setPage(p => p + 1)} disabled={members.length < 20}>Next {'\u2192'}</button>
          </div>
        </div>
      </div>
    </>
  );
}

const thStyle: React.CSSProperties = {
  padding: '8px 10px',
  textAlign: 'left',
  color: 'var(--gray)',
  fontWeight: 600,
  fontSize: '0.58rem',
  fontFamily: 'var(--font-m)',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  borderBottom: '1px solid var(--border)',
  whiteSpace: 'nowrap',
};

const tdStyle: React.CSSProperties = {
  padding: '7px 10px',
  color: 'var(--white)',
  fontSize: '0.62rem',
  fontFamily: 'var(--font-m)',
};
