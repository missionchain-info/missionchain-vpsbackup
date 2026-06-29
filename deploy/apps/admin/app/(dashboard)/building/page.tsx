'use client';

import { useState, useEffect } from 'react';
import { useAuth, isOwnerWallet } from '@/lib/auth';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
const SZ = '0.62rem';

const thStyle: React.CSSProperties = { fontSize: '0.58rem', padding: '8px 10px', color: 'var(--gray)', fontFamily: 'var(--font-d)', letterSpacing: '0.08em', textTransform: 'uppercase' as const, textAlign: 'left' as const, borderBottom: '1px solid var(--border)' };
const tdStyle: React.CSSProperties = { fontSize: '0.62rem', padding: '7px 10px', color: 'var(--white)', fontFamily: 'var(--font-b)', borderBottom: '1px solid var(--border)' };

function ToggleRow({ on, onToggle, label, hint, disabled }: { on: boolean; onToggle: () => void; label: string; hint?: string; disabled?: boolean }) {
  return (
    <div className="toggle-row" style={disabled ? { opacity: 0.55, pointerEvents: 'none' } : undefined}>
      <div className={`toggle ${on ? 'on' : ''}`} onClick={disabled ? undefined : onToggle} />
      <div>
        <span className="toggle-label">{label}</span>
        {hint && <div style={{ fontSize: SZ, color: 'var(--gray2)', marginTop: 2 }}>{hint}</div>}
      </div>
    </div>
  );
}

/* ── Default GV Tiers ── */
interface GvTier {
  rank: string
  icon: string
  minGv: number
  maxGv: number
  rate: number
  nftBonus: string
  color: string
}

const DEFAULT_GV_TIERS: GvTier[] = [
  { rank: 'Believer', icon: '\uD83C\uDF31', minGv: 0, maxGv: 4999, rate: 0, nftBonus: '\u2014', color: 'var(--gray)' },
  { rank: 'Builder', icon: '\uD83D\uDD28', minGv: 5000, maxGv: 19999, rate: 3, nftBonus: '3\u00D7 Builder', color: '#4CAF50' },
  { rank: 'Connector', icon: '\u26A1', minGv: 20000, maxGv: 49999, rate: 5, nftBonus: '3\u00D7 Maker', color: '#29B6F6' },
  { rank: 'Champion', icon: '\uD83D\uDC8E', minGv: 50000, maxGv: 149999, rate: 7, nftBonus: '3\u00D7 Luminary', color: '#AB47BC' },
  { rank: 'Ambassador', icon: '\uD83D\uDC51', minGv: 150000, maxGv: 499999, rate: 8, nftBonus: '5\u00D7 Luminary', color: 'var(--gold)' },
  { rank: 'Legend', icon: '\uD83C\uDFC6', minGv: 500000, maxGv: 999999999, rate: 9, nftBonus: '10\u00D7 Luminary', color: '#FFD700' },
];

/* ── Weekly Growth Reward Milestones ── */
interface Milestone {
  f1Count: number
  minPurchase: number
  reward: string
}

const DEFAULT_MILESTONES: Milestone[] = [
  { f1Count: 3, minPurchase: 100, reward: 'Builder NFT' },
  { f1Count: 5, minPurchase: 100, reward: 'Maker NFT' },
  { f1Count: 10, minPurchase: 100, reward: 'Luminary NFT' },
];

