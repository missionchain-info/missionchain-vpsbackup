'use client';

import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  fetchRoundConfigs, updateRoundConfig,
  fetchSeedSummary, updatePromotion,
  fetchMfpArtworks, uploadMfpArtwork, updateMfpArtwork, deleteMfpArtwork,
  fetchStatsOverview,
} from '@/lib/api';
import { useAuth, isOwnerWallet } from '@/lib/auth';
import OldInvestorsSection from '@/components/OldInvestorsSection';
import { useMcUi } from '@/components/ui/McUi';

interface RoundConfig {
  id: string;
  roundType: string;
  status: string;
  displayCap: string | null;
  totalSold: string;
  countdownStart: string | null;
  countdownEnd: string | null;
  micPrice: string | null;
  notes: string | null;
}

interface SeedSummary {
  totalSoldMic: string;
  totalRevenue: string;
  participants: number;
  purchaseCount: number;
  allocationMic: number;
  remainingMic: string;
  distributor: {
    totalCommission: string;
    paidCommission: string;
    pendingCommission: string;
    totalOrders: number;
  };
  netFunds: string;
  mfpMinted: number;
  mfpMaxSupply: number;
  promotion: {
    active: boolean;
    pct: number;
    start: string | null;
    end: string | null;
  } | null;
  status: string;
}

interface MfpArtwork {
  id: string;
  name: string;
  imageData: string;
  active: boolean;
  usedCount: number;
  createdAt: string;
}

const SZ = '0.62rem';
const STATUS_OPTIONS = ['UPCOMING', 'ACTIVE', 'CLOSED'];
const STATUS_COLORS: Record<string, string> = { UPCOMING: '#f0ad4e', ACTIVE: '#5cb85c', CLOSED: '#999' };

const MICE_ROUNDS = [
  { label: 'R1', range: '1 \u2013 20K', price: 100, cap: 20000 },
  { label: 'R2', range: '20K \u2013 40K', price: 200, cap: 20000 },
  { label: 'R3', range: '40K \u2013 60K', price: 300, cap: 20000 },
  { label: 'R4', range: '60K \u2013 80K', price: 400, cap: 20000 },
  { label: 'R5', range: '80K \u2013 100K', price: 500, cap: 20000 },
];

function fmt(n: number): string {
  if (!n || isNaN(n)) return '-';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1_000) return Math.round(n / 1_000) + 'K';
  return Math.round(n).toLocaleString();
}

const fmtFull = (n: number): string => (!n || isNaN(n)) ? '-' : n.toLocaleString();

function fmtUsd(n: number): string {
  if (!n || isNaN(n)) return '-';
  return '$' + Math.round(n).toLocaleString();
}

