'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  fetchFounderStats,
  fetchFounderRequests,
  createFounderRequest,
  cancelFounderRequest,
  executeFounderRequestNow,
  lookupFounderMember,
  FounderStats,
  FounderRequest,
} from '@/lib/api';
import { useMcUi } from '@/components/ui/McUi';

const BSCSCAN_TX = (h: string) => `https://bscscan.com/tx/${h}`;

interface Props {
  isSuperAdmin: boolean;
  showToast?: (msg: string) => void;
}

const SZ = '0.62rem';

const thSt: React.CSSProperties = {
  padding: '8px 10px',
  textAlign: 'left',
  color: 'var(--gray)',
  fontWeight: 600,
  fontSize: '0.55rem',
  fontFamily: 'var(--font-d)',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
};

const tdSt: React.CSSProperties = {
  padding: '10px',
  fontFamily: 'var(--font-m)',
  fontSize: SZ,
  color: 'var(--white)',
};

const fmtMic = (n: number) =>
  !n || isNaN(n) ? '0' : n.toLocaleString('en-US', { maximumFractionDigits: 0 });

const shortWallet = (w: string) =>
  w.length > 12 ? `${w.slice(0, 6)}…${w.slice(-4)}` : w;

const Stat = ({ label, value, color }: { label: string; value: string; color?: string }) => (
  <div className="stat-box" style={{ flex: 1 }}>
    <div className="stat-lbl">{label}</div>
    <div className="stat-val" style={{ color: color || 'var(--gold)' }}>
      {value}
    </div>
  </div>
);

function CountdownBadge({ targetIso, executing }: { targetIso: string; executing: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const target = new Date(targetIso).getTime();
  const diff = target - now;
  if (diff <= 0) {
    return (
      <span
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          padding: '2px 8px', borderRadius: 10,
          background: 'rgba(255,180,0,0.15)', color: 'var(--gold)',
          fontSize: '0.55rem', fontWeight: 600,
        }}
      >
        ⏳ {executing ? 'Executing...' : 'Ready (cron pending)'}
      </span>
    );
  }
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  return (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        padding: '2px 8px', borderRadius: 10,
        background: 'rgba(229,57,53,0.12)', color: '#E53935',
        fontSize: '0.55rem', fontWeight: 600,
      }}
    >
      ⏳ {h}h {String(m).padStart(2, '0')}m {String(s).padStart(2, '0')}s
    </span>
  );
}

const ROLE_OPTIONS = [
  'Founder',
  'Co-Founder',
  'Architect',
  'CTO',
  'CMO',
  'Management',
  'Tech Team',
  'Other',
] as const;

