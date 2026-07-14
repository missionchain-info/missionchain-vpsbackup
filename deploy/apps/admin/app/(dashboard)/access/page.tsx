'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { fetchAdminAccess, grantAdminAccess, updateAdminLevel, revokeAdminAccess } from '@/lib/api';
import { useAuth, isOwnerWallet, OwnerCrown } from '@/lib/auth';
// MFP-NFT royalty + grant-mint moved to /components → MFP-NFT tab (Apr 27, 2026)

interface AdminUser {
  wallet: string;
  userId: string;
  role: string;
  adminLevel: string;
  email?: string | null;
  kycStatus: string;
  createdAt: string;
  updatedAt: string;
}

const SZ = '0.62rem';

const thSt = {
  padding: '8px 10px', textAlign: 'left' as const, color: 'var(--gray)',
  fontWeight: 600, fontSize: '0.58rem', fontFamily: 'var(--font-d)',
  letterSpacing: '0.08em', textTransform: 'uppercase' as const,
};

const LEVELS = [
  { value: 'OBSERVER',  label: 'Observer',  badge: 'b-gray',   desc: 'Read-only access. View dashboard, members, distributors, sales rounds, audit logs, mining/staking stats. Cannot edit, cannot export.' },
  { value: 'ANALYST',   label: 'Analyst',   badge: 'b-purple', desc: 'Observer + member profile detail (KYC, transactions), CSV/PDF export, advanced filters, full audit log access. Cannot edit anything.' },
  { value: 'OPERATOR',  label: 'Operator',  badge: 'b-cyan',   desc: 'Analyst + edit member profiles, manage distributors, approve/reject payment requests, edit round sales config, create old-investor grant requests.' },
  { value: 'GOVERNOR',  label: 'Governor',  badge: 'b-gold',   desc: 'Operator + system config (CORS, rate limits), mining/staking config, NFT/MFP grants config, treasury withdraw (with timelock).' },
];

const shortWallet = (w: string) => w.length > 12 ? `${w.slice(0, 6)}...${w.slice(-4)}` : w;

