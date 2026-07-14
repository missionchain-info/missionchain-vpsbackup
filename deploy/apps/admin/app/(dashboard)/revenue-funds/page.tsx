'use client';

import Link from 'next/link';
import { useState, useEffect, useCallback } from 'react';
import {
  fetchOperationalPool,
  enrollOperationalPoolMember,
  updateOperationalPoolMember,
  removeOperationalPoolMember,
  fetchStewardCouncil,
  type OperationalPoolMember,
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

const shortWallet = (w: string) => (w.length > 12 ? `${w.slice(0, 6)}...${w.slice(-4)}` : w);

const TABS = [
  { id: 'seed',    label: 'SEED Sale',  enabled: true },
  { id: 'presale', label: 'Pre-Sale',   enabled: false },
  { id: 'mice',    label: 'MICE Sale',  enabled: false },
];

export default function RevenueFundsPage() {
  const { user } = useAuth();
  const isOwner = isOwnerWallet(user?.wallet);
  const [activeTab, setActiveTab] = useState('seed');

  return (
    <>
      <div className="page-hd">
        <div>
          <div className="page-eyebrow">Treasury</div>
          <div className="page-title">Revenue &amp; Funds</div>
          <div className="page-sub">Distribution of sale revenue across operational and treasury pools.</div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, borderBottom: '1px solid var(--border)' }}>
        {TABS.map((t) => (
          <button
            key={t.id}
            disabled={!t.enabled}
            onClick={() => t.enabled && setActiveTab(t.id)}
            style={{
              padding: '10px 18px',
              fontSize: '0.7rem',
              fontFamily: 'var(--font-d)',
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              background: 'transparent',
              border: 'none',
              borderBottom: activeTab === t.id ? '2px solid var(--gold)' : '2px solid transparent',
              color: activeTab === t.id ? 'var(--gold)' : t.enabled ? 'var(--white)' : 'var(--gray2)',
              cursor: t.enabled ? 'pointer' : 'not-allowed',
              opacity: t.enabled ? 1 : 0.4,
            }}
          >
            {t.label}{!t.enabled && ' (soon)'}
          </button>
        ))}
      </div>

      {activeTab === 'seed' && <SeedSaleTab isOwner={isOwner} />}
    </>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// SEED SALE TAB
// ──────────────────────────────────────────────────────────────────────────

function SeedSaleTab({ isOwner }: { isOwner: boolean }) {
  const mcUi = useMcUi();

  // Section state — Operational Activities
  const [opPool, setOpPool] = useState<{
    members: OperationalPoolMember[];
    totalShareBps: number;
    weekIdx: number;
    totalClaimable: number;
    totalAllocated: number;
    totalClaimed: number;
  } | null>(null);
  const [opLoading, setOpLoading] = useState(true);
  const [council, setCouncil] = useState<StewardCouncilMember[]>([]);

  const [showEnroll, setShowEnroll] = useState(false);
  const [enrollForm, setEnrollForm] = useState({ wallet: '', sharePctBps: 0, weeklyMaxoutUsdt: 0 });
  const [editingWallet, setEditingWallet] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ sharePctBps: 0, weeklyMaxoutUsdt: 0 });

  const loadAll = useCallback(async () => {
    setOpLoading(true);
    try {
      const [opRes, cRes] = await Promise.all([fetchOperationalPool(), fetchStewardCouncil()]);
      setOpPool(opRes.data);
      setCouncil(cRes.data || []);
    } catch (err: any) {
      console.error('Failed to load Op pool', err);
    } finally {
      setOpLoading(false);
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  const handleEnroll = async () => {
    if (!enrollForm.wallet || enrollForm.sharePctBps <= 0) {
      mcUi.toast({ type: 'error', message: 'Wallet and share % required' });
      return;
    }
    try {
      await enrollOperationalPoolMember({
        wallet: enrollForm.wallet,
        sharePctBps: enrollForm.sharePctBps,
        weeklyMaxoutUsdt: enrollForm.weeklyMaxoutUsdt,
      });
      mcUi.toast({ type: 'success', message: 'Member added to Operational Pool' });
      setShowEnroll(false);
      setEnrollForm({ wallet: '', sharePctBps: 0, weeklyMaxoutUsdt: 0 });
      await loadAll();
    } catch (err: any) {
      mcUi.toast({ type: 'error', message: err.message || 'Failed to add' });
    }
  };

  const handleSaveEdit = async (wallet: string) => {
    try {
      await updateOperationalPoolMember(wallet, editForm);
      mcUi.toast({ type: 'success', message: 'Member updated' });
      setEditingWallet(null);
      await loadAll();
    } catch (err: any) {
      mcUi.toast({ type: 'error', message: err.message || 'Failed to update' });
    }
  };

  const handleRemove = async (wallet: string, memberId: string) => {
    const ok = await mcUi.confirm({
      title: 'Remove from Operational Pool',
      message: <>Remove <b>{memberId}</b> from operational pool? Their pending claimable balance is preserved.</>,
      confirmLabel: 'Remove',
    });
    if (!ok) return;
    try {
      await removeOperationalPoolMember(wallet);
      mcUi.toast({ type: 'success', message: 'Removed' });
      await loadAll();
    } catch (err: any) {
      mcUi.toast({ type: 'error', message: err.message || 'Failed to remove' });
    }
  };

  // Council members not yet enrolled
  const enrolledWallets = new Set(opPool?.members.map((m) => m.wallet.toLowerCase()) ?? []);
  const availableCouncil = council.filter((c) => c.active && !enrolledWallets.has(c.wallet.toLowerCase()));

  const totalSharePct = (opPool?.totalShareBps ?? 0) / 100;
  const remainingBps = 10000 - (opPool?.totalShareBps ?? 0);

  return (
    <>
      {/* ═══ SEED Sale Stats Header ═══ */}
      <SeedSaleStats />

      {/* ═══ Pool Sections (5) ═══ */}

      <PoolSection
        title="Distribution Agent (KPI)"
        pct="20%"
        note="Already implemented — see Distributors page"
      >
        <div style={{ padding: 16, color: 'var(--gray2)', fontSize: SZ }}>
          Existing distributor program manages this pool. View at{' '}
          <Link href="/distributors" style={{ color: 'var(--gold)' }}>Distributors ↗</Link>
        </div>
      </PoolSection>

      <PoolSection
        title="Operational Activities"
        pct="20%"
        note="Funds Dist. — Steward Council members + % allocation + weekly maxout"
      >
        {/* Stats row */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, padding: 16 }}>
          <Stat label="Total Share Allocated" value={`${totalSharePct.toFixed(2)}%`} hint={`${remainingBps} bps remaining`} />
          <Stat label="Total Claimable" value={`$${(opPool?.totalClaimable ?? 0).toLocaleString()}`} />
          <Stat label="Total Claimed (lifetime)" value={`$${(opPool?.totalClaimed ?? 0).toLocaleString()}`} />
          <Stat label="Week Idx" value={String(opPool?.weekIdx ?? 0)} hint="Mon-Sun GMT (approx)" />
        </div>

        {isOwner && (
          <div style={{ padding: '0 16px 12px', display: 'flex', justifyContent: 'flex-end' }}>
            <button
              className="btn btn-gold btn-sm"
              style={{ fontSize: SZ, padding: '5px 12px' }}
              onClick={() => setShowEnroll(!showEnroll)}
              disabled={availableCouncil.length === 0}
            >
              {showEnroll ? 'Cancel' : '+ ADD COUNCIL MEMBER'}
            </button>
          </div>
        )}

        {isOwner && showEnroll && (
          <div style={{ padding: 16, borderTop: '1px solid var(--border)', background: 'rgba(212,160,23,.04)' }}>
            <div style={{ fontFamily: 'var(--font-d)', fontSize: '0.65rem', color: 'var(--gold)', marginBottom: 10 }}>
              ADD MEMBER (must be on Steward Council first)
            </div>
            {availableCouncil.length === 0 ? (
              <div style={{ fontSize: SZ, color: 'var(--gray2)' }}>
                All active council members already enrolled. Add new members via{' '}
                <Link href="/steward-council" style={{ color: 'var(--gold)' }}>Steward Council ↗</Link>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr auto', gap: 10, alignItems: 'flex-end' }}>
                <div>
                  <div style={thSt}>Council Member</div>
                  <select
                    value={enrollForm.wallet}
                    onChange={(e) => setEnrollForm({ ...enrollForm, wallet: e.target.value })}
                    style={inputSt}
                  >
                    <option value="">— Choose —</option>
                    {availableCouncil.map((c) => (
                      <option key={c.wallet} value={c.wallet}>
                        {c.memberId} — {c.role} ({shortWallet(c.wallet)})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <div style={thSt}>Share %</div>
                  <input
                    type="number"
                    min="0.01"
                    max="100"
                    step="0.01"
                    value={enrollForm.sharePctBps / 100 || ''}
                    onChange={(e) => setEnrollForm({ ...enrollForm, sharePctBps: Math.round(parseFloat(e.target.value) * 100) || 0 })}
                    placeholder="e.g. 7"
                    style={inputSt}
                  />
                </div>
                <div>
                  <div style={thSt}>Weekly Maxout (USDT)</div>
                  <input
                    type="number"
                    min="0"
                    value={enrollForm.weeklyMaxoutUsdt || ''}
                    onChange={(e) => setEnrollForm({ ...enrollForm, weeklyMaxoutUsdt: parseFloat(e.target.value) || 0 })}
                    placeholder="e.g. 5000"
                    style={inputSt}
                  />
                </div>
                <button className="btn btn-gold btn-sm" style={{ fontSize: SZ }} onClick={handleEnroll}>Add</button>
              </div>
            )}
          </div>
        )}

        {/* Members table */}
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={thSt}>Member ID</th>
                <th style={thSt}>Wallet</th>
                <th style={thSt}>Role</th>
                <th style={thSt}>Share %</th>
                <th style={thSt}>Weekly Maxout</th>
                <th style={thSt}>This Week Allocated</th>
                <th style={thSt}>Claimable</th>
                <th style={thSt}>Total Claimed</th>
                <th style={{ ...thSt, textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {opLoading ? (
                <tr><td colSpan={9} style={{ padding: 20, textAlign: 'center', color: 'var(--muted)', fontSize: SZ }}>Loading...</td></tr>
              ) : (opPool?.members.length ?? 0) === 0 ? (
                <tr><td colSpan={9} style={{ padding: 20, textAlign: 'center', color: 'var(--muted)', fontSize: SZ }}>No members enrolled yet.</td></tr>
              ) : opPool!.members.map((m) => (
                <tr key={m.wallet}>
                  <td style={tdSt}><strong>{m.memberId}</strong></td>
                  <td style={{ ...tdSt, fontFamily: 'var(--font-m)', color: 'var(--gold)' }}>
                    {shortWallet(m.wallet)}<OwnerCrown wallet={m.wallet} />
                  </td>
                  <td style={tdSt}>{m.role}</td>
                  <td style={tdSt}>
                    {editingWallet === m.wallet ? (
                      <input
                        type="number" min="0.01" max="100" step="0.01"
                        value={editForm.sharePctBps / 100 || ''}
                        onChange={(e) => setEditForm({ ...editForm, sharePctBps: Math.round(parseFloat(e.target.value) * 100) || 0 })}
                        style={{ ...inputSt, width: 80 }}
                      />
                    ) : `${(m.sharePctBps / 100).toFixed(2)}%`}
                  </td>
                  <td style={tdSt}>
                    {editingWallet === m.wallet ? (
                      <input
                        type="number" min="0"
                        value={editForm.weeklyMaxoutUsdt || ''}
                        onChange={(e) => setEditForm({ ...editForm, weeklyMaxoutUsdt: parseFloat(e.target.value) || 0 })}
                        style={{ ...inputSt, width: 100 }}
                      />
                    ) : `$${m.weeklyMaxoutUsdt.toLocaleString()}`}
                  </td>
                  <td style={tdSt}>${m.allocatedThisWeek.toLocaleString()}</td>
                  <td style={{ ...tdSt, color: 'var(--gold)', fontWeight: 700 }}>
                    ${m.claimableUsdt.toLocaleString()}
                  </td>
                  <td style={tdSt}>${m.totalClaimedUsdt.toLocaleString()}</td>
                  <td style={{ ...tdSt, textAlign: 'right' }}>
                    {editingWallet === m.wallet ? (
                      <>
                        <button className="btn btn-gold btn-sm" style={{ fontSize: SZ, marginRight: 4 }} onClick={() => handleSaveEdit(m.wallet)}>Save</button>
                        <button className="btn btn-outline btn-sm" style={{ fontSize: SZ }} onClick={() => setEditingWallet(null)}>Cancel</button>
                      </>
                    ) : (
                      <>
                        {isOwner && (
                          <>
                            <button
                              className="btn btn-outline btn-sm"
                              style={{ fontSize: SZ, marginRight: 4 }}
                              onClick={() => {
                                setEditingWallet(m.wallet);
                                setEditForm({ sharePctBps: m.sharePctBps, weeklyMaxoutUsdt: m.weeklyMaxoutUsdt });
                              }}
                            >Edit</button>
                            <button
                              className="btn btn-outline btn-sm"
                              style={{ fontSize: SZ, color: 'var(--crimson2)', borderColor: 'rgba(107,20,40,.3)', marginRight: 4 }}
                              onClick={() => handleRemove(m.wallet, m.memberId)}
                            >Remove</button>
                          </>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

      </PoolSection>

      <PoolSection
        title="Management Bonus"
        pct="10%"
        note="Steward Council orders + 75% threshold approval — coming in Phase 2c"
      >
        <div style={{ padding: 16, color: 'var(--gray2)', fontSize: SZ }}>
          Pool will receive 10% of SEED revenue. Council members create bonus orders, approval threshold (configurable, default 75%) to execute. Owner can cancel.
        </div>
      </PoolSection>

      <PoolSection
        title="Reserved"
        pct="50%"
        note="DAO-decided expenses — managed via Steward Council ≥75% vote (Phase 1) → DAOGovernor (Phase β)"
      >
        <div style={{ padding: 16, color: 'var(--gray2)', fontSize: SZ }}>
          Allocations approved by DAO Governor proposals. View at{' '}
          <Link href="/dao" style={{ color: 'var(--gold)' }}>DAO Governance ↗</Link>
        </div>
      </PoolSection>
    </>
  );
}

// ─── Header Stats ──────────────────────────────────────────────────────

function SeedSaleStats() {
  return (
    <div className="card" style={{ marginBottom: 16, padding: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        <Stat label="Total Quota" value="227,500,000 MIC" />
        <Stat label="Strategic Partners Granted" value="—" hint="X / 75M MIC" />
        <Stat label="SEED Public Sold" value="—" hint="Y / 152.5M MIC" />
        <Stat label="Sale Revenue" value="—" hint="USDT" />
      </div>
      <div style={{ marginTop: 8, fontSize: '0.55rem', color: 'var(--gray2)' }}>
        Stats wiring will be added once SEED on-chain integration is updated (Phase 2d).
      </div>
    </div>
  );
}

// ─── Pool Section Wrapper ──────────────────────────────────────────────

function PoolSection({ title, pct, note, children }: { title: string; pct: string; note: string; children: React.ReactNode }) {
  return (
    <div className="card" style={{ marginBottom: 16, padding: 0 }}>
      <div style={{
        padding: '12px 16px',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
      }}>
        <div>
          <div style={{ fontFamily: 'var(--font-d)', fontSize: '0.85rem', color: 'var(--gold)', letterSpacing: '0.04em' }}>
            {title} <span style={{ marginLeft: 8, fontSize: '0.65rem', color: 'var(--cyan)' }}>{pct}</span>
          </div>
          <div style={{ fontSize: '0.55rem', color: 'var(--gray2)', marginTop: 2 }}>{note}</div>
        </div>
      </div>
      {children}
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div style={{ padding: '10px 12px', background: 'var(--bg4)', borderRadius: 6 }}>
      <div style={{ fontSize: '0.5rem', color: 'var(--gray2)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
        {label}
      </div>
      <div style={{ fontSize: '0.95rem', color: 'var(--white)', fontWeight: 700, marginTop: 4, fontFamily: 'var(--font-m)' }}>
        {value}
      </div>
      {hint && (
        <div style={{ fontSize: '0.5rem', color: 'var(--gray2)', marginTop: 2 }}>{hint}</div>
      )}
    </div>
  );
}
