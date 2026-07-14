'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  fetchOldInvestorStats,
  fetchOldInvestorRequests,
  createOldInvestorRequest,
  cancelOldInvestorRequest,
  executeOldInvestorRequestNow,
  OldInvestorStats,
  OldInvestorRequest,
} from '@/lib/api';
import { useMcUi } from '@/components/ui/McUi';

// SeedSale v4 (Apr 29, 2026) — for tx links to BscScan
const BSCSCAN_TX = (h: string) => `https://bscscan.com/tx/${h}`;

interface Props {
  isSuperAdmin: boolean;
  showToast: (msg: string) => void;
  existingWallets?: Array<{ wallet: string; userId: string }>;
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

const fmtMic = (n: number) => {
  if (!n || isNaN(n)) return '0';
  return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
};

const shortWallet = (w: string) => (w.length > 12 ? `${w.slice(0, 6)}...${w.slice(-4)}` : w);

const Stat = ({ label, value, color }: { label: string; value: string; color?: string }) => (
  <div className="stat-box" style={{ flex: 1 }}>
    <div className="stat-lbl">{label}</div>
    <div className="stat-val" style={{ color: color || 'var(--gold)' }}>
      {value}
    </div>
  </div>
);

// Live countdown for a future cooldownEnd timestamp.
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
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          padding: '2px 8px',
          borderRadius: 10,
          background: 'rgba(255,180,0,0.15)',
          color: 'var(--gold)',
          fontSize: '0.55rem',
          fontWeight: 600,
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
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '2px 8px',
        borderRadius: 10,
        background: 'rgba(229,57,53,0.12)',
        color: '#E53935',
        fontSize: '0.55rem',
        fontWeight: 600,
        fontFamily: 'var(--font-m)',
      }}
    >
      ⏳ {h}h {String(m).padStart(2, '0')}m {String(s).padStart(2, '0')}s
    </span>
  );
}

