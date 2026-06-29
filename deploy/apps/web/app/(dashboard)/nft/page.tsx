'use client'

import { useState, useEffect } from 'react'
import { useAccount, useReadContract } from 'wagmi'
import SubNav, { EARN_TABS } from '@/components/layout/SubNav'
import { useApi } from '@/hooks/useApi'
import LoadingSpinner from '@/components/ui/LoadingSpinner'
import MfpMintCard from '@/components/MfpMintCard'
import { CONTRACTS, MFPNFT_ABI, COMMUNITY_NFT_ABI } from '@/lib/contracts'

interface MyNft {
  id: string
  type: string
  tier?: string
  multiplier: string
  expiresIn?: string
  staked?: boolean
  inPool?: boolean
  mintedAt?: string
  daysElapsed?: number
  daysRemaining?: number
  serial?: string
  status?: string
  txid?: string
}

interface NftData {
  totalNfts?: number
  mfpCount?: number
  communityCount?: number
  builderCount?: number
  makerCount?: number
  luminaryCount?: number
  myNfts?: MyNft[]
}

type NftCategory = 'Builder' | 'Maker' | 'Luminary'
type NftTab = 'mfp' | 'community'

const NFT_COLORS: Record<NftCategory, string> = {
  Builder: '#29B6F6', Maker: '#AB47BC', Luminary: '#C084D4',
}

function filterByCategory(nfts: MyNft[], cat: NftCategory): MyNft[] {
  return nfts.filter(n => n.tier === cat)
}

function shortenTx(tx: string) {
  if (!tx || tx.length < 16) return tx || '-'
  return tx.slice(0, 8) + '...' + tx.slice(-6)
}

