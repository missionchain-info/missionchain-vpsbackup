'use client';

import { useState, useEffect, useCallback } from 'react';
import { fetchDAOBoard, addDAOMember, updateDAOMember, deleteDAOMember } from '@/lib/api';

interface BoardMember {
  id: string;
  wallet: string;
  username: string;
  role: string;
  votePower: string;
  benefitRate: string;
  benefitCap: string;
  status: string;
  email?: string | null;
  telegram?: string | null;
  notes?: string | null;
}

const SZ = '0.62rem';

const fmt = (n: number) => (!n || isNaN(n)) ? '-' : n.toLocaleString();

const thSt = {
  padding: '8px 10px', textAlign: 'left' as const, color: 'var(--gray)',
  fontWeight: 600, fontSize: '0.58rem', fontFamily: 'var(--font-d)',
  letterSpacing: '0.08em', textTransform: 'uppercase' as const,
};
const tdSt = { padding: '7px 10px', color: 'var(--white)', fontSize: SZ };

const VALID_ROLES = ['OWNER', 'ADMIN', 'SENATOR', 'COUNCIL', 'GUARDIAN'] as const;

const ROLE_BADGE: Record<string, string> = {
  OWNER: 'role-owner', ADMIN: 'b-purple', SENATOR: 'b-copper', COUNCIL: 'b-gray', GUARDIAN: 'b-gray',
};

const ROLE_COLOR: Record<string, string> = {
  OWNER: 'var(--gold2)', ADMIN: 'var(--purple2)', SENATOR: 'var(--copper)', COUNCIL: 'var(--gray)', GUARDIAN: 'var(--gray)',
};

const PERM_MATRIX = [
  { action: 'View DAO Members', guardian: true, council: true, senator: true, admin: true, owner: true, threshold: '-' },
  { action: 'Edit Board Member', guardian: false, council: false, senator: false, admin: true, owner: true, threshold: 'Admin+' },
  { action: 'Add Board Member', guardian: false, council: false, senator: false, admin: false, owner: true, threshold: 'Owner Only' },
  { action: 'Framework Parameter Vote', guardian: false, council: false, senator: 'Advisory', admin: true, owner: true, threshold: '66% + 30% quorum' },
  { action: 'Activate SWAP', guardian: false, council: false, senator: false, admin: true, owner: true, threshold: 'Admin+' },
  { action: 'Grant Bonus / Incentive', guardian: false, council: false, senator: false, admin: true, owner: true, threshold: 'Admin+ / DAO Vote' },
  { action: 'Access NIRA-AI Console', guardian: false, council: false, senator: false, admin: false, owner: true, threshold: 'Owner / Super-Wallet' },
  { action: 'DENOUNCE (transfer authority)', guardian: false, council: false, senator: false, admin: false, owner: true, threshold: 'Owner Only' },
];

const shortWallet = (w: string) => w.length > 12 ? `${w.slice(0, 6)}...${w.slice(-4)}` : w;

