'use client';

import React, { useEffect, useState, useCallback } from 'react';
import {
  fetchDistributors,
  fetchDistributorStats,
  grantDistributor,
  updateDistributor,
  deleteDistributor,
  fetchDistributorDetail,
  approvePayoutRequest,
  rejectPayoutRequest,
  markPayoutPaid,
} from '@/lib/api';
import { useMcUi } from '@/components/ui/McUi';
import { isOwnerWallet } from '@/lib/auth';

interface Distributor {
  id: string;
  wallet: string;
  grantedBy: string;
  commissionRate: string;
  isActive: boolean;
  totalEarned: string;
  totalOrders: number;
  notes: string | null;
  createdAt: string;
}

interface DistStats {
  totalDistributors: number;
  activeCount: number;
  disabledCount: number;
  totalEarned: string;
  totalOrders: number;
}

interface Earning {
  id: string;
  buyerWallet: string;
  orderAmount: string;
  commission: string;
  status: string;
  createdAt: string;
  payoutRequestId?: string | null;
  purchase?: {
    id: string;
    type: string;
    packageName: string | null;
    txHash: string | null;
    createdAt: string;
  } | null;
}

interface PayoutRequest {
  id: string;
  status: 'PENDING' | 'APPROVED' | 'PAID' | 'REJECTED';
  grossAmount: string;
  feeBps: number;
  feeAmount: string;
  netAmount: string;
  earningCount: number;
  requestedAt: string;
  approvedAt?: string | null;
  approvedBy?: string | null;
  rejectedAt?: string | null;
  rejectedReason?: string | null;
  paidAt?: string | null;
  paidTxHash?: string | null;
}

const SZ = '0.62rem';

const fmt = (n: number) => (!n || isNaN(n)) ? '-' : n.toLocaleString();
const fmtUsd = (n: number) => (!n || isNaN(n)) ? '-' : '$' + n.toLocaleString();