export default function NftPage() {
  const { address } = useAccount()
  const [tab, setTab] = useState<NftTab>('mfp')
  const { data, loading } = useApi<NftData>('/nft/overview')
  const [popupCategory, setPopupCategory] = useState<NftCategory | null>(null)
  const [poolStats, setPoolStats] = useState<any>(null)

  // ── On-chain reads for MFP-NFT ─────────────────────────────────
  const { data: mfpUserBalance } = useReadContract({
    address: CONTRACTS.mfpNft,
    abi: MFPNFT_ABI,
    functionName: 'balanceOf',
    args: address ? [address as `0x${string}`] : undefined,
    query: { enabled: !!address },
  })
  const mfpUserCount = mfpUserBalance ? Number(mfpUserBalance) : 0

  // ── On-chain reads for Community NFTs (Builder/Maker/Luminary) ──
  // Uses public JsonRpcProvider so it works on mobile browsers without injected wallet.
  const [chainCommunity, setChainCommunity] = useState<{ builder: number; maker: number; luminary: number } | null>(null)
  useEffect(() => {
    if (!address) return
    ;(async () => {
      try {
        const { JsonRpcProvider, Contract } = await import('ethers')
        const rpcUrl = process.env.NEXT_PUBLIC_CHAIN_ID === '56'
          ? 'https://bsc-dataseed1.binance.org/'
          : 'https://bsc-dataseed.binance.org/'
        const provider = new JsonRpcProvider(rpcUrl)
        const cnft = new Contract(CONTRACTS.communityNft, COMMUNITY_NFT_ABI as any, provider)
        const [b, m, l] = await Promise.all([
          cnft.balanceOf(address, 1).catch(() => 0n) as Promise<bigint>,
          cnft.balanceOf(address, 2).catch(() => 0n) as Promise<bigint>,
          cnft.balanceOf(address, 3).catch(() => 0n) as Promise<bigint>,
        ])
        setChainCommunity({ builder: Number(b), maker: Number(m), luminary: Number(l) })
      } catch (err) {
        console.error('[Community NFT on-chain]', err)
      }
    })()
  }, [address])

  useEffect(() => {
    const base = process.env.NEXT_PUBLIC_API_URL || ''
    fetch(`${base}/nft/pool/stats`).then(r => r.ok ? r.json() : null).then(d => { if (d) setPoolStats(d) }).catch(() => {})
  }, [])

  if (loading) return <LoadingSpinner />
  const d = data || {}
  const myNfts = d.myNfts || []
  // Prefer on-chain when available (DB indexer can lag); fall back to API counts.
  const builderCount = Math.max(d.builderCount || 0, chainCommunity?.builder || 0)
  const makerCount = Math.max(d.makerCount || 0, chainCommunity?.maker || 0)
  const luminaryCount = Math.max(d.luminaryCount || 0, chainCommunity?.luminary || 0)
  const communityCount = builderCount + makerCount + luminaryCount

  return (
    <>
    <SubNav items={EARN_TABS} />
    <div className="nft-page">

      {/* ─── 2-Tab Switcher ─── */}
      <div className="nft-page-tabs">
        <button
          className={`nft-page-tab ${tab === 'mfp' ? 'active' : ''}`}
          onClick={() => setTab('mfp')}
        >
          <span className="nft-page-tab-icon">{'\u{1F451}'}</span>
          <span>MFP-NFTs</span>
          <span className="nft-page-tab-badge">{mfpUserCount}</span>
        </button>
        <button
          className={`nft-page-tab ${tab === 'community' ? 'active' : ''}`}
          onClick={() => setTab('community')}
        >
          <span className="nft-page-tab-icon">{'\u{1F465}'}</span>
          <span>Community NFTs</span>
          <span className="nft-page-tab-badge">{communityCount || '-'}</span>
        </button>
      </div>

      {/* ════════════════ TAB 1: MFP-NFTs ════════════════ */}
      {tab === 'mfp' && (
        <>
          {/* Mint card (allowance + mint + reveal + Your Collection grid) */}
          <MfpMintCard />

          {/* MFP-only Reward Pools */}
          <div className="nft-section-card">
            <div className="nft-section-header">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
              <span className="nft-section-title">MFP Reward Pools</span>
            </div>
            <div className="nft-pool-note">Separate from Community pools — only MFP-NFT holders share these revenue streams.</div>

            <div className="nft-mfp-pools-grid">
              {/* Weekly 0.5% */}
              <div className="nft-pool-mini">
                <div className="nft-pool-mini-icon">{'\u{23F0}'}</div>
                <div className="nft-pool-mini-body">
                  <div className="nft-pool-mini-name">Weekly Reward Pool</div>
                  <div className="nft-pool-mini-pct">0.5% of Pre-Sale + MICE revenue</div>
                  <div className="nft-pool-mini-stats">
                    <div><span>This week:</span> <strong>$-</strong></div>
                    <div><span>My share:</span> <strong className="net-stat-gold">$-</strong></div>
                  </div>
                </div>
              </div>
              {/* Monthly 0.5% */}
              <div className="nft-pool-mini">
                <div className="nft-pool-mini-icon">{'\u{1F4C5}'}</div>
                <div className="nft-pool-mini-body">
                  <div className="nft-pool-mini-name">Monthly Reward Pool</div>
                  <div className="nft-pool-mini-pct">0.5% of Pre-Sale + MICE revenue</div>
                  <div className="nft-pool-mini-stats">
                    <div><span>This month:</span> <strong>$-</strong></div>
                    <div><span>My share:</span> <strong className="net-stat-gold">$-</strong></div>
                  </div>
                </div>
              </div>
            </div>

            <div className="nft-pool-detail-rows">
              <div className="nft-pool-detail-row">
                <span className="nft-pool-detail-label">Multiplier</span>
                <span className="nft-pool-detail-value">MFP-NFT × 25 (highest weight in protocol)</span>
              </div>
              <div className="nft-pool-detail-row">
                <span className="nft-pool-detail-label">Eligibility</span>
                <span className="nft-pool-detail-value">Hold ≥ 1 MFP-NFT (lifetime — no expiry)</span>
              </div>
              <div className="nft-pool-detail-row">
                <span className="nft-pool-detail-label">Distribution</span>
                <span className="nft-pool-detail-value">Auto-calculated by system. Claimed via /network → My Earnings.</span>
              </div>
            </div>
          </div>

          {/* MFP Per-NFT Actions hint */}
          <div className="nft-section-card nft-actions-hint">
            <div className="nft-section-header">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
              <span className="nft-section-title">Per-NFT Actions</span>
            </div>
            <div className="nft-pool-note">Each MFP-NFT in your collection (above) supports the following actions. Click any card → action menu.</div>
            <div className="nft-actions-row">
              <div className="nft-action-pill">
                <span>{'\u{1F4E4}'}</span>
                <span><strong>Transfer</strong> — send to another wallet (no fee)</span>
              </div>
              <div className="nft-action-pill">
                <span>{'\u{1F4B0}'}</span>
                <span><strong>Sell on P2P</strong> — list internally (5% royalty enforced)</span>
              </div>
              <div className="nft-action-pill">
                <span>{'\u{1F30A}'}</span>
                <span><strong>Element</strong> — list on element.market (BSC native)</span>
              </div>
              <div className="nft-action-pill">
                <span>{'\u{1F52E}'}</span>
                <span><strong>Magic Eden</strong> — list on magiceden.io (multi-chain)</span>
              </div>
            </div>
            <div className="nft-pool-note" style={{ marginTop: 10, fontStyle: 'italic', fontSize: '0.7rem' }}>
              Tap any MFP-NFT card above → action menu. Transfer + external marketplaces ready. P2P contract shipping next sprint.
            </div>
          </div>
        </>
      )}

      {/* ════════════════ TAB 2: Community NFTs ════════════════ */}
      {tab === 'community' && (
        <>
          {/* Tier counts (clickable → popup) */}
          <div className="nft-my-hero">
            <div className="nft-my-hero-bg" />
            <div className="nft-my-hero-content">
              <div className="nft-hero-title-row">
                <div className="nft-my-hero-icon">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                </div>
                <div>
                  <div className="nft-my-hero-label">My Community NFTs</div>
                  <div className="nft-hero-total">{communityCount || '-'} <span className="nft-hero-total-unit">NFTs</span></div>
                </div>
              </div>
              <div className="nft-portfolio-grid">
                {([
                  { cat: 'Builder' as NftCategory, label: 'Builder', sub: '×1 · 60 days', iconCls: 'builder', count: builderCount,
                    icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#29B6F6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg> },
                  { cat: 'Maker' as NftCategory, label: 'Maker', sub: '×2.5 · 90 days', iconCls: 'maker', count: makerCount,
                    icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#AB47BC" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg> },
                  { cat: 'Luminary' as NftCategory, label: 'Luminary', sub: '×5 · 180 days', iconCls: 'luminary', count: luminaryCount,
                    icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#C084D4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z"/></svg> },
                ]).map(({ cat, label, sub, iconCls, icon, count }) => {
                  const color = NFT_COLORS[cat]
                  return (
                    <div key={cat} className={`nft-pcard nft-pcard-my nft-pcard-${iconCls}`}
                      onClick={() => setPopupCategory(cat)} style={{ cursor: 'pointer' }}>
                      <div className={`nft-pcard-icon nft-pcard-icon-${iconCls}`}>{icon}</div>
                      <div className="nft-pcard-count" style={{ color }}>{count || '-'}</div>
                      <div className="nft-pcard-name">{label}</div>
                      <div className="nft-pcard-sub">{sub}</div>
                      <div className="nft-pcard-tap-hint">Tap to view details</div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>

          {/* Community NFT Reward Pool 5% Daily Emission */}
          <div className="nft-section-card">
            <div className="nft-section-header">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
              <span className="nft-section-title">Community NFT Reward Pool — 5% Daily Emission</span>
            </div>
            <div className="nft-pool-note">5% of MIC daily emission distributed to active Community NFT holders by tier weight (Builder ×1 · Maker ×2.5 · Luminary ×5).</div>
            <div className="nft-mfp-pools-grid">
              <div className="nft-pool-mini">
                <div className="nft-pool-mini-icon">{'\u{2696}\u{FE0F}'}</div>
                <div className="nft-pool-mini-body">
                  <div className="nft-pool-mini-name">Pool Weight</div>
                  <div className="nft-pool-mini-pct">Sum of all active multipliers</div>
                  <div className="nft-pool-mini-stats">
                    <div><span>Total weight:</span> <strong>{poolStats?.totalWeightedShares ? poolStats.totalWeightedShares.toLocaleString() : '-'}</strong></div>
                    <div><span>Active NFTs:</span> <strong>{poolStats?.activeEntries || '-'}</strong></div>
                  </div>
                </div>
              </div>
              <div className="nft-pool-mini">
                <div className="nft-pool-mini-icon">{'\u{1F4B0}'}</div>
                <div className="nft-pool-mini-body">
                  <div className="nft-pool-mini-name">My Pending</div>
                  <div className="nft-pool-mini-pct">Daily MIC accrued (claimable)</div>
                  <div className="nft-pool-mini-stats">
                    <div><span>Pending:</span> <strong className="net-stat-gold">- MIC</strong></div>
                    <div><span>Burned:</span> <strong>{poolStats?.burnedTotal || '-'}</strong></div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Weekly + Monthly Reward Pools — Community-only */}
          <div className="nft-section-card">
            <div className="nft-section-header">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              <span className="nft-section-title">Community Reward Pools</span>
            </div>
            <div className="nft-pool-note">Distributed by tier weight to active Community NFTs only (separate from MFP pools).</div>
            <div className="nft-mfp-pools-grid">
              <div className="nft-pool-mini">
                <div className="nft-pool-mini-icon">{'\u{23F0}'}</div>
                <div className="nft-pool-mini-body">
                  <div className="nft-pool-mini-name">Weekly Reward Pool</div>
                  <div className="nft-pool-mini-pct">0.5% of Pre-Sale + MICE revenue</div>
                  <div className="nft-pool-mini-stats">
                    <div><span>This week:</span> <strong>$-</strong></div>
                    <div><span>My share:</span> <strong className="net-stat-gold">$-</strong></div>
                  </div>
                </div>
              </div>
              <div className="nft-pool-mini">
                <div className="nft-pool-mini-icon">{'\u{1F4C5}'}</div>
                <div className="nft-pool-mini-body">
                  <div className="nft-pool-mini-name">Monthly Reward Pool</div>
                  <div className="nft-pool-mini-pct">0.5% of Pre-Sale + MICE revenue</div>
                  <div className="nft-pool-mini-stats">
                    <div><span>This month:</span> <strong>$-</strong></div>
                    <div><span>My share:</span> <strong className="net-stat-gold">$-</strong></div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Weekly Lucky Draw — Community NFTs only */}
          <div className="nft-section-card">
            <div className="nft-section-header">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 12V8H6a2 2 0 0 1-2-2c0-1.1.9-2 2-2h12v4"/><path d="M4 6v12c0 1.1.9 2 2 2h14v-4"/><path d="M18 12a2 2 0 0 0-2 2c0 1.1.9 2 2 2h4v-4h-4z"/></svg>
              <span className="nft-section-title">Weekly Lucky Draw</span>
            </div>
            <div className="nft-pool-note">1% of Revenue · CAP $5,000/week. Community NFTs active within the week only (MFP-NFT not eligible). Entry by NFT serial numbers.</div>

            <div className="nft-rp-stats-grid">
              <div className="nft-rp-stat-box nft-rp-stat-gold">
                <div className="nft-rp-stat-label">This Week Prize Pool</div>
                <div className="nft-rp-stat-value nft-rp-val-gold">-</div>
              </div>
              <div className="nft-rp-stat-box" style={{ background: 'rgba(123,45,139,.06)', border: '1px solid rgba(123,45,139,.12)' }}>
                <div className="nft-rp-stat-label">Weekly CAP</div>
                <div className="nft-rp-stat-value" style={{ color: 'var(--purple2)' }}>$5,000</div>
              </div>
            </div>

            <div className="nft-lucky-prizes">
              <div className="nft-lucky-row nft-lucky-1st">
                <span className="nft-lucky-icon">{'\u{1F947}'}</span>
                <span className="nft-lucky-label">Prize #1</span>
                <span className="nft-lucky-winners">1 winner</span>
                <span className="nft-lucky-share">30%</span>
                <span className="nft-lucky-example">~$1,500</span>
              </div>
              <div className="nft-lucky-row nft-lucky-2nd">
                <span className="nft-lucky-icon">{'\u{1F948}'}</span>
                <span className="nft-lucky-label">Prize #2</span>
                <span className="nft-lucky-winners">2 winners</span>
                <span className="nft-lucky-share">10% each</span>
                <span className="nft-lucky-example">~$500</span>
              </div>
              <div className="nft-lucky-row nft-lucky-3rd">
                <span className="nft-lucky-icon">{'\u{1F949}'}</span>
                <span className="nft-lucky-label">Prize #3</span>
                <span className="nft-lucky-winners">5 winners</span>
                <span className="nft-lucky-share">5% each</span>
                <span className="nft-lucky-example">~$250</span>
              </div>
              <div className="nft-lucky-row nft-lucky-con">
                <span className="nft-lucky-icon">{'\u{1F381}'}</span>
                <span className="nft-lucky-label">Consolation</span>
                <span className="nft-lucky-winners">10 winners</span>
                <span className="nft-lucky-share">2.5% each</span>
                <span className="nft-lucky-example">~$125</span>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── NFT Detail Popup (shared by both tabs) ── */}
      {popupCategory && (() => {
        const nfts = filterByCategory(myNfts, popupCategory)
        const color = NFT_COLORS[popupCategory]
        return (
          <div className="nft-popup-overlay" onClick={() => setPopupCategory(null)}>
            <div className="nft-popup" onClick={(e) => e.stopPropagation()}>
              <div className="nft-popup-header">
                <h3 className="nft-popup-title" style={{ color }}>{popupCategory} NFTs</h3>
                <span className="nft-popup-count">{nfts.length} total</span>
                <button className="nft-popup-close" onClick={() => setPopupCategory(null)}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </div>
              {nfts.length === 0 ? (
                <div className="nft-popup-empty">No {popupCategory} NFTs owned</div>
              ) : (
                <div className="nft-popup-table-wrap">
                  <table className="nft-popup-table">
                    <thead>
                      <tr>
                        <th>Serial</th>
                        <th>Minted</th>
                        <th>Elapsed</th>
                        <th>Remaining</th>
                        <th>Status</th>
                        <th>Pool</th>
                        <th>TXID</th>
                      </tr>
                    </thead>
                    <tbody>
                      {nfts.map((nft, i) => (
                        <tr key={i} className={nft.status === 'Expired' ? 'nft-row-expired' : ''}>
                          <td className="nft-popup-serial">#{nft.serial || nft.id}</td>
                          <td className="nft-popup-date">{nft.mintedAt ? new Date(nft.mintedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }) : '-'}</td>
                          <td>{nft.daysElapsed != null ? `${nft.daysElapsed}d` : '-'}</td>
                          <td>{nft.daysRemaining != null ? `${nft.daysRemaining}d` : '-'}</td>
                          <td>
                            <span className={`nft-status-badge ${nft.status === 'Active' ? 'nft-status-active' : 'nft-status-expired'}`}>
                              {nft.status || 'Active'}
                            </span>
                          </td>
                          <td>
                            {nft.inPool ? (
                              <span className="nft-pool-badge-in">In Pool</span>
                            ) : nft.status !== 'Expired' ? (
                              <button className="nft-join-pool-btn-sm">Join</button>
                            ) : '-'}
                          </td>
                          <td className="nft-popup-tx">
                            {nft.txid ? (
                              <a href={`https://bscscan.com/tx/${nft.txid}`} target="_blank" rel="noopener noreferrer" title={nft.txid}>
                                {shortenTx(nft.txid)}
                              </a>
                            ) : '-'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )
      })()}
    </div>
    </>
  )
}