export default function DAOPage() {
  const [board, setBoard] = useState<BoardMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);

  // Add form
  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState({ username: '', wallet: '', role: 'GUARDIAN', votePower: '', benefitRate: '', benefitCap: '', notes: '' });
  const [addSaving, setAddSaving] = useState(false);

  // Edit form
  const [editWallet, setEditWallet] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ username: '', role: '', votePower: '', benefitRate: '', benefitCap: '', status: '', notes: '' });
  const [editSaving, setEditSaving] = useState(false);

  // View detail
  const [viewMember, setViewMember] = useState<BoardMember | null>(null);

  // Delete confirm
  const [deleteTarget, setDeleteTarget] = useState<BoardMember | null>(null);
  const [deleting, setDeleting] = useState(false);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const loadBoard = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchDAOBoard();
      if (res?.data) setBoard(res.data);
    } catch (err: any) {
      console.error('Failed to load board', err);
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadBoard(); }, [loadBoard]);

  /* ─── ADD MEMBER ─── */
  const handleAdd = async () => {
    if (!addForm.wallet || !addForm.username) {
      showToast('Wallet and username are required');
      return;
    }
    setAddSaving(true);
    try {
      await addDAOMember({
        wallet: addForm.wallet,
        username: addForm.username,
        role: addForm.role,
        votePower: parseFloat(addForm.votePower) || 0,
        benefitRate: parseFloat(addForm.benefitRate) || 0,
        benefitCap: parseFloat(addForm.benefitCap) || 0,
        notes: addForm.notes || undefined,
      });
      showToast(`${addForm.username} added to Board`);
      setShowAddForm(false);
      setAddForm({ username: '', wallet: '', role: 'GUARDIAN', votePower: '', benefitRate: '', benefitCap: '', notes: '' });
      loadBoard();
    } catch (err: any) {
      showToast('Error: ' + (err.message || 'Failed to add'));
    }
    setAddSaving(false);
  };

  /* ─── EDIT MEMBER ─── */
  const openEdit = (m: BoardMember) => {
    setEditWallet(m.wallet);
    setEditForm({
      username: m.username,
      role: m.role,
      votePower: m.votePower,
      benefitRate: m.benefitRate,
      benefitCap: m.benefitCap,
      status: m.status,
      notes: m.notes || '',
    });
  };

  const handleEdit = async () => {
    if (!editWallet) return;
    setEditSaving(true);
    try {
      await updateDAOMember(editWallet, {
        username: editForm.username,
        role: editForm.role,
        votePower: parseFloat(editForm.votePower) || 0,
        benefitRate: parseFloat(editForm.benefitRate) || 0,
        benefitCap: parseFloat(editForm.benefitCap) || 0,
        status: editForm.status,
        notes: editForm.notes || null,
      });
      showToast('Member updated');
      setEditWallet(null);
      loadBoard();
    } catch (err: any) {
      showToast('Error: ' + (err.message || 'Failed to update'));
    }
    setEditSaving(false);
  };

  /* ─── DELETE MEMBER ─── */
  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteDAOMember(deleteTarget.wallet);
      showToast(`${deleteTarget.username} removed`);
      setDeleteTarget(null);
      loadBoard();
    } catch (err: any) {
      showToast('Error: ' + (err.message || 'Failed to delete'));
    }
    setDeleting(false);
  };

  const owners = board.filter(m => m.role === 'OWNER');
  const totalVP = board.reduce((sum, m) => sum + parseFloat(m.votePower || '0'), 0);

  const renderPerm = (val: boolean | string) => {
    if (val === true) return <span className="badge b-active">{'\u2713'}</span>;
    if (val === false) return <span className="badge b-danger">{'\u2715'}</span>;
    return <span className="badge b-warn">{val}</span>;
  };

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

      {/* View Detail Modal */}
      {viewMember && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', zIndex: 9998,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }} onClick={() => setViewMember(null)}>
          <div className="card" style={{ width: 480, maxHeight: '80vh', overflow: 'auto' }} onClick={e => e.stopPropagation()}>
            <div className="card-title">Member Detail</div>
            <InfoRow label="Username" value={viewMember.username} />
            <InfoRow label="Wallet" value={viewMember.wallet} mono />
            <InfoRow label="Role" value={viewMember.role} />
            <InfoRow label="Vote Power" value={Number(viewMember.votePower) > 0 ? `${viewMember.votePower}%` : "-"} />
            <InfoRow label="Benefit Rate" value={Number(viewMember.benefitRate) > 0 ? `${viewMember.benefitRate}%` : "-"} />
            <InfoRow label="Benefit Cap" value={Number(viewMember.benefitCap) > 0 ? `${Number(viewMember.benefitCap).toLocaleString()} MIC/week` : "-"} />
            <InfoRow label="Status" value={viewMember.status} />
            {viewMember.notes && <InfoRow label="Notes" value={viewMember.notes} />}
            <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
              <button className="btn btn-outline btn-sm" onClick={() => setViewMember(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirm Modal */}
      {deleteTarget && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', zIndex: 9998,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }} onClick={() => setDeleteTarget(null)}>
          <div className="card" style={{ width: 420 }} onClick={e => e.stopPropagation()}>
            <div className="card-title" style={{ color: 'var(--crimson2)' }}>Confirm Removal</div>
            <p style={{ fontSize: SZ, color: 'var(--gray)', lineHeight: 1.7, marginBottom: 16 }}>
              Remove <strong style={{ color: 'var(--white)' }}>{deleteTarget.username}</strong> ({shortWallet(deleteTarget.wallet)}) from the Governing Board?
              <br />This action cannot be undone.
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-outline btn-sm" onClick={() => setDeleteTarget(null)}>Cancel</button>
              <button className="btn btn-sm" style={{ background: 'var(--crimson)', color: '#fff' }} onClick={handleDelete} disabled={deleting}>
                {deleting ? 'Removing...' : 'Remove Member'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {editWallet && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', zIndex: 9998,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }} onClick={() => setEditWallet(null)}>
          <div className="card" style={{ width: 520, maxHeight: '85vh', overflow: 'auto' }} onClick={e => e.stopPropagation()}>
            <div className="card-title">Edit Board Member</div>
            <div className="input-wrap">
              <div className="input-label">Wallet</div>
              <input type="text" value={editWallet} disabled style={{ opacity: 0.5 }} />
            </div>
            <div className="g2">
              <div className="input-wrap">
                <div className="input-label">Username</div>
                <input type="text" value={editForm.username} onChange={e => setEditForm(p => ({ ...p, username: e.target.value }))} />
              </div>
              <div className="input-wrap">
                <div className="input-label">Role</div>
                <select value={editForm.role} onChange={e => setEditForm(p => ({ ...p, role: e.target.value }))}>
                  {VALID_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
            </div>
            <div className="g3">
              <div className="input-wrap">
                <div className="input-label">Vote Power (%)</div>
                <input type="number" step="0.1" value={editForm.votePower} onChange={e => setEditForm(p => ({ ...p, votePower: e.target.value }))} />
              </div>
              <div className="input-wrap">
                <div className="input-label">Benefit Rate (%)</div>
                <input type="number" step="0.1" value={editForm.benefitRate} onChange={e => setEditForm(p => ({ ...p, benefitRate: e.target.value }))} />
              </div>
              <div className="input-wrap">
                <div className="input-label">Benefit Cap (MIC)</div>
                <input type="number" value={editForm.benefitCap} onChange={e => setEditForm(p => ({ ...p, benefitCap: e.target.value }))} />
              </div>
            </div>
            <div className="input-wrap">
              <div className="input-label">Status</div>
              <select value={editForm.status} onChange={e => setEditForm(p => ({ ...p, status: e.target.value }))}>
                <option value="ACTIVE">ACTIVE</option>
                <option value="PENDING">PENDING</option>
                <option value="SUSPENDED">SUSPENDED</option>
              </select>
            </div>
            <div className="input-wrap">
              <div className="input-label">Notes</div>
              <textarea rows={2} value={editForm.notes} onChange={e => setEditForm(p => ({ ...p, notes: e.target.value }))} />
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
              <button className="btn btn-outline btn-sm" onClick={() => setEditWallet(null)}>Cancel</button>
              <button className="btn btn-gold btn-sm" onClick={handleEdit} disabled={editSaving}>
                {editSaving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ PAGE HEADER ═══ */}
      <div className="page-hd">
        <div>
          <div className="page-eyebrow">Governance</div>
          <div className="page-title">DAO Management</div>
          <div className="page-sub">Governing Board &middot; Roles &middot; Vote Power &middot; Benefits &middot; Matrix</div>
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => setShowAddForm(!showAddForm)}>
          + Add Member
        </button>
      </div>

      <div style={{
        padding: '10px 16px', marginBottom: 16, borderRadius: 8,
        background: 'rgba(240,173,78,0.08)', border: '1px solid rgba(240,173,78,0.25)',
        fontSize: '0.78rem', lineHeight: 1.6, color: 'var(--gold)',
      }}>
        {'\u26A0\uFE0F'} DAO Management requires <strong>Admin or Owner</strong> role. Adding Board Members is restricted to <strong>Owner only</strong>. Guardian, Council, and Senator have read-only access here.
      </div>

      {/* ═══ STATS ═══ */}
      <div className="g3" style={{ marginBottom: 16 }}>
        <div className="stat-box">
          <div className="stat-lbl">Board Members</div>
          <div className="stat-val g">{loading ? '...' : fmt(board.length)}</div>
          <div className="stat-delta">{fmt(board.filter(m => m.status === 'ACTIVE').length)} active</div>
        </div>
        <div className="stat-box">
          <div className="stat-lbl">Total Vote Power</div>
          <div className="stat-val p">{totalVP > 0 ? `${totalVP.toFixed(1)}%` : '-'}</div>
          <div className="stat-delta">Distributed via stake</div>
        </div>
        <div className="stat-box">
          <div className="stat-lbl">Owners</div>
          <div className="stat-val gold">{fmt(owners.length)}</div>
        </div>
      </div>

      {/* ═══ ADD MEMBER FORM ═══ */}
      {showAddForm && (
        <div className="card card-g" style={{ marginBottom: 16 }}>
          <div className="card-title">Add Governing Board Member <span className="badge b-gold" style={{ marginLeft: 8 }}>Owner Only</span></div>
          <div className="g2">
            <div>
              <div className="input-wrap">
                <div className="input-label">Username</div>
                <input type="text" placeholder="Display name" value={addForm.username} onChange={e => setAddForm(p => ({ ...p, username: e.target.value }))} />
              </div>
              <div className="input-wrap">
                <div className="input-label">Full Wallet Address</div>
                <input type="text" placeholder="0x..." value={addForm.wallet} onChange={e => setAddForm(p => ({ ...p, wallet: e.target.value }))} />
              </div>
              <div className="input-wrap">
                <div className="input-label">Role</div>
                <select value={addForm.role} onChange={e => setAddForm(p => ({ ...p, role: e.target.value }))}>
                  {VALID_ROLES.filter(r => r !== 'OWNER').map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <div className="input-wrap">
                <div className="input-label">Vote Power (%)</div>
                <input type="number" step="0.1" placeholder="e.g. 5.0" value={addForm.votePower} onChange={e => setAddForm(p => ({ ...p, votePower: e.target.value }))} />
              </div>
            </div>
            <div>
              <div className="input-wrap">
                <div className="input-label">Benefit % of Pool</div>
                <input type="number" step="0.1" placeholder="e.g. 8.5" value={addForm.benefitRate} onChange={e => setAddForm(p => ({ ...p, benefitRate: e.target.value }))} />
              </div>
              <div className="input-wrap">
                <div className="input-label">Weekly Benefit CAP (MIC)</div>
                <input type="number" placeholder="e.g. 50000" value={addForm.benefitCap} onChange={e => setAddForm(p => ({ ...p, benefitCap: e.target.value }))} />
              </div>
              <div className="input-wrap">
                <div className="input-label">Notes / Responsibilities</div>
                <textarea rows={3} placeholder="Region, role description, appointment reason..." value={addForm.notes} onChange={e => setAddForm(p => ({ ...p, notes: e.target.value }))} />
              </div>
            </div>
          </div>
          <div className="alert alert-warn" style={{ marginBottom: 12 }}>
            {'\u26A0\uFE0F'} Currently Owner-decided. After Phase III, this will require full DAO vote.
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary" onClick={handleAdd} disabled={addSaving}>
              {addSaving ? 'Adding...' : 'Confirm Appointment'}
            </button>
            <button className="btn btn-outline" onClick={() => setShowAddForm(false)}>Cancel</button>
          </div>
        </div>
      )}

      {/* ═══ BOARD TABLE ═══ */}
      <div className="card" style={{ padding: 0, marginBottom: 16 }}>
        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)' }}>
          <div className="card-title" style={{ margin: 0 }}>Board Members &amp; Roles</div>
        </div>

        {loading ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--gray2)' }}>Loading board members...</div>
        ) : board.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--gray2)', fontFamily: 'var(--font-m)', fontSize: SZ }}>
            No board members yet. Click &quot;+ Add Member&quot; to appoint the first member.
          </div>
        ) : (
          <>
            <div className="dao-row dao-hdr">
              <span>Username / Wallet</span><span>Full Address</span><span>Role</span><span>Vote Power</span><span>Benefit</span><span>Status</span><span>Actions</span>
            </div>
            {board.map((m) => (
              <div className="dao-row" key={m.id || m.wallet}>
                <span><strong style={{ color: 'var(--white)' }}>{m.username}</strong></span>
                <span style={{ fontFamily: 'var(--font-m)', fontSize: SZ, color: 'var(--gold)' }}>
                  {shortWallet(m.wallet)}
                </span>
                <span>
                  <span className={`${m.role === 'OWNER' ? 'sb-role-badge role-owner' : `badge ${ROLE_BADGE[m.role] || 'b-gray'}`}`} style={{ fontSize: 8 }}>
                    {m.role === 'OWNER' && '\u2B21 '}{m.role}
                  </span>
                </span>
                <span style={{ color: ROLE_COLOR[m.role] || 'var(--gray)', fontWeight: 700 }}>
                  {parseFloat(m.votePower) > 0 ? `${m.votePower}%` : '-'}
                </span>
                <span style={{ color: 'var(--gray)' }}>
                  {parseFloat(m.benefitRate) > 0 ? `${m.benefitRate}% / ${fmt(Number(m.benefitCap))}` : '-'}
                </span>
                <span>
                  <span className={`badge ${m.status === 'ACTIVE' ? 'b-active' : m.status === 'PENDING' ? 'b-warn' : 'b-danger'}`}>
                    {m.status}
                  </span>
                </span>
                <span style={{ display: 'flex', gap: 4 }}>
                  <button className="btn-icon" title="View" onClick={() => setViewMember(m)}>{'\u{1F441}'}</button>
                  <button className="btn-icon" title="Edit" onClick={() => openEdit(m)}>{'\u270F\uFE0F'}</button>
                  {m.role !== 'OWNER' && (
                    <button className="btn-icon" title="Remove" style={{ color: 'var(--crimson2)' }} onClick={() => setDeleteTarget(m)}>
                      {'\u{1F5D1}'}
                    </button>
                  )}
                </span>
              </div>
            ))}
          </>
        )}
      </div>

      {/* ═══ PERMISSION MATRIX ═══ */}
      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)' }}>
          <div className="card-title" style={{ margin: 0 }}>DAO Governance Permission Matrix</div>
        </div>
        <div className="tbl-wrap">
          <table>
            <thead>
              <tr>
                <th style={thSt}>Action / Permission</th><th style={thSt}>Guardian</th><th style={thSt}>Council</th><th style={thSt}>Senator</th><th style={thSt}>Admin</th><th style={thSt}>Owner</th><th style={thSt}>Threshold</th>
              </tr>
            </thead>
            <tbody>
              {PERM_MATRIX.map((row, i) => (
                <tr key={i}>
                  <td style={tdSt}>{row.action}</td>
                  <td style={tdSt}>{renderPerm(row.guardian)}</td>
                  <td style={tdSt}>{renderPerm(row.council)}</td>
                  <td style={tdSt}>{renderPerm(row.senator)}</td>
                  <td style={tdSt}>{renderPerm(row.admin)}</td>
                  <td style={tdSt}>{renderPerm(row.owner)}</td>
                  <td style={tdSt}>{row.threshold}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

/* ─── InfoRow helper ─── */
function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="info-row">
      <span className="info-key">{label}</span>
      <span className={`info-val ${mono ? 'mono' : ''}`}>{value}</span>
    </div>
  );
}