export default function AdminAccessPage() {
  const { user } = useAuth();
  const router = useRouter();

  // Gate: owner-wallet only — Grant Admin / Revoke / Update level
  useEffect(() => {
    if (user && !isOwnerWallet(user.wallet)) {
      router.replace('/stats');
    }
  }, [user, router]);

  const [admins, setAdmins] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);

  // Grant form
  const [showGrant, setShowGrant] = useState(false);
  const [grantForm, setGrantForm] = useState({ wallet: '', adminLevel: 'OBSERVER' });
  const [granting, setGranting] = useState(false);

  // Edit
  const [editWallet, setEditWallet] = useState<string | null>(null);
  const [editLevel, setEditLevel] = useState('OBSERVER');
  const [editSaving, setEditSaving] = useState(false);

  // Revoke
  const [revokeTarget, setRevokeTarget] = useState<AdminUser | null>(null);
  const [revoking, setRevoking] = useState(false);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const loadAdmins = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchAdminAccess();
      if (res?.data) setAdmins(res.data);
    } catch (err: any) {
      console.error('Failed to load admin access', err);
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadAdmins(); }, [loadAdmins]);

  /* ─── GRANT ─── */
  const handleGrant = async () => {
    if (!grantForm.wallet) {
      showToast('Wallet address is required');
      return;
    }
    setGranting(true);
    try {
      await grantAdminAccess({ wallet: grantForm.wallet, adminLevel: grantForm.adminLevel });
      showToast('Admin access granted');
      setShowGrant(false);
      setGrantForm({ wallet: '', adminLevel: 'OBSERVER' });
      loadAdmins();
    } catch (err: any) {
      showToast('Error: ' + (err.message || 'Failed'));
    }
    setGranting(false);
  };

  /* ─── UPDATE LEVEL ─── */
  const handleUpdateLevel = async () => {
    if (!editWallet) return;
    setEditSaving(true);
    try {
      await updateAdminLevel(editWallet, { adminLevel: editLevel });
      showToast('Permission level updated');
      setEditWallet(null);
      loadAdmins();
    } catch (err: any) {
      showToast('Error: ' + (err.message || 'Failed'));
    }
    setEditSaving(false);
  };

  /* ─── REVOKE ─── */
  const handleRevoke = async () => {
    if (!revokeTarget) return;
    setRevoking(true);
    try {
      await revokeAdminAccess(revokeTarget.wallet);
      showToast(`Admin access revoked for ${revokeTarget.userId}`);
      setRevokeTarget(null);
      loadAdmins();
    } catch (err: any) {
      showToast('Error: ' + (err.message || 'Failed'));
    }
    setRevoking(false);
  };

  const getLevelInfo = (level: string) => LEVELS.find(l => l.value === level) || LEVELS[2];

  return (
    <>
      {/* Toast */}
      {toast && (
        <div className="alert alert-info" style={{
          position: 'fixed', top: 20, right: 20, zIndex: 9999,
          marginBottom: 0, boxShadow: '0 4px 20px rgba(0,0,0,.4)',
        }}>
          {toast}
        </div>
      )}

      {/* Revoke Confirm Modal */}
      {revokeTarget && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', zIndex: 9998,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }} onClick={() => setRevokeTarget(null)}>
          <div className="card" style={{ width: 440 }} onClick={e => e.stopPropagation()}>
            <div className="card-title" style={{ color: 'var(--crimson2)' }}>Revoke Admin Access</div>
            <p style={{ fontSize: SZ, color: 'var(--gray)', lineHeight: 1.7, marginBottom: 16 }}>
              Revoke admin access for <strong style={{ color: 'var(--white)' }}>{revokeTarget.userId}</strong> ({shortWallet(revokeTarget.wallet)})?
              <br />Their role will be changed back to <strong style={{ color: 'var(--white)' }}>USER</strong>. They can no longer access the admin panel.
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-outline btn-sm" onClick={() => setRevokeTarget(null)}>Cancel</button>
              <button className="btn btn-sm" style={{ background: 'var(--crimson)', color: '#fff' }} onClick={handleRevoke} disabled={revoking}>
                {revoking ? 'Revoking...' : 'Revoke Access'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Level Modal */}
      {editWallet && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', zIndex: 9998,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }} onClick={() => setEditWallet(null)}>
          <div className="card" style={{ width: 480 }} onClick={e => e.stopPropagation()}>
            <div className="card-title">Change Permission Level</div>
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontFamily: 'var(--font-m)', fontSize: '0.58rem', color: 'var(--gray2)', marginBottom: 4, letterSpacing: '0.08em', textTransform: 'uppercase' as const }}>WALLET</div>
              <div style={{ fontFamily: 'var(--font-m)', fontSize: SZ, color: 'var(--gold)' }}>{editWallet}</div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
              {LEVELS.map(lv => (
                <label key={lv.value} style={{
                  display: 'flex', alignItems: 'flex-start', gap: 12, padding: '12px 14px',
                  borderRadius: 10, cursor: 'pointer',
                  background: editLevel === lv.value ? 'rgba(123,45,139,.1)' : 'var(--bg4)',
                  border: editLevel === lv.value ? '1px solid var(--purple)' : '1px solid var(--border)',
                  transition: 'all .2s',
                }}>
                  <input
                    type="radio" name="level" value={lv.value}
                    checked={editLevel === lv.value}
                    onChange={() => setEditLevel(lv.value)}
                    style={{ marginTop: 2 }}
                  />
                  <div>
                    <div style={{ fontFamily: 'var(--font-d)', fontSize: SZ, fontWeight: 700, color: 'var(--white)', marginBottom: 2 }}>
                      {lv.label}
                    </div>
                    <div style={{ fontSize: SZ, color: 'var(--gray2)', lineHeight: 1.5 }}>{lv.desc}</div>
                  </div>
                </label>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-outline btn-sm" onClick={() => setEditWallet(null)}>Cancel</button>
              <button className="btn btn-gold btn-sm" onClick={handleUpdateLevel} disabled={editSaving}>
                {editSaving ? 'Saving...' : 'Update Level'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ PAGE HEADER ═══ */}
      <div className="page-hd">
        <div>
          <div className="page-eyebrow">Settings</div>
          <div className="page-title">Admin Access</div>
          <div className="page-sub">Manage who can access the Admin panel and their permission level</div>
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => setShowGrant(!showGrant)}>
          + Grant Access
        </button>
      </div>

      <div style={{
        padding: '10px 16px', marginBottom: 16, borderRadius: 8,
        background: 'rgba(240,173,78,0.08)', border: '1px solid rgba(240,173,78,0.25)',
        fontSize: '0.78rem', lineHeight: 1.6, color: 'var(--gold)',
      }}>
        {'\u26A0\uFE0F'} Only <strong>OWNER</strong> can grant, modify, or revoke admin access. OWNER accounts cannot be revoked from this panel.
      </div>

      {/* ═══ PERMISSION LEVELS LEGEND ═══ */}
      <div className="g3" style={{ marginBottom: 20 }}>
        {LEVELS.map(lv => (
          <div key={lv.value} className="card" style={{ padding: '14px 18px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span className={`badge ${lv.badge}`} style={{ fontSize: '0.52rem' }}>{lv.label}</span>
            </div>
            <div style={{ fontSize: SZ, color: 'var(--gray)', lineHeight: 1.5 }}>{lv.desc}</div>
          </div>
        ))}
      </div>

      {/* ═══ GRANT ACCESS FORM ═══ */}
      {showGrant && (
        <div className="card card-g" style={{ marginBottom: 16 }}>
          <div className="card-title">Grant Admin Access <span className="badge b-gold" style={{ marginLeft: 8 }}>Owner Only</span></div>
          <div className="g2">
            <div className="input-wrap">
              <div className="input-label">Wallet Address</div>
              <input
                type="text" placeholder="0x... (must be a registered user)"
                value={grantForm.wallet}
                onChange={e => setGrantForm(p => ({ ...p, wallet: e.target.value }))}
              />
            </div>
            <div className="input-wrap">
              <div className="input-label">Permission Level</div>
              <select value={grantForm.adminLevel} onChange={e => setGrantForm(p => ({ ...p, adminLevel: e.target.value }))}>
                {LEVELS.map(lv => (
                  <option key={lv.value} value={lv.value}>{lv.label}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="alert alert-warn" style={{ marginBottom: 12 }}>
            {'\u26A0\uFE0F'} The wallet must belong to a registered user. The user&apos;s role will be changed to ADMIN.
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary" onClick={handleGrant} disabled={granting}>
              {granting ? 'Granting...' : 'Grant Access'}
            </button>
            <button className="btn btn-outline" onClick={() => setShowGrant(false)}>Cancel</button>
          </div>
        </div>
      )}

      {/* ═══ ADMIN LIST ═══ */}
      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)' }}>
          <div className="card-title" style={{ margin: 0 }}>Admin Users ({admins.length})</div>
        </div>

        {loading ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--gray2)' }}>Loading...</div>
        ) : admins.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--gray2)', fontFamily: 'var(--font-m)', fontSize: SZ }}>
            No admin users found.
          </div>
        ) : (
          <div className="tbl-wrap">
            <table>
              <thead>
                <tr>
                  <th style={thSt}>User ID</th>
                  <th style={thSt}>Wallet</th>
                  <th style={thSt}>Role</th>
                  <th style={thSt}>Permission Level</th>
                  <th style={thSt}>KYC</th>
                  <th style={thSt}>Added</th>
                  <th style={thSt}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {admins
                  .filter(a => isOwnerWallet(user?.wallet) || !isOwnerWallet(a.wallet))
                  .map(a => {
                  const lvInfo = getLevelInfo(a.adminLevel);
                  const isOwnerRow = isOwnerWallet(a.wallet);
                  return (
                    <tr key={a.wallet}>
                      <td>
                        <strong style={{ color: 'var(--white)' }}>{a.userId}</strong>
                        {a.email && <div style={{ fontSize: SZ, color: 'var(--gray2)' }}>{a.email}</div>}
                      </td>
                      <td style={{ fontFamily: 'var(--font-m)', fontSize: SZ, color: 'var(--gold)' }}>
                        {shortWallet(a.wallet)}
                        <OwnerCrown wallet={a.wallet} />
                      </td>
                      <td>
                        <span className="badge b-purple" style={{ fontSize: 8 }}>ADMIN</span>
                      </td>
                      <td>
                        {isOwnerRow ? (
                          <span className="badge b-gold" style={{ fontSize: 8 }}>FULL</span>
                        ) : (
                          <span className={`badge ${lvInfo.badge}`} style={{ fontSize: 8 }}>{lvInfo.label}</span>
                        )}
                      </td>
                      <td>
                        <span className={`badge ${a.kycStatus === 'fully_verified' ? 'b-active' : a.kycStatus === 'none' ? 'b-gray' : 'b-warn'}`} style={{ fontSize: 8 }}>
                          {a.kycStatus}
                        </span>
                      </td>
                      <td style={{ fontSize: SZ, color: 'var(--gray2)', fontFamily: 'var(--font-m)' }}>
                        {new Date(a.createdAt).toLocaleDateString()}
                      </td>
                      <td>
                        {isOwnerRow ? (
                          <span style={{ fontSize: SZ, color: 'var(--gray2)', fontFamily: 'var(--font-m)' }}>Protected</span>
                        ) : (
                          <div style={{ display: 'flex', gap: 4 }}>
                            <button
                              className="btn btn-outline btn-sm"
                              style={{ fontSize: SZ }}
                              onClick={() => { setEditWallet(a.wallet); setEditLevel(a.adminLevel); }}
                            >
                              Change Level
                            </button>
                            <button
                              className="btn btn-outline btn-sm"
                              style={{ fontSize: SZ, color: 'var(--crimson2)', borderColor: 'rgba(107,20,40,.3)' }}
                              onClick={() => setRevokeTarget(a)}
                            >
                              Revoke
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* MFP-NFT Royalty + Grant Mint Allocation moved to /components → MFP-NFT tab */}
    </>
  );
}
