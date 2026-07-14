'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  fetchStewardCouncil,
  addStewardCouncilMember,
  updateStewardCouncilMember,
  deleteStewardCouncilMember,
  searchUserForCouncil,
  type StewardCouncilMember,
} from '@/lib/api';
import { useAuth, isOwnerWallet, OwnerCrown } from '@/lib/auth';
import { useMcUi } from '@/components/ui/McUi';

const SZ = '0.62rem';

const thSt = {
  padding: '8px 10px', textAlign: 'left' as const, color: 'var(--gray)',
  fontWeight: 600, fontSize: '0.58rem', fontFamily: 'var(--font-d)',
  letterSpacing: '0.08em', textTransform: 'uppercase' as const,
};

const tdSt = {
  padding: '10px', fontSize: SZ, color: 'var(--white)',
  borderTop: '1px solid var(--border)',
};

const shortWallet = (w: string) => (w.length > 12 ? `${w.slice(0, 6)}...${w.slice(-4)}` : w);

export default function StewardCouncilPage() {
  const { user } = useAuth();
  const mcUi = useMcUi();
  const isOwner = isOwnerWallet(user?.wallet);

  const [members, setMembers] = useState<StewardCouncilMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingWallet, setEditingWallet] = useState<string | null>(null);

  const [addForm, setAddForm] = useState({
    memberId: '', wallet: '', role: '', rightLabel: 'Admin', note: '',
  });
  const [userSearch, setUserSearch] = useState('');
  const [searchResults, setSearchResults] = useState<Array<{ userId: string; wallet: string; kycStatus: string }>>([]);
  const [searchingUser, setSearchingUser] = useState(false);
  const [editForm, setEditForm] = useState({
    role: '', rightLabel: '', note: '', active: true,
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchStewardCouncil();
      setMembers(res.data || []);
    } catch (err: any) {
      console.error('Failed to load council', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleAdd = async () => {
    if (!addForm.memberId || !addForm.wallet || !addForm.role) {
      mcUi.toast({ type: 'error', message: 'Pick a registered user and fill Role' });
      return;
    }
    if (!/^0x[a-fA-F0-9]{40}$/.test(addForm.wallet)) {
      mcUi.toast({ type: 'error', message: 'Invalid wallet address' });
      return;
    }
    try {
      await addStewardCouncilMember(addForm);
      mcUi.toast({ type: 'success', message: 'Member added' });
      setShowAddForm(false);
      setAddForm({ memberId: '', wallet: '', role: '', rightLabel: 'Admin', note: '' });
      setUserSearch('');
      setSearchResults([]);
      await load();
    } catch (err: any) {
      mcUi.toast({ type: 'error', message: err.message || 'Failed to add' });
    }
  };

  // Debounced user search
  useEffect(() => {
    if (!userSearch || userSearch.length < 2) {
      setSearchResults([]);
      return;
    }
    setSearchingUser(true);
    const t = setTimeout(async () => {
      try {
        const res = await searchUserForCouncil(userSearch);
        setSearchResults(res.data || []);
      } catch (err) {
        setSearchResults([]);
      } finally {
        setSearchingUser(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [userSearch]);

  const pickUser = (u: { userId: string; wallet: string }) => {
    setAddForm({ ...addForm, memberId: u.userId, wallet: u.wallet });
    setUserSearch(`${u.userId} (${u.wallet.slice(0, 6)}...${u.wallet.slice(-4)})`);
    setSearchResults([]);
  };

  const handleEdit = async () => {
    if (!editingWallet) return;
    try {
      await updateStewardCouncilMember(editingWallet, editForm);
      mcUi.toast({ type: 'success', message: 'Member updated' });
      setEditingWallet(null);
      await load();
    } catch (err: any) {
      mcUi.toast({ type: 'error', message: err.message || 'Failed to update' });
    }
  };

  const handleDelete = async (wallet: string, memberId: string) => {
    const ok = await mcUi.confirm({
      title: 'Remove Council Member',
      message: <>Remove <b>{memberId}</b> ({shortWallet(wallet)}) from Steward Council? Their pool allocations (if any) will also be removed.</>,
      confirmLabel: 'Remove',
      cancelLabel: 'Cancel',
    });
    if (!ok) return;
    try {
      await deleteStewardCouncilMember(wallet);
      mcUi.toast({ type: 'success', message: 'Member removed' });
      await load();
    } catch (err: any) {
      mcUi.toast({ type: 'error', message: err.message || 'Failed to remove' });
    }
  };

  const startEdit = (m: StewardCouncilMember) => {
    setEditingWallet(m.wallet);
    setEditForm({
      role: m.role,
      rightLabel: m.rightLabel,
      note: m.note ?? '',
      active: m.active,
    });
  };

  return (
    <>
      <div className="page-hd">
        <div>
          <div className="page-eyebrow">Governance</div>
          <div className="page-title">Steward Council</div>
          <div className="page-sub">
            Master council member registry. {isOwner ? 'Owner can Add / Edit / Delete members.' : 'View-only.'}
          </div>
          <div style={{ fontSize: '0.55rem', color: 'var(--gray2)', marginTop: 6 }}>
            Phase 1 voting: 1 member = 1 vote. MFP-NFT weighted voting deferred to DAO phase.
          </div>
        </div>
        {isOwner && (
          <div>
            <button
              className="btn btn-gold btn-sm"
              style={{ fontSize: SZ, padding: '6px 14px' }}
              onClick={() => setShowAddForm(!showAddForm)}
            >
              {showAddForm ? 'Cancel' : '+ ADD MEMBER'}
            </button>
          </div>
        )}
      </div>

      {/* Add form */}
      {isOwner && showAddForm && (
        <div className="card" style={{ marginBottom: 16, padding: 16 }}>
          <div style={{ fontFamily: 'var(--font-d)', fontSize: '0.7rem', color: 'var(--gold)', marginBottom: 12 }}>
            ADD COUNCIL MEMBER
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div style={{ gridColumn: '1 / -1', position: 'relative' }}>
              <div style={thSt}>Search Registered User (by ID or wallet)</div>
              <input
                type="text"
                value={userSearch}
                onChange={(e) => {
                  setUserSearch(e.target.value);
                  if (addForm.memberId) setAddForm({ ...addForm, memberId: '', wallet: '' });
                }}
                placeholder="Type at least 2 characters..."
                style={inputSt}
              />
              {searchResults.length > 0 && (
                <div style={{
                  position: 'absolute', top: '100%', left: 0, right: 0,
                  background: 'var(--card-bg)', border: '1px solid var(--border)',
                  borderRadius: 6, maxHeight: 240, overflowY: 'auto', zIndex: 10,
                }}>
                  {searchResults.map((u) => (
                    <div
                      key={u.wallet}
                      onClick={() => pickUser(u)}
                      style={{
                        padding: '8px 12px', cursor: 'pointer',
                        borderBottom: '1px solid var(--border)',
                        fontSize: '0.65rem',
                      }}
                    >
                      <strong style={{ color: 'var(--white)' }}>{u.userId}</strong>
                      <span style={{ marginLeft: 8, color: 'var(--gold)', fontFamily: 'var(--font-m)' }}>
                        {u.wallet.slice(0, 6)}...{u.wallet.slice(-4)}
                      </span>
                      <span style={{
                        marginLeft: 8, fontSize: '0.55rem', padding: '1px 6px', borderRadius: 8,
                        background: u.kycStatus === 'approved' ? 'rgba(76,175,80,0.15)' : 'rgba(120,120,120,0.15)',
                        color: u.kycStatus === 'approved' ? '#4CAF50' : 'var(--gray2)',
                      }}>
                        {u.kycStatus}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {userSearch && !searchingUser && searchResults.length === 0 && userSearch.length >= 2 && !addForm.memberId && (
                <div style={{ marginTop: 6, fontSize: '0.6rem', color: 'var(--gray2)' }}>
                  No registered user matched. User must complete sign-up flow first.
                </div>
              )}
              {addForm.memberId && (
                <div style={{ marginTop: 6, fontSize: '0.6rem', color: 'var(--green)' }}>
                  ✓ Selected: {addForm.memberId} ({addForm.wallet.slice(0, 6)}...{addForm.wallet.slice(-4)})
                </div>
              )}
            </div>
            <div>
              <div style={thSt}>Role</div>
              <input
                type="text"
                value={addForm.role}
                onChange={(e) => setAddForm({ ...addForm, role: e.target.value })}
                placeholder="e.g. Founder, CTO"
                style={inputSt}
              />
            </div>
            <div>
              <div style={thSt}>Right (display)</div>
              <input
                type="text"
                value={addForm.rightLabel}
                onChange={(e) => setAddForm({ ...addForm, rightLabel: e.target.value })}
                style={inputSt}
              />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <div style={thSt}>Note</div>
              <input
                type="text"
                value={addForm.note}
                onChange={(e) => setAddForm({ ...addForm, note: e.target.value })}
                placeholder="Optional notes"
                style={inputSt}
              />
            </div>
          </div>
          <div style={{ marginTop: 14, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn btn-outline btn-sm" style={{ fontSize: SZ }} onClick={() => setShowAddForm(false)}>Cancel</button>
            <button className="btn btn-gold btn-sm" style={{ fontSize: SZ }} onClick={handleAdd}>Add Member</button>
          </div>
        </div>
      )}

      {/* List */}
      <div className="card" style={{ padding: 0 }}>
        <div className="tbl-wrap">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={thSt}>Member ID</th>
                <th style={thSt}>Wallet</th>
                <th style={thSt}>Role</th>
                <th style={thSt}>Right</th>
                <th style={thSt}>Note</th>
                <th style={thSt}>Status</th>
                {isOwner && <th style={{ ...thSt, textAlign: 'right' }}>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={isOwner ? 7 : 6} style={{ padding: 20, textAlign: 'center', color: 'var(--muted)', fontSize: SZ }}>Loading...</td></tr>
              ) : members.length === 0 ? (
                <tr><td colSpan={isOwner ? 7 : 6} style={{ padding: 20, textAlign: 'center', color: 'var(--muted)', fontSize: SZ }}>No council members yet.</td></tr>
              ) : members.map((m) => (
                <tr key={m.wallet}>
                  <td style={tdSt}>
                    <strong style={{ color: 'var(--white)' }}>{m.memberId}</strong>
                  </td>
                  <td style={{ ...tdSt, fontFamily: 'var(--font-m)', color: 'var(--gold)' }}>
                    {shortWallet(m.wallet)}
                    <OwnerCrown wallet={m.wallet} />
                  </td>
                  <td style={tdSt}>
                    {editingWallet === m.wallet ? (
                      <input value={editForm.role} onChange={(e) => setEditForm({ ...editForm, role: e.target.value })} style={inputSt} />
                    ) : m.role}
                  </td>
                  <td style={tdSt}>
                    {editingWallet === m.wallet ? (
                      <input value={editForm.rightLabel} onChange={(e) => setEditForm({ ...editForm, rightLabel: e.target.value })} style={inputSt} />
                    ) : (
                      <span className="badge b-purple" style={{ fontSize: 8 }}>{m.rightLabel}</span>
                    )}
                  </td>
                  <td style={tdSt}>
                    {editingWallet === m.wallet ? (
                      <input value={editForm.note} onChange={(e) => setEditForm({ ...editForm, note: e.target.value })} style={inputSt} />
                    ) : (m.note || '—')}
                  </td>
                  <td style={tdSt}>
                    {editingWallet === m.wallet ? (
                      <select
                        value={editForm.active ? '1' : '0'}
                        onChange={(e) => setEditForm({ ...editForm, active: e.target.value === '1' })}
                        style={inputSt}
                      >
                        <option value="1">Active</option>
                        <option value="0">Inactive</option>
                      </select>
                    ) : (
                      <span className={`badge ${m.active ? 'b-active' : 'b-gray'}`} style={{ fontSize: 8 }}>
                        {m.active ? 'Active' : 'Inactive'}
                      </span>
                    )}
                  </td>
                  {isOwner && (
                    <td style={{ ...tdSt, textAlign: 'right' }}>
                      {editingWallet === m.wallet ? (
                        <>
                          <button className="btn btn-gold btn-sm" style={{ fontSize: SZ, marginRight: 4 }} onClick={handleEdit}>Save</button>
                          <button className="btn btn-outline btn-sm" style={{ fontSize: SZ }} onClick={() => setEditingWallet(null)}>Cancel</button>
                        </>
                      ) : (
                        <>
                          <button className="btn btn-outline btn-sm" style={{ fontSize: SZ, marginRight: 4 }} onClick={() => startEdit(m)}>Edit</button>
                          <button className="btn btn-outline btn-sm" style={{ fontSize: SZ, color: 'var(--crimson2)', borderColor: 'rgba(107,20,40,.3)' }} onClick={() => handleDelete(m.wallet, m.memberId)}>Remove</button>
                        </>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

const inputSt = {
  width: '100%',
  padding: '6px 10px',
  background: 'var(--card-bg)',
  color: 'var(--white)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  fontSize: '0.7rem',
  fontFamily: 'var(--font-m)',
};
