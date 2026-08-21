'use client';

import { useState, useEffect } from 'react';

const SZ = '0.62rem';
const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

interface NetStats {
  totalEmitted: number;
  dailyEmission: number;
  activeLicences: number;
  micPerLicencePerDay: number;
  minerShare: number;
  damper: number;
  poolRemaining: number;
  poolTotal: number;
  totalMiceMinted: number;
  split: { miners: number; staking: number; dao: number; communityNft: number; mfpReward: number };
}

const num = (v: number | undefined, d = 0) =>
  v === undefined || v === null ? '\u2014' : v.toLocaleString('en-US', { maximumFractionDigits: d });

export default function MiningStakingPage() {
  const [activeTab, setActiveTab] = useState<'mining' | 'staking'>('mining');

  // This page was entirely static: every figure below was a hard-coded em dash and the
  // formula three revisions out of date. It reads the same public endpoint the DApp does.
  const [net, setNet] = useState<NetStats | null>(null);
  const [netErr, setNetErr] = useState<string | null>(null);

  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const r = await fetch(`${API_BASE}/mining/network-stats`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const d = (await r.json()).data;
        if (!dead) { setNet(d); setNetErr(null); }
      } catch (e: any) {
        if (!dead) setNetErr(e?.message || 'could not read emission state');
      }
    })();
    return () => { dead = true; };
  }, []);

  // The published split and the one running today differ while the 90-day Early Staking
  // Boost lends part of the miners' share to staking. Showing either alone reads as wrong.
  const pub = net?.split ?? { miners: 59, staking: 25, dao: 10, communityNft: 5, mfpReward: 1 };
  const boostOn = typeof net?.minerShare === 'number' && net.minerShare < pub.miners;
  const live = boostOn
    ? { ...pub, miners: net!.minerShare, staking: pub.staking + (pub.miners - net!.minerShare) }
    : pub;

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
          {netErr && (
            <div className="card" style={{ padding: '10px 14px', marginBottom: 12, fontSize: SZ }}>
              Emission state could not be read, so the figures below are blank rather than
              stale: {netErr}
            </div>
          )}
          <div className="g3" style={{ marginBottom: 16 }}>
            <div className="stat-box">
              <div className="stat-lbl">Total Emitted</div>
              <div className="stat-val p">{num(net?.totalEmitted, 2)}</div>
              <div className="stat-delta">of {num(net?.poolTotal ?? 5_950_000_000)} pool</div>
            </div>
            <div className="stat-box">
              <div className="stat-lbl">Daily Emission Rate</div>
              <div className="stat-val gold">{num(net?.dailyEmission, 2)}</div>
              {/* EmissionControllerV2. What stood here was E_base x D(t) x R(t) x W(t) —
                  R(t) was removed on 2026-08-05 and the whole six-factor engine on 08-18. */}
              <div className="stat-delta">E = N {'\u00D7'} r {'\u00F7'} minerShare {'\u00D7'} damper</div>
            </div>
            <div className="stat-box">
              <div className="stat-lbl">Active MICE Licenses</div>
              <div className="stat-val g">{num(net?.activeLicences)}</div>
              <div className="stat-delta">
                of 100,000 max{net ? ` \u00B7 ${num(net.totalMiceMinted)} minted` : ''}
              </div>
            </div>
          </div>

          <div className="g2" style={{ marginBottom: 16 }}>
            <div className="card" style={{ padding: 20 }}>
              <div className="card-title">Emission Split{boostOn ? ' \u2014 live' : ''}</div>
              <div className="info-row"><span className="info-key">Miners (MICE)</span><span className="info-val">{live.miners.toFixed(2).replace(/\.00$/, '')}%</span></div>
              <div className="info-row"><span className="info-key">Staking</span><span className="info-val">{live.staking.toFixed(2).replace(/\.00$/, '')}%</span></div>
              <div className="info-row"><span className="info-key">DAO Treasury</span><span className="info-val">{live.dao}%</span></div>
              <div className="info-row"><span className="info-key">Community NFT Reward</span><span className="info-val">{live.communityNft}%</span></div>
              <div className="info-row"><span className="info-key">MFP-NFT Reward</span><span className="info-val">{live.mfpReward}%</span></div>
              {boostOn && (
                <div style={{ marginTop: 10, fontSize: SZ, lineHeight: 1.6, opacity: .85 }}>
                  Early Staking Boost is running: for 90 days part of the miners&rsquo; share is
                  lent to staking, so the live split is {live.miners.toFixed(2)}% / {live.staking.toFixed(2)}%
                  against the published {pub.miners}% / {pub.staking}%. Miners are not paid less —
                  each active licence still earns {num(net?.micPerLicencePerDay, 4)} MIC/day; more is
                  issued to cover the larger staking slice.
                </div>
              )}
            </div>
            <div className="card" style={{ padding: 20 }}>
              <div className="card-title">Circuit Breakers</div>
              {/* V2 has no E_base to double and reads no price, so "2x E_base" and a price
                  floor described brakes that no longer exist. What remains is real. */}
              <div className="info-row"><span className="info-key">Mining allocation</span><span className="info-val">{'\u2264'} {num(net?.poolTotal ?? 5_950_000_000)}</span></div>
              <div className="info-row"><span className="info-key">Remaining</span><span className="info-val">{num(net?.poolRemaining, 0)}</span></div>
              <div className="info-row"><span className="info-key">Licence ceiling</span><span className="info-val">100,000 {'\u00D7'} 30,000 MIC</span></div>
              <div className="info-row"><span className="info-key">Emergency damper</span><span className="info-val">{net ? `${net.damper.toFixed(2)}${net.damper >= 1 ? ' (off)' : ' \u2014 ENGAGED'}` : '\u2014'}</span></div>
              <div className="info-row"><span className="info-key">Unstake Limit</span><span className="info-val">10%/day</span></div>
            </div>
          </div>

          <div className="sep-lbl">Mining Pool Distribution</div>
          <div className="card" style={{ padding: 20, marginBottom: 16 }}>
            <div className="callout">
              <p>Mining rewards are distributed automatically by <strong>EmissionControllerV2</strong>. Every active MICE licence earns the same fixed rate — <strong>83.3333 MIC per day</strong> — so total issuance rises with the number of miners while each miner&rsquo;s share stays put. A licence earns for its full 360-day term. No price feed and no adoption curve are involved.</p>
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
