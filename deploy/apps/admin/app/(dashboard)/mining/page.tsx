'use client';

import { useState } from 'react';

const SZ = '0.62rem';

export default function MiningStakingPage() {
  const [activeTab, setActiveTab] = useState<'mining' | 'staking'>('mining');

  return (
    <>
      <div className="page-hd">
        <div>
          <div className="page-eyebrow">Business &amp; Finance</div>
          <div className="page-title">Mining &amp; Staking</div>
          <div className="page-sub">Emission controls, mining pool, staking parameters &amp; deposit management</div>
        </div>
      </div>

      <div className="tabs" style={{ marginBottom: 20 }}>
        <button className={`tab ${activeTab === 'mining' ? 'active' : ''}`} onClick={() => setActiveTab('mining')}>Mining Pool</button>
        <button className={`tab ${activeTab === 'staking' ? 'active' : ''}`} onClick={() => setActiveTab('staking')}>Staking</button>
      </div>

      {activeTab === 'mining' && (
        <>
          {/* EMISSION CONTROLS */}
          <div className="sep-lbl">Emission Engine</div>
          <div className="g3" style={{ marginBottom: 16 }}>
            <div className="stat-box">
              <div className="stat-lbl">Total Emitted</div>
              <div className="stat-val p">{'\u2014'}</div>
              <div className="stat-delta">of 5,950,000,000 pool</div>
            </div>
            <div className="stat-box">
              <div className="stat-lbl">Daily Emission Rate</div>
              <div className="stat-val gold">{'\u2014'}</div>
              <div className="stat-delta">E(t) = E_base {'\u00D7'} D(t) {'\u00D7'} R(t) {'\u00D7'} W(t)</div>
            </div>
            <div className="stat-box">
              <div className="stat-lbl">Active MICE Licenses</div>
              <div className="stat-val g">{'\u2014'}</div>
              <div className="stat-delta">of 100,000 max</div>
            </div>
          </div>

          <div className="g2" style={{ marginBottom: 16 }}>
            <div className="card" style={{ padding: 20 }}>
              <div className="card-title">Emission Split</div>
              <div className="info-row"><span className="info-key">Miners (MICE)</span><span className="info-val">60%</span></div>
              <div className="info-row"><span className="info-key">Staking</span><span className="info-val">25%</span></div>
              <div className="info-row"><span className="info-key">DAO Treasury</span><span className="info-val">10%</span></div>
              <div className="info-row"><span className="info-key">Community NFT Reward</span><span className="info-val">5%</span></div>
            </div>
            <div className="card" style={{ padding: 20 }}>
              <div className="card-title">Circuit Breakers</div>
              <div className="info-row"><span className="info-key">Cumulative Cap</span><span className="info-val">{'\u2264'} 5,950,000,000</span></div>
              <div className="info-row"><span className="info-key">Daily Cap</span><span className="info-val">2{'\u00D7'} E_base(t)</span></div>
              <div className="info-row"><span className="info-key">Price Floor</span><span className="info-val">$0.001 MIC</span></div>
              <div className="info-row"><span className="info-key">Unstake Limit</span><span className="info-val">10%/day</span></div>
            </div>
          </div>

          <div className="sep-lbl">Mining Pool Distribution</div>
          <div className="card" style={{ padding: 20, marginBottom: 16 }}>
            <div className="callout">
              <p>Mining pool distribution is automatic via <strong>EmissionController.sol</strong>. Daily emission is distributed to active MICE holders weighted by Hindex. Controls will be available after smart contract deployment.</p>
            </div>
          </div>
        </>
      )}

      {activeTab === 'staking' && (
        <>
          <div className="sep-lbl">Staking Parameters</div>
          <div className="g2" style={{ marginBottom: 16 }}>
            <div className="card" style={{ padding: 20 }}>
              <div className="card-title">Time-Lock Multipliers</div>
              <div className="info-row"><span className="info-key">30 days</span><span className="info-val">{'\u00D7'}1.0</span></div>
              <div className="info-row"><span className="info-key">90 days</span><span className="info-val">{'\u00D7'}1.25</span></div>
              <div className="info-row"><span className="info-key">180 days</span><span className="info-val">{'\u00D7'}1.5</span></div>
              <div className="info-row"><span className="info-key">360 days</span><span className="info-val">{'\u00D7'}2.0</span></div>
            </div>
            <div className="card" style={{ padding: 20 }}>
              <div className="card-title">Staking Stats</div>
              <div className="info-row"><span className="info-key">Total Staked</span><span className="info-val">{'\u2014'}</span></div>
              <div className="info-row"><span className="info-key">Active Positions</span><span className="info-val">{'\u2014'}</span></div>
              <div className="info-row"><span className="info-key">Total Weighted</span><span className="info-val">{'\u2014'}</span></div>
              <div className="info-row"><span className="info-key">APY (est.)</span><span className="info-val">{'\u2014'}</span></div>
            </div>
          </div>

          <div className="sep-lbl">Staking Sustainability Fund</div>
          <div className="card" style={{ padding: 20 }}>
            <div className="callout">
              <p>5% of MICE USDT revenue ($750K target) allocated to auto-buy MIC from DEX. Post-emission: drip MIC into Staking Reward Pool to maintain APY {'\u003E'} 0%.</p>
            </div>
            <div className="g3" style={{ marginTop: 16 }}>
              <div className="stat-box"><div className="stat-lbl">Fund Balance</div><div className="stat-val gold">{'\u2014'}</div></div>
              <div className="stat-box"><div className="stat-lbl">MIC Accumulated</div><div className="stat-val p">{'\u2014'}</div></div>
              <div className="stat-box"><div className="stat-lbl">Last Buy</div><div className="stat-val g">{'\u2014'}</div></div>
            </div>
          </div>
        </>
      )}
    </>
  );
}