export default function CommunityBuildingPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState('');

  // ── Referral Commission ──
  const [f1Rate, setF1Rate] = useState('7');
  const [f2Rate, setF2Rate] = useState('3');
  const [referralAppliesTo, setReferralAppliesTo] = useState('presale,mice'); // NOT seed

  // ── GV Bonus ──
  const [gvTotalRate, setGvTotalRate] = useState('9');
  const [gvTiers, setGvTiers] = useState<GvTier[]>(DEFAULT_GV_TIERS);
  const [gvOverride, setGvOverride] = useState(true); // earn only difference from downline

  // ── Weekly Growth Reward (5%) ──
  const [cbPoolRate, setCbPoolRate] = useState('5');
  const [cbMilestones, setCbMilestones] = useState<Milestone[]>(DEFAULT_MILESTONES);
  const [cbResetOnLuminary, setCbResetOnLuminary] = useState(true);

  // ── Monthly Community Reward (7.5%) ──
  const [monthlyPoolRate, setMonthlyPoolRate] = useState('7.5');

  // ── Lucky Draw (1%) ──
  const [luckyDrawRate, setLuckyDrawRate] = useState('1');
  const [luckyDrawCap, setLuckyDrawCap] = useState('5000');
  const [luckyDrawPrize1, setLuckyDrawPrize1] = useState('30');
  const [luckyDrawPrize2, setLuckyDrawPrize2] = useState('10');
  const [luckyDrawPrize3, setLuckyDrawPrize3] = useState('5');
  const [luckyDrawConsolation, setLuckyDrawConsolation] = useState('2.5');

  // ── Incentives Pool (2.5%) ──
  const [incentivesRate, setIncentivesRate] = useState('2.5');

  // ── NFT Multipliers ──
  const [nftMultBuilder, setNftMultBuilder] = useState('1');
  const [nftMultMaker, setNftMultMaker] = useState('2.5');
  const [nftMultLuminary, setNftMultLuminary] = useState('5');
  const [nftMultMFP, setNftMultMFP] = useState('10');

  // ── Stats (read-only) ──
  const [stats, setStats] = useState({
    totalReferralPaid: 0, totalGvPaid: 0, totalCbDistributed: 0,
    totalMonthlyDistributed: 0, totalLuckyDrawDistributed: 0,
    activeBuilders: 0, activeMakers: 0, activeLuminaries: 0, activeMFPs: 0,
  });

  useEffect(() => {
    // TODO: load from API /admin/system-config/building-config
    setLoading(false);
  }, []);

  const markDirty = () => setDirty(true);

  const updateTier = (idx: number, field: keyof GvTier, value: string) => {
    const updated = [...gvTiers];
    if (field === 'rate' || field === 'minGv' || field === 'maxGv') {
      (updated[idx] as any)[field] = parseFloat(value) || 0;
    } else {
      (updated[idx] as any)[field] = value;
    }
    setGvTiers(updated);
    markDirty();
  };

  const updateMilestone = (idx: number, field: keyof Milestone, value: string) => {
    const updated = [...cbMilestones];
    if (field === 'f1Count' || field === 'minPurchase') {
      (updated[idx] as any)[field] = parseInt(value) || 0;
    } else {
      (updated[idx] as any)[field] = value;
    }
    setCbMilestones(updated);
    markDirty();
  };

  const handleSave = async () => {
    setSaving(true);
    setMsg('');
    try {
      const jwt = typeof window !== 'undefined' ? localStorage.getItem('mc-admin-jwt') : null;
      const config = {
        referral: { f1Rate: parseFloat(f1Rate), f2Rate: parseFloat(f2Rate), appliesTo: referralAppliesTo },
        gvBonus: { totalRate: parseFloat(gvTotalRate), tiers: gvTiers, override: gvOverride },
        communityBuilder: { poolRate: parseFloat(cbPoolRate), milestones: cbMilestones, resetOnLuminary: cbResetOnLuminary },
        monthlyPool: { rate: parseFloat(monthlyPoolRate) },
        luckyDraw: {
          rate: parseFloat(luckyDrawRate), weekCap: parseFloat(luckyDrawCap),
          prizes: { p1: parseFloat(luckyDrawPrize1), p2: parseFloat(luckyDrawPrize2), p3: parseFloat(luckyDrawPrize3), consolation: parseFloat(luckyDrawConsolation) },
        },
        incentives: { rate: parseFloat(incentivesRate) },
        nftMultipliers: {
          builder: parseFloat(nftMultBuilder), maker: parseFloat(nftMultMaker),
          luminary: parseFloat(nftMultLuminary), mfp: parseFloat(nftMultMFP),
        },
      };

      await fetch(`${API_BASE}/admin/system-config/building-config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}) },
        body: JSON.stringify({ value: JSON.stringify(config) }),
      });

      setDirty(false);
      setMsg('Community Building configuration saved');
      setTimeout(() => setMsg(''), 5000);
    } catch {
      setMsg('Error saving configuration');
    } finally {
      setSaving(false);
    }
  };

  /* ── Revenue allocation summary ── */
  const totalMarketingPct = parseFloat(f1Rate) + parseFloat(f2Rate) + parseFloat(cbPoolRate) + parseFloat(luckyDrawRate) + parseFloat(monthlyPoolRate) + parseFloat(gvTotalRate) + parseFloat(incentivesRate);

  /* ── Read-only mode for non-owner (only owner-wallet can edit) ── */
  const { user } = useAuth();
  const isSuperAdmin = isOwnerWallet(user?.wallet);
  const readOnly = !isSuperAdmin;

  return (
    <>
      {/* ═══ HEADER ═══ */}
      <div className="page-hd">
        <div>
          <div className="page-eyebrow">Management</div>
          <div className="page-title">Community Building</div>
          <div className="page-sub">Configure referral, GV bonus, NFT rewards &amp; incentive programs</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          {!readOnly && dirty && (
            <button className="btn btn-outline btn-sm" style={{ fontSize: SZ, fontFamily: 'var(--font-m)', padding: '5px 12px' }} onClick={() => { setDirty(false); setMsg(''); }}>RESET</button>
          )}
          {!readOnly && (
            <button className="btn btn-outline btn-sm" style={{ fontSize: SZ, fontFamily: 'var(--font-m)', padding: '5px 12px' }} onClick={handleSave} disabled={!dirty || saving}>
              {saving ? 'Saving...' : 'SAVE CHANGES'}
            </button>
          )}
        </div>
      </div>

      {/* Read-only banner for non-owner */}
      {readOnly && (
        <div
          style={{
            padding: '10px 16px',
            marginBottom: 16,
            borderRadius: 8,
            background: 'rgba(212,160,23,0.08)',
            border: '1px solid rgba(212,160,23,0.3)',
            fontSize: SZ,
            color: 'var(--gold)',
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          🔒 READ-ONLY — Only OWNER can modify Community Building parameters.
        </div>
      )}

      {msg && (
        <div style={{
          padding: '8px 14px', marginBottom: 12, borderRadius: 8, fontSize: SZ, fontWeight: 600,
          background: msg.includes('Error') ? 'rgba(255,80,80,.15)' : 'rgba(80,200,120,.15)',
          color: msg.includes('Error') ? '#ff5050' : '#50c878',
        }}>{msg}</div>
      )}

      {/* ═══ REVENUE ALLOCATION SUMMARY ═══ */}
      <div className="sep-lbl">Revenue Allocation (35%)</div>
      <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 16 }}>
        <div className="tbl-wrap">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={thStyle}>Category</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Rate</th>
              </tr>
            </thead>
            <tbody>
              {[
                { label: 'Referral Commission (F1 + F2)', pct: parseFloat(f1Rate) + parseFloat(f2Rate) },
                { label: 'Weekly Growth Reward', pct: parseFloat(cbPoolRate) },
                { label: 'GV Bonus', pct: parseFloat(gvTotalRate) },
                { label: 'Monthly Community Reward', pct: parseFloat(monthlyPoolRate) },
                { label: 'Weekly Lucky Draw', pct: parseFloat(luckyDrawRate) },
                { label: 'Incentives Pool', pct: parseFloat(incentivesRate) },
              ].map(r => (
                <tr key={r.label} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={tdStyle}>{r.label}</td>
                  <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'var(--font-m)', color: 'var(--gold)' }}>{r.pct}%</td>
                </tr>
              ))}
              <tr style={{ background: 'var(--bg4)' }}>
                <td style={{ ...tdStyle, fontWeight: 700 }}>Total</td>
                <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'var(--font-d)', fontWeight: 800, color: totalMarketingPct === 35 ? '#50c878' : '#ff5050' }}>
                  {totalMarketingPct.toFixed(1)}%
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        {totalMarketingPct !== 35 && (
          <div style={{ padding: '8px 14px', background: 'rgba(255,80,80,.08)', fontSize: SZ, color: '#ff5050' }}>
            Total should be 35%. Please adjust the rates.
          </div>
        )}
      </div>

      {/* ═══ REFERRAL COMMISSION ═══ */}
      <div className="sep-lbl">Referral Commission</div>
      <div className="card" style={{ padding: 20, marginBottom: 16 }}>
        <div className="callout" style={{ marginBottom: 16, fontSize: SZ }}>
          Direct referral commission paid instantly on-chain in USDT. Applies to Pre-Sale &amp; MICE only (NOT Seed Round). Total = F1 + F2.
        </div>
        <div className="g3" style={{ marginBottom: 12 }}>
          <div>
            <div className="input-label" style={{ marginBottom: 6 }}>F1 Rate (%) {'\u2014'} Direct Referral</div>
            <input type="number" step="0.5" value={f1Rate} onChange={e => { setF1Rate(e.target.value); markDirty(); }} style={{ padding: '5px 10px', borderRadius: 6, background: 'var(--card-bg)', color: 'var(--white)', border: '1px solid var(--border)', fontSize: SZ, fontFamily: 'var(--font-m)', width: '100%' }} readOnly={readOnly} />
          </div>
          <div>
            <div className="input-label" style={{ marginBottom: 6 }}>F2 Rate (%) {'\u2014'} Second Level</div>
            <input type="number" step="0.5" value={f2Rate} onChange={e => { setF2Rate(e.target.value); markDirty(); }} style={{ padding: '5px 10px', borderRadius: 6, background: 'var(--card-bg)', color: 'var(--white)', border: '1px solid var(--border)', fontSize: SZ, fontFamily: 'var(--font-m)', width: '100%' }} readOnly={readOnly} />
          </div>
          <div>
            <div className="input-label" style={{ marginBottom: 6 }}>Total Referral</div>
            <div style={{ padding: '8px 12px', background: 'var(--bg3)', borderRadius: 6, fontFamily: 'var(--font-d)', fontWeight: 700, fontSize: SZ, color: 'var(--gold)' }}>
              {(parseFloat(f1Rate) + parseFloat(f2Rate)).toFixed(1)}%
            </div>
            <div style={{ fontSize: SZ, color: 'var(--gray2)', marginTop: 3 }}>Payment: Instantly On-chain (USDT)</div>
          </div>
        </div>
        <div className="info-row"><span className="info-key">Applies To</span><span className="info-val" style={{ fontSize: SZ }}>Pre-Sale &amp; MICE (NOT Seed)</span></div>
        <div className="info-row"><span className="info-key">Contract</span><span className="info-val" style={{ fontSize: SZ, fontFamily: 'var(--font-m)' }}>ReferralRegistry.sol</span></div>
      </div>

      {/* ═══ GV BONUS TIERS ═══ */}
      <div className="sep-lbl">GV Bonus Tiers ({gvTotalRate}% of Revenue)</div>
      <div className="card" style={{ padding: 20, marginBottom: 16 }}>
        <div className="callout" style={{ marginBottom: 16, fontSize: SZ }}>
          GV = Group Volume (all generations, not just F1/F2). Counts USDT from both Pre-Sale and MICE. <strong>Override applied</strong>: earn only the difference between your rate and each direct downline&apos;s rate.
        </div>

        <ToggleRow
          on={gvOverride}
          onToggle={() => { setGvOverride(!gvOverride); markDirty(); }}
          label="Override Mode"
          hint="Earn only the difference between your rate and downline's rate (recommended)"
          disabled={readOnly}
        />

        <div style={{ marginTop: 16 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
            <thead>
              <tr>
                <th style={{ ...thStyle, width: '18%', textAlign: 'left' as const }}>Rank</th>
                <th style={{ ...thStyle, width: '18%', textAlign: 'right' as const }}>Min GV ($)</th>
                <th style={{ ...thStyle, width: '18%', textAlign: 'right' as const }}>Max GV ($)</th>
                <th style={{ ...thStyle, width: '14%', textAlign: 'right' as const }}>Rate %</th>
                <th style={{ ...thStyle, width: '32%', textAlign: 'right' as const }}>NFT Bonus</th>
              </tr>
            </thead>
            <tbody>
              {gvTiers.map((tier, i) => (
                <tr key={tier.rank} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ ...tdStyle, textAlign: 'left' }}>
                    <span style={{ marginRight: 6 }}>{tier.icon}</span>
                    <span style={{ fontWeight: 700, color: tier.color, fontFamily: 'var(--font-d)', fontSize: SZ }}>{tier.rank}</span>
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'right' }}>
                    <input type="text" value={tier.minGv.toLocaleString()} onChange={e => updateTier(i, 'minGv', e.target.value.replace(/,/g, ''))} style={{ padding: '4px 8px', borderRadius: 6, background: 'var(--card-bg)', color: 'var(--white)', border: '1px solid var(--border)', fontSize: SZ, fontFamily: 'var(--font-m)', width: '100%', textAlign: 'right' }} readOnly={readOnly} />
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'right' }}>
                    <input type="text" value={tier.maxGv.toLocaleString()} onChange={e => updateTier(i, 'maxGv', e.target.value.replace(/,/g, ''))} style={{ padding: '4px 8px', borderRadius: 6, background: 'var(--card-bg)', color: 'var(--white)', border: '1px solid var(--border)', fontSize: SZ, fontFamily: 'var(--font-m)', width: '100%', textAlign: 'right' }} readOnly={readOnly} />
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'right' }}>
                    <input type="number" step="0.5" value={tier.rate} onChange={e => updateTier(i, 'rate', e.target.value)} style={{ padding: '4px 8px', borderRadius: 6, background: 'var(--card-bg)', color: tier.color, border: '1px solid var(--border)', fontSize: SZ, fontFamily: 'var(--font-m)', width: '100%', textAlign: 'right', fontWeight: 700 }} readOnly={readOnly} />
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'right' }}>
                    <input type="text" value={tier.nftBonus} onChange={e => updateTier(i, 'nftBonus', e.target.value)} style={{ padding: '4px 8px', borderRadius: 6, background: 'var(--card-bg)', color: 'var(--white)', border: '1px solid var(--border)', fontSize: SZ, fontFamily: 'var(--font-m)', width: '100%', textAlign: 'right' }} readOnly={readOnly} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ═══ WEEKLY GROWTH REWARD ═══ */}
      <div className="sep-lbl">Weekly Growth Reward ({cbPoolRate}% of Revenue)</div>
      <div className="g2" style={{ marginBottom: 16 }}>
        <div className="card" style={{ padding: 20 }}>
          <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <span style={{ fontSize: '1.1rem' }}>{'\uD83C\uDFC5'}</span> Milestone NFT Rewards
          </div>
          <div className="callout" style={{ marginBottom: 14, fontSize: SZ }}>
            Count-based criteria. After earning Luminary, counter resets and new circle starts.
          </div>

          <ToggleRow
            on={cbResetOnLuminary}
            onToggle={() => { setCbResetOnLuminary(!cbResetOnLuminary); markDirty(); }}
            label="Reset after Luminary"
            hint="Counter resets to 0 after earning Luminary, new circle begins"
            disabled={readOnly}
          />

          <div style={{ marginTop: 14 }}>
            {cbMilestones.map((m, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, padding: '8px 10px', background: 'var(--bg3)', borderRadius: 8 }}>
                <span style={{ fontSize: SZ, color: 'var(--gray2)', minWidth: 24 }}>#{i + 1}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <span style={{ fontSize: SZ, color: 'var(--gray)' }}>Introduce</span>
                    <input type="number" value={m.f1Count} onChange={e => updateMilestone(i, 'f1Count', e.target.value)} style={{ padding: '5px 10px', borderRadius: 6, background: 'var(--card-bg)', color: 'var(--white)', border: '1px solid var(--border)', fontSize: SZ, fontFamily: 'var(--font-m)', width: 56, textAlign: 'center', fontWeight: 700 }} readOnly={readOnly} />
                    <span style={{ fontSize: SZ, color: 'var(--gray)' }}>F1 who buy {'\u2265'}</span>
                    <span style={{ fontSize: SZ, color: 'var(--gray)' }}>$</span>
                    <input type="number" value={m.minPurchase} onChange={e => updateMilestone(i, 'minPurchase', e.target.value)} style={{ padding: '5px 10px', borderRadius: 6, background: 'var(--card-bg)', color: 'var(--white)', border: '1px solid var(--border)', fontSize: SZ, fontFamily: 'var(--font-m)', width: 60, textAlign: 'center' }} readOnly={readOnly} />
                  </div>
                </div>
                <span style={{ fontSize: SZ, fontWeight: 700, fontFamily: 'var(--font-d)', color: m.reward.includes('Luminary') ? '#CE93D8' : m.reward.includes('Maker') ? 'var(--gold)' : '#90A4AE' }}>
                  {'\u2192'} {m.reward}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="card" style={{ padding: 20 }}>
          <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <span style={{ fontSize: '1.1rem' }}>{'\uD83D\uDCB0'}</span> USDT Pool Distribution
          </div>
          <div className="callout" style={{ marginBottom: 14, fontSize: SZ }}>
            The {cbPoolRate}% pool is distributed to NFT holders whose NFTs were issued within the current week. Only new NFTs qualify. Snapshot at 24:00 Sunday GMT.
          </div>
          <div>
            <div className="input-label" style={{ marginBottom: 6 }}>Pool Rate (%)</div>
            <input type="number" step="0.5" value={cbPoolRate} onChange={e => { setCbPoolRate(e.target.value); markDirty(); }} style={{ padding: '5px 10px', borderRadius: 6, background: 'var(--card-bg)', color: 'var(--white)', border: '1px solid var(--border)', fontSize: SZ, fontFamily: 'var(--font-m)', width: '100%' }} readOnly={readOnly} />
            <div style={{ fontSize: SZ, color: 'var(--gray2)', marginTop: 3 }}>Percentage of Pre-Sale + MICE USDT revenue</div>
          </div>
          <div style={{ marginTop: 12 }}>
            <div className="info-row"><span className="info-key">Distribution</span><span className="info-val" style={{ fontSize: SZ }}>Weekly Auto</span></div>
            <div className="info-row"><span className="info-key">Method</span><span className="info-val" style={{ fontSize: SZ }}>By NFT Multiplier</span></div>
            <div className="info-row"><span className="info-key">Contract</span><span className="info-val" style={{ fontFamily: 'var(--font-m)', fontSize: SZ }}>ClaimRewards.sol</span></div>
          </div>
        </div>
      </div>

      {/* ═══ NFT MULTIPLIERS ═══ */}
      <div className="sep-lbl">NFT Multipliers (for USDT Distribution)</div>
      <div className="card" style={{ padding: 20, marginBottom: 16 }}>
        <div className="callout" style={{ marginBottom: 16, fontSize: SZ }}>
          NFT multipliers are used <strong>ONLY</strong> for distributing USDT reward pools (Weekly Growth Reward 5%, Monthly Community Reward 7.5%, Lucky Draw 1%). They do NOT affect MIC staking rewards. Staking and NFT are completely separate systems.
        </div>
        <div className="g4">
          {[
            { label: 'Builder', icon: '\uD83D\uDEE0\uFE0F', val: nftMultBuilder, set: setNftMultBuilder, color: '#90A4AE' },
            { label: 'Maker', icon: '\u2B50', val: nftMultMaker, set: setNftMultMaker, color: 'var(--gold)' },
            { label: 'Luminary', icon: '\uD83D\uDC8E', val: nftMultLuminary, set: setNftMultLuminary, color: '#CE93D8' },
            { label: 'MFP-NFT', icon: '\uD83D\uDC51', val: nftMultMFP, set: setNftMultMFP, color: '#E040FB' },
          ].map(n => (
            <div key={n.label} style={{ background: 'var(--bg3)', borderRadius: 10, padding: 14, textAlign: 'center' }}>
              <div style={{ fontSize: '1.3rem', marginBottom: 4 }}>{n.icon}</div>
              <div style={{ fontSize: SZ, fontWeight: 700, fontFamily: 'var(--font-d)', color: n.color, marginBottom: 6 }}>{n.label}</div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                <span style={{ fontSize: SZ, color: 'var(--gray2)' }}>{'\u00D7'}</span>
                <input
                  type="number" step="0.5" value={n.val}
                  onChange={e => { n.set(e.target.value); markDirty(); }}
                  style={{ padding: '5px 10px', borderRadius: 6, background: 'var(--card-bg)', color: n.color, border: '1px solid var(--border)', fontSize: SZ, fontFamily: 'var(--font-d)', width: 64, textAlign: 'center', fontWeight: 800 }} readOnly={readOnly} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ═══ MONTHLY COMMUNITY REWARD ═══ */}
      <div className="sep-lbl">Monthly Community Reward ({monthlyPoolRate}%)</div>
      <div className="card" style={{ padding: 20, marginBottom: 16 }}>
        <div className="g2">
          <div>
            <div className="callout" style={{ marginBottom: 12, fontSize: SZ }}>
              Distributed monthly to ALL active NFT holders (both old and new). Rewards loyalty and long-term holding. Monthly auto-calculated, DAO-approved.
            </div>
            <div className="input-label" style={{ marginBottom: 6 }}>Pool Rate (%)</div>
            <input type="number" step="0.5" value={monthlyPoolRate} onChange={e => { setMonthlyPoolRate(e.target.value); markDirty(); }} style={{ padding: '5px 10px', borderRadius: 6, background: 'var(--card-bg)', color: 'var(--white)', border: '1px solid var(--border)', fontSize: SZ, fontFamily: 'var(--font-m)', width: '100%' }} readOnly={readOnly} />
          </div>
          <div>
            <div className="info-row"><span className="info-key">Frequency</span><span className="info-val" style={{ fontSize: SZ }}>Monthly</span></div>
            <div className="info-row"><span className="info-key">Approval</span><span className="info-val" style={{ fontSize: SZ }}>DAO-approved</span></div>
            <div className="info-row"><span className="info-key">Method</span><span className="info-val" style={{ fontSize: SZ }}>By NFT Multiplier</span></div>
            <div className="info-row"><span className="info-key">Contract</span><span className="info-val" style={{ fontFamily: 'var(--font-m)', fontSize: SZ }}>PeriodicRewards.sol</span></div>
            <div className="info-row"><span className="info-key">Total Distributed</span><span className="info-val gold" style={{ fontSize: SZ, fontFamily: 'var(--font-m)' }}>{'\u2014'}</span></div>
          </div>
        </div>
      </div>

      {/* ═══ LUCKY DRAW ═══ */}
      <div className="sep-lbl">Weekly Lucky Draw ({luckyDrawRate}%)</div>
      <div className="card" style={{ padding: 20, marginBottom: 16 }}>
        <div className="callout" style={{ marginBottom: 14, fontSize: SZ }}>
          Community NFT (Active) serial numbers are used as entries. Only NFTs issued within the current week are eligible for that week&apos;s draw. Weekly snapshot at 24:00 Sunday GMT. Draw uses Chainlink VRF for provable fairness. CAP per week to prevent excessive payouts.
        </div>
        <div className="g3" style={{ marginBottom: 14 }}>
          <div>
            <div className="input-label" style={{ marginBottom: 6 }}>Pool Rate (%)</div>
            <input type="number" step="0.1" value={luckyDrawRate} onChange={e => { setLuckyDrawRate(e.target.value); markDirty(); }} style={{ padding: '5px 10px', borderRadius: 6, background: 'var(--card-bg)', color: 'var(--white)', border: '1px solid var(--border)', fontSize: SZ, fontFamily: 'var(--font-m)', width: '100%' }} readOnly={readOnly} />
          </div>
          <div>
            <div className="input-label" style={{ marginBottom: 6 }}>Weekly CAP (USDT)</div>
            <input type="text" value={luckyDrawCap ? Number(luckyDrawCap).toLocaleString() : ''} onChange={e => { setLuckyDrawCap(e.target.value.replace(/,/g, '')); markDirty(); }} style={{ padding: '5px 10px', borderRadius: 6, background: 'var(--card-bg)', color: 'var(--white)', border: '1px solid var(--border)', fontSize: SZ, fontFamily: 'var(--font-m)', width: '100%' }} readOnly={readOnly} />
          </div>
          <div>
            <div className="input-label" style={{ marginBottom: 6 }}>Contract</div>
            <div style={{ padding: '8px 12px', background: 'var(--bg3)', borderRadius: 6, fontSize: SZ, fontFamily: 'var(--font-m)', color: 'var(--gray)' }}>
              LuckyDraw.sol + Chainlink VRF
            </div>
          </div>
        </div>

        <div style={{ fontSize: '0.58rem', fontWeight: 700, color: 'var(--gray2)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 8 }}>Prize Distribution (% of pool)</div>
        <div className="g4">
          {[
            { label: 'Prize #1 (1 winner)', val: luckyDrawPrize1, set: setLuckyDrawPrize1, color: '#FFD700', ex: '$1,500' },
            { label: 'Prize #2 (2 winners)', val: luckyDrawPrize2, set: setLuckyDrawPrize2, color: 'var(--gold)', ex: '$500 each' },
            { label: 'Prize #3 (5 winners)', val: luckyDrawPrize3, set: setLuckyDrawPrize3, color: '#90A4AE', ex: '$250 each' },
            { label: 'Consolation (10 winners)', val: luckyDrawConsolation, set: setLuckyDrawConsolation, color: 'var(--gray)', ex: '$125 each' },
          ].map(p => (
            <div key={p.label} style={{ background: 'var(--bg3)', borderRadius: 8, padding: '10px 10px', textAlign: 'center' }}>
              <div style={{ fontSize: '0.58rem', color: 'var(--gray2)', marginBottom: 4 }}>{p.label}</div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2, marginBottom: 4 }}>
                <input type="number" step="0.5" value={p.val} onChange={e => { p.set(e.target.value); markDirty(); }}
                  style={{ padding: '5px 10px', borderRadius: 6, background: 'var(--card-bg)', color: p.color, border: '1px solid var(--border)', fontSize: SZ, fontFamily: 'var(--font-d)', width: 56, textAlign: 'center', fontWeight: 800 }} readOnly={readOnly} />
                <span style={{ fontSize: SZ, color: 'var(--gray2)' }}>%</span>
              </div>
              <div style={{ fontSize: '0.58rem', color: 'var(--gray2)' }}>e.g. {p.ex}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ═══ INCENTIVES POOL ═══ */}
      <div className="sep-lbl">Incentives Pool ({incentivesRate}%)</div>
      <div className="card" style={{ padding: 20, marginBottom: 16 }}>
        <div className="g2">
          <div>
            <div className="callout" style={{ marginBottom: 12, fontSize: SZ }}>
              DAO-governed fund for community campaigns, special bonuses, and growth incentives. Managed via IncentivePool.sol.
            </div>
            <div className="input-label" style={{ marginBottom: 6 }}>Pool Rate (%)</div>
            <input type="number" step="0.5" value={incentivesRate} onChange={e => { setIncentivesRate(e.target.value); markDirty(); }} style={{ padding: '5px 10px', borderRadius: 6, background: 'var(--card-bg)', color: 'var(--white)', border: '1px solid var(--border)', fontSize: SZ, fontFamily: 'var(--font-m)', width: '100%' }} readOnly={readOnly} />
          </div>
          <div>
            <div className="info-row"><span className="info-key">Governance</span><span className="info-val" style={{ fontSize: SZ }}>DAO Controlled</span></div>
            <div className="info-row"><span className="info-key">Contract</span><span className="info-val" style={{ fontFamily: 'var(--font-m)', fontSize: SZ }}>IncentivePool.sol</span></div>
            <div className="info-row"><span className="info-key">Usage</span><span className="info-val" style={{ fontSize: SZ }}>Campaigns, Bonuses, Growth</span></div>
            <div className="info-row"><span className="info-key">Total Distributed</span><span className="info-val gold" style={{ fontSize: SZ, fontFamily: 'var(--font-m)' }}>{'\u2014'}</span></div>
          </div>
        </div>
      </div>

      {/* ═══ DISTRIBUTION STATS ═══ */}
      <div className="sep-lbl">Distribution Stats</div>
      <div className="g4" style={{ marginBottom: 16 }}>
        <div className="stat-box">
          <div className="stat-lbl">Total Referral Paid</div>
          <div className="stat-val gold">{'\u2014'}</div>
        </div>
        <div className="stat-box">
          <div className="stat-lbl">Total GV Paid</div>
          <div className="stat-val gold">{'\u2014'}</div>
        </div>
        <div className="stat-box">
          <div className="stat-lbl">Weekly Growth</div>
          <div className="stat-val gold">{'\u2014'}</div>
        </div>
        <div className="stat-box">
          <div className="stat-lbl">Monthly Community</div>
          <div className="stat-val gold">{'\u2014'}</div>
        </div>
      </div>

      <div className="g4" style={{ marginBottom: 16 }}>
        <div className="stat-box">
          <div className="stat-lbl">Active Builders</div>
          <div className="stat-val">{'\u2014'}</div>
        </div>
        <div className="stat-box">
          <div className="stat-lbl">Active Makers</div>
          <div className="stat-val">{'\u2014'}</div>
        </div>
        <div className="stat-box">
          <div className="stat-lbl">Active Luminaries</div>
          <div className="stat-val">{'\u2014'}</div>
        </div>
        <div className="stat-box">
          <div className="stat-lbl">Active MFPs</div>
          <div className="stat-val">{'\u2014'}</div>
        </div>
      </div>
    </>
  );
}