export default function FoundersAllocationSection({ isSuperAdmin }: Props) {
  const mcUi = useMcUi();
  const [stats, setStats] = useState<FounderStats | null>(null);
  const [requests, setRequests] = useState<FounderRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshTick, setRefreshTick] = useState(0);

  // Form state
  const [memberIdInput, setMemberIdInput] = useState('');
  const [resolvedWallet, setResolvedWallet] = useState<string | null>(null);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const [micAmountStr, setMicAmountStr] = useState('');
  const [roleSel, setRoleSel] = useState<string>('Founder');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [actionLoading, setActionLoading] = useState<{ [id: string]: 'cancel' | 'execute' | null }>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, r] = await Promise.all([
        fetchFounderStats().catch(() => null),
        fetchFounderRequests({ limit: 200 }).catch(() => null),
      ]);
      if (s?.data) setStats(s.data);
      if (r?.data) setRequests(r.data);
    } catch (e) { console.error('Founder load failed', e); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load, refreshTick]);
  useEffect(() => {
    const id = setInterval(() => setRefreshTick((t) => t + 1), 30000);
    return () => clearInterval(id);
  }, []);

  // Auto-resolve memberId → wallet (debounced)
  useEffect(() => {
    if (!memberIdInput.trim()) {
      setResolvedWallet(null);
      setResolveError(null);
      return;
    }
    setResolving(true);
    const t = setTimeout(async () => {
      try {
        const r = await lookupFounderMember(memberIdInput.trim());
        setResolvedWallet(r.data.wallet);
        setResolveError(null);
      } catch (e: any) {
        setResolvedWallet(null);
        setResolveError(e?.message || 'Member ID not found');
      } finally {
        setResolving(false);
      }
    }, 400);
    return () => { clearTimeout(t); setResolving(false); };
  }, [memberIdInput]);

  const handleSubmit = async () => {
    if (!memberIdInput.trim()) {
      mcUi.toast({ type: 'error', message: 'Member ID required' });
      return;
    }
    if (!resolvedWallet) {
      mcUi.toast({ type: 'error', message: 'Member ID could not be resolved to a wallet' });
      return;
    }
    const micAmount = parseFloat(micAmountStr);
    if (!micAmount || micAmount <= 0) {
      mcUi.toast({ type: 'error', message: 'MIC amount must be > 0' });
      return;
    }
    if (stats && micAmount > stats.remainingMic) {
      mcUi.toast({ type: 'error', message: `Exceeds remaining pool (${fmtMic(stats.remainingMic)} MIC available)` });
      return;
    }
    if (!roleSel.trim()) {
      mcUi.toast({ type: 'error', message: 'Role required' });
      return;
    }

    setSubmitting(true);
    try {
      await createFounderRequest({
        memberId: memberIdInput.trim(),
        micAmount,
        role: roleSel,
        note: note.trim() || undefined,
      });
      mcUi.toast({
        type: 'success',
        message: `Request created — auto-executes in ${stats?.cooldownHours ?? 48}h or click Execute Now`,
      });
      setMemberIdInput('');
      setResolvedWallet(null);
      setMicAmountStr('');
      setNote('');
      setRoleSel('Founder');
      setRefreshTick((t) => t + 1);
    } catch (e: any) {
      mcUi.toast({ type: 'error', message: 'Error: ' + (e?.message || 'Failed to create request') });
    }
    setSubmitting(false);
  };

  const handleCancel = async (id: string) => {
    if (!isSuperAdmin) {
      mcUi.toast({ type: 'error', message: 'Permission denied' });
      return;
    }
    const reason = await mcUi.prompt({
      title: 'Cancel Founder Allocation',
      message: 'This will permanently cancel the pending request. Optionally provide a reason for the audit log.',
      label: 'Cancel reason (optional)',
      placeholder: 'e.g. Recipient declined, duplicate entry…',
      multiline: true,
      confirmLabel: 'Cancel Request',
      cancelLabel: 'Keep Pending',
    });
    if (reason === null) return;
    setActionLoading((s) => ({ ...s, [id]: 'cancel' }));
    try {
      await cancelFounderRequest(id, reason.trim() || undefined);
      mcUi.toast({ type: 'success', message: 'Request cancelled' });
      setRefreshTick((t) => t + 1);
    } catch (e: any) {
      mcUi.toast({ type: 'error', message: 'Cancel failed: ' + (e?.message || 'Unknown error') });
    }
    setActionLoading((s) => ({ ...s, [id]: null }));
  };

  const handleExecuteNow = async (id: string) => {
    if (!isSuperAdmin) {
      mcUi.toast({ type: 'error', message: 'Permission denied' });
      return;
    }
    const ok = await mcUi.confirm({
      title: 'Execute Founder Allocation Now',
      message: (
        <>
          This bypasses the <b>48h cooldown</b> and executes the on-chain
          {' '}<code style={{ color: '#F5D56E' }}>FoundersVault.distributeFounder()</code>
          {' '}call immediately via the relayer. The recipient receives their MIC plus
          a 24-month-cliff vesting schedule on confirmation. This action cannot be undone.
        </>
      ),
      confirmLabel: 'Execute Now',
      cancelLabel: 'Wait for Cooldown',
    });
    if (!ok) return;
    setActionLoading((s) => ({ ...s, [id]: 'execute' }));
    try {
      const res = await executeFounderRequestNow(id);
      mcUi.toast({
        type: 'success',
        message: `Executed on-chain — tx ${res.data.txHash ? res.data.txHash.slice(0, 10) + '…' : 'submitted'}`,
      });
      setRefreshTick((t) => t + 1);
    } catch (e: any) {
      mcUi.toast({ type: 'error', message: 'Execute failed: ' + (e?.message || 'Unknown error') });
    }
    setActionLoading((s) => ({ ...s, [id]: null }));
  };

  const pending = requests.filter((r) => r.status === 'PENDING');
  const done = requests.filter((r) => r.status === 'DONE');
  const cancelled = requests.filter((r) => r.status === 'CANCELLED');

  const inputSt: React.CSSProperties = {
    width: '100%', padding: '8px 12px', borderRadius: 6,
    border: '1px solid var(--border)', background: 'var(--input-bg)',
    color: 'var(--white)', fontSize: SZ, fontFamily: 'var(--font-m)',
  };

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="card-title" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span>Founders &amp; Management — Allocation (280M MIC, 4%)</span>
        <span
          style={{
            fontSize: '0.58rem', padding: '4px 10px', borderRadius: 12,
            background: isSuperAdmin ? 'rgba(212,160,23,0.12)' : 'rgba(120,180,220,0.12)',
            color: isSuperAdmin ? 'var(--gold)' : 'var(--cyan)',
            border: `1px solid ${isSuperAdmin ? 'rgba(212,160,23,0.3)' : 'rgba(120,180,220,0.3)'}`,
          }}
        >
          {isSuperAdmin ? 'OWNER' : 'ADMIN'}
        </span>
      </div>
      <p style={{ fontSize: SZ, color: 'var(--gray)', lineHeight: 1.6, marginBottom: 14 }}>
        280,000,000 MIC reserved for Founders &amp; Management. Admin creates a PENDING request →
        <b> 48h review window</b> → server auto-executes via{' '}
        <code style={{ color: 'var(--gold)' }}>FoundersVault.distributeFounder()</code>.
        Owner can <b>Cancel</b> during cooldown or <b>Execute Now</b> (bypass cooldown).
        Vesting: <b>24-month cliff</b> + 10% unlock + 2.5%/month (handled on-chain by LockManager).
        MFP-NFT grants are managed separately in <b>Grant Mint</b>.
      </p>

      {/* Stats */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <Stat label="Allocation" value={`${fmtMic(stats?.allocationMic ?? 280_000_000)} MIC`} color="var(--gold)" />
        <Stat label="Granted" value={`${fmtMic(stats?.grantedMic ?? 0)} MIC`} color="var(--copper)" />
        <Stat label="Pending (reserved)" value={`${fmtMic(stats?.pendingMic ?? 0)} MIC`} color="#E53935" />
        <Stat label="Available" value={`${fmtMic(stats?.remainingMic ?? 280_000_000)} MIC`} color="var(--green)" />
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <Stat label="Recipients" value={String(stats?.recipientsCount ?? 0)} color="var(--cream)" />
        <Stat label="Grants Done" value={String(stats?.grantsCount ?? 0)} color="var(--cream)" />
        <Stat label="Pending #" value={String(stats?.pendingCount ?? 0)} color="var(--cream)" />
        <Stat label="Cancelled" value={String(stats?.cancelledCount ?? 0)} color="var(--cream)" />
      </div>

      {/* Form: New allocation request */}
      <div style={{ background: 'rgba(255,255,255,0.02)', padding: 14, borderRadius: 8, marginBottom: 18 }}>
        <div style={{ fontSize: '0.62rem', color: 'var(--gold)', fontWeight: 600, marginBottom: 10, letterSpacing: '0.05em' }}>
          NEW ALLOCATION REQUEST
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label style={{ fontSize: '0.55rem', color: 'var(--gray)', display: 'block', marginBottom: 4 }}>
              Member ID (from app.missionchain.io) *
            </label>
            <input
              type="text"
              value={memberIdInput}
              onChange={(e) => setMemberIdInput(e.target.value)}
              placeholder="e.g. MC0001"
              style={inputSt}
            />
            <div style={{ fontSize: '0.5rem', marginTop: 4, minHeight: '0.7rem', color: resolveError ? '#E53935' : 'var(--gray)' }}>
              {resolving ? 'Looking up…' :
               resolvedWallet ? `→ Wallet: ${shortWallet(resolvedWallet)}` :
               resolveError ? `⚠ ${resolveError}` :
               'Wallet auto-fills when Member ID is recognized'}
            </div>
          </div>

          <div>
            <label style={{ fontSize: '0.55rem', color: 'var(--gray)', display: 'block', marginBottom: 4 }}>
              MIC Amount *
            </label>
            <input
              type="number"
              value={micAmountStr}
              onChange={(e) => setMicAmountStr(e.target.value)}
              placeholder="e.g. 500000"
              min="0"
              step="any"
              style={inputSt}
            />
            <div style={{ fontSize: '0.5rem', marginTop: 4, color: 'var(--gray)' }}>
              Max available: {fmtMic(stats?.remainingMic ?? 0)} MIC
            </div>
          </div>

          <div>
            <label style={{ fontSize: '0.55rem', color: 'var(--gray)', display: 'block', marginBottom: 4 }}>
              Role *
            </label>
            <select value={roleSel} onChange={(e) => setRoleSel(e.target.value)} style={inputSt}>
              {ROLE_OPTIONS.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ fontSize: '0.55rem', color: 'var(--gray)', display: 'block', marginBottom: 4 }}>
              Note (optional)
            </label>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Internal accounting reference…"
              style={inputSt}
            />
          </div>
        </div>

        <button
          onClick={handleSubmit}
          disabled={submitting || !resolvedWallet}
          style={{
            marginTop: 14, padding: '10px 24px',
            background: resolvedWallet ? 'var(--gold)' : 'var(--input-bg)',
            color: resolvedWallet ? '#1a1408' : 'var(--gray)',
            fontWeight: 600, border: 'none', borderRadius: 6,
            cursor: submitting || !resolvedWallet ? 'not-allowed' : 'pointer',
            fontSize: '0.62rem', fontFamily: 'var(--font-d)', letterSpacing: '0.05em',
            opacity: submitting ? 0.6 : 1,
          }}
        >
          {submitting ? 'Creating…' : `CREATE REQUEST (48h cooldown)`}
        </button>
      </div>

      {loading && <div style={{ fontSize: SZ, color: 'var(--gray)' }}>Loading…</div>}

      {/* Pending */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: '0.62rem', color: 'var(--gold)', fontWeight: 600, marginBottom: 8, letterSpacing: '0.05em' }}>
          PENDING ({pending.length})
        </div>
        {pending.length === 0 ? (
          <div style={{ fontSize: SZ, color: 'var(--gray)', padding: 14, fontStyle: 'italic' }}>
            No pending requests
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <th style={thSt}>Member ID</th>
                <th style={thSt}>Recipient</th>
                <th style={thSt}>MIC</th>
                <th style={thSt}>Role</th>
                <th style={thSt}>Note</th>
                <th style={thSt}>Cooldown</th>
                <th style={thSt}>Requested By</th>
                {isSuperAdmin && <th style={thSt}>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {pending.map((r) => (
                <tr key={r.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={tdSt}><b>{r.memberId}</b></td>
                  <td style={tdSt}><code style={{ fontSize: '0.55rem' }}>{shortWallet(r.recipient)}</code></td>
                  <td style={{ ...tdSt, color: 'var(--gold)', fontWeight: 700 }}>{fmtMic(r.micAmount)}</td>
                  <td style={tdSt}>{r.role}</td>
                  <td style={{ ...tdSt, fontSize: '0.55rem', color: 'var(--gray)', maxWidth: 180 }}>{r.note || '—'}</td>
                  <td style={tdSt}>
                    <CountdownBadge targetIso={r.cooldownEnd} executing={actionLoading[r.id] === 'execute'} />
                  </td>
                  <td style={{ ...tdSt, fontSize: '0.55rem' }}>
                    {r.requestedByUserId || shortWallet(r.requestedBy)}
                  </td>
                  {isSuperAdmin && (
                    <td style={tdSt}>
                      <button
                        onClick={() => handleExecuteNow(r.id)}
                        disabled={actionLoading[r.id] === 'execute'}
                        style={{
                          padding: '4px 10px', marginRight: 6, background: 'var(--green)',
                          color: '#fff', border: 'none', borderRadius: 4,
                          fontSize: '0.5rem', cursor: 'pointer', fontWeight: 600,
                          opacity: actionLoading[r.id] === 'execute' ? 0.5 : 1,
                        }}
                      >
                        {actionLoading[r.id] === 'execute' ? '…' : 'Execute Now'}
                      </button>
                      <button
                        onClick={() => handleCancel(r.id)}
                        disabled={actionLoading[r.id] === 'cancel'}
                        style={{
                          padding: '4px 10px', background: '#E53935',
                          color: '#fff', border: 'none', borderRadius: 4,
                          fontSize: '0.5rem', cursor: 'pointer', fontWeight: 600,
                          opacity: actionLoading[r.id] === 'cancel' ? 0.5 : 1,
                        }}
                      >
                        {actionLoading[r.id] === 'cancel' ? '…' : 'Cancel'}
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Done */}
      {done.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: '0.62rem', color: 'var(--green)', fontWeight: 600, marginBottom: 8, letterSpacing: '0.05em' }}>
            DONE ({done.length})
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <th style={thSt}>Member ID</th>
                <th style={thSt}>Recipient</th>
                <th style={thSt}>MIC</th>
                <th style={thSt}>Role</th>
                <th style={thSt}>Executed At</th>
                <th style={thSt}>Executed By</th>
                <th style={thSt}>TX</th>
              </tr>
            </thead>
            <tbody>
              {done.map((r) => (
                <tr key={r.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={tdSt}><b>{r.memberId}</b></td>
                  <td style={tdSt}><code style={{ fontSize: '0.55rem' }}>{shortWallet(r.recipient)}</code></td>
                  <td style={{ ...tdSt, color: 'var(--copper)', fontWeight: 700 }}>{fmtMic(r.micAmount)}</td>
                  <td style={tdSt}>{r.role}</td>
                  <td style={{ ...tdSt, fontSize: '0.55rem' }}>
                    {r.executedAt ? new Date(r.executedAt).toLocaleString() : '—'}
                  </td>
                  <td style={{ ...tdSt, fontSize: '0.55rem' }}>
                    {r.executedBy === 'CRON' ? <span style={{ color: 'var(--cyan)' }}>cron</span> :
                     r.executedByUserId ? r.executedByUserId :
                     r.executedBy ? shortWallet(r.executedBy) : '—'}
                  </td>
                  <td style={tdSt}>
                    {r.txHash ? (
                      <a href={BSCSCAN_TX(r.txHash)} target="_blank" rel="noopener noreferrer"
                        style={{ color: 'var(--gold)', fontSize: '0.55rem', textDecoration: 'underline' }}>
                        {r.txHash.slice(0, 8)}…↗
                      </a>
                    ) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Cancelled */}
      {cancelled.length > 0 && (
        <details>
          <summary style={{ fontSize: '0.62rem', color: '#E53935', fontWeight: 600, cursor: 'pointer', marginBottom: 8, letterSpacing: '0.05em' }}>
            CANCELLED ({cancelled.length})
          </summary>
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 8 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <th style={thSt}>Member ID</th>
                <th style={thSt}>Recipient</th>
                <th style={thSt}>MIC</th>
                <th style={thSt}>Cancelled At</th>
                <th style={thSt}>Cancelled By</th>
                <th style={thSt}>Reason</th>
              </tr>
            </thead>
            <tbody>
              {cancelled.map((r) => (
                <tr key={r.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={tdSt}><b>{r.memberId}</b></td>
                  <td style={tdSt}><code style={{ fontSize: '0.55rem' }}>{shortWallet(r.recipient)}</code></td>
                  <td style={tdSt}>{fmtMic(r.micAmount)}</td>
                  <td style={{ ...tdSt, fontSize: '0.55rem' }}>
                    {r.cancelledAt ? new Date(r.cancelledAt).toLocaleString() : '—'}
                  </td>
                  <td style={{ ...tdSt, fontSize: '0.55rem' }}>
                    {r.cancelledBy ? shortWallet(r.cancelledBy) : '—'}
                  </td>
                  <td style={{ ...tdSt, fontSize: '0.55rem', color: 'var(--gray)' }}>{r.cancelReason || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </div>
  );
}
