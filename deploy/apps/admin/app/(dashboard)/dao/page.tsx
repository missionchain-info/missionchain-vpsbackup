'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useMcUi } from '@/components/ui/McUi';

/** BSC-USD is 18 decimals, not the 6 that Ethereum USDT uses. */
const USDT_DECIMALS = 18;
import { fetchDAOBoard, addDAOMember, updateDAOMember, deleteDAOMember } from '@/lib/api';

/** A row as the board table renders it: a stored appointee, or a Council seat merged in. */
type BoardRow = BoardMember & { autoCouncil: boolean };

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
  /** Appointed members only — Council seats are merged in below, never stored twice. */
  const [rawBoard, setRawBoard] = useState<BoardMember[]>([]);
  const [council, setCouncil] = useState<any[]>([]);

  /** An appointee from outside the Council may not out-vote a Council seat. */
  const MAX_APPOINTED_VP = 0.5;
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
      if (res?.data) setRawBoard(res.data);

      /* Council roster, fetched alongside so the board reflects it without a second entry. */
      try {
        const jwt = typeof window !== 'undefined' ? localStorage.getItem('mc-admin-jwt') : null;
        const cRes = await fetch(`${process.env.NEXT_PUBLIC_API_URL || ''}/admin/steward-council`, {
          headers: jwt ? { Authorization: `Bearer ${jwt}` } : {},
        });
        if (cRes.ok) setCouncil((await cRes.json()).data || []);
      } catch { /* the appointed list still renders */ }
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

  /*
   * Council seats are not typed in here — they are read from the Steward Council and merged
   * in with a coefficient of 1.0. Maintaining the same roster twice guarantees the two
   * drift, and the one that drifts is always the copy nobody is looking at.
   *
   * An appointee from outside the Council keeps whatever coefficient was set for them,
   * capped at MAX_APPOINTED_VP, and stays editable here.
   */
  const board = useMemo<BoardRow[]>(() => {
    const fromCouncil: BoardRow[] = council
      .filter(c => c.active)
      .map(c => ({
        id: `council-${c.wallet}`,
        username: c.memberId || String(c.wallet).slice(0, 8),
        wallet: c.wallet,
        role: c.role || 'COUNCIL',
        votePower: '1',
        // Pay is set on the Steward Council page; nothing here writes it.
        benefitRate: '',
        benefitCap: '',
        status: 'ACTIVE',
        notes: c.notes ?? '',
        autoCouncil: true,
      }));
    const seen = new Set(fromCouncil.map(m => m.wallet.toLowerCase()));
    const appointed: BoardRow[] = rawBoard
      .filter(m => !seen.has(String(m.wallet).toLowerCase()))
      .map(m => ({
        ...m,
        votePower: String(Math.min(parseFloat(m.votePower || '0') || 0, MAX_APPOINTED_VP)),
        autoCouncil: false,
      }));
    return [...fromCouncil, ...appointed];
  }, [council, rawBoard]);

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
      {/* Vote power is a COEFFICIENT, not a percentage: a Council seat carries 1.0 and an
          appointed member at most 0.5. Showing it as "%" invited the reading that the board
          shares out a fixed 100, which is not how it works — the total simply grows as seats
          are added. The Owners tile went with it; the Owner does not vote. */}
      <div className="g2" style={{ marginBottom: 16 }}>
        <div className="stat-box">
          <div className="stat-lbl">Board Members</div>
          <div className="stat-val g">{loading ? '...' : fmt(board.length)}</div>
          <div className="stat-delta">
            {fmt(board.filter(m => m.status === 'ACTIVE').length)} active {'\u00B7'}{' '}
            {fmt(board.filter(m => m.autoCouncil).length)} from Steward Council
          </div>
        </div>
        <div className="stat-box">
          <div className="stat-lbl">Total Vote Power</div>
          <div className="stat-val p">{totalVP > 0 ? totalVP.toFixed(1) : '-'}</div>
          <div className="stat-delta">Sum of every member&rsquo;s coefficient</div>
        </div>
      </div>

      {/* ═══ ADD MEMBER FORM ═══ */}
      {showAddForm && (
        <div className="card card-g" style={{ marginBottom: 16 }}>
          <div className="card-title">Add Governing Board Member <span className="badge b-gold" style={{ marginLeft: 8 }}>Owner Only</span></div>
          <div className="g2">
            {/* Two fields a side, so the form reads evenly. Role is no longer chosen from a
                list — an appointee who is not on the Council is a GUARDIAN by definition, and
                the pay fields left with the pool that pays them: benefits are set on the
                Steward Council page, not here. */}
            <div>
              <div className="input-wrap">
                <div className="input-label">Username</div>
                <input type="text" placeholder="Display name" value={addForm.username} onChange={e => setAddForm(p => ({ ...p, username: e.target.value }))} />
              </div>
              <div className="input-wrap">
                <div className="input-label">Full Wallet Address</div>
                <input type="text" placeholder="0x..." value={addForm.wallet} onChange={e => setAddForm(p => ({ ...p, wallet: e.target.value }))} />
              </div>
            </div>
            <div>
              <div className="input-wrap">
                <div className="input-label">Vote Power (coefficient, max {MAX_APPOINTED_VP})</div>
                <input type="number" step="0.1" min="0" max={MAX_APPOINTED_VP}
                  placeholder={`e.g. ${MAX_APPOINTED_VP}`} value={addForm.votePower}
                  onChange={e => setAddForm(p => ({ ...p, votePower: e.target.value }))} />
              </div>
              <div className="input-wrap">
                <div className="input-label">Notes / Responsibilities</div>
                <textarea rows={2} placeholder="Region, role description, appointment reason..." value={addForm.notes} onChange={e => setAddForm(p => ({ ...p, notes: e.target.value }))} />
              </div>
            </div>
          </div>
          <div className="alert alert-warn" style={{ marginBottom: 12 }}>
            {'\u26A0\uFE0F'} Steward Council members appear here automatically with a coefficient of 1.0 and
            are managed on the Steward Council page. Use this form only for someone outside the Council,
            whose coefficient is capped at {MAX_APPOINTED_VP}.
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
              <span>Username / Wallet</span><span>Full Address</span><span>Role</span>
              <span style={{ textAlign: 'center' }}>Vote Power</span><span>Status</span><span>Actions</span>
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
                {/* A coefficient, not a percentage — a Council seat is 1, an appointee at
                    most 0.5. The Benefit column left with the pay fields: what a member is
                    paid is set on the Steward Council page, and showing a permanent "-" here
                    only invited the question of why it was always empty. */}
                <span style={{ color: ROLE_COLOR[m.role] || 'var(--gray)', fontWeight: 700, textAlign: 'center' }}>
                  {parseFloat(m.votePower) > 0 ? parseFloat(m.votePower).toFixed(1) : '-'}
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

      {/* The two SEED spending pools moved to the member app, where the votes are cast.
          Mirroring them here as well meant three places showed the same orders and only one
          of them was the place a member could act. */}

      {/* ═══ PERMISSION MATRIX ═══ */}
      {/* Dimmed on purpose: the rows below describe the old Admin/Guardian/Senator model and
          have not been rewritten for the Council-centred design. Left visible rather than
          deleted so the rebuild has something to work from, but greyed so nobody reads it as
          current. */}
      <div className="card" style={{ padding: 0, opacity: 0.45, pointerEvents: 'none' }}>
        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)' }}>
          <div className="card-title" style={{ margin: 0 }}>
            DAO Governance Permission Matrix
            <span className="badge b-gray" style={{ marginLeft: 8, fontSize: '0.5rem' }}>BEING REBUILT</span>
          </div>
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

/**
 * The two SEED slots the Council spends by vote: Management Bonus (10%) and the
 * Contingency Reserve (50%).
 *
 * Both follow the same three steps — a member raises an order, members approve it, and once
 * the threshold is met anyone may execute it, which calls `SeedBudgetV5c.release()` for that
 * slot. One component serves both, because a second hand-written copy would drift from the
 * first the moment either contract changed.
 *
 * They are NOT identical underneath, and the adapter below is where that lives:
 *
 *   ManagementBonusPoolV3  orders(id) -> (id, recipient, amount, content, requester,
 *                                        createdAt, status enum, executedAt)
 *                          approvals counted in `approvalsCount(id)`, threshold `thresholdBps()`
 *   ReservedExpensesPoolV3 orders(id) -> (proposer, recipient, amount, content,
 *                                        approvalCount, executed, cancelled)
 *                          approvals inline on the struct, threshold `threshold()`
 *
 * Status is an enum in one and two booleans in the other; both are normalised to a single
 * string so the rendering below never has to know which pool it is drawing.
 */
/* ─── InfoRow helper ─── */
function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="info-row">
      <span className="info-key">{label}</span>
      <span className={`info-val ${mono ? 'mono' : ''}`}>{value}</span>
    </div>
  );
}
