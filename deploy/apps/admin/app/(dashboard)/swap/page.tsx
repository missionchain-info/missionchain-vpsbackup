'use client';

import { useState, useEffect, useCallback } from 'react';
import { fetchStatsOverview } from '@/lib/api';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

const fmtN = (n: number) => (!n || isNaN(n)) ? '-' : n.toLocaleString('en-US');
const fmtUsd = (n: number) => (!n || isNaN(n)) ? '-' : '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const SZ = '0.62rem';

export default function SwapPage() {
  const [swapEnabled, setSwapEnabled] = useState(false);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // Add to pool inputs
  const [addUsdt, setAddUsdt] = useState('');
  const [addMic, setAddMic] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    Promise.all([
      fetchStatsOverview().catch(() => null),
      fetch(`${API_BASE}/rounds/system-info`).then(r => r.json()).catch(() => null),
    ]).then(([statsRes, sysRes]) => {
      if (statsRes?.data) setStats(statsRes.data);
      if (sysRes?.data) setSwapEnabled(sysRes.data.swapEnabled || false);
    }).finally(() => setLoading(false));
  }, []);

  // Derived values from stats
  const seedUsdt = Number(stats?.seed?.usdtRaised || 0);
  const presaleUsdt = Number(stats?.presale?.usdtRaised || 0);
  const miceUsdt = Number(stats?.mice?.usdtRaised || 0);

  // SEED V5c (deployed 2026-06-23): 0% to liquidity. Funds Reserved 50% instead.
  const seedLiqUsdt = 0;
  // 40% of PreSale+MICE net capital goes to liquidity
  const presaleLiqUsdt = presaleUsdt * 0.40;
  const miceLiqUsdt = miceUsdt * 0.40;
  const totalLiqUsdt = seedLiqUsdt + presaleLiqUsdt + miceLiqUsdt;

  // MIC source: 105M pre-issued for DEX/CEX
  const preIssuedMic = 105_000_000;

  // Pool state (placeholder — will come from contract/API later)
  const poolMic = 0;
  const poolUsdt = 0;

  const handleActivate = async () => {
    const micVal = parseFloat(addMic);
    const usdtVal = parseFloat(addUsdt);
    if (!micVal || !usdtVal || micVal <= 0 || usdtVal <= 0) {
      setMsg('Enter both MIC and USDT amounts to activate SWAP');
      return;
    }
    if (!confirm(`Activate SWAP with ${fmtN(micVal)} MIC + $${fmtN(usdtVal)} USDT?\n\nThis pool will be LOCKED for 10 years. This action cannot be undone.`)) return;

    setSaving(true);
    setMsg('');
    try {
      const jwt = typeof window !== 'undefined' ? localStorage.getItem('mc-admin-jwt') : null;
      await fetch(`${API_BASE}/admin/system-config/swap_enabled`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}) },
        body: JSON.stringify({ value: 'true' }),
      });
      setSwapEnabled(true);
      setAddMic('');
      setAddUsdt('');
      setMsg('SWAP activated successfully');
      setTimeout(() => setMsg(''), 5000);
    } catch {
      setMsg('Error activating SWAP');
    } finally {
      setSaving(false);
    }
  };

  const handleAddLiquidity = async (type: 'usdt' | 'mic') => {
    const val = type === 'usdt' ? parseFloat(addUsdt) : parseFloat(addMic);
    if (!val || val <= 0) { setMsg(`Enter a valid ${type.toUpperCase()} amount`); return; }
    if (!confirm(`Add ${type === 'usdt' ? '$' : ''}${fmtN(val)} ${type.toUpperCase()} to liquidity pool?`)) return;

    setSaving(true);
    setMsg('');
    try {
      // Placeholder — will call smart contract in production
      setMsg(`${fmtN(val)} ${type.toUpperCase()} added to pool`);
      if (type === 'usdt') setAddUsdt(''); else setAddMic('');
      setTimeout(() => setMsg(''), 5000);
    } catch {
      setMsg('Error adding liquidity');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="page-hd">
        <div>
          <div className="page-eyebrow">Business &amp; Finance</div>
          <div className="page-title">SWAP Control</div>
          <div className="page-sub">Liquidity pool management, SWAP activation &amp; price stabilization</div>
        </div>
      </div>

      {/* STATUS ALERT */}
      {!swapEnabled ? (
        <div className="alert alert-warn" style={{ marginBottom: 16 }}>
          {'\u26A0\uFE0F'} SWAP is currently <strong>INACTIVE</strong>. Add MIC + USDT to the pool and activate to enable on-chain trading. Once activated, the pool is <strong>locked for 10 years</strong>.
        </div>
      ) : (
        <div className="alert alert-ok" style={{ marginBottom: 16 }}>
          {'\u2705'} SWAP is <strong>ACTIVE</strong>. Pool is locked for 10 years. You can add MIC or USDT to rebalance price.
        </div>
      )}

      {/* Save message */}
      {msg && (
        <div style={{
          padding: '6px 12px', marginBottom: 12, borderRadius: 8, fontSize: SZ, fontWeight: 600,
          background: msg.includes('Error') ? 'rgba(255,80,80,.15)' : 'rgba(80,200,120,.15)',
          color: msg.includes('Error') ? '#ff5050' : '#50c878',
        }}>{msg}</div>
      )}

      {/* SWAP STATUS */}
      <div className="sep-lbl">SWAP Status</div>
      <div className="g3" style={{ marginBottom: 16 }}>
        <div className="stat-box">
          <div className="stat-lbl">Status</div>
          <div className="stat-val" style={{ color: swapEnabled ? 'var(--green2)' : 'var(--crimson2)' }}>{swapEnabled ? 'ACTIVE' : 'INACTIVE'}</div>
        </div>
        <div className="stat-box">
          <div className="stat-lbl">Pool MIC</div>
          <div className="stat-val p">{poolMic > 0 ? fmtN(poolMic) : '-'}</div>
          <div className="stat-delta">In liquidity</div>
        </div>
        <div className="stat-box">
          <div className="stat-lbl">Pool USDT</div>
          <div className="stat-val gold">{poolUsdt > 0 ? fmtUsd(poolUsdt) : '-'}</div>
          <div className="stat-delta">In liquidity</div>
        </div>
      </div>

      {/* ═══ LIQUIDITY SOURCES ═══ */}
      <div className="sep-lbl">Liquidity Sources</div>
      <div className="g2" style={{ marginBottom: 16 }}>

        {/* SOURCE 1: MIC from Pre-Issued */}
        <div className="card" style={{ padding: 20 }}>
          <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: '1.1rem' }}>{'\uD83E\uDE99'}</span> MIC Source {'\u2014'} Pre-Issued
          </div>
          <div className="callout" style={{ marginBottom: 12 }}>
            105,000,000 MIC (1.5% of total supply) allocated for DEX/CEX Listing at contract deployment. Held in LiquidityPool.sol, ready to be added to SWAP pool.
          </div>
          <div className="info-row"><span className="info-key">Allocated</span><span className="info-val" style={{ fontFamily: 'var(--font-m)' }}>105,000,000 MIC</span></div>
          <div className="info-row"><span className="info-key">Added to Pool</span><span className="info-val" style={{ fontFamily: 'var(--font-m)' }}>{poolMic > 0 ? fmtN(poolMic) + ' MIC' : '-'}</span></div>
          <div className="info-row"><span className="info-key">Available</span><span className="info-val" style={{ fontFamily: 'var(--font-m)', color: 'var(--green2)' }}>{fmtN(preIssuedMic - poolMic)} MIC</span></div>
          <div style={{ marginTop: 10 }}>
            <div className="prog-bar"><div className="prog-fill p" style={{ width: `${poolMic > 0 ? (poolMic / preIssuedMic * 100) : 0}%` }} /></div>
          </div>
        </div>

        {/* SOURCE 2: USDT from Revenue */}
        <div className="card" style={{ padding: 20 }}>
          <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: '1.1rem' }}>{'\uD83D\uDCB5'}</span> USDT Source {'\u2014'} Revenue Allocation
          </div>
          <div className="callout" style={{ marginBottom: 12 }}>
            Pre-Sale &amp; MICE revenue flows 40% to Liquidity Contract. SEED V5c does NOT fund liquidity (managed by Reserved 50% via DAO vote). These funds accumulate automatically and can be added to SWAP pool by Admin.
          </div>
          <div className="info-row"><span className="info-key">From SEED</span><span className="info-val" style={{ fontFamily: 'var(--font-m)', color: 'var(--gray2)' }}>$0 <em style={{ fontSize: 10 }}>(V5c: 0% to LP)</em></span></div>
          <div className="info-row"><span className="info-key">From Pre-Sale (40%)</span><span className="info-val" style={{ fontFamily: 'var(--font-m)' }}>{fmtUsd(presaleLiqUsdt)}</span></div>
          <div className="info-row"><span className="info-key">From MICE (40%)</span><span className="info-val" style={{ fontFamily: 'var(--font-m)' }}>{fmtUsd(miceLiqUsdt)}</span></div>
          <div style={{ borderTop: '1px solid var(--border)', marginTop: 8, paddingTop: 8 }}>
            <div className="info-row"><span className="info-key" style={{ fontWeight: 700 }}>Total Available</span><span className="info-val" style={{ fontFamily: 'var(--font-m)', fontWeight: 700, color: 'var(--gold)' }}>{fmtUsd(totalLiqUsdt)}</span></div>
          </div>
          <div className="info-row"><span className="info-key">Added to Pool</span><span className="info-val" style={{ fontFamily: 'var(--font-m)' }}>{poolUsdt > 0 ? fmtUsd(poolUsdt) : '-'}</span></div>
        </div>
      </div>

      {/* ═══ ACTIVATE SWAP (only when inactive) ═══ */}
      {!swapEnabled && (
        <>
          <div className="sep-lbl">Step 1 {'\u2014'} Create Initial Pool &amp; Activate SWAP</div>
          <div className="card" style={{ padding: 20, marginBottom: 16 }}>
            <div className="callout" style={{ marginBottom: 16, borderLeftColor: 'var(--gold)' }}>
              <strong>First-time activation:</strong> Add both MIC and USDT to create the initial liquidity pair on PancakeSwap V3. The initial ratio determines the starting MIC price. Once activated, the pool is <strong>locked for 10 years</strong> and cannot be withdrawn.
            </div>

            <div className="g2" style={{ marginBottom: 16 }}>
              <div>
                <div className="input-label" style={{ marginBottom: 6 }}>Initial MIC</div>
                <input
                  type="number"
                  value={addMic}
                  onChange={(e) => setAddMic(e.target.value)}
                  placeholder="e.g. 105000000"
                  style={{ width: '100%' }}
                />
                <div style={{ fontSize: '0.58rem', color: 'var(--gray2)', marginTop: 4, fontFamily: 'var(--font-m)' }}>
                  Source: {fmtN(preIssuedMic)} MIC from Pre-Issued (LiquidityPool.sol)
                </div>
              </div>
              <div>
                <div className="input-label" style={{ marginBottom: 6 }}>Initial USDT</div>
                <input
                  type="number"
                  value={addUsdt}
                  onChange={(e) => setAddUsdt(e.target.value)}
                  placeholder="e.g. 262500"
                  style={{ width: '100%' }}
                />
                <div style={{ fontSize: '0.58rem', color: 'var(--gray2)', marginTop: 4, fontFamily: 'var(--font-m)' }}>
                  Source: {fmtUsd(totalLiqUsdt)} from PreSale + MICE Revenue (40% Liquidity allocation)
                </div>
              </div>
            </div>

            {/* Price preview */}
            {addMic && addUsdt && parseFloat(addMic) > 0 && parseFloat(addUsdt) > 0 && (
              <div style={{
                background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 8,
                padding: '10px 14px', marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              }}>
                <span style={{ fontSize: SZ, color: 'var(--gray)' }}>Starting price:</span>
                <span style={{ fontFamily: 'var(--font-d)', fontSize: SZ, fontWeight: 700, color: 'var(--gold)' }}>
                  1 MIC = ${(parseFloat(addUsdt) / parseFloat(addMic)).toFixed(6)}
                </span>
              </div>
            )}

            <button
              className="btn btn-gold"
              onClick={handleActivate}
              disabled={saving || !addMic || !addUsdt}
              style={{ width: '100%', padding: '10px 0', fontSize: SZ, fontWeight: 700 }}
            >
              {saving ? 'Activating...' : '\uD83D\uDD12 Activate SWAP & Lock Pool (10 Years)'}
            </button>
          </div>
        </>
      )}

      {/* ═══ ADD LIQUIDITY (always visible) ═══ */}
      <div className="sep-lbl">{swapEnabled ? 'Add Liquidity to SWAP Pool' : 'Step 2 (after activation) \u2014 Add Liquidity to Rebalance'}</div>
      <div className="g2" style={{ marginBottom: 16 }}>
        {/* ADD MIC */}
        <div className="card" style={{ padding: 20 }}>
          <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            Add MIC to SWAP Pool
          </div>
          <div style={{ fontSize: SZ, color: 'var(--gray2)', marginBottom: 12, lineHeight: 1.5 }}>
            Add MIC from LiquidityPool.sol contract to increase MIC supply in the pool. This <strong>lowers</strong> MIC price {'\u2014'} use when price is too high.
          </div>
          <div className="info-row" style={{ marginBottom: 8 }}>
            <span className="info-key">Available in Contract</span>
            <span className="info-val" style={{ fontFamily: 'var(--font-m)', color: 'var(--green2)' }}>{fmtN(preIssuedMic - poolMic)} MIC</span>
          </div>
          <div className="info-row" style={{ marginBottom: 12 }}>
            <span className="info-key">Currently in Pool</span>
            <span className="info-val" style={{ fontFamily: 'var(--font-m)' }}>{poolMic > 0 ? fmtN(poolMic) + ' MIC' : '-'}</span>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              type="number"
              value={swapEnabled ? addMic : ''}
              onChange={(e) => setAddMic(e.target.value)}
              placeholder="MIC amount"
              disabled={!swapEnabled}
              style={{ flex: 1, opacity: swapEnabled ? 1 : 0.5 }}
            />
            <button
              className="btn btn-gold"
              onClick={() => handleAddLiquidity('mic')}
              disabled={saving || !swapEnabled || !addMic}
              style={{ padding: '8px 20px', fontWeight: 700, opacity: swapEnabled ? 1 : 0.5 }}
            >
              {saving ? '...' : 'ADD MIC'}
            </button>
          </div>
          {!swapEnabled && (
            <div style={{ fontSize: '0.58rem', color: 'var(--gray2)', marginTop: 6, fontStyle: 'italic' }}>
              Activate SWAP first to enable adding liquidity
            </div>
          )}
        </div>

        {/* ADD USDT */}
        <div className="card" style={{ padding: 20 }}>
          <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            Add USDT to SWAP Pool
          </div>
          <div style={{ fontSize: SZ, color: 'var(--gray2)', marginBottom: 12, lineHeight: 1.5 }}>
            Add USDT from Liquidity Contract (revenue allocation) to increase USDT in the pool. This <strong>raises</strong> MIC price {'\u2014'} use when price is too low.
          </div>
          <div className="info-row" style={{ marginBottom: 8 }}>
            <span className="info-key">Available in Contract</span>
            <span className="info-val" style={{ fontFamily: 'var(--font-m)', color: 'var(--gold)' }}>{fmtUsd(totalLiqUsdt - poolUsdt)}</span>
          </div>
          <div className="info-row" style={{ marginBottom: 12 }}>
            <span className="info-key">Currently in Pool</span>
            <span className="info-val" style={{ fontFamily: 'var(--font-m)' }}>{poolUsdt > 0 ? fmtUsd(poolUsdt) : '-'}</span>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              type="number"
              value={swapEnabled ? addUsdt : ''}
              onChange={(e) => setAddUsdt(e.target.value)}
              placeholder="USDT amount"
              disabled={!swapEnabled}
              style={{ flex: 1, opacity: swapEnabled ? 1 : 0.5 }}
            />
            <button
              className="btn btn-gold"
              onClick={() => handleAddLiquidity('usdt')}
              disabled={saving || !swapEnabled || !addUsdt}
              style={{ padding: '8px 20px', fontWeight: 700, opacity: swapEnabled ? 1 : 0.5 }}
            >
              {saving ? '...' : 'ADD USDT'}
            </button>
          </div>
          {!swapEnabled && (
            <div style={{ fontSize: '0.58rem', color: 'var(--gray2)', marginTop: 6, fontStyle: 'italic' }}>
              Activate SWAP first to enable adding liquidity
            </div>
          )}
        </div>
      </div>

      {/* Rebalance hint when active */}
      {swapEnabled && (
        <div className="callout" style={{ marginBottom: 16, borderLeftColor: 'var(--green2)' }}>
          <strong>Price stabilization:</strong> Phase 1 (current) {'\u2014'} Manual rebalancing by Admin. If MIC price drops, add USDT to raise it. If MIC price rises too fast, add MIC to lower it. Phase 2 {'\u2014'} AI Stabilizer will auto-rebalance based on TWAP deviation.
        </div>
      )}

      {/* ═══ PRICE ORACLE ═══ */}
      <div className="sep-lbl">Price Oracle</div>
      <div className="g2" style={{ marginBottom: 16 }}>
        <div className="card" style={{ padding: 20 }}>
          <div className="card-title">Oracle Configuration</div>
          <div className="info-row"><span className="info-key">Primary</span><span className="info-val">PancakeSwap V3 TWAP</span></div>
          <div className="info-row"><span className="info-key">Fallback</span><span className="info-val">Chainlink Price Feed</span></div>
          <div className="info-row"><span className="info-key">TWAP Window</span><span className="info-val">30 minutes</span></div>
          <div className="info-row"><span className="info-key">Price Floor</span><span className="info-val">$0.001 MIC</span></div>
        </div>
        <div className="card" style={{ padding: 20 }}>
          <div className="card-title">Stabilization</div>
          <div className="info-row"><span className="info-key">Phase 1</span><span className="info-val">Manual rebalance by Admin</span></div>
          <div className="info-row"><span className="info-key">Phase 2</span><span className="info-val badge b-gray">AI Stabilizer (auto)</span></div>
          <div className="info-row"><span className="info-key">Slippage Guard</span><span className="info-val badge b-gray">Phase 2</span></div>
          <div className="info-row"><span className="info-key">Auto-rebalance</span><span className="info-val badge b-gray">Phase 2</span></div>
        </div>
      </div>

      {/* ═══ POOL LOCK & FUTURE ═══ */}
      <div className="sep-lbl">Pool Lock &amp; Roadmap</div>
      <div className="card" style={{ padding: 20 }}>
        <div className="g2">
          <div>
            <div className="card-title">Pool Lock</div>
            <div className="info-row"><span className="info-key">Lock Duration</span><span className="info-val">10 years from activation</span></div>
            <div className="info-row"><span className="info-key">Lock Status</span><span className="info-val">{swapEnabled ? <span className="badge b-ok">Locked</span> : <span className="badge b-gray">Not yet activated</span>}</span></div>
            <div className="info-row"><span className="info-key">Withdrawal</span><span className="info-val">Not possible during lock</span></div>
            <div className="info-row"><span className="info-key">Additional Deposits</span><span className="info-val">Allowed (Admin only)</span></div>
          </div>
          <div>
            <div className="card-title">Future Roadmap</div>
            <div className="info-row"><span className="info-key">Community Farming</span><span className="info-val badge b-gray">Planned</span></div>
            <div className="info-row"><span className="info-key">LP Token Rewards</span><span className="info-val badge b-gray">Planned</span></div>
            <div className="info-row"><span className="info-key">Multi-pair Support</span><span className="info-val badge b-gray">Planned</span></div>
            <div className="callout" style={{ marginTop: 10 }}>
              Community members will be able to provide liquidity and earn farming rewards. LP tokens will be issued as proof of liquidity provision.
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