export default function OldInvestorsSection({ isSuperAdmin, showToast: _legacyToast, existingWallets = [] }: Props) {
  // Use Mission Chain UI hook (replaces native confirm/prompt + parent showToast).
  // Keep _legacyToast param for back-compat — internal calls go through mcUi.
  const mcUi = useMcUi();
  const showToast = (msg: string) => mcUi.toast({ type: 'info', message: msg });
  void _legacyToast;
  const [stats, setStats] = useState<OldInvestorStats | null>(null);
  const [requests, setRequests] = useState<OldInvestorRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshTick, setRefreshTick] = useState(0);

  // Form state
  const [recipientMode, setRecipientMode] = useState<'dropdown' | 'manual'>('manual');
  const [recipient, setRecipient] = useState('');
  const [micAmountStr, setMicAmountStr] = useState('');
  const nowLocal = () => {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
  };
  const [startTimeLocal, setStartTimeLocal] = useState(nowLocal());
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Action loading per row
  const [actionLoading, setActionLoading] = useState<{ [id: string]: 'cancel' | 'execute' | null }>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, r] = await Promise.all([
        fetchOldInvestorStats().catch(() => null),
        fetchOldInvestorRequests({ limit: 200 }).catch(() => null),
      ]);
      if (s?.data) setStats(s.data);
      if (r?.data) setRequests(r.data);
    } catch (e) {
      console.error('OldInvestors load failed', e);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshTick]);

  // Auto-refresh every 30s while page is open (catches cron auto-execute updates)
  useEffect(() => {
    const id = setInterval(() => setRefreshTick((t) => t + 1), 30000);
    return () => clearInterval(id);
  }, []);

  const handleSubmit = async () => {
    if (!/^0x[a-fA-F0-9]{40}$/.test(recipient)) {
      showToast('Invalid recipient wallet');
      return;
    }
    const micAmount = parseFloat(micAmountStr);
    if (!micAmount || micAmount <= 0) {
      showToast('Amount must be > 0');
      return;
    }
    if (stats && micAmount > stats.remainingMic) {
      showToast(`Exceeds remaining pool (${fmtMic(stats.remainingMic)} MIC available)`);
      return;
    }
    const startTimeSec = Math.floor(new Date(startTimeLocal).getTime() / 1000);
    if (!startTimeSec || isNaN(startTimeSec)) {
      showToast('Invalid start time');
      return;
    }

    setSubmitting(true);
    try {
      await createOldInvestorRequest({
        recipient,
        micAmount,
        startTime: startTimeSec,
        note: note.trim() || undefined,
      });
      showToast(`Request created — auto-executes in ${stats?.cooldownHours ?? 24}h or click Execute Now`);
      setRecipient('');
      setMicAmountStr('');
      setNote('');
      setStartTimeLocal(nowLocal());
      setRefreshTick((t) => t + 1);
    } catch (e: any) {
      showToast('Error: ' + (e?.message || 'Failed to create request'));
    }
    setSubmitting(false);
  };

  const handleCancel = async (id: string) => {
    if (!isSuperAdmin) {
      mcUi.toast({ type: 'error', message: 'Permission denied' });
      return;
    }
    const reason = await mcUi.prompt({
      title: 'Cancel Grant Request',
      message: 'This will permanently cancel the pending request. Optionally provide a reason for the audit log.',
      label: 'Cancel reason (optional)',
      placeholder: 'e.g. Recipient declined, duplicate entry…',
      multiline: true,
      confirmLabel: 'Cancel Request',
      cancelLabel: 'Keep Pending',
    });
    if (reason === null) return; // user dismissed
    setActionLoading((s) => ({ ...s, [id]: 'cancel' }));
    try {
      await cancelOldInvestorRequest(id, reason.trim() || undefined);
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
      title: 'Execute Grant Now',
      message: (
        <>
          This bypasses the <b>24h cooldown</b> and executes the on-chain
          {' '}<code style={{ color: '#F5D56E' }}>SeedSale.adminGrantOldInvestor()</code>
          {' '}call immediately via the on-chain relayer. The recipient will
          receive their MIC + vesting schedule on confirmation. This action cannot be undone.
        </>
      ),
      confirmLabel: 'Execute Now',
      cancelLabel: 'Wait for Cooldown',
    });
    if (!ok) return;
    setActionLoading((s) => ({ ...s, [id]: 'execute' }));
    try {
      const res = await executeOldInvestorRequestNow(id);
      mcUi.toast({
        type: 'success',
        message: `Executed on-chain — tx ${res.data.txHash ? res.data.txHash.slice(0, 10) + '...' : 'submitted'}`,
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

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div
        className="card-title"
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
      >
        <span>Old Investors — Strategic Partner Grant (75M MIC)</span>
        <span
          style={{
            fontSize: '0.58rem',
            padding: '4px 10px',
            borderRadius: 12,
            background: isSuperAdmin ? 'rgba(212,160,23,0.12)' : 'rgba(120,180,220,0.12)',
            color: isSuperAdmin ? 'var(--gold)' : 'var(--cyan)',
            border: `1px solid ${isSuperAdmin ? 'rgba(212,160,23,0.3)' : 'rgba(120,180,220,0.3)'}`,
          }}
        >
          ADMIN
        </span>
      </div>
      <p style={{ fontSize: SZ, color: 'var(--gray)', lineHeight: 1.6, marginBottom: 14 }}>
        75,000,000 MIC reserved for strategic partners. Admin creates a PENDING request →
        24h review window → server auto-executes on-chain via{' '}
        <code style={{ color: 'var(--gold)' }}>SeedSale.adminGrantOldInvestor()</code>. Requests
        can be <b>Cancelled</b> during cooldown or <b>Executed Now</b> (bypass cooldown). Vesting: 6-month
        cliff + 10% unlock + 2.5%/month, backdateable startTime.
      </p>

      {/* Stats */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <Stat label="Allocation" value={`${fmtMic(stats?.allocationMic ?? 75_000_000)} MIC`} color="var(--gold)" />
        <Stat label="Granted" value={`${fmtMic(stats?.grantedMic ?? 0)} MIC`} color="var(--copper)" />
        <Stat label="Pending (reserved)" value={`${fmtMic(stats?.pendingMic ?? 0)} MIC`} color="#E53935" />
        <Stat label="Available" value={`${fmtMic(stats?.remainingMic ?? 75_000_000)} MIC`} color="var(--green)" />
        <Stat label="Recipients" value={String(stats?.recipientsCount ?? 0)} color="var(--cyan)" />
        <Stat label="Done" value={String(stats?.grantsCount ?? 0)} color="var(--purple2)" />
      </div>

      {/* Create Request form */}
      <div
        style={{
          padding: 16,
          background: 'rgba(212,160,23,.04)',
          border: '1px dashed rgba(212,160,23,.3)',
          borderRadius: 10,
          marginBottom: 20,
        }}
      >
        <div
          style={{
            fontFamily: 'var(--font-d)',
            fontSize: '0.7rem',
            fontWeight: 700,
            color: 'var(--gold)',
            marginBottom: 12,
          }}
        >
          Create Old Investor Grant Request (any admin)
        </div>

        <div style={{ marginBottom: 12 }}>
          <div style={thSt}>Recipient Wallet</div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <label style={{ fontSize: '0.6rem', display: 'flex', alignItems: 'center', gap: 4 }}>
              <input
                type="radio"
                checked={recipientMode === 'dropdown'}
                onChange={() => setRecipientMode('dropdown')}
              />
              From existing
            </label>
            <label style={{ fontSize: '0.6rem', display: 'flex', alignItems: 'center', gap: 4 }}>
              <input
                type="radio"
                checked={recipientMode === 'manual'}
                onChange={() => setRecipientMode('manual')}
              />
              Enter new wallet
            </label>
          </div>
          {recipientMode === 'dropdown' ? (
            <select
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 10px',
                fontSize: SZ,
                fontFamily: 'var(--font-m)',
                background: 'var(--bg3)',
                border: '1px solid var(--border)',
                color: 'var(--white)',
                borderRadius: 6,
              }}
            >
              <option value="">— Select wallet —</option>
              {existingWallets.map((w) => (
                <option key={w.wallet} value={w.wallet}>
                  {shortWallet(w.wallet)} — {w.userId}
                </option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder="0x..."
              style={{
                width: '100%',
                padding: '8px 10px',
                fontSize: SZ,
                fontFamily: 'var(--font-m)',
                background: 'var(--bg3)',
                border: '1px solid var(--border)',
                color: 'var(--white)',
                borderRadius: 6,
              }}
            />
          )}
        </div>

        <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={thSt}>MIC Amount (max {fmtMic(stats?.remainingMic ?? 75_000_000)})</div>
            <input
              type="number"
              value={micAmountStr}
              onChange={(e) => setMicAmountStr(e.target.value)}
              placeholder="e.g. 5000000"
              min={1}
              style={{
                width: '100%',
                padding: '8px 10px',
                fontSize: SZ,
                fontFamily: 'var(--font-m)',
                background: 'var(--bg3)',
                border: '1px solid var(--border)',
                color: 'var(--white)',
                borderRadius: 6,
              }}
            />
          </div>
          <div style={{ flex: 1 }}>
            <div style={thSt}>Vesting Start (backdateable — pick past date to recognize prior contribution)</div>
            <input
              type="datetime-local"
              value={startTimeLocal}
              onChange={(e) => setStartTimeLocal(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 10px',
                fontSize: SZ,
                fontFamily: 'var(--font-m)',
                background: 'var(--bg3)',
                border: '1px solid var(--border)',
                color: 'var(--white)',
                borderRadius: 6,
              }}
            />
          </div>
        </div>

        <div style={{ marginBottom: 12 }}>
          <div style={thSt}>Note (optional, e.g. "Strategic partner — contributed since Jan 2026")</div>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Recognition / context..."
            style={{
              width: '100%',
              padding: '8px 10px',
              fontSize: SZ,
              fontFamily: 'var(--font-m)',
              background: 'var(--bg3)',
              border: '1px solid var(--border)',
              color: 'var(--white)',
              borderRadius: 6,
            }}
          />
        </div>

        <button
          className="btn btn-gold btn-sm"
          onClick={handleSubmit}
          disabled={submitting}
          style={{ width: '100%' }}
        >
          {submitting ? 'Submitting...' : '✦ Submit Grant Request (24h cooldown then auto-execute)'}
        </button>
        <p style={{ fontSize: '0.55rem', color: 'var(--gray2)', marginTop: 8, lineHeight: 1.5 }}>
          Request enters PENDING for {stats?.cooldownHours ?? 24}h. May be Cancelled or
          Executed Now during the window. After cooldown, server cron signs on-chain via the relayer
          and creates vesting via LockManager. No MetaMask needed for execution.
        </p>
      </div>

      {/* Pending Requests */}
      <div
        className="card-title"
        style={{ fontSize: '0.7rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
      >
        <span>Pending Requests ({pending.length})</span>
        <span style={{ fontSize: '0.55rem', color: 'var(--gray2)', fontWeight: 400 }}>
          Active 24h cooldown — Cancel / Execute Now
        </span>
      </div>
      <div
        style={{
          maxHeight: 320,
          overflowY: 'auto',
          border: '1px solid var(--border)',
          borderRadius: 8,
          marginBottom: 16,
          background: 'var(--bg4)',
        }}
      >
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead style={{ position: 'sticky', top: 0, background: 'var(--bg3)', zIndex: 1 }}>
            <tr>
              <th style={thSt}>Created</th>
              <th style={thSt}>Recipient</th>
              <th style={thSt}>Amount</th>
              <th style={thSt}>Vesting Start</th>
              <th style={thSt}>Status</th>
              <th style={thSt}>Note</th>
              <th style={{ ...thSt, textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} style={{ ...tdSt, textAlign: 'center', color: 'var(--gray)' }}>
                  Loading...
                </td>
              </tr>
            ) : pending.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  style={{
                    ...tdSt,
                    textAlign: 'center',
                    color: 'var(--gray2)',
                    fontStyle: 'italic',
                    padding: 20,
                  }}
                >
                  No pending requests. Create one above.
                </td>
              </tr>
            ) : (
              pending.map((r) => {
                const dt = new Date(r.createdAt);
                const dtFmt = `${dt.toLocaleDateString()} ${dt.toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })}`;
                const vest = new Date(r.startTime);
                const vestFmt = vest.toLocaleDateString();
                const isExecuting = actionLoading[r.id] === 'execute';
                return (
                  <tr key={r.id} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ ...tdSt, fontSize: '0.55rem', color: 'var(--gray2)' }}>{dtFmt}</td>
                    <td style={{ ...tdSt, fontFamily: 'var(--font-m)', color: 'var(--gold)' }}>
                      {shortWallet(r.recipient)}
                      {r.recipientUserId && (
                        <span style={{ display: 'block', fontSize: '0.5rem', color: 'var(--gray2)' }}>
                          {r.recipientUserId}
                        </span>
                      )}
                    </td>
                    <td style={tdSt}>{fmtMic(r.micAmount)} MIC</td>
                    <td style={{ ...tdSt, fontSize: '0.55rem', color: 'var(--gray2)' }}>{vestFmt}</td>
                    <td style={tdSt}>
                      <CountdownBadge targetIso={r.cooldownEnd} executing={isExecuting} />
                      {r.executeError && (
                        <div
                          style={{
                            marginTop: 4,
                            fontSize: '0.5rem',
                            color: '#E53935',
                            fontStyle: 'italic',
                          }}
                          title={r.executeError}
                        >
                          ⚠ retry pending
                        </div>
                      )}
                    </td>
                    <td style={{ ...tdSt, fontSize: '0.55rem', color: 'var(--gray2)', maxWidth: 180 }}>
                      {r.note || '—'}
                    </td>
                    <td style={{ ...tdSt, textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {isSuperAdmin ? (
                        <>
                          <button
                            className="btn btn-outline btn-sm"
                            disabled={actionLoading[r.id] != null}
                            onClick={() => handleCancel(r.id)}
                            style={{ marginRight: 6, fontSize: '0.55rem', padding: '4px 8px' }}
                          >
                            {actionLoading[r.id] === 'cancel' ? '...' : 'Cancel'}
                          </button>
                          <button
                            className="btn btn-gold btn-sm"
                            disabled={actionLoading[r.id] != null}
                            onClick={() => handleExecuteNow(r.id)}
                            style={{ fontSize: '0.55rem', padding: '4px 8px' }}
                          >
                            {actionLoading[r.id] === 'execute' ? '...' : 'Execute Now'}
                          </button>
                        </>
                      ) : (
                        <span style={{ fontSize: '0.55rem', color: 'var(--gray2)', fontStyle: 'italic' }}>
                          Restricted
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Done Requests */}
      <div className="card-title" style={{ fontSize: '0.7rem' }}>
        Completed Grants ({done.length})
      </div>
      <div
        style={{
          maxHeight: 280,
          overflowY: 'auto',
          border: '1px solid var(--border)',
          borderRadius: 8,
          marginBottom: 16,
          background: 'var(--bg4)',
        }}
      >
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead style={{ position: 'sticky', top: 0, background: 'var(--bg3)', zIndex: 1 }}>
            <tr>
              <th style={thSt}>Executed</th>
              <th style={thSt}>Recipient</th>
              <th style={thSt}>Amount</th>
              <th style={thSt}>By</th>
              <th style={thSt}>Tx</th>
              <th style={thSt}>Note</th>
            </tr>
          </thead>
          <tbody>
            {done.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  style={{
                    ...tdSt,
                    textAlign: 'center',
                    color: 'var(--gray2)',
                    fontStyle: 'italic',
                    padding: 20,
                  }}
                >
                  No completed grants yet.
                </td>
              </tr>
            ) : (
              done.map((r) => {
                const dt = r.executedAt ? new Date(r.executedAt) : null;
                const dtFmt = dt
                  ? `${dt.toLocaleDateString()} ${dt.toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}`
                  : '—';
                return (
                  <tr key={r.id} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ ...tdSt, fontSize: '0.55rem', color: 'var(--gray2)' }}>{dtFmt}</td>
                    <td style={{ ...tdSt, fontFamily: 'var(--font-m)', color: 'var(--gold)' }}>
                      {shortWallet(r.recipient)}
                      {r.recipientUserId && (
                        <span style={{ display: 'block', fontSize: '0.5rem', color: 'var(--gray2)' }}>
                          {r.recipientUserId}
                        </span>
                      )}
                    </td>
                    <td style={{ ...tdSt, color: 'var(--copper)' }}>{fmtMic(r.micAmount)} MIC</td>
                    <td style={{ ...tdSt, fontSize: '0.55rem', color: 'var(--gray2)' }}>
                      {r.executedBy === 'CRON' ? '⚙ cron' : shortWallet(r.executedBy ?? '—')}
                    </td>
                    <td style={tdSt}>
                      {r.txHash ? (
                        <a
                          href={BSCSCAN_TX(r.txHash)}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ color: 'var(--cyan)', textDecoration: 'none', fontSize: '0.55rem' }}
                        >
                          {r.txHash.slice(0, 8)}... ↗
                        </a>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td style={{ ...tdSt, fontSize: '0.55rem', color: 'var(--gray2)', maxWidth: 180 }}>
                      {r.note || '—'}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Cancelled (collapsible-like simple list, only show if any) */}
      {cancelled.length > 0 && (
        <details>
          <summary
            style={{
              fontFamily: 'var(--font-d)',
              fontSize: '0.7rem',
              color: 'var(--gray2)',
              cursor: 'pointer',
              marginBottom: 8,
            }}
          >
            Cancelled Requests ({cancelled.length})
          </summary>
          <div
            style={{
              border: '1px solid var(--border)',
              borderRadius: 8,
              background: 'var(--bg4)',
              opacity: 0.7,
            }}
          >
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead style={{ background: 'var(--bg3)' }}>
                <tr>
                  <th style={thSt}>Cancelled</th>
                  <th style={thSt}>Recipient</th>
                  <th style={thSt}>Amount</th>
                  <th style={thSt}>By</th>
                  <th style={thSt}>Reason</th>
                </tr>
              </thead>
              <tbody>
                {cancelled.map((r) => {
                  const dt = r.cancelledAt ? new Date(r.cancelledAt) : null;
                  const dtFmt = dt ? dt.toLocaleString() : '—';
                  return (
                    <tr key={r.id} style={{ borderTop: '1px solid var(--border)' }}>
                      <td style={{ ...tdSt, fontSize: '0.55rem', color: 'var(--gray2)' }}>{dtFmt}</td>
                      <td style={{ ...tdSt, fontFamily: 'var(--font-m)', color: 'var(--gray2)' }}>
                        {shortWallet(r.recipient)}
                      </td>
                      <td style={{ ...tdSt, color: 'var(--gray2)' }}>{fmtMic(r.micAmount)} MIC</td>
                      <td style={{ ...tdSt, fontSize: '0.55rem', color: 'var(--gray2)' }}>
                        {shortWallet(r.cancelledBy ?? '—')}
                      </td>
                      <td style={{ ...tdSt, fontSize: '0.55rem', color: 'var(--gray2)' }}>
                        {r.cancelReason || '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}
