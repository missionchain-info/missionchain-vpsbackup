'use client';

import { useEffect, useState, useCallback } from 'react';
import { fetchStatsOverview, fetchDistributorStats, fetchDashboardOverview } from '@/lib/api';

const SZ = '0.62rem';

/* ── helpers ── */
const fmt = (v: number | string, decimals = 0) => {
  const n = typeof v === 'string' ? parseFloat(v) : v;
  if (!n || isNaN(n)) return '-';
  return n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
};
const fmtUsd = (v: number | string) => {
  const n = typeof v === 'string' ? parseFloat(v) : v;
  if (!n || isNaN(n)) return '-';
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
const pct = (a: number, b: number) => (b === 0 ? 0 : Math.min((a / b) * 100, 100));

/* ── MICE 5-round pricing ── */
const MICE_ROUNDS = [
  { label: 'R1', range: '1 – 20K', price: 100, cap: 20000 },
  { label: 'R2', range: '20K – 40K', price: 200, cap: 20000 },
  { label: 'R3', range: '40K – 60K', price: 300, cap: 20000 },
  { label: 'R4', range: '60K – 80K', price: 400, cap: 20000 },
  { label: 'R5', range: '80K – 100K', price: 500, cap: 20000 },
];

function currentMiceRound(sold: number) {
  if (sold < 20000) return 0;
  if (sold < 40000) return 1;
  if (sold < 60000) return 2;
  if (sold < 80000) return 3;
  return 4;
}

export default function StatsPage() {
  const [d, setD] = useState<any>(null);
  const [distStats, setDistStats] = useState<any>(null);
  const [onchain, setOnchain] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState('');

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [statsRes, distRes, onchainRes] = await Promise.all([
        fetchStatsOverview().catch(() => null),
        fetchDistributorStats().catch(() => null),
        fetchDashboardOverview().catch(() => null),
      ]);
      if (statsRes?.data) setD(statsRes.data);
      setDistStats(distRes);
      if (onchainRes?.data) setOnchain(onchainRes.data);
      setLastUpdate(new Date().toLocaleTimeString());
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  /* derived — on-chain values from /dashboard/overview, admin values from /admin/stats */
  const s = d || {};
  const oc = onchain || {};
  const preIssued = Number(oc.preIssued || 1_050_000_000);
  const mined = Number(oc.totalEmitted || s.mining?.totalEmitted || 0);
  const staked = Number(oc.totalStaked || s.staking?.totalStaked || 0);
  const burned = Number(oc.totalBurned || s.mice?.micBurned || 0);
  const inContractReserves = Number(oc.inContractReserves || 0);  // Refined Option 2 (2026-05-10)
  const vestingLocked      = Number(oc.vestingLocked || 0);       // Refined Option 2 (2026-05-10)
  const circulating = Number(oc.circulatingSupply || 0);
  const totalEmittedAll = preIssued + mined;
  const hardCap = Number(oc.totalSupply || 7_000_000_000);

  // MIC price: before SWAP → use current sale round price
  const micPrice = 0.0025; // SEED price while SWAP not live
  const priceSource = 'SEED Round';

  // Sales
  const seed = s.seed || {};
  const presale = s.presale || {};
  const mice = s.mice || {};
  const refs = s.referrals || {};
  const rev = s.revenue || {};
  const users = s.users || {};

  // MICE round calc
  const miceSold = mice.totalLicenses || 0;
  const currentRound = currentMiceRound(miceSold);

  return (
    <>
      <div className="page-hd">
        <div>
          <div className="page-eyebrow">Admin Dashboard</div>
          <div className="page-title">Overview</div>
          <div className="page-sub">Real-time ecosystem metrics</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {lastUpdate && (
            <span style={{ fontFamily: 'var(--font-m)', fontSize: '0.58rem', color: 'var(--gray2)' }}>
              Updated {lastUpdate}
            </span>
          )}
          <button className="btn btn-outline btn-sm" onClick={loadAll}>
            {'\u21BB'} Refresh
          </button>
        </div>
      </div>

      {/* ═══════════════════════════════════════════
          BLOCK 1: MIC TOKEN OVERVIEW
      ═══════════════════════════════════════════ */}
      <div className="sep-lbl">MIC Token</div>

      <div className="g4" style={{ marginBottom: 10 }}>
        <StatBox icon={'\u{1F4E6}'} label="Pre-issued (15%)" value={fmt(preIssued)} color="gold" loading={loading} />
        <StatBox icon={'\u{1F3E6}'} label="In-Contract Reserves" value={fmt(inContractReserves)} color="c" loading={loading}
          sub="Vault / Treasury / Sale" />
        <StatBox icon={'\u{1F512}'} label="Vesting (Locked)" value={fmt(vestingLocked)} color="c" loading={loading}
          sub="Cliff/monthly via LockManager" />
        <StatBox icon={'\u26CF\uFE0F'} label="Total Mined (85%)" value={fmt(mined)} color="p" loading={loading} />
      </div>
      <div className="g4" style={{ marginBottom: 10 }}>
        <StatBox icon={'\u{1F525}'} label="Total Burned" value={fmt(burned)} color="c" loading={loading} />
        <StatBox icon={'\u{1F4C8}'} label="Total Staking" value={fmt(staked)} color="p" loading={loading} />
        <StatBox icon={'\u{1F504}'} label="Circulating Supply" value={fmt(circulating)} color="g" loading={loading} />
        <StatBox icon={'\u{1F4B2}'} label="MIC Price" value={`$${micPrice}`} color="gold" loading={loading}
          sub={priceSource} />
      </div>
      <div className="g4" style={{ marginBottom: 10 }}>
        <StatBox icon={'\u{1F4CA}'} label="Market Cap (est.)" value={fmtUsd(circulating * micPrice)} color="g" loading={loading}
          sub={`Circulating \u00D7 $${micPrice}`} />
      </div>

      {/* Emission progress bar */}
      <div className="card" style={{ padding: '14px 20px', marginBottom: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
          <span style={{ fontFamily: 'var(--font-m)', fontSize: '0.58rem', color: 'var(--gray2)', letterSpacing: '.08em' }}>
            TOTAL EMITTED
          </span>
          <span style={{ fontFamily: 'var(--font-m)', fontSize: SZ, color: 'var(--gold2)' }}>
            {fmt(totalEmittedAll)} / {fmt(hardCap)} MIC ({pct(totalEmittedAll, hardCap) > 0 ? pct(totalEmittedAll, hardCap).toFixed(1) + "%" : "-"})
          </span>
        </div>
        <div className="prog-bar" style={{ height: 8 }}>
          <div className="prog-fill g" style={{ width: `${pct(totalEmittedAll, hardCap)}%` }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
          <span style={{ fontFamily: 'var(--font-m)', fontSize: '0.58rem', color: 'var(--gray2)' }}>
            Pre-issued: {pct(preIssued, hardCap) > 0 ? pct(preIssued, hardCap).toFixed(1) + "%" : "-"}
          </span>
          <span style={{ fontFamily: 'var(--font-m)', fontSize: '0.58rem', color: 'var(--gray2)' }}>
            Mined: {pct(mined, hardCap) > 0 ? pct(mined, hardCap).toFixed(2) + "%" : "-"}
          </span>
          <span style={{ fontFamily: 'var(--font-m)', fontSize: '0.58rem', color: 'var(--gray2)' }}>
            Hard Cap: 7,000,000,000
          </span>
        </div>
      </div>

      {/* ═══════════════════════════════════════════
          BLOCK 2: MEMBERS
      ═══════════════════════════════════════════ */}
      <div className="sep-lbl">Members</div>

      <div className="g4" style={{ marginBottom: 24 }}>
        <StatBox icon={'\u{1F465}'} label="Total Members" value={fmt(users.total || 0)} color="g" loading={loading} />
        <StatBox icon={'\u{1F4C5}'} label="New (30 days)" value={fmt(users.newThisMonth || 0)} color="gold" loading={loading} />
        <StatBox icon={'\u2705'} label="KYC Verified" value={fmt(users.kycVerified || 0)} color="g" loading={loading} />
        <StatBox icon={'\u23F3'} label="KYC Pending" value={fmt(users.pendingKyc || 0)} color="c" loading={loading}
          sub={users.pendingKyc > 0 ? 'Needs review' : ''} />
      </div>

      {/* ═══════════════════════════════════════════
          BLOCK 3a: SEED & PRE-SALE (2 cards, 1 row)
      ═══════════════════════════════════════════ */}
      <div className="sep-lbl">Sales Rounds</div>

      <div className="g2" style={{ marginBottom: 16 }}>
        {/* SEED ROUND */}
        <div className="card card-g" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{
            padding: '14px 20px 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            borderBottom: '1px solid var(--border)',
            background: 'rgba(201,168,76,.04)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: '1.2rem' }}>{'\u{1F331}'}</span>
              <span style={{ fontFamily: 'var(--font-d)', fontWeight: 800, fontSize: SZ, letterSpacing: '.06em' }}>SEED ROUND</span>
            </div>
            <span className="badge b-gold" style={{ fontSize: '0.5rem' }}>@ $0.0025</span>
          </div>
          <div style={{ padding: '16px 20px' }}>
            <SaleRow label="CAP" value={fmtUsd(seed.hardCap || 381250)} />
            <SaleProgress value={Number(seed.usdtRaised || 0)} max={seed.hardCap || 381250} />
            <SaleRow label="BUYERS" value={fmt(seed.buyers || 0)} />
            <SaleRow label="MIC SOLD" value={`${fmt(seed.micSold || 0)} / ${fmt(seed.allocation || 152500000)}`} />
            <SaleRow label="VOLUME ($)" value={fmtUsd(seed.usdtRaised || 0)} highlight="gold" />
            <SaleRow label="MKT COST" value={fmtUsd(seed.mktCost || 0)} sub="50% Operational" />
            <SaleRow label="FUND RAISED" value={fmtUsd(seed.fundRaised || 0)} highlight="g" sub="50% Net Capital" last />
          </div>
        </div>

        {/* PRE-SALE */}
        <div className="card card-p" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{
            padding: '14px 20px 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            borderBottom: '1px solid var(--border)',
            background: 'rgba(123,45,139,.04)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: '1.2rem' }}>{'\u{1F4B0}'}</span>
              <span style={{ fontFamily: 'var(--font-d)', fontWeight: 800, fontSize: SZ, letterSpacing: '.06em' }}>PRE-SALE</span>
            </div>
            <span className="badge b-purple" style={{ fontSize: '0.5rem' }}>@ $0.005</span>
          </div>
          <div style={{ padding: '16px 20px' }}>
            <SaleRow label="CAP" value={fmtUsd(presale.hardCap || 1575000)} />
            <SaleProgress value={Number(presale.usdtRaised || 0)} max={presale.hardCap || 1575000} />
            <SaleRow label="BUYERS" value={fmt(presale.buyers || 0)} />
            <SaleRow label="MIC SOLD" value={`${fmt(presale.micSold || 0)} / ${fmt(presale.allocation || 315000000)}`} />
            <SaleRow label="VOLUME ($)" value={fmtUsd(presale.usdtRaised || 0)} highlight="gold" />
            <SaleRow label="MKT COST" value={fmtUsd(presale.mktCost || 0)} sub="35% Marketing" />
            <SaleRow label="FUND RAISED" value={fmtUsd(presale.fundRaised || 0)} highlight="g" sub="57.5% Net Capital" last />
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════
          BLOCK 3b: MICE LICENSE (full width)
      ═══════════════════════════════════════════ */}
      <div className="card card-c" style={{ padding: 0, overflow: 'hidden', marginBottom: 24 }}>
        <div style={{
          padding: '14px 20px 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          borderBottom: '1px solid var(--border)',
          background: 'rgba(107,20,40,.04)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: '1.2rem' }}>{'\u{1FAA5}'}</span>
            <span style={{ fontFamily: 'var(--font-d)', fontWeight: 800, fontSize: SZ, letterSpacing: '.06em' }}>MICE LICENSE</span>
          </div>
          <span className="badge b-crimson" style={{ fontSize: '0.5rem' }}>
            Current: Round {currentRound + 1} @ ${MICE_ROUNDS[currentRound].price}
          </span>
        </div>
        <div style={{ padding: '16px 20px' }}>
          <div className="g2" style={{ gap: 32 }}>
            {/* Left: Metrics */}
            <div>
              <SaleRow label="CAP" value={`${fmt(mice.maxSupply || 100000)} Licenses`} />
              <SaleProgress value={miceSold} max={100000} label={`${fmt(miceSold)} / 100,000`} />
              <SaleRow label="BUYERS" value={fmt(mice.buyers || 0)} />
              <SaleRow label="MICE SOLD" value={fmt(miceSold)} />
              <SaleRow label="MIC BURNED" value={fmt(mice.micBurned || 0)} highlight="c" sub="50% of payment" />
              <SaleRow label="VOLUME ($)" value={fmtUsd(mice.usdtRaised || 0)} highlight="gold" sub="USDT portion (50%)" />
              <SaleRow label="MKT COST" value={fmtUsd(mice.mktCost || 0)} sub="35% Marketing" />
              <SaleRow label="FUND RAISED" value={fmtUsd(mice.fundRaised || 0)} highlight="g" sub="57.5% Net Capital" last />
            </div>

            {/* Right: 5-Round pricing chart */}
            <div>
              <div style={{ fontFamily: 'var(--font-m)', fontSize: '0.58rem', letterSpacing: '.14em', color: 'var(--gray2)', marginBottom: 12, textTransform: 'uppercase' }}>
                5-Round Pricing Progress
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {MICE_ROUNDS.map((r, i) => {
                  const isActive = i === currentRound;
                  const isPast = i < currentRound;
                  const roundStart = i * 20000;
                  const roundSold = isPast ? 20000 : (isActive ? Math.max(0, miceSold - roundStart) : 0);
                  const roundPct = (roundSold / 20000) * 100;
                  return (
                    <div key={i} style={{
                      padding: '8px 12px',
                      borderRadius: 8,
                      background: isActive ? 'rgba(107,20,40,.12)' : 'var(--bg4)',
                      border: isActive ? '1px solid var(--crimson)' : '1px solid var(--border)',
                      opacity: isPast ? 0.5 : 1,
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                        <span style={{ fontFamily: 'var(--font-d)', fontSize: SZ, fontWeight: 700, color: isActive ? 'var(--white)' : 'var(--gray)' }}>
                          {r.label}: {r.range}
                          {isActive && <span style={{ marginLeft: 6, color: 'var(--crimson2)', fontSize: '0.58rem' }}>{'\u25CF'} ACTIVE</span>}
                          {isPast && <span style={{ marginLeft: 6, color: 'var(--gray2)', fontSize: '0.58rem' }}>{'\u2713'} SOLD OUT</span>}
                        </span>
                        <span style={{ fontFamily: 'var(--font-m)', fontSize: SZ, fontWeight: 700, color: 'var(--gold2)' }}>
                          ${r.price}
                        </span>
                      </div>
                      <div className="prog-bar" style={{ height: 4 }}>
                        <div className="prog-fill" style={{ width: `${roundPct}%`, background: isPast ? 'var(--gray2)' : isActive ? 'var(--grad-full)' : 'transparent' }} />
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 3 }}>
                        <span style={{ fontFamily: 'var(--font-m)', fontSize: '0.58rem', color: 'var(--gray2)' }}>
                          {fmt(roundSold)} / {fmt(r.cap)}
                        </span>
                        <span style={{ fontFamily: 'var(--font-m)', fontSize: '0.58rem', color: 'var(--gray2)' }}>
                          Revenue: ${fmt(roundSold * r.price / 2)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════
          BLOCK 4: FINANCIAL SUMMARY
      ═══════════════════════════════════════════ */}
      <div className="sep-lbl">Financial Summary</div>

      <div className="g2" style={{ marginBottom: 24 }}>
        {/* Revenue Breakdown */}
        <div className="card" style={{ padding: 20 }}>
          <div className="card-title">Revenue Breakdown</div>
          <div style={{ display: 'flex', gap: 20, alignItems: 'center' }}>
            <DonutChart
              segments={[
                { value: Number(seed.usdtRaised || 0), color: '#C9A84C', label: 'SEED' },
                { value: Number(presale.usdtRaised || 0), color: '#7B2D8B', label: 'Pre-Sale' },
                { value: Number(mice.usdtRaised || 0), color: '#6B1428', label: 'MICE (USDT)' },
              ]}
              size={120}
            />
            <div style={{ flex: 1 }}>
              <RevenueRow color="#C9A84C" label="SEED" value={fmtUsd(seed.usdtRaised || 0)} />
              <RevenueRow color="#7B2D8B" label="Pre-Sale" value={fmtUsd(presale.usdtRaised || 0)} />
              <RevenueRow color="#6B1428" label="MICE (USDT)" value={fmtUsd(mice.usdtRaised || 0)} />
              <div style={{ borderTop: '1px solid var(--border)', marginTop: 8, paddingTop: 8 }}>
                <RevenueRow color="transparent" label="Total Revenue" value={fmtUsd(s.sales?.totalRaisedUsdt || 0)} bold />
              </div>
            </div>
          </div>
        </div>

        {/* Fund Allocation */}
        <div className="card" style={{ padding: 20 }}>
          <div className="card-title">Fund Allocation (PreSale + MICE)</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <AllocBar label="Liquidity Pool & Buffer" pct={40} value={fmtUsd(rev.liquidityPool || 0)} color="var(--gold)" />
            <AllocBar label="Marketing & Sales" pct={35} value={fmtUsd(rev.marketing || 0)} color="var(--purple)" />
            <AllocBar label="DAO Treasury" pct={12.5} value={fmtUsd(rev.daoTreasury || 0)} color="var(--crimson)" />
            <AllocBar label="Management" pct={7.5} value={fmtUsd(rev.management || 0)} color="var(--copper)" />
            <AllocBar label="Reserved Staking" pct={5} value={fmtUsd(rev.reservedStaking || 0)} color="var(--purple2)" />
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════
          BLOCK 5: REFERRAL & NETWORK
      ═══════════════════════════════════════════ */}
      <div className="sep-lbl">Referral &amp; Network</div>

      <div className="g4" style={{ marginBottom: 24 }}>
        <StatBox icon={'\u{1F517}'} label="F1 Paid (7%)" value={fmtUsd(refs.totalF1Paid || 0)} color="gold" loading={loading} />
        <StatBox icon={'\u{1F517}'} label="F2 Paid (3%)" value={fmtUsd(refs.totalF2Paid || 0)} color="p" loading={loading} />
        <StatBox icon={'\u{1F3C6}'} label="GV Bonus Paid" value={fmtUsd(0)} color="c" loading={loading} sub="Coming soon" />
        <StatBox icon={'\u{1F91D}'} label="Active Distributors" value={fmt(distStats?.activeCount || 0)} color="g" loading={loading}
          sub={`$${fmt(distStats?.totalEarned || 0, 2)} earned`} />
      </div>

      {/* ═══════════════════════════════════════════
          BLOCK 6: RECENT ACTIVITY
      ═══════════════════════════════════════════ */}
      <div className="sep-lbl">Recent Activity</div>

      <div className="card" style={{ padding: 0, marginBottom: 32 }}>
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Event</th>
              <th>User</th>
              <th>Amount</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td colSpan={5} style={{ textAlign: 'center', padding: 32, color: 'var(--gray2)', fontFamily: 'var(--font-m)', fontSize: SZ }}>
                Activity feed will be populated from event logs
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </>
  );
}

/* ═══════════════════════════════════════════════
   SUB-COMPONENTS
═══════════════════════════════════════════════ */

function StatBox({ icon, label, value, color, loading, sub }: {
  icon: string; label: string; value: string; color?: string; loading?: boolean; sub?: string;
}) {
  return (
    <div className="stat-box">
      <div className="stat-icon">{icon}</div>
      <div className="stat-lbl">{label}</div>
      <div className={`stat-val ${color || ''}`}>{loading ? '...' : value}</div>
      {sub && <div className="stat-delta">{sub}</div>}
    </div>
  );
}

function SaleRow({ label, value, highlight, sub, last }: {
  label: string; value: string; highlight?: string; sub?: string; last?: boolean;
}) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
      padding: '8px 0',
      borderBottom: last ? 'none' : '1px solid var(--border)',
    }}>
      <span style={{ fontFamily: 'var(--font-m)', fontSize: '0.58rem', letterSpacing: '.06em', color: 'var(--gray2)', textTransform: 'uppercase' }}>
        {label}
      </span>
      <div style={{ textAlign: 'right' }}>
        <span style={{
          fontFamily: 'var(--font-d)', fontSize: SZ, fontWeight: 700,
          color: highlight === 'gold' ? 'var(--gold2)' : highlight === 'g' ? 'var(--copper)' : highlight === 'c' ? 'var(--crimson2)' : 'var(--white)',
        }}>
          {value}
        </span>
        {sub && (
          <div style={{ fontFamily: 'var(--font-m)', fontSize: '0.58rem', color: 'var(--gray2)', marginTop: 1 }}>{sub}</div>
        )}
      </div>
    </div>
  );
}

function SaleProgress({ value, max, label }: { value: number; max: number; label?: string }) {
  const p = pct(value, max);
  return (
    <div style={{ padding: '6px 0 8px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontFamily: 'var(--font-m)', fontSize: '0.58rem', letterSpacing: '.06em', color: 'var(--gray2)', textTransform: 'uppercase' }}>
          PROGRESS
        </span>
        <span style={{ fontFamily: 'var(--font-m)', fontSize: SZ, color: 'var(--gold2)' }}>
          {label || `${p.toFixed(1)}%`}
        </span>
      </div>
      <div className="prog-bar" style={{ height: 6 }}>
        <div className="prog-fill g" style={{ width: `${p}%` }} />
      </div>
    </div>
  );
}

function DonutChart({ segments, size }: {
  segments: { value: number; color: string; label: string }[];
  size: number;
}) {
  const total = segments.reduce((a, s) => a + s.value, 0);
  const r = size / 2;
  const strokeWidth = 20;
  const radius = r - strokeWidth / 2;
  const circumference = 2 * Math.PI * radius;

  let offset = 0;
  const arcs = segments.map((seg) => {
    const pctVal = total > 0 ? seg.value / total : 0;
    const dash = pctVal * circumference;
    const gap = circumference - dash;
    const currentOffset = offset;
    offset += dash;
    return { ...seg, dash, gap, offset: currentOffset, pct: pctVal };
  });

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink: 0 }}>
      {/* Background ring */}
      <circle cx={r} cy={r} r={radius} fill="none" stroke="var(--bg4)" strokeWidth={strokeWidth} />
      {/* Segments */}
      {arcs.map((arc, i) => (
        <circle
          key={i}
          cx={r} cy={r} r={radius}
          fill="none"
          stroke={arc.color}
          strokeWidth={strokeWidth}
          strokeDasharray={`${arc.dash} ${arc.gap}`}
          strokeDashoffset={-arc.offset}
          transform={`rotate(-90 ${r} ${r})`}
          style={{ opacity: 0.8 }}
        />
      ))}
      {/* Center text */}
      <text x={r} y={r - 4} textAnchor="middle" fill="var(--white)" fontFamily="var(--font-d)" fontSize="12" fontWeight="900">
        {total > 0 ? `$${(total / 1000).toFixed(1)}K` : '-'}
      </text>
      <text x={r} y={r + 10} textAnchor="middle" fill="var(--gray2)" fontFamily="var(--font-m)" fontSize="7">
        TOTAL
      </text>
    </svg>
  );
}

function RevenueRow({ color, label, value, bold }: {
  color: string; label: string; value: string; bold?: boolean;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
      {color !== 'transparent' && (
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
      )}
      <span style={{
        flex: 1, fontFamily: 'var(--font-m)', fontSize: '0.58rem',
        color: bold ? 'var(--white)' : 'var(--gray)',
        fontWeight: bold ? 700 : 400,
      }}>
        {label}
      </span>
      <span style={{
        fontFamily: 'var(--font-d)', fontSize: SZ,
        fontWeight: bold ? 800 : 600,
        color: bold ? 'var(--gold2)' : 'var(--white)',
      }}>
        {value}
      </span>
    </div>
  );
}

function AllocBar({ label, pct: pctVal, value, color }: {
  label: string; pct: number; value: string; color: string;
}) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontFamily: 'var(--font-m)', fontSize: '0.58rem', color: 'var(--gray)' }}>
          {label} ({pctVal}%)
        </span>
        <span style={{ fontFamily: 'var(--font-d)', fontSize: SZ, fontWeight: 700, color: 'var(--white)' }}>
          {value}
        </span>
      </div>
      <div style={{ height: 6, background: 'var(--bg4)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${(pctVal / 40) * 100}%`, height: '100%', background: color, borderRadius: 3, opacity: 0.7 }} />
      </div>
    </div>
  );
}
