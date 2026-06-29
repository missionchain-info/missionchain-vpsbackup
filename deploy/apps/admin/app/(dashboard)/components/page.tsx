'use client';

import { useState, useEffect } from 'react';
import { JsonRpcProvider, Contract } from 'ethers';
import { fetchDashboardOverview, fetchPoolStats, fetchPoolAdminEntries, fetchPoolActivity, fetchAdminAccess } from '@/lib/api';
import MfpAccessSection from '@/components/MfpAccessSection';
import FoundersAllocationSection from '@/components/FoundersAllocationSection';
import { useAuth, isOwnerWallet } from '@/lib/auth';

/* ── On-chain MFPNFT (BSC Mainnet — Phase 0 Genesis 2026-05-06) ── */
const MFPNFT_ADDRESS = '0xAE6F32A6fdf80F5e54ba85441386dBA6a381f565';
const BSC_RPC = 'https://bsc-dataseed.binance.org';
const MFPNFT_TOKEN_ABI = [
  'function totalMinted() view returns (uint256)',
  'function tokenByIndex(uint256 index) view returns (uint256)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function pairOf(uint256 tokenId) view returns (uint256, uint256)',
] as const;

interface MfpToken {
  tokenId: number;
  owner: string;
  imageId: number;
  verseId: number;
}

function shortAddr(a: string) {
  if (!a || a.length < 10) return a || '-';
  return a.slice(0, 6) + '...' + a.slice(-4);
}

/* ── Helper: fetch JSON with JWT auth ── */
const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
async function fetchJson(path: string) {
  const jwt = typeof window !== 'undefined' ? localStorage.getItem('mc-admin-jwt') : null;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (jwt) headers['Authorization'] = `Bearer ${jwt}`;
  const res = await fetch(`${API_BASE}${path}`, { headers });
  return res.json();
}

/* ── Formatting helpers ── */
function fmt(n: number | undefined | null): string {
  if (n === undefined || n === null || isNaN(n as number) || n === 0) return '-';
  return n.toLocaleString();
}

/* ── MICE round label ── */
const MICE_ROUND_LABELS: Record<number, string> = {
  1: 'Round 1 \u2014 Early Stage',
  2: 'Round 2 \u2014 Growth',
  3: 'Round 3 \u2014 Expansion',
  4: 'Round 4 \u2014 Mature',
  5: 'Round 5 \u2014 Premium',
};

/* SEED grant cap — reserves up to 1,250 of the 2,500 hard cap
   for SEED package buyers. The remaining 1,250 are split between Founding,
   Old-Investor grants, and DAO-approved discretionary allocations. */
const SEED_RESERVED_CAP = 1_250;
const MFP_HARD_CAP = 2_500;