function fmtUsd2(n: number): string {
  if (!n || isNaN(n)) return '-';
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function pct(a: number, b: number) {
  return b === 0 ? 0 : Math.min((a / b) * 100, 100);
}

function currentMiceRound(sold: number) {
  if (sold < 20000) return 0;
  if (sold < 40000) return 1;
  if (sold < 60000) return 2;
  if (sold < 80000) return 3;
  return 4;
}

export default function RoundsPage() {
  const { user } = useAuth();
  const isSuperAdmin = isOwnerWallet(user?.wallet);
  const mcUi = useMcUi();
  const showToast = (msg: string) => mcUi.toast({ type: 'info', message: msg });
  const [rounds, setRounds] = useState<RoundConfig[]>([]);
  const [loading, setLoading] = useState(true);

  // SEED specific state
  const [seedSummary, setSeedSummary] = useState<SeedSummary | null>(null);
  const [promoData, setPromoData] = useState({ active: false, pct: '', start: '', end: '' });
  const [promoSaving, setPromoSaving] = useState(false);

  // MFP Artwork state
  const [artworks, setArtworks] = useState<MfpArtwork[]>([]);
  const [showArtwork, setShowArtwork] = useState(false);
  const [artworkName, setArtworkName] = useState('');
  const [artworkUploading, setArtworkUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Stats for PreSale & MICE
  const [statsData, setStatsData] = useState<any>(null);

  const loadData = useCallback(async () => {
    try {
      const [roundsRes, seedRes, artRes, overviewRes] = await Promise.all([
        fetchRoundConfigs(),
        fetchSeedSummary().catch(() => null),
        fetchMfpArtworks().catch(() => null),
        fetchStatsOverview().catch(() => null),
      ]);
      setRounds(roundsRes.data || []);
      if (seedRes?.data) {
        setSeedSummary(seedRes.data);
        if (seedRes.data.promotion) {
          setPromoData({
            active: seedRes.data.promotion.active,
            pct: seedRes.data.promotion.pct?.toString() || '',
            start: seedRes.data.promotion.start ? seedRes.data.promotion.start.slice(0, 16) : '',
            end: seedRes.data.promotion.end ? seedRes.data.promotion.end.slice(0, 16) : '',
          });
        }
      }
      if (artRes?.data) setArtworks(artRes.data);
      if (overviewRes?.data) setStatsData(overviewRes.data);
    } catch (err) {
      console.error('Failed to load', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Quick status change
  const quickStatus = async (roundType: string, status: string) => {
    try {
      await updateRoundConfig(roundType, { status });
      await loadData();
    } catch (err: any) {
      mcUi.toast({ type: 'error', message: 'Failed: ' + (err.message || 'Unknown') });
    }
  };

  // ── Promotion save
  const savePromotion = async () => {
    setPromoSaving(true);
    try {
      await updatePromotion('SEED', {
        promotionActive: promoData.active,
        promotionPct: promoData.pct ? Number(promoData.pct) : null,
        promotionStart: promoData.start ? new Date(promoData.start).toISOString() : null,
        promotionEnd: promoData.end ? new Date(promoData.end).toISOString() : null,
      });
      mcUi.toast({ type: 'success', message: 'Promotion saved' });
      await loadData();
    } catch (err: any) {
      mcUi.toast({ type: 'error', message: 'Promotion save failed: ' + (err.message || 'Unknown') });
    } finally {
      setPromoSaving(false);
    }
  };

  // ── Artwork upload
  const handleArtworkUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!artworkName.trim()) {
      mcUi.toast({ type: 'error', message: 'Enter artwork name first' });
      return;
    }

    setArtworkUploading(true);
    try {
      const reader = new FileReader();
      reader.onload = async () => {
        const base64 = reader.result as string;
        await uploadMfpArtwork({ name: artworkName.trim(), imageData: base64 });
        setArtworkName('');
        if (fileInputRef.current) fileInputRef.current.value = '';
        await loadData();
        setArtworkUploading(false);
        mcUi.toast({ type: 'success', message: 'Artwork uploaded' });
      };
      reader.readAsDataURL(file);
    } catch (err: any) {
      mcUi.toast({ type: 'error', message: 'Upload failed: ' + (err.message || 'Unknown') });
      setArtworkUploading(false);
    }
  };

  const toggleArtwork = async (id: string, active: boolean) => {
    await updateMfpArtwork(id, { active: !active });
    await loadData();
  };

  const removeArtwork = async (id: string) => {
    const ok = await mcUi.confirm({
      title: 'Delete Artwork',
      message: 'This will remove the artwork from the active pool. Future MFP-NFT mints will not pick this image. Existing minted NFTs are unaffected.',
      confirmLabel: 'Delete',
      cancelLabel: 'Keep',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await deleteMfpArtwork(id);
      mcUi.toast({ type: 'success', message: 'Artwork deleted' });
      await loadData();
    } catch (err: any) {
      mcUi.toast({ type: 'error', message: err.message || 'Cannot delete' });
    }
  };

  if (loading) {
    return <div style={{ padding: 32, color: 'var(--muted)' }}>Loading round configs...</div>;
  }

  const seedRound = rounds.find(r => r.roundType === 'SEED');
  const presaleRound = rounds.find(r => r.roundType === 'PRESALE');
  const miceRound = rounds.find(r => r.roundType === 'MICE');

  // PreSale data from stats API
  const ps = statsData?.presale || {};
  const mice = statsData?.mice || {};

  return (
    <>
      <div className="page-hd">
        <div>
          <div className="page-eyebrow">Business &amp; Finance</div>
          <div className="page-title">Round Sales</div>
          <div className="page-sub">Manage status, promotion, pricing and artwork for all sale rounds</div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════
           SECTION 1: SEED ROUND
         ═══════════════════════════════════════════════ */}
      <div className="sep-lbl" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: '1rem' }}>🌱</span> SEED Round
        {seedSummary && (
          <span style={{
            marginLeft: 'auto', background: STATUS_COLORS[seedSummary.status] || '#666',
            color: '#fff', padding: '2px 10px', borderRadius: 12, fontSize: SZ, fontWeight: 600,
          }}>{seedSummary.status}</span>
        )}
      </div>

      {/* Quick status buttons */}
      {seedRound && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
          {STATUS_OPTIONS.map(s => (
            <button key={s} onClick={() => quickStatus('SEED', s)}
              style={{
                padding: '4px 12px', borderRadius: 5, cursor: 'pointer',
                fontWeight: 600, fontSize: SZ,
                background: seedSummary?.status === s ? STATUS_COLORS[s] : 'var(--card-bg)',
                color: seedSummary?.status === s ? '#fff' : 'var(--gray)',
                border: `1px solid ${seedSummary?.status === s ? STATUS_COLORS[s] : 'var(--border)'}`,
              }}>
              {s === 'UPCOMING' ? 'Pending' : s === 'ACTIVE' ? 'Enable' : 'Disable'}
            </button>
          ))}
        </div>
      )}

      {seedSummary && (
        <>
          {/* Stats grid */}
          <div className="g3" style={{ marginBottom: 14 }}>
            <div className="stat-box"><div className="stat-lbl">Total Sold</div><div className="stat-val p">{fmt(Number(seedSummary.totalSoldMic))} MIC</div><div className="stat-delta">of 227.5M allocation</div></div>
            <div className="stat-box"><div className="stat-lbl">Revenue</div><div className="stat-val gold">{fmtUsd(Number(seedSummary.totalRevenue))}</div><div className="stat-delta">@ $0.0025/MIC</div></div>
            <div className="stat-box"><div className="stat-lbl">Participants</div><div className="stat-val g">{fmtFull(seedSummary.participants)}</div><div className="stat-delta">{fmtFull(seedSummary.purchaseCount)} purchases</div></div>
          </div>
          <div className="g3" style={{ marginBottom: 14 }}>
            <div className="stat-box"><div className="stat-lbl">Remaining</div><div className="stat-val c">{fmt(Number(seedSummary.remainingMic))} MIC</div></div>
            <div className="stat-box"><div className="stat-lbl">Net Funds</div><div className="stat-val g">{fmtUsd(Number(seedSummary.netFunds))}</div></div>
            <div className="stat-box"><div className="stat-lbl">MFP-NFT Minted</div><div className="stat-val p">{fmtFull(seedSummary.mfpMinted)} / {fmt(seedSummary.mfpMaxSupply)}</div></div>
          </div>
          <div className="g2" style={{ marginBottom: 14 }}>
            <div className="stat-box"><div className="stat-lbl">Dist. Commission</div><div className="stat-val gold">{fmtUsd(Number(seedSummary.distributor.totalCommission))}</div></div>
            <div className="stat-box"><div className="stat-lbl">Pending Claims</div><div className="stat-val" style={{ color: '#d9534f' }}>{fmtUsd(Number(seedSummary.distributor.pendingCommission))}</div></div>
          </div>

          {/* Progress bar */}
          <div className="card" style={{ padding: '12px 16px', marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: SZ, marginBottom: 6 }}>
              <span style={{ fontFamily: 'var(--font-d)', fontWeight: 700 }}>SEED Progress</span>
              <span style={{ fontFamily: 'var(--font-m)', color: 'var(--gray)' }}>{pct(Number(seedSummary.totalSoldMic), seedSummary.allocationMic) > 0 ? pct(Number(seedSummary.totalSoldMic), seedSummary.allocationMic).toFixed(1) + "%" : "-"}</span>
            </div>
            <div className="prog-bar"><div className="prog-fill g" style={{ width: `${pct(Number(seedSummary.totalSoldMic), seedSummary.allocationMic)}%` }} /></div>
          </div>

          {/* Promotion Config */}
          <div className="card" style={{ padding: 14, marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <div className="card-title" style={{ margin: 0 }}>Promotion Config</div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={() => setPromoData({ ...promoData, active: true })}
                  style={{
                    padding: '3px 14px', borderRadius: 5, cursor: 'pointer',
                    fontWeight: 600, fontSize: SZ,
                    background: promoData.active ? '#5cb85c' : 'transparent',
                    color: promoData.active ? '#fff' : 'var(--gray)',
                    border: `1px solid ${promoData.active ? '#5cb85c' : 'var(--border)'}`,
                  }}>Active</button>
                <button onClick={() => setPromoData({ ...promoData, active: false })}
                  style={{
                    padding: '3px 14px', borderRadius: 5, cursor: 'pointer',
                    fontWeight: 600, fontSize: SZ,
                    background: !promoData.active ? '#999' : 'transparent',
                    color: !promoData.active ? '#fff' : 'var(--gray)',
                    border: `1px solid ${!promoData.active ? '#999' : 'var(--border)'}`,
                  }}>Inactive</button>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10, fontSize: SZ }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                Bonus % (max 15)
                <input type="number" min="0" max="15" step="0.5" value={promoData.pct}
                  onChange={(e) => setPromoData({ ...promoData, pct: e.target.value })}
                  style={inputStyle} />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                Start
                <input type="datetime-local" value={promoData.start}
                  onChange={(e) => setPromoData({ ...promoData, start: e.target.value })}
                  style={inputStyle} />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                End
                <input type="datetime-local" value={promoData.end}
                  onChange={(e) => setPromoData({ ...promoData, end: e.target.value })}
                  style={inputStyle} />
              </label>
            </div>
            <button onClick={savePromotion} disabled={promoSaving}
              className="btn btn-outline btn-sm"
              style={{ marginTop: 10, fontSize: SZ }}>
              {promoSaving ? 'Saving...' : 'Save Promotion'}
            </button>
          </div>

          {/* MFP-NFT Artwork block removed per Thomas:
              MFP-ART pipeline now uses static images on VPS (/opt/missionchain/fullstack/MFP-ART/)
              served via api.missionchain.io/static/mfp-art/. No upload UI needed. */}
        </>
      )}

      {/* ═══════════════════════════════════════════════
           SECTION 1B: OLD INVESTORS — 75M Strategic Partner Grant
         ═══════════════════════════════════════════════ */}
      <OldInvestorsSection isSuperAdmin={isSuperAdmin} showToast={showToast} />

      {/* ═══════════════════════════════════════════════
           SECTION 2: PRE-SALE
         ═══════════════════════════════════════════════ */}
      <div className="sep-lbl" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: '1rem' }}>💰</span> Pre-Sale
        {presaleRound && (
          <span style={{
            marginLeft: 'auto', background: STATUS_COLORS[presaleRound.status] || '#666',
            color: '#fff', padding: '2px 10px', borderRadius: 12, fontSize: SZ, fontWeight: 600,
          }}>{presaleRound.status}</span>
        )}
      </div>

      {/* Quick status buttons */}
      {presaleRound && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
          {STATUS_OPTIONS.map(s => (
            <button key={s} onClick={() => quickStatus('PRESALE', s)}
              style={{
                padding: '4px 12px', borderRadius: 5, cursor: 'pointer',
                fontWeight: 600, fontSize: SZ,
                background: presaleRound.status === s ? STATUS_COLORS[s] : 'var(--card-bg)',
                color: presaleRound.status === s ? '#fff' : 'var(--gray)',
                border: `1px solid ${presaleRound.status === s ? STATUS_COLORS[s] : 'var(--border)'}`,
              }}>
              {s === 'UPCOMING' ? 'Pending' : s === 'ACTIVE' ? 'Enable' : 'Disable'}
            </button>
          ))}
        </div>
      )}

      <div className="g3" style={{ marginBottom: 14 }}>
        <div className="stat-box">
          <div className="stat-lbl">USDT Raised</div>
          <div className="stat-val gold">{fmtUsd2(Number(ps.usdtRaised || 0))}</div>
          <div className="stat-delta">Hard cap $1,575,000</div>
        </div>
        <div className="stat-box">
          <div className="stat-lbl">MIC Sold</div>
          <div className="stat-val p">{fmt(Number(ps.micSold || 0))} MIC</div>
          <div className="stat-delta">of 315M allocation</div>
        </div>
        <div className="stat-box">
          <div className="stat-lbl">Buyers</div>
          <div className="stat-val g">{fmtFull(ps.buyers || 0)}</div>
          <div className="stat-delta">{fmtFull(ps.count || 0)} purchases</div>
        </div>
      </div>

      {/* PreSale progress */}
      <div className="card" style={{ padding: '12px 16px', marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: SZ, marginBottom: 6 }}>
          <span style={{ fontFamily: 'var(--font-d)', fontWeight: 700 }}>Pre-Sale Progress</span>
          <span style={{ fontFamily: 'var(--font-m)', color: 'var(--gray)' }}>{pct(Number(ps.usdtRaised || 0), 1_575_000) > 0 ? pct(Number(ps.usdtRaised || 0), 1_575_000).toFixed(1) + "%" : "-"}</span>
        </div>
        <div className="prog-bar"><div className="prog-fill p" style={{ width: `${pct(Number(ps.usdtRaised || 0), 1_575_000)}%` }} /></div>
      </div>

      {/* PreSale packages & referral info */}
      <div className="g2" style={{ marginBottom: 14 }}>
        <div className="card" style={{ padding: 16 }}>
          <div className="card-title">Packages (@ $0.005/MIC)</div>
          <div className="info-row"><span className="info-key">Minimum</span><span className="info-val">$25+ {'\u2192'} 5,000+ MIC</span></div>
          <div className="info-row"><span className="info-key">Builder</span><span className="info-val">$1,000 {'\u2192'} 200K MIC + Builder NFT</span></div>
          <div className="info-row"><span className="info-key">Maker</span><span className="info-val">$2,500 {'\u2192'} 500K MIC + Maker NFT</span></div>
          <div className="info-row"><span className="info-key">Luminary</span><span className="info-val">$5,000 {'\u2192'} 1M MIC + Luminary NFT</span></div>
        </div>
        <div className="card" style={{ padding: 16 }}>
          <div className="card-title">Revenue Split</div>
          <div className="info-row"><span className="info-key">Marketing &amp; Sales</span><span className="info-val">35%</span></div>
          <div className="info-row"><span className="info-key">Management</span><span className="info-val">7.5%</span></div>
          <div className="info-row"><span className="info-key">Net Capital</span><span className="info-val">57.5%</span></div>
          <div style={{ marginTop: 8, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
            <div className="info-row"><span className="info-key">Referral F1</span><span className="info-val">7% USDT</span></div>
            <div className="info-row"><span className="info-key">Referral F2</span><span className="info-val">3% USDT</span></div>
          </div>
        </div>
      </div>

      <div className="g2" style={{ marginBottom: 24 }}>
        <div className="stat-box"><div className="stat-lbl">Marketing Cost</div><div className="stat-val gold">{fmtUsd2(Number(ps.mktCost || 0))}</div><div className="stat-delta">35% of revenue</div></div>
        <div className="stat-box"><div className="stat-lbl">Net Capital</div><div className="stat-val g">{fmtUsd2(Number(ps.fundRaised || 0))}</div><div className="stat-delta">57.5% of revenue</div></div>
      </div>

      {/* ═══════════════════════════════════════════════
           SECTION 3: MICE LICENSE
         ═══════════════════════════════════════════════ */}
      <div className="sep-lbl" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: '1rem' }}>🪪</span> MICE License
        {miceRound && (
          <span style={{
            marginLeft: 'auto', background: STATUS_COLORS[miceRound.status] || '#666',
            color: '#fff', padding: '2px 10px', borderRadius: 12, fontSize: SZ, fontWeight: 600,
          }}>{miceRound.status}</span>
        )}
      </div>

      {/* Quick status buttons */}
      {miceRound && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
          {STATUS_OPTIONS.map(s => (
            <button key={s} onClick={() => quickStatus('MICE', s)}
              style={{
                padding: '4px 12px', borderRadius: 5, cursor: 'pointer',
                fontWeight: 600, fontSize: SZ,
                background: miceRound.status === s ? STATUS_COLORS[s] : 'var(--card-bg)',
                color: miceRound.status === s ? '#fff' : 'var(--gray)',
                border: `1px solid ${miceRound.status === s ? STATUS_COLORS[s] : 'var(--border)'}`,
              }}>
              {s === 'UPCOMING' ? 'Pending' : s === 'ACTIVE' ? 'Enable' : 'Disable'}
            </button>
          ))}
        </div>
      )}

      <div className="g3" style={{ marginBottom: 14 }}>
        <div className="stat-box">
          <div className="stat-lbl">Total Licenses</div>
          <div className="stat-val p">{fmtFull(mice.totalLicenses || 0)}</div>
          <div className="stat-delta">of 100,000 max</div>
        </div>
        <div className="stat-box">
          <div className="stat-lbl">USDT Raised</div>
          <div className="stat-val gold">{fmtUsd2(Number(mice.usdtRaised || 0))}</div>
          <div className="stat-delta">50% USDT portion</div>
        </div>
        <div className="stat-box">
          <div className="stat-lbl">MIC Burned</div>
          <div className="stat-val" style={{ color: '#d9534f' }}>{fmt(Number(mice.micBurned || 0))} MIC</div>
          <div className="stat-delta">50% burned</div>
        </div>
      </div>

      {/* MICE progress */}
      <div className="card" style={{ padding: '12px 16px', marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: SZ, marginBottom: 6 }}>
          <span style={{ fontFamily: 'var(--font-d)', fontWeight: 700 }}>MICE License Progress</span>
          <span style={{ fontFamily: 'var(--font-m)', color: 'var(--gray)' }}>{pct(mice.totalLicenses || 0, 100_000) > 0 ? pct(mice.totalLicenses || 0, 100_000).toFixed(1) + "%" : "-"}</span>
        </div>
        <div className="prog-bar"><div className="prog-fill gold" style={{ width: `${pct(mice.totalLicenses || 0, 100_000)}%` }} /></div>
      </div>

      {/* 5-Round Pricing Chart */}
      <div className="card" style={{ padding: 16, marginBottom: 14 }}>
        <div className="card-title">5-Round Pricing (20,000 licenses per round)</div>
        <div style={{ display: 'flex', gap: 4, alignItems: 'flex-end', height: 120, marginTop: 12 }}>
          {MICE_ROUNDS.map((r, i) => {
            const sold = mice.totalLicenses || 0;
            const curRound = currentMiceRound(sold);
            const roundStart = i * 20000;
            const roundEnd = (i + 1) * 20000;
            const fillPct = i < curRound ? 100 : i === curRound ? pct(Math.max(0, sold - roundStart), 20000) : 0;
            const isActive = i === curRound;

            return (
              <div key={r.label} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                <span style={{ fontSize: '0.58rem', fontFamily: 'var(--font-m)', color: 'var(--gray)' }}>${r.price}</span>
                <div style={{
                  width: '100%', height: 80, background: 'var(--bg3)', borderRadius: 6, position: 'relative', overflow: 'hidden',
                  border: isActive ? '1px solid var(--gold)' : '1px solid var(--border)',
                }}>
                  <div style={{
                    position: 'absolute', bottom: 0, width: '100%',
                    height: `${fillPct}%`,
                    background: i < curRound ? 'var(--green2)' : isActive ? 'var(--gold)' : 'var(--bg4)',
                    borderRadius: '0 0 5px 5px',
                    transition: 'height 0.3s ease',
                  }} />
                </div>
                <span style={{ fontSize: '0.58rem', fontWeight: 600, color: isActive ? 'var(--gold)' : 'var(--gray2)' }}>{r.label}</span>
                <span style={{ fontSize: '0.52rem', color: 'var(--gray2)', fontFamily: 'var(--font-m)' }}>{r.range}</span>
              </div>
            );
          })}
        </div>
        <div style={{ fontSize: '0.58rem', color: 'var(--gray2)', marginTop: 8, textAlign: 'center', fontFamily: 'var(--font-m)' }}>
          Payment: 50% MIC (Burned) + 50% USDT {'\u00B7'} Duration: 360 days {'\u00B7'} ERC-1155 NFT
        </div>
      </div>

      {/* MICE revenue split */}
      <div className="g2" style={{ marginBottom: 14 }}>
        <div className="card" style={{ padding: 16 }}>
          <div className="card-title">USDT Revenue Split (same as PreSale)</div>
          <div className="info-row"><span className="info-key">Marketing &amp; Sales</span><span className="info-val">35%</span></div>
          <div className="info-row"><span className="info-key">Management</span><span className="info-val">7.5%</span></div>
          <div className="info-row"><span className="info-key">DAO Treasury</span><span className="info-val">12.5%</span></div>
          <div className="info-row"><span className="info-key">Reserved Staking</span><span className="info-val">5%</span></div>
          <div className="info-row"><span className="info-key">Liquidity Pool</span><span className="info-val">40%</span></div>
        </div>
        <div className="card" style={{ padding: 16 }}>
          <div className="card-title">MICE Revenue Summary</div>
          <div className="info-row"><span className="info-key">Buyers</span><span className="info-val">{fmtFull(mice.buyers || 0)}</span></div>
          <div className="info-row"><span className="info-key">Marketing Cost</span><span className="info-val">{fmtUsd2(Number(mice.mktCost || 0))}</span></div>
          <div className="info-row"><span className="info-key">Net Capital</span><span className="info-val">{fmtUsd2(Number(mice.fundRaised || 0))}</span></div>
          <div className="info-row"><span className="info-key">Target Revenue</span><span className="info-val">$15,000,000 USDT</span></div>
        </div>
      </div>

      {/* Toast now rendered globally by McUiProvider */}
    </>
  );
}

const inputStyle: React.CSSProperties = {
  padding: '5px 10px', borderRadius: 4, background: 'var(--card-bg)',
  color: 'var(--white)', border: '1px solid var(--border)', fontFamily: 'var(--font-m)', fontSize: SZ,
};