export default function DistributorsPage() {
  const mcUi = useMcUi();
  const [distributors, setDistributors] = useState<Distributor[]>([]);
  const [stats, setStats] = useState<DistStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  // Grant form
  const [showGrant, setShowGrant] = useState(false);
  const [grantWallet, setGrantWallet] = useState('');
  const [grantMemberId, setGrantMemberId] = useState('');
  const [memberLookupStatus, setMemberLookupStatus] = useState<'idle' | 'checking' | 'found' | 'not_found'>('idle');
  const [grantRate, setGrantRate] = useState('20');
  const [grantNotes, setGrantNotes] = useState('');
  const [granting, setGranting] = useState(false);
  const memberIdTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const walletTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Detail view (earnings + payout requests)
  const [earningsWallet, setEarningsWallet] = useState<string | null>(null);
  const [earnings, setEarnings] = useState<Earning[]>([]);
  const [payoutRequests, setPayoutRequests] = useState<PayoutRequest[]>([]);
  const [earningsLoading, setEarningsLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Read wallet from JWT (owner-wallet gates fee field)
  const [userWallet, setUserWallet] = useState<string>('');
  useEffect(() => {
    try {
      const t = typeof window !== 'undefined' ? localStorage.getItem('mc-admin-jwt') : null;
      if (!t) return;
      const payload = JSON.parse(atob(t.split('.')[1]));
      setUserWallet(payload.wallet || '');
    } catch {}
  }, []);

  const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

  // Lookup: Member ID → Wallet or Wallet → Member ID
  const lookupByMemberId = useCallback(async (userId: string) => {
    if (!userId || userId.length < 3) { setMemberLookupStatus('idle'); return; }
    setMemberLookupStatus('checking');
    try {
      const res = await fetch(`${API_BASE}/auth/check-referrer?ref=${encodeURIComponent(userId)}`);
      const data = await res.json();
      if (data.valid) {
        if (data.wallet) setGrantWallet(data.wallet);
        setMemberLookupStatus('found');
      } else {
        setMemberLookupStatus('not_found');
      }
    } catch { setMemberLookupStatus('not_found'); }
  }, [API_BASE]);

  const lookupByWallet = useCallback(async (wallet: string) => {
    if (!wallet || wallet.length < 10) { setMemberLookupStatus('idle'); return; }
    setMemberLookupStatus('checking');
    try {
      const res = await fetch(`${API_BASE}/auth/check-referrer?ref=${encodeURIComponent(wallet)}`);
      const data = await res.json();
      if (data.valid && data.name) {
        setGrantMemberId(data.name);
        setMemberLookupStatus('found');
      } else {
        setMemberLookupStatus('not_found');
      }
    } catch { setMemberLookupStatus('not_found'); }
  }, [API_BASE]);

  const loadData = useCallback(async () => {
    try {
      const [distRes, statsRes] = await Promise.all([
        fetchDistributors({ page, limit: 20 }),
        fetchDistributorStats(),
      ]);
      setDistributors(distRes.data || []);
      setTotal(distRes.total || 0);
      setStats(statsRes);
    } catch (err) {
      console.error('Failed to load distributors', err);
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleGrant = async () => {
    if (!grantWallet.trim()) {
      mcUi.toast({ type: 'error', message: 'Wallet is required' });
      return;
    }
    const rateNum = Number(grantRate);
    if (isNaN(rateNum) || rateNum < 0 || rateNum > 20) {
      mcUi.toast({ type: 'error', message: 'Rate must be between 0 and 20%' });
      return;
    }
    setGranting(true);
    try {
      await grantDistributor({
        wallet: grantWallet.trim(),
        commissionRate: rateNum / 100,
        notes: grantNotes || undefined,
      });
      setShowGrant(false);
      setGrantWallet('');
      setGrantMemberId('');
      setMemberLookupStatus('idle');
      setGrantRate('20');
      setGrantNotes('');
      mcUi.toast({ type: 'success', message: 'Distributor granted successfully' });
      await loadData();
    } catch (err: any) {
      mcUi.toast({ type: 'error', message: 'Grant failed: ' + (err.message || 'Unknown error') });
    } finally {
      setGranting(false);
    }
  };

  const handleToggle = async (wallet: string, currentActive: boolean) => {
    try {
      await updateDistributor(wallet, { isActive: !currentActive });
      await loadData();
    } catch (err: any) {
      mcUi.toast({ type: 'error', message: 'Update failed: ' + (err.message || 'Unknown error') });
    }
  };

  const handleDelete = async (wallet: string) => {
    const ok = await mcUi.confirm({
      title: 'Delete Distributor',
      message: (
        <>
          Permanently remove distributor <code style={{ color: 'var(--gold)' }}>{wallet.slice(0, 10)}...{wallet.slice(-6)}</code>?
          {' '}This cannot be undone. Past earnings remain in the audit log.
        </>
      ),
      confirmLabel: 'Delete',
      cancelLabel: 'Keep',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await deleteDistributor(wallet);
      mcUi.toast({ type: 'success', message: 'Distributor deleted' });
      await loadData();
    } catch (err: any) {
      mcUi.toast({ type: 'error', message: 'Delete failed: ' + (err.message || 'Unknown error') });
    }
  };

  const loadDetail = async (wallet: string) => {
    if (earningsWallet === wallet) {
      setEarningsWallet(null);
      setPayoutRequests([]);
      setEarnings([]);
      return;
    }
    setEarningsWallet(wallet);
    setEarningsLoading(true);
    try {
      const res = await fetchDistributorDetail(wallet);
      setEarnings(res.data?.earnings || []);
      setPayoutRequests(res.data?.payoutRequests || []);
    } catch (err) {
      console.error('Failed to load distributor detail', err);
    } finally {
      setEarningsLoading(false);
    }
  };

  const handleApprove = async (request: PayoutRequest) => {
    let feeBps = 0;
    if (isOwnerWallet(userWallet)) {
      const feePctStr = await mcUi.prompt({
        title: 'Apply Withdrawal Fee',
        message: (
          <>
            Gross amount: <b style={{ color: 'var(--gold)' }}>${Number(request.grossAmount).toLocaleString('en-US', { minimumFractionDigits: 2 })}</b>.
            Optional processing fee (0–10%, default 0%).
          </>
        ),
        label: 'Fee percentage',
        placeholder: '0',
        defaultValue: '0',
        validator: (v) => {
          const n = parseFloat(v);
          if (isNaN(n) || n < 0 || n > 10) return 'Fee must be between 0 and 10';
          return null;
        },
        confirmLabel: 'Approve',
        cancelLabel: 'Cancel',
      });
      if (feePctStr === null) return;
      feeBps = Math.round(parseFloat(feePctStr) * 100);
    }
    setActionLoading(request.id);
    try {
      const res = await approvePayoutRequest(request.id, feeBps);
      mcUi.toast({ type: 'success', message: res.data?.message || 'Approved' });
      const w = earningsWallet;
      setEarningsWallet(null);
      setPayoutRequests([]);
      setEarnings([]);
      if (w) loadDetail(w);
      loadData();
    } catch (err: any) {
      mcUi.toast({ type: 'error', message: err?.message || 'Approve failed' });
    } finally {
      setActionLoading(null);
    }
  };

  const handleReject = async (request: PayoutRequest) => {
    const reason = await mcUi.prompt({
      title: 'Reject Payout Request',
      message: 'Provide a reason (min 3 characters) for the audit log. The distributor will see this rejection reason.',
      label: 'Rejection reason',
      placeholder: 'e.g. Invalid earnings, dispute under review…',
      multiline: true,
      validator: (v) => (v.trim().length < 3 ? 'Reason must be at least 3 characters' : null),
      confirmLabel: 'Reject',
      cancelLabel: 'Cancel',
    });
    if (reason === null) return;
    setActionLoading(request.id);
    try {
      const res = await rejectPayoutRequest(request.id, reason.trim());
      mcUi.toast({ type: 'success', message: res.data?.message || 'Rejected' });
      setEarningsWallet(null);
      loadData();
    } catch (err: any) {
      mcUi.toast({ type: 'error', message: err?.message || 'Reject failed' });
    } finally {
      setActionLoading(null);
    }
  };

  const handleMarkPaid = async (request: PayoutRequest) => {
    const txHash = await mcUi.prompt({
      title: 'Mark Payout as Paid',
      message: (
        <>
          Net to send: <b style={{ color: 'var(--gold)' }}>${Number(request.netAmount).toLocaleString('en-US', { minimumFractionDigits: 2 })}</b>.
          Paste the USDT transfer transaction hash for record.
        </>
      ),
      label: 'Transaction hash',
      placeholder: '0x...',
      validator: (v) => (v.trim().length < 10 ? 'Tx hash must be at least 10 characters' : null),
      confirmLabel: 'Mark Paid',
      cancelLabel: 'Cancel',
    });
    if (txHash === null) return;
    setActionLoading(request.id);
    try {
      const res = await markPayoutPaid(request.id, txHash.trim());
      mcUi.toast({ type: 'success', message: res.data?.message || 'Marked as paid' });
      setEarningsWallet(null);
      loadData();
    } catch (err: any) {
      mcUi.toast({ type: 'error', message: err?.message || 'Mark-paid failed' });
    } finally {
      setActionLoading(null);
    }
  };

  const truncate = (s: string) => s.length > 14 ? s.slice(0, 8) + '...' + s.slice(-4) : s;

  if (loading) {
    return <div style={{ padding: 32, color: 'var(--muted)' }}>Loading distributors...</div>;
  }

  return (
    <div>
      <div className="page-hd">
        <div>
          <div className="page-eyebrow">Management</div>
          <div className="page-title">Distributor Management</div>
          <div className="page-sub">SEED Sale distribution partners — 20% commission</div>
        </div>
        <button
          className="btn btn-outline btn-sm"
          onClick={() => setShowGrant(!showGrant)}
          style={{ fontSize: SZ }}
        >
          {showGrant ? 'Cancel' : '+ Grant Distributor'}
        </button>
      </div>

      {/* Stats row */}
      {stats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12, marginBottom: 20 }}>
          {[
            { label: 'Total Distributors', value: fmt(stats.totalDistributors) },
            { label: 'Active', value: fmt(stats.activeCount) },
            { label: 'Total Earned (USDT)', value: fmtUsd(Number(stats.totalEarned)) },
            { label: 'Total Orders', value: fmt(stats.totalOrders) },
          ].map((s) => (
            <div key={s.label} className="stat-box">
              <div className="stat-val gold">{s.value}</div>
              <div className="stat-lbl">{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Grant form */}
      {showGrant && (
        <div className="card" style={{ padding: 20, marginBottom: 20 }}>
          <div className="card-title">Grant New Distributor</div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <div className="input-wrap">
              <div className="input-label">Member ID</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="text" value={grantMemberId}
                  onChange={(e) => {
                    const v = e.target.value.toLowerCase();
                    setGrantMemberId(v);
                    setMemberLookupStatus('idle');
                    if (memberIdTimer.current) clearTimeout(memberIdTimer.current);
                    memberIdTimer.current = setTimeout(() => lookupByMemberId(v), 500);
                  }}
                  placeholder="e.g. micadmin"
                  style={{ fontSize: SZ, fontFamily: 'var(--font-m)', padding: '5px 10px', width: 160 }}
                />
                {memberLookupStatus === 'checking' && <span style={{ fontSize: '0.52rem', color: 'var(--gray2)' }}>...</span>}
                {memberLookupStatus === 'found' && <span style={{ fontSize: '0.52rem', color: '#5cb85c' }}>&#10003;</span>}
                {memberLookupStatus === 'not_found' && <span style={{ fontSize: '0.52rem', color: '#d9534f' }}>&#10007;</span>}
              </div>
            </div>
            <div className="input-wrap">
              <div className="input-label">Wallet Address *</div>
              <input
                type="text" value={grantWallet}
                onChange={(e) => {
                  const v = e.target.value;
                  setGrantWallet(v);
                  setMemberLookupStatus('idle');
                  if (walletTimer.current) clearTimeout(walletTimer.current);
                  walletTimer.current = setTimeout(() => lookupByWallet(v), 500);
                }}
                placeholder="0x..."
                style={{ fontSize: SZ, fontFamily: 'var(--font-m)', padding: '5px 10px', width: 320 }}
              />
            </div>
            <div className="input-wrap">
              <div className="input-label">Rate (%) — max 20</div>
              <input
                type="number"
                min={0}
                max={20}
                step={1}
                value={grantRate}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === '') { setGrantRate(''); return; }
                  const n = Number(v);
                  if (isNaN(n)) return;
                  // Clamp to [0, 20] inclusive
                  if (n > 20) setGrantRate('20');
                  else if (n < 0) setGrantRate('0');
                  else setGrantRate(v);
                }}
                style={{ fontSize: SZ, fontFamily: 'var(--font-m)', padding: '5px 10px', width: 60 }}
              />
            </div>
            <div className="input-wrap">
              <div className="input-label">Notes</div>
              <input
                type="text" value={grantNotes} onChange={(e) => setGrantNotes(e.target.value)}
                placeholder="Optional..."
                style={{ fontSize: SZ, fontFamily: 'var(--font-m)', padding: '5px 10px', width: 160 }}
              />
            </div>
            <div className="input-wrap">
              <div className="input-label" style={{ visibility: 'hidden' }}>&nbsp;</div>
              <button
                className="btn btn-outline btn-sm"
                onClick={handleGrant} disabled={granting || memberLookupStatus === 'not_found'}
                style={{ fontSize: SZ }}
              >
                {granting ? 'Granting...' : 'Grant'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Distributors table */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: SZ }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)', background: 'rgba(255,255,255,0.03)' }}>
              <th style={thStyle}>Wallet</th>
              <th style={thStyle}>Status</th>
              <th style={thStyle}>Rate</th>
              <th style={thStyle}>Earned (USDT)</th>
              <th style={thStyle}>Orders</th>
              <th style={thStyle}>Created</th>
              <th style={thStyle}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {distributors.map((d) => (
              <React.Fragment key={d.id}>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={tdStyle}>
                    <span title={d.wallet} style={{ cursor: 'pointer' }}>{truncate(d.wallet)}</span>
                  </td>
                  <td style={tdStyle}>
                    <span style={{
                      padding: '2px 8px', borderRadius: 10, fontSize: SZ, fontWeight: 600,
                      background: d.isActive ? 'rgba(92,184,92,0.2)' : 'rgba(255,255,255,0.1)',
                      color: d.isActive ? '#5cb85c' : '#999',
                    }}>
                      {d.isActive ? 'Active' : 'Disabled'}
                    </span>
                  </td>
                  <td style={tdStyle}>{(Number(d.commissionRate) * 100).toFixed(0)}%</td>
                  <td style={tdStyle}>{fmtUsd(Number(d.totalEarned))}</td>
                  <td style={tdStyle}>{fmt(d.totalOrders)}</td>
                  <td style={tdStyle}>{new Date(d.createdAt).toLocaleDateString()}</td>
                  <td style={tdStyle}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button onClick={() => handleToggle(d.wallet, d.isActive)} style={btnSmall}>
                        {d.isActive ? 'Disable' : 'Enable'}
                      </button>
                      <button onClick={() => loadDetail(d.wallet)} style={btnSmall}>
                        {earningsWallet === d.wallet ? 'Hide' : 'Detail'}
                      </button>
                      <button onClick={() => handleDelete(d.wallet)} style={{ ...btnSmall, color: '#d9534f' }}>
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
                {earningsWallet === d.wallet && (
                  <tr>
                    <td colSpan={7} style={{ padding: '16px', background: 'rgba(255,255,255,0.02)' }}>
                      {earningsLoading ? (
                        <span style={{ color: 'var(--muted)' }}>Loading detail...</span>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                          {/* ── PAYOUT REQUESTS ────────────── */}
                          <section>
                            <h4 style={{ margin: '0 0 8px 0', fontSize: '0.7rem', color: 'var(--gold)', letterSpacing: 0.5 }}>
                              PAYOUT REQUESTS ({payoutRequests.length})
                            </h4>
                            {payoutRequests.length === 0 ? (
                              <span style={{ color: 'var(--muted)', fontSize: SZ }}>No payout requests yet</span>
                            ) : (
                              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: SZ }}>
                                <thead>
                                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                                    <th style={thStyle}>Requested</th>
                                    <th style={thStyle}>Gross</th>
                                    <th style={thStyle}>Fee</th>
                                    <th style={thStyle}>Net</th>
                                    <th style={thStyle}>Orders</th>
                                    <th style={thStyle}>Status</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {payoutRequests.map((r) => {
                                    // Status display (read-only — actions live on /payment-requests page)
                                    // Workflow Apr 29: PENDING → PAID atomically (no intermediate APPROVED state)
                                    const isPaid = r.status === 'PAID';
                                    // Treat any legacy APPROVED as still pending (action in /payment-requests)
                                    const isPending = r.status === 'PENDING' || r.status === 'APPROVED';
                                    const statusLabel =
                                      isPaid ? 'Approved' :
                                      r.status === 'REJECTED' ? 'Rejected' :
                                      'Pending';
                                    const statusColor =
                                      isPaid ? '#66BB6A' :
                                      r.status === 'REJECTED' ? '#EF5350' :
                                      'var(--gold)';
                                    void isPending;
                                    return (
                                      <tr key={r.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                                        <td style={tdStyle}>{new Date(r.requestedAt).toLocaleString()}</td>
                                        <td style={tdStyle}>{fmtUsd(Number(r.grossAmount))}</td>
                                        <td style={tdStyle}>{r.feeBps > 0 ? `${(r.feeBps / 100).toFixed(1)}%` : '-'}</td>
                                        <td style={tdStyle}>{fmtUsd(Number(r.netAmount))}</td>
                                        <td style={tdStyle}>{r.earningCount}</td>
                                        <td style={{ ...tdStyle }}>
                                          <span style={{ color: statusColor, fontWeight: 700 }}>{statusLabel}</span>
                                          {isPaid && r.paidTxHash && (
                                            <>
                                              {' '}&middot;{' '}
                                              <a
                                                href={`https://bscscan.com/tx/${r.paidTxHash}`}
                                                target="_blank" rel="noopener noreferrer"
                                                style={{ color: 'var(--gold)', textDecoration: 'none', fontSize: '0.6rem' }}>
                                                View Tx
                                              </a>
                                            </>
                                          )}
                                          {r.status === 'REJECTED' && r.rejectedReason && (
                                            <div style={{ color: 'var(--muted)', fontSize: '0.55rem', marginTop: 2 }} title={r.rejectedReason}>
                                              {r.rejectedReason.slice(0, 30)}{r.rejectedReason.length > 30 ? '...' : ''}
                                            </div>
                                          )}
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            )}
                          </section>

                          {/* ── ORDERS / EARNINGS ────────────── */}
                          <section>
                            <h4 style={{ margin: '0 0 8px 0', fontSize: '0.7rem', color: 'var(--gold)', letterSpacing: 0.5 }}>
                              ORDERS &amp; COMMISSIONS ({earnings.length})
                            </h4>
                            {earnings.length === 0 ? (
                              <span style={{ color: 'var(--muted)', fontSize: SZ }}>No earnings yet</span>
                            ) : (
                              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: SZ }}>
                                <thead>
                                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                                    <th style={thStyle}>Buyer</th>
                                    <th style={thStyle}>Package</th>
                                    <th style={thStyle}>Order</th>
                                    <th style={thStyle}>Commission</th>
                                    <th style={thStyle}>Status</th>
                                    <th style={thStyle}>Date</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {earnings.map((e) => (
                                    <tr key={e.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                                      <td style={tdStyle}>{truncate(e.buyerWallet)}</td>
                                      <td style={tdStyle}>{e.purchase?.packageName || e.purchase?.type || '-'}</td>
                                      <td style={tdStyle}>{fmtUsd(Number(e.orderAmount))}</td>
                                      <td style={tdStyle}>{fmtUsd(Number(e.commission))}</td>
                                      <td style={tdStyle}>{e.status}</td>
                                      <td style={tdStyle}>{new Date(e.createdAt).toLocaleDateString()}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                          </section>
                        </div>
                      )}
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
            {distributors.length === 0 && (
              <tr>
                <td colSpan={7} style={{ padding: 20, textAlign: 'center', color: 'var(--muted)', fontSize: '0.56rem' }}>
                  No distributors yet. Click &ldquo;+ Grant Distributor&rdquo; to add one.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {total > 20 && (
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 16 }}>
          <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page <= 1} style={btnSmall}>Prev</button>
          <span style={{ color: 'var(--gray)', fontSize: SZ, lineHeight: '28px' }}>Page {page}</span>
          <button onClick={() => setPage(page + 1)} disabled={distributors.length < 20} style={btnSmall}>Next</button>
        </div>
      )}
    </div>
  );
}

const thStyle: React.CSSProperties = {
  padding: '8px 10px',
  textAlign: 'left',
  color: 'var(--gray)',
  fontWeight: 600,
  fontSize: '0.58rem',
  fontFamily: 'var(--font-d)',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
};

const tdStyle: React.CSSProperties = {
  padding: '7px 10px',
  color: 'var(--white)',
  fontSize: SZ,
};

const btnSmall: React.CSSProperties = {
  padding: '3px 10px',
  background: 'rgba(255,255,255,0.08)',
  color: 'var(--white)',
  border: '1px solid var(--border)',
  borderRadius: 4,
  cursor: 'pointer',
  fontSize: SZ,
};