export default function ComponentsPage() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState(0);
  const tabs = ['MICE Licenses', 'MFP-NFT', 'Community NFTs', 'Community Pool', 'MIC Founders, Management'];

  /* ── API state ── */
  const [dashboard, setDashboard] = useState<any>(null);
  const [networkStats, setNetworkStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  /* ── MFP admin extras ── */
  const [admins, setAdmins] = useState<Array<{ wallet: string; userId: string; role?: string }>>([]);
  const [toast, setToast] = useState<string>('');
  const [showMfpDetails, setShowMfpDetails] = useState(false);
  const [mfpTokens, setMfpTokens] = useState<MfpToken[]>([]);
  const [mfpTokensLoading, setMfpTokensLoading] = useState(false);

  /* Load on-chain MFP tokens when modal opens */
  useEffect(() => {
    if (!showMfpDetails) return;
    let mounted = true;
    (async () => {
      setMfpTokensLoading(true);
      try {
        const provider = new JsonRpcProvider(BSC_RPC);
        const contract = new Contract(MFPNFT_ADDRESS, MFPNFT_TOKEN_ABI, provider);
        const total = Number(await contract.totalMinted().catch(() => 0n));
        if (total === 0) {
          if (mounted) { setMfpTokens([]); setMfpTokensLoading(false); }
          return;
        }
        const max = Math.min(total, 200); // cap at 200 to avoid RPC overload
        const list: MfpToken[] = [];
        for (let i = 0; i < max; i++) {
          try {
            const tokenId = Number(await contract.tokenByIndex(BigInt(i)));
            const [owner, pair] = await Promise.all([
              contract.ownerOf(BigInt(tokenId)),
              contract.pairOf(BigInt(tokenId)),
            ]);
            list.push({
              tokenId,
              owner: String(owner),
              imageId: Number(pair[0]),
              verseId: Number(pair[1]),
            });
          } catch (err) {
            // skip token on error
          }
        }
        if (mounted) setMfpTokens(list);
      } catch (err) {
        console.error('[MFP tokens] on-chain fetch failed', err);
      } finally {
        if (mounted) setMfpTokensLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [showMfpDetails]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3500);
  };

  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        const [dashRes, netRes, adminsRes] = await Promise.all([
          fetchDashboardOverview(),
          fetchJson('/mining/network-stats'),
          fetchAdminAccess().catch(() => null),
        ]);
        if (!mounted) return;
        setDashboard(dashRes?.data ?? dashRes);
        setNetworkStats(netRes?.data ?? netRes);
        if (adminsRes?.data) {
          setAdmins(adminsRes.data.map((a: any) => ({ wallet: a.wallet, userId: a.userId, role: a.role })));
        }
      } catch (err) {
        console.error('Failed to fetch MICE/NFT data:', err);
      } finally {
        if (mounted) setLoading(false);
      }
    }
    load();
    return () => { mounted = false; };
  }, []);

  /* ── Derived values ── */
  const activeMice = networkStats?.totalMiceMinted ?? dashboard?.activeMice ?? null;
  const miceMaxSupply = dashboard?.miceMaxSupply ?? 100000;
  const currentRound = networkStats?.currentRound ?? dashboard?.miceCurrentRound ?? null;
  const currentPrice = dashboard?.miceCurrentPrice ?? null;
  const mfpMinted = dashboard?.mfpMinted ?? null;
  const communityNftsTotal = dashboard?.communityNfts ?? null;

  const L = loading; // shorthand

  return (
    <>
      <div className="page-hd">
        <div>
          <div className="page-eyebrow">Components</div>
          <div className="page-title">MICE &amp; NFTs</div>
          <div className="page-sub">Manage MICE licenses, MFP-NFT, and Community Credentials</div>
        </div>
      </div>

      <div className="tabs">
        {tabs.map((t, i) => (
          <button key={t} className={`tab ${activeTab === i ? 'active' : ''}`} onClick={() => setActiveTab(i)}>{t}</button>
        ))}
      </div>

      {/* ── Tab 0: MICE Licenses ── */}
      {activeTab === 0 && (
        <>
          <div className="sep-lbl">MICE &mdash; Mission Algorithm Node License</div>
          <div className="g4" style={{ marginBottom: 20 }}>
            <div className="stat-box">
              <div className="stat-lbl">Total MICE Cap</div>
              <div className="stat-val g">{fmt(miceMaxSupply)}</div>
              <div className="stat-delta">Immutable hard cap</div>
            </div>
            <div className="stat-box">
              <div className="stat-lbl">Active Licenses</div>
              <div className="stat-val p">{L ? '-' : fmt(activeMice)}</div>
              <div className="stat-delta up">360-day auto-expiry</div>
            </div>
            <div className="stat-box">
              <div className="stat-lbl">Current Round</div>
              <div className="stat-val gold">{L ? '-' : currentRound != null ? `#${currentRound}` : '-'}</div>
              <div className="stat-delta">{currentRound != null ? (MICE_ROUND_LABELS[currentRound] ?? `Round ${currentRound}`) : '-'}</div>
            </div>
            <div className="stat-box">
              <div className="stat-lbl">Current Price</div>
              <div className="stat-val">{L ? '-' : currentPrice != null && Number(currentPrice) > 0 ? `$${fmt(currentPrice)}` : '-'}</div>
              <div className="stat-delta">50% MIC Burned + 50% USDT</div>
            </div>
          </div>

          {/* MICE round overview table */}
          <div className="card" style={{ marginBottom: 20 }}>
            <div className="card-title">MICE Pricing &mdash; 5 Rounds (20,000 licenses each)</div>
            <div style={{ overflowX: 'auto' }}>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Round</th>
                    <th>MICE #</th>
                    <th>Price</th>
                    <th>MIC Burned (50%)</th>
                    <th>USDT (50%)</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { r: 1, label: 'Early Stage', range: '1 \u2013 20,000', price: 100, mic: 50, usdt: 50 },
                    { r: 2, label: 'Growth', range: '20,001 \u2013 40,000', price: 200, mic: 100, usdt: 100 },
                    { r: 3, label: 'Expansion', range: '40,001 \u2013 60,000', price: 300, mic: 150, usdt: 150 },
                    { r: 4, label: 'Mature', range: '60,001 \u2013 80,000', price: 400, mic: 200, usdt: 200 },
                    { r: 5, label: 'Premium', range: '80,001 \u2013 100,000', price: 500, mic: 250, usdt: 250 },
                  ].map((row) => {
                    const isCurrent = currentRound === row.r;
                    const isPast = currentRound != null && row.r < currentRound;
                    return (
                      <tr key={row.r} style={isCurrent ? { background: 'rgba(201,168,76,.08)' } : {}}>
                        <td>Round {row.r} &mdash; {row.label}</td>
                        <td style={{ fontFamily: 'var(--font-m)', fontSize: 11 }}>{row.range}</td>
                        <td><strong>${row.price}</strong></td>
                        <td>${row.mic}</td>
                        <td>${row.usdt}</td>
                        <td>
                          {isCurrent ? (
                            <span style={{ padding: '2px 8px', borderRadius: 6, fontSize: 10, fontWeight: 700, background: 'rgba(201,168,76,.15)', color: 'var(--gold)' }}>ACTIVE</span>
                          ) : isPast ? (
                            <span style={{ padding: '2px 8px', borderRadius: 6, fontSize: 10, fontWeight: 700, background: 'rgba(76,175,80,.12)', color: '#66BB6A' }}>SOLD OUT</span>
                          ) : (
                            <span style={{ padding: '2px 8px', borderRadius: 6, fontSize: 10, fontWeight: 700, background: 'rgba(255,255,255,.06)', color: 'var(--gray2)' }}>UPCOMING</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Summary note */}
          {!L && activeMice === 0 && (
            <div className="card" style={{ marginBottom: 20, textAlign: 'center', color: 'var(--gray2)', padding: 20, fontSize: 13 }}>
              No MICE licenses minted yet. Mining has not started.
            </div>
          )}
        </>
      )}

      {/* ── Tab 1: MFP-NFT ── */}
      {activeTab === 1 && (
        <>
          <div className="sep-lbl">MFP-NFT &mdash; Mission Founders Pass</div>

          {/* ── Headline supply card with big "N / 2,500" + actions ── */}
          <div className="card" style={{ marginBottom: 16, padding: 22 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
              <div style={{
                width: 64, height: 64, borderRadius: 16, flexShrink: 0,
                background: 'linear-gradient(135deg,#1F1035,#130A1E)',
                border: '1px solid rgba(212,160,23,0.25)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32,
              }}>{'\u{1F48E}'}</div>
              <div style={{ flex: 1, minWidth: 220 }}>
                <div style={{ fontSize: 11, color: 'var(--gray2)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4 }}>
                  Total Minted (on-chain)
                </div>
                <div style={{ fontSize: 32, fontWeight: 800, fontFamily: 'var(--font-d)', color: 'var(--gold)', lineHeight: 1 }}>
                  {L ? '-' : fmt(mfpMinted)}
                  <span style={{ color: 'var(--gray2)', fontSize: 22, fontWeight: 500 }}> / {fmt(MFP_HARD_CAP)}</span>
                </div>
                <div style={{ marginTop: 6, fontSize: 12, color: 'var(--muted)' }}>
                  Hard cap immutable on-chain. Available pool: <strong style={{ color: 'var(--gold)' }}>{L ? '-' : (mfpMinted != null ? fmt(MFP_HARD_CAP - mfpMinted) : '-')}</strong>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button className="btn btn-primary btn-sm" onClick={() => setShowMfpDetails(true)}>
                  View Details
                </button>
                <a
                  href="https://bscscan.com/address/0xAE6F32A6fdf80F5e54ba85441386dBA6a381f565"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-outline btn-sm"
                  style={{ textDecoration: 'none' }}
                >
                  BSCScan {'↗'}
                </a>
              </div>
            </div>

            {/* Sub-stats: SEED reserved cap, multiplier, duration */}
            <div className="g4" style={{ marginTop: 18 }}>
              <div className="stat-box">
                <div className="stat-lbl">OWNER — SEED Reserved</div>
                <div className="stat-val gold" style={{ fontSize: 16 }}>{fmt(SEED_RESERVED_CAP)}</div>
                <div className="stat-delta">Of 2,500 cap, 1,250 reserved for SEED package buyers</div>
              </div>
              <div className="stat-box">
                <div className="stat-lbl">SEED Granted So Far</div>
                <div className="stat-val p" style={{ fontSize: 16 }}>{L ? '-' : fmt(dashboard?.seedMfpGranted)}</div>
                <div className="stat-delta">SeedSale auto-grants on package purchase</div>
              </div>
              <div className="stat-box">
                <div className="stat-lbl">Multiplier</div>
                <div className="stat-val gold" style={{ fontSize: 16 }}>&times;25</div>
                <div className="stat-delta">Reward-pool weight (highest in protocol)</div>
              </div>
              <div className="stat-box">
                <div className="stat-lbl">Duration</div>
                <div className="stat-val g" style={{ fontSize: 16 }}>Lifetime</div>
                <div className="stat-delta">No expiry · DAO governance asset</div>
              </div>
            </div>
          </div>

          {/* ── Authors Pool / Royalty Receiver — quick callout ── */}
          <div className="card" style={{ marginBottom: 16, padding: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
              <div style={{ fontSize: 28, flexShrink: 0 }}>{'\u{1F3A8}'}</div>
              <div style={{ flex: 1, minWidth: 220 }}>
                <div style={{ fontSize: 11, color: 'var(--gray2)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 2 }}>
                  Royalty Receiver — 5% (ERC-2981)
                </div>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--gold)', marginBottom: 4 }}>
                  Authors Pool — splits 5% sale royalty across contributing artists
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                  Edit address below in <strong>Royalty Configuration</strong>. Applies to all marketplaces honoring ERC-2981 (OpenSea Pro, in-app P2P).
                </div>
              </div>
            </div>
          </div>

          {/* ── Embedded MfpAccessSection: Royalty edit + Grant Mint Allocation ── */}
          <MfpAccessSection
            existingWallets={admins}
            showToast={showToast}
          />

          {/* ── View Details Modal — bright colors, on-chain list ── */}
          {showMfpDetails && (
            <div
              style={{
                position: 'fixed', inset: 0, zIndex: 9999,
                background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                padding: 20,
              }}
              onClick={() => setShowMfpDetails(false)}
            >
              <div
                onClick={(e) => e.stopPropagation()}
                style={{
                  background: 'linear-gradient(145deg, #1A1228, #16213E)',
                  border: '1px solid rgba(201,168,76,0.40)',
                  borderRadius: 16, padding: '22px 24px',
                  maxWidth: 760, width: '100%', maxHeight: '85vh', overflowY: 'auto',
                  boxShadow: '0 20px 60px rgba(0,0,0,0.5), 0 0 40px rgba(201,168,76,0.10)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <div style={{ fontSize: 16, fontWeight: 700, color: '#F5D56E', fontFamily: 'var(--font-d)' }}>
                    MFP-NFT Token Details {mfpTokens.length > 0 && (
                      <span style={{ color: '#D4C098', fontSize: 13, fontWeight: 500, marginLeft: 8 }}>
                        ({mfpTokens.length} tokens)
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => setShowMfpDetails(false)}
                    style={{ background: 'none', border: 'none', color: '#D4C098', fontSize: 22, cursor: 'pointer', padding: 4 }}
                  >&times;</button>
                </div>

                <div style={{ fontSize: 12, color: '#D4C098', marginBottom: 14, lineHeight: 1.5 }}>
                  All minted MFP-NFTs read directly from contract <code style={{ background: 'rgba(245,213,110,0.10)', padding: '1px 6px', borderRadius: 3, color: '#F5D56E', fontSize: 11 }}>0x4d5147aC...4BD8c</code>. Click any Token ID to view on BSCScan.
                </div>

                {mfpTokensLoading ? (
                  <div style={{ padding: '40px 0', textAlign: 'center', color: '#D4C098', fontStyle: 'italic' }}>
                    Loading on-chain token list...
                  </div>
                ) : mfpTokens.length === 0 ? (
                  <div style={{ padding: '40px 0', textAlign: 'center', color: '#D4C098', fontStyle: 'italic' }}>
                    No MFP-NFTs minted yet on this contract.
                  </div>
                ) : (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, color: '#F5E8CC' }}>
                      <thead>
                        <tr style={{ background: 'rgba(245,213,110,0.10)', borderBottom: '1px solid rgba(245,213,110,0.25)' }}>
                          <th style={{ textAlign: 'left', padding: '10px 8px', color: '#F5D56E', fontWeight: 700, letterSpacing: '0.04em', fontSize: 11 }}>TOKEN ID</th>
                          <th style={{ textAlign: 'left', padding: '10px 8px', color: '#F5D56E', fontWeight: 700, letterSpacing: '0.04em', fontSize: 11 }}>IMAGE #</th>
                          <th style={{ textAlign: 'left', padding: '10px 8px', color: '#F5D56E', fontWeight: 700, letterSpacing: '0.04em', fontSize: 11 }}>VERSE #</th>
                          <th style={{ textAlign: 'left', padding: '10px 8px', color: '#F5D56E', fontWeight: 700, letterSpacing: '0.04em', fontSize: 11 }}>CURRENT OWNER</th>
                          <th style={{ textAlign: 'right', padding: '10px 8px', color: '#F5D56E', fontWeight: 700, letterSpacing: '0.04em', fontSize: 11 }}>BSCScan</th>
                        </tr>
                      </thead>
                      <tbody>
                        {mfpTokens.map((t) => (
                          <tr key={t.tokenId} style={{ borderBottom: '1px solid rgba(245,213,110,0.10)' }}>
                            <td style={{ padding: '10px 8px', fontFamily: 'monospace', fontWeight: 700, color: '#F5D56E' }}>
                              #{t.tokenId}
                            </td>
                            <td style={{ padding: '10px 8px', fontFamily: 'monospace', color: '#F5E8CC' }}>{t.imageId}</td>
                            <td style={{ padding: '10px 8px', fontFamily: 'monospace', color: '#F5E8CC' }}>{t.verseId}</td>
                            <td style={{ padding: '10px 8px', fontFamily: 'monospace', color: '#F5E8CC' }}>
                              <a
                                href={`https://bscscan.com/address/${t.owner}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{ color: '#F5E8CC', textDecoration: 'none', borderBottom: '1px dotted rgba(245,232,204,0.40)' }}
                              >
                                {shortAddr(t.owner)}
                              </a>
                            </td>
                            <td style={{ padding: '10px 8px', textAlign: 'right' }}>
                              <a
                                href={`https://bscscan.com/token/${MFPNFT_ADDRESS}?a=${t.tokenId}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{ color: '#F5D56E', textDecoration: 'none', fontWeight: 600, fontSize: 11 }}
                              >
                                View {'↗'}
                              </a>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                <div style={{
                  marginTop: 14, padding: '10px 12px',
                  background: 'rgba(245,213,110,0.10)',
                  border: '1px solid rgba(245,213,110,0.25)',
                  borderRadius: 8,
                  fontSize: 11, color: '#F5E8CC', lineHeight: 1.5,
                }}>
                  <strong style={{ color: '#F5D56E' }}>Full transfer history:</strong> view all events for the MFPNFT contract at{' '}
                  <a
                    href={`https://bscscan.com/address/${MFPNFT_ADDRESS}#events`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: '#F5D56E', fontWeight: 600 }}
                  >
                    bscscan.com {'↗'}
                  </a>
                </div>
              </div>
            </div>
          )}

          {/* Toast */}
          {toast && (
            <div
              style={{
                position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)', zIndex: 10000,
                background: 'rgba(0,0,0,0.85)', color: '#F5D56E',
                padding: '10px 18px', borderRadius: 8, fontSize: 13,
                border: '1px solid rgba(201,168,76,0.30)',
              }}
            >
              {toast}
            </div>
          )}
        </>
      )}

      {/* ── Tab 2: Community NFTs ── */}
      {activeTab === 2 && (
        <>
          <div className="sep-lbl">Community NFT Credentials</div>

          {/* Summary stat */}
          <div className="g3" style={{ marginBottom: 20 }}>
            <div className="stat-box">
              <div className="stat-lbl">Total Community NFTs</div>
              <div className="stat-val p">{L ? '-' : fmt(communityNftsTotal)}</div>
              <div className="stat-delta">On-chain total (all tiers)</div>
            </div>
            <div className="stat-box">
              <div className="stat-lbl">Supply Type</div>
              <div className="stat-val" style={{ fontSize: 16 }}>Unlimited</div>
              <div className="stat-delta">Minted based on KPI / performance</div>
            </div>
            <div className="stat-box">
              <div className="stat-lbl">DAO Voting</div>
              <div className="stat-val c" style={{ fontSize: 16 }}>None</div>
              <div className="stat-delta">No governance rights</div>
            </div>
          </div>

          {/* Tier cards */}
          <div className="g4" style={{ marginBottom: 20 }}>
            {/* Builder */}
            <div className="nft-card">
              <div className="nft-img" style={{ background: 'linear-gradient(135deg,#1A0E28,#0C0812)' }}>{'\u{1F3D7}\uFE0F'}</div>
              <div className="nft-body">
                <div className="nft-name">Builder NFT</div>
                <div className="nft-stats">
                  <div className="nft-stat">
                    <div className="nft-stat-l">MULTIPLIER</div>
                    <div className="nft-stat-v" style={{ color: '#29B6F6' }}>&times;1.0</div>
                  </div>
                  <div className="nft-stat">
                    <div className="nft-stat-l">DURATION</div>
                    <div className="nft-stat-v">60 days</div>
                  </div>
                  <div className="nft-stat">
                    <div className="nft-stat-l">STATUS</div>
                    <div className="nft-stat-v" style={{ fontSize: 11 }}>Performance-based</div>
                  </div>
                </div>
                <div style={{ marginTop: 12, display: 'flex', gap: 6 }}>
                  <button className="btn btn-outline btn-sm">Manage</button>
                  <button className="btn btn-outline btn-sm">Config</button>
                </div>
              </div>
            </div>

            {/* Maker */}
            <div className="nft-card">
              <div className="nft-img" style={{ background: 'linear-gradient(135deg,#1F1035,#1A0E28)' }}>{'\u{1F528}'}</div>
              <div className="nft-body">
                <div className="nft-name">Maker NFT</div>
                <div className="nft-stats">
                  <div className="nft-stat">
                    <div className="nft-stat-l">MULTIPLIER</div>
                    <div className="nft-stat-v" style={{ color: '#AB47BC' }}>&times;2.5</div>
                  </div>
                  <div className="nft-stat">
                    <div className="nft-stat-l">DURATION</div>
                    <div className="nft-stat-v">90 days</div>
                  </div>
                  <div className="nft-stat">
                    <div className="nft-stat-l">STATUS</div>
                    <div className="nft-stat-v" style={{ fontSize: 11 }}>Performance-based</div>
                  </div>
                </div>
                <div style={{ marginTop: 12, display: 'flex', gap: 6 }}>
                  <button className="btn btn-outline btn-sm">Manage</button>
                  <button className="btn btn-outline btn-sm">Config</button>
                </div>
              </div>
            </div>

            {/* Luminary */}
            <div className="nft-card">
              <div className="nft-img" style={{ background: 'linear-gradient(135deg,#2a1600,#1F1035)' }}>{'\u2B50'}</div>
              <div className="nft-body">
                <div className="nft-name">Luminary NFT</div>
                <div className="nft-stats">
                  <div className="nft-stat">
                    <div className="nft-stat-l">MULTIPLIER</div>
                    <div className="nft-stat-v" style={{ color: '#C084D4' }}>&times;5.0</div>
                  </div>
                  <div className="nft-stat">
                    <div className="nft-stat-l">DURATION</div>
                    <div className="nft-stat-v">180 days</div>
                  </div>
                  <div className="nft-stat">
                    <div className="nft-stat-l">STATUS</div>
                    <div className="nft-stat-v" style={{ fontSize: 11 }}>Performance-based</div>
                  </div>
                </div>
                <div style={{ marginTop: 12, display: 'flex', gap: 6 }}>
                  <button className="btn btn-outline btn-sm">Manage</button>
                  <button className="btn btn-outline btn-sm">Config</button>
                </div>
              </div>
            </div>
          </div>

          {!L && communityNftsTotal === 0 && (
            <div className="card" style={{ marginBottom: 20, textAlign: 'center', color: 'var(--gray2)', padding: 20, fontSize: 13 }}>
              No community NFTs minted yet. NFTs are issued based on KPI and performance milestones.
            </div>
          )}
        </>
      )}

      {/* ── NFT Configuration (shared for Tab 1 & Tab 2) ── */}
      {(activeTab === 1 || activeTab === 2) && (
        <div className="card card-g">
          <div className="card-title">NFT Configuration Parameters</div>
          <div className="g2">
            <div>
              <div className="input-wrap">
                <div className="input-label">Series Number Generation</div>
                <select><option>Auto-generate unique hash on minting</option><option>Sequential numbering</option></select>
              </div>
              {activeTab === 2 && (
                <div className="input-wrap">
                  <div className="input-label">Design Upload Pool (minting picks random)</div>
                  <div style={{ border: '1px dashed var(--border2)', borderRadius: 10, padding: 20, textAlign: 'center', color: 'var(--gray2)', fontSize: 12, cursor: 'pointer' }}>
                    {'\u{1F4C1}'} Drop images here or click to upload<br />
                    <span style={{ fontSize: 10, fontFamily: 'var(--font-m)' }}>PNG &middot; SVG &middot; WebP &mdash; random selection at mint</span>
                  </div>
                </div>
              )}
            </div>
            <div>
              <div className="input-wrap">
                <div className="input-label">Staking Required to Vote?</div>
                <ToggleRow defaultOn label={'Yes \u2014 zero stake means zero governance rights'} />
              </div>
              <div className="input-wrap">
                <div className="input-label">Community NFT Re-verification Period</div>
                <select><option>Annual re-verification required</option><option>Never (permanent)</option><option>Custom...</option></select>
              </div>
            </div>
          </div>
          <button className="btn btn-primary">Save Configuration</button>
        </div>
      )}

      {/* ── Tab 3: Community Pool (unchanged — already uses API) ── */}
      {activeTab === 3 && <CommunityPoolTab />}

      {/* ── Tab 4: MIC Founders, Management — 280M MIC, 48h cooldown ── */}
      {activeTab === 4 && (
        <FoundersAllocationSection
          isSuperAdmin={isOwnerWallet(user?.wallet)}
          showToast={showToast}
        />
      )}
    </>
  );
}

/* ── Toggle component ── */
function ToggleRow({ defaultOn = false, label }: { defaultOn?: boolean; label: string }) {
  const [on, setOn] = useState(defaultOn);
  return (
    <div className="toggle-row">
      <div className={`toggle ${on ? 'on' : ''}`} onClick={() => setOn(!on)} />
      <span className="toggle-label">{label}</span>
    </div>
  );
}

/* ── Tab 3: Community Pool (preserved as-is) ── */
function CommunityPoolTab() {
  const [stats, setStats] = useState<any>(null);
  const [entries, setEntries] = useState<any[]>([]);
  const [activity, setActivity] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [filterStatus, setFilterStatus] = useState('All');
  const [filterTier, setFilterTier] = useState('');
  const [search, setSearch] = useState('');
  const [view, setView] = useState<'entries' | 'activity'>('entries');

  const loadData = () => {
    fetchPoolStats().then(setStats).catch(() => {});
    fetchPoolAdminEntries({ status: filterStatus, tier: filterTier, search, page })
      .then((r: any) => { setEntries(r.entries || []); setTotal(r.total || 0); setPages(r.pages || 1); })
      .catch(() => {});
    fetchPoolActivity().then(setActivity).catch(() => {});
  };

  useEffect(() => { loadData(); }, [page, filterStatus, filterTier, search]);

  const tierBreakdown = stats?.tierBreakdown || {};

  return (
    <>
      <div className="sep-lbl">Community NFT Reward Pool &mdash; 5% Daily Emission (MIC)</div>
      <div className="g4" style={{ marginBottom: 20 }}>
        <div className="stat-box">
          <div className="stat-lbl">Total Weight</div>
          <div className="stat-val g">{stats?.totalWeightedShares ? stats.totalWeightedShares.toLocaleString() : '-'}</div>
        </div>
        <div className="stat-box">
          <div className="stat-lbl">Active Entries</div>
          <div className="stat-val p">{stats?.activeEntries || '-'}</div>
        </div>
        <div className="stat-box">
          <div className="stat-lbl">Burned</div>
          <div className="stat-val" style={{ color: 'var(--crimson2)' }}>{stats?.burnedTotal || '-'}</div>
        </div>
        <div className="stat-box">
          <div className="stat-lbl">Total Entries</div>
          <div className="stat-val">{total}</div>
        </div>
      </div>

      <div className="g3" style={{ marginBottom: 20 }}>
        {['builder', 'maker', 'luminary'].map((t) => (
          <div className="stat-box" key={t}>
            <div className="stat-lbl">{t.charAt(0).toUpperCase() + t.slice(1)}</div>
            <div className="stat-val" style={{ color: t === 'builder' ? '#29B6F6' : t === 'maker' ? '#AB47BC' : '#C084D4' }}>
              {tierBreakdown[t]?.count || '-'} <span style={{ fontSize: 10, color: 'var(--gray2)' }}>({tierBreakdown[t]?.weight || '-'} wt)</span>
            </div>
          </div>
        ))}
      </div>

      {/* View toggle */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <button className={`btn btn-sm ${view === 'entries' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setView('entries')}>Pool Entries</button>
        <button className={`btn btn-sm ${view === 'activity' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setView('activity')}>Activity Log</button>
      </div>

      {view === 'entries' && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
            <select value={filterStatus} onChange={(e) => { setFilterStatus(e.target.value); setPage(1); }} style={{ fontSize: 12, padding: '6px 10px', borderRadius: 8, background: 'var(--bg2)', color: 'var(--text1)', border: '1px solid var(--border2)' }}>
              <option value="All">All Status</option>
              <option value="ACTIVE">Active</option>
              <option value="EXPIRED">Expired</option>
              <option value="BURNED">Burned</option>
            </select>
            <select value={filterTier} onChange={(e) => { setFilterTier(e.target.value); setPage(1); }} style={{ fontSize: 12, padding: '6px 10px', borderRadius: 8, background: 'var(--bg2)', color: 'var(--text1)', border: '1px solid var(--border2)' }}>
              <option value="">All Tiers</option>
              <option value="Builder">Builder</option>
              <option value="Maker">Maker</option>
              <option value="Luminary">Luminary</option>
            </select>
            <input
              placeholder="Search wallet or instance..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              style={{ fontSize: 12, padding: '6px 10px', borderRadius: 8, background: 'var(--bg2)', color: 'var(--text1)', border: '1px solid var(--border2)', flex: 1, minWidth: 140 }}
            />
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl">
              <thead><tr>
                <th>Instance</th><th>Wallet</th><th>Tier</th><th>Weight</th><th>Joined</th><th>Expires</th><th>Status</th><th>Claimed</th>
              </tr></thead>
              <tbody>
                {entries.length === 0 ? (
                  <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--gray2)', padding: 20 }}>No entries found</td></tr>
                ) : entries.map((e: any) => (
                  <tr key={e.id}>
                    <td style={{ fontFamily: 'var(--font-m)', fontSize: 11 }}>{e.instanceId}</td>
                    <td style={{ fontFamily: 'var(--font-m)', fontSize: 11 }}>{e.wallet?.slice(0, 6)}...{e.wallet?.slice(-4)}</td>
                    <td><span className={`badge badge-${e.tier?.toLowerCase()}`}>{e.tier}</span></td>
                    <td>{e.weight}</td>
                    <td style={{ fontSize: 11 }}>{new Date(e.joinedAt).toLocaleDateString()}</td>
                    <td style={{ fontSize: 11 }}>{new Date(e.expiresAt).toLocaleDateString()}</td>
                    <td>
                      <span style={{
                        padding: '2px 8px', borderRadius: 6, fontSize: 10, fontWeight: 700, textTransform: 'uppercase' as const,
                        background: e.status === 'ACTIVE' ? 'rgba(76,175,80,.15)' : e.status === 'BURNED' ? 'rgba(244,67,54,.12)' : 'rgba(255,152,0,.12)',
                        color: e.status === 'ACTIVE' ? '#66BB6A' : e.status === 'BURNED' ? '#EF5350' : '#FFA726',
                      }}>{e.status}</span>
                    </td>
                    <td style={{ fontFamily: 'var(--font-m)', fontSize: 11 }}>{Number(e.totalClaimed || 0) > 0 ? Number(e.totalClaimed).toFixed(2) : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {pages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'center', gap: 6, marginTop: 12 }}>
              <button className="btn btn-sm btn-outline" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Prev</button>
              <span style={{ fontSize: 12, color: 'var(--gray2)', lineHeight: '32px' }}>Page {page} / {pages}</span>
              <button className="btn btn-sm btn-outline" disabled={page >= pages} onClick={() => setPage(p => p + 1)}>Next</button>
            </div>
          )}
        </div>
      )}

      {view === 'activity' && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-title">Recent Activity</div>
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl">
              <thead><tr>
                <th>Time</th><th>Action</th><th>Serial</th><th>Wallet</th><th>TX</th>
              </tr></thead>
              <tbody>
                {activity.length === 0 ? (
                  <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--gray2)', padding: 20 }}>No activity yet</td></tr>
                ) : activity.map((a: any, i: number) => (
                  <tr key={i}>
                    <td style={{ fontSize: 11 }}>{new Date(a.time).toLocaleString()}</td>
                    <td>
                      <span style={{
                        padding: '2px 8px', borderRadius: 6, fontSize: 10, fontWeight: 700,
                        background: a.action === 'Joined' ? 'rgba(76,175,80,.15)' : a.action === 'Claimed' ? 'rgba(201,168,76,.15)' : 'rgba(244,67,54,.12)',
                        color: a.action === 'Joined' ? '#66BB6A' : a.action === 'Claimed' ? 'var(--gold)' : '#EF5350',
                      }}>{a.action}</span>
                    </td>
                    <td style={{ fontFamily: 'var(--font-m)', fontSize: 11 }}>{a.serial}</td>
                    <td style={{ fontFamily: 'var(--font-m)', fontSize: 11 }}>{a.wallet?.slice(0, 6)}...{a.wallet?.slice(-4)}</td>
                    <td style={{ fontFamily: 'var(--font-m)', fontSize: 11 }}>
                      {a.tx ? <a href={`https://bscscan.com/tx/${a.tx}`} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--gold)' }}>{a.tx.slice(0, 8)}...</a> : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
