'use client'

import { useState, useCallback, useEffect } from 'react'
import SubNav, { EARN_TABS } from '@/components/layout/SubNav'
import { useApi } from '@/hooks/useApi'
import { api } from '@/lib/api'
import { useAccount } from 'wagmi'
import LoadingSpinner from '@/components/ui/LoadingSpinner'

// ─── My Community tree types ────────────────────────────────────────
interface TreeMember {
  userId: string
  wallet: string
  createdAt: string
  gvRank: string
  childCount: number
  pv: string
  gv: string
}

interface ChildrenResp {
  wallet: string
  children: TreeMember[]
}

function shortWallet(w: string) {
  return w ? w.slice(0, 6) + '...' + w.slice(-4) : '-'
}

function formatDate(iso: string) {
  try {
    const d = new Date(iso)
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: '2-digit' })
  } catch {
    return '-'
  }
}

function fmtUsdShort(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return '-'
  const n = typeof v === 'string' ? parseFloat(v) : v
  if (!isFinite(n) || n === 0) return '-'
  return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 })
}

const RANK_META: Record<string, { icon: string; color: string }> = {
  Believer: { icon: '🌱', color: 'var(--muted)' },
  Builder: { icon: '🔨', color: '#4CAF50' },
  Connector: { icon: '⚡', color: '#29B6F6' },
  Champion: { icon: '💎', color: '#AB47BC' },
  Ambassador: { icon: '👑', color: 'var(--gold)' },
  Legend: { icon: '🏆', color: '#FFD700' },
}

// Recursive tree node — lazy loads its own children on expand
function TreeNode({ member, depth }: { member: TreeMember; depth: number }) {
  const [expanded, setExpanded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [children, setChildren] = useState<TreeMember[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const toggle = useCallback(async () => {
    if (member.childCount === 0) return
    if (expanded) { setExpanded(false); return }
    setExpanded(true)
    if (children === null) {
      setLoading(true)
      setError(null)
      try {
        const res = await api<ChildrenResp>(`/network/children?wallet=${encodeURIComponent(member.wallet)}`)
        setChildren(res.children)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Load failed')
      } finally {
        setLoading(false)
      }
    }
  }, [expanded, children, member.wallet, member.childCount])

  const rank = RANK_META[member.gvRank] ?? RANK_META.Believer
  const hasChildren = member.childCount > 0
  const indent = Math.min(depth, 8) * 14

  return (
    <div className="net-tree-branch">
      <div className="net-tree-node" style={{ paddingLeft: indent + 10 }}>
        <span className="net-tree-userid">{member.userId}</span>
        <span className="net-tree-wallet">{shortWallet(member.wallet)}</span>
        <span className="net-tree-date">{formatDate(member.createdAt)}</span>
        <span className="net-tree-pv">{fmtUsdShort(member.pv)}</span>
        <span className="net-tree-gv">{fmtUsdShort(member.gv)}</span>
        <span className="net-tree-rank-label" style={{ color: rank.color }}>
          <span className="net-tree-rank-icon">{rank.icon}</span>{member.gvRank}
        </span>
        <span
          className={`net-tree-f1 ${hasChildren ? 'clickable' : 'empty'}`}
          onClick={hasChildren ? toggle : undefined}
          role={hasChildren ? 'button' : undefined}
          tabIndex={hasChildren ? 0 : undefined}
          aria-expanded={hasChildren ? expanded : undefined}
          onKeyDown={(e) => { if (hasChildren && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggle() } }}
        >
          {hasChildren ? (
            <>
              <span className="net-tree-caret">{expanded ? '▼' : '▶'}</span>
              {member.childCount}
            </>
          ) : '-'}
        </span>
      </div>
      {expanded && (
        <div className="net-tree-children">
          {loading && <div className="net-tree-empty" style={{ paddingLeft: indent + 30 }}>Loading…</div>}
          {error && <div className="net-tree-empty net-tree-error" style={{ paddingLeft: indent + 30 }}>{error}</div>}
          {!loading && !error && children && children.length === 0 && (
            <div className="net-tree-empty" style={{ paddingLeft: indent + 30 }}>No members yet</div>
          )}
          {!loading && !error && children && children.map((c) => (
            <TreeNode key={c.wallet} member={c} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  )
}

// Root: fetches F1 of the auth user on mount
function MyCommunityTree() {
  const [loading, setLoading] = useState(true)
  const [members, setMembers] = useState<TreeMember[]>([])
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await api<ChildrenResp>('/network/children')
      setMembers(res.children)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Load failed')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  return (
    <div className="net-tree-container">
      {loading && <div className="net-tree-empty">Loading community…</div>}
      {error && <div className="net-tree-empty net-tree-error">{error} <button className="net-tree-retry" onClick={load}>Retry</button></div>}
      {!loading && !error && members.length === 0 && (
        <div className="net-tree-empty">
          No F1 members yet. Share your referral link to start building your community.
        </div>
      )}
      {!loading && !error && members.map((m) => (
        <TreeNode key={m.wallet} member={m} depth={0} />
      ))}
    </div>
  )
}

interface NetworkData {
  rank?: string
  gv?: number
  nextRank?: string
  nextThreshold?: number
  needed?: number
  pctProgress?: number
  teamStats?: {
    f1Members?: number
    f1Volume?: string
    f2Members?: number
    f2Volume?: string
    groupVolume?: string
    totalTeam?: number
  }
  income?: {
    f1?: string
    f2?: string
    gv?: string
    total?: string
  }
  // Team Bonus rate (admin-configurable, defaults to 9% if API not yet exposing it)
  teamBonusRate?: number
  // My Earnings — all reward streams unified into Total / Claimed / Unclaimed
  earnings?: {
    total?: string | number
    claimed?: string | number
    unclaimed?: string | number
    referralClaimed?: string | number
    referralUnclaimed?: string | number
    teamBonusClaimed?: string | number
    teamBonusUnclaimed?: string | number
    monthlyClaimed?: string | number
    monthlyUnclaimed?: string | number
    luckyClaimed?: string | number
    luckyUnclaimed?: string | number
  }
}

const GV_TIERS = [
  { rank: 'Believer', threshold: '$0 - $4,999', rate: '0%', icon: '🌱', color: 'var(--muted)' },
  { rank: 'Builder', threshold: '$5K - $20K', rate: '3%', icon: '🔨', color: '#4CAF50' },
  { rank: 'Connector', threshold: '$20K - $50K', rate: '5%', icon: '⚡', color: '#29B6F6' },
  { rank: 'Champion', threshold: '$50K - $150K', rate: '7%', icon: '💎', color: '#AB47BC' },
  { rank: 'Ambassador', threshold: '$150K - $500K', rate: '8%', icon: '👑', color: 'var(--gold)' },
  { rank: 'Legend', threshold: '$500K+', rate: '9%', icon: '🏆', color: '#FFD700' },
]

export default function NetworkPage() {
  const { data, loading } = useApi<NetworkData>('/network/overview')
  const { address } = useAccount()
  if (loading) return <LoadingSpinner />
  const d = data || {}

  const currentRank = d.rank || 'Believer'
  const currentIdx = GV_TIERS.findIndex(t => t.rank === currentRank)
  const pct = d.pctProgress || 0

  return (
    <>
    <SubNav items={EARN_TABS} />
    <div className="net-page">
      {/* ── Rank Hero Card ── */}
      <div className="net-rank-card">
        <div className="net-rank-bg" />
        <div className="net-rank-shine" />
        <div className="net-rank-content">
          <div className="net-rank-top">
            <div className="net-rank-badge">
              <span className="net-rank-emoji">{GV_TIERS[currentIdx]?.icon || '🌱'}</span>
            </div>
            <div className="net-rank-info">
              <div className="net-rank-label">Your Rank</div>
              <div className="net-rank-name">{currentRank}</div>
            </div>
            <div className="net-rank-gv">
              <div className="net-rank-label">Team Volume</div>
              <div className="net-rank-gv-value">{d.gv ? `$${d.gv.toLocaleString()}` : '-'}</div>
            </div>
          </div>
          <div className="net-progress-section">
            <div className="net-progress-bar">
              <div className="net-progress-fill" style={{ width: `${Math.min(pct, 100)}%` }}>
                <div className="net-progress-glow" />
              </div>
            </div>
            <div className="net-progress-labels">
              <span>{currentRank}</span>
              <span className="net-progress-next">
                {d.nextRank ? (
                  <>{d.nextRank} &mdash; <strong>${d.needed ? d.needed.toLocaleString() : '-'}</strong> needed</>
                ) : 'Max Rank'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Quick Stats Row ── */}
      <div className="net-stats-row">
        <div className="net-stat-chip">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
          <div className="net-stat-chip-info">
            <span className="net-stat-chip-value">{d.teamStats?.f1Members || '-'}</span>
            <span className="net-stat-chip-label">F1</span>
          </div>
        </div>
        <div className="net-stat-chip">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--purple2)" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
          <div className="net-stat-chip-info">
            <span className="net-stat-chip-value">{d.teamStats?.f2Members || '-'}</span>
            <span className="net-stat-chip-label">F2</span>
          </div>
        </div>
        <div className="net-stat-chip">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--cyan)" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
          <div className="net-stat-chip-info">
            <span className="net-stat-chip-value">{d.teamStats?.totalTeam || '-'}</span>
            <span className="net-stat-chip-label">Team</span>
          </div>
        </div>
        <div className="net-stat-chip net-stat-chip-highlight">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
          <div className="net-stat-chip-info">
            <span className="net-stat-chip-value net-stat-gold">{Number(d.income?.total) ? d.income?.total : '-'}</span>
            <span className="net-stat-chip-label">Earned</span>
          </div>
        </div>
      </div>

      {/* ── My Earnings — Total / Earned / Unclaimed + Claim ── */}
      <div className="net-section-card net-earnings-card">
        <div className="net-section-header">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
          <span className="net-section-title">My Earnings</span>
        </div>
        <div className="net-earnings-stats">
          <div className="net-earnings-stat">
            <div className="net-earnings-stat-label">Total</div>
            <div className="net-earnings-stat-value">${Number(d.earnings?.total || 0).toLocaleString()}</div>
          </div>
          <div className="net-earnings-stat">
            <div className="net-earnings-stat-label">Earned (Claimed)</div>
            <div className="net-earnings-stat-value net-stat-claimed">${Number(d.earnings?.claimed || 0).toLocaleString()}</div>
          </div>
          <div className="net-earnings-stat">
            <div className="net-earnings-stat-label">Unclaimed</div>
            <div className="net-earnings-stat-value net-stat-gold">${Number(d.earnings?.unclaimed || 0).toLocaleString()}</div>
          </div>
          <div className="net-earnings-stat net-earnings-action">
            <button
              className="net-claim-btn"
              disabled={!Number(d.earnings?.unclaimed || 0)}
              onClick={() => alert('Claim flow — to be wired to /network/claim API')}
            >
              Claim
            </button>
          </div>
        </div>

        <div className="net-earnings-breakdown">
          <div className="net-earnings-row net-earnings-header">
            <span>Source</span>
            <span>Earned</span>
            <span>Unclaimed</span>
          </div>
          <div className="net-earnings-row">
            <span className="net-earnings-source"><span className="net-dot gold" />Referral Commission</span>
            <span className="net-earnings-claimed">${Number(d.earnings?.referralClaimed || 0).toLocaleString()} <span className="net-earnings-unit">USDT</span></span>
            <span className="net-earnings-unclaimed">${Number(d.earnings?.referralUnclaimed || 0).toLocaleString()} <span className="net-earnings-unit">USDT</span></span>
          </div>
          <div className="net-earnings-row">
            <span className="net-earnings-source"><span className="net-dot purple" />Team Bonus</span>
            <span className="net-earnings-claimed">${Number(d.earnings?.teamBonusClaimed || 0).toLocaleString()} <span className="net-earnings-unit">USDT</span></span>
            <span className="net-earnings-unclaimed">${Number(d.earnings?.teamBonusUnclaimed || 0).toLocaleString()} <span className="net-earnings-unit">USDT</span></span>
          </div>
          <div className="net-earnings-row">
            <span className="net-earnings-source"><span className="net-dot cyan" />Monthly Reward Pool</span>
            <span className="net-earnings-claimed">${Number(d.earnings?.monthlyClaimed || 0).toLocaleString()} <span className="net-earnings-unit">USDT</span></span>
            <span className="net-earnings-unclaimed">${Number(d.earnings?.monthlyUnclaimed || 0).toLocaleString()} <span className="net-earnings-unit">USDT</span></span>
          </div>
          <div className="net-earnings-row">
            <span className="net-earnings-source"><span className="net-dot copper" />Weekly Lucky Draw</span>
            <span className="net-earnings-claimed">${Number(d.earnings?.luckyClaimed || 0).toLocaleString()} <span className="net-earnings-unit">USDT</span></span>
            <span className="net-earnings-unclaimed">${Number(d.earnings?.luckyUnclaimed || 0).toLocaleString()} <span className="net-earnings-unit">USDT</span></span>
          </div>
        </div>
      </div>

      {/* ── Volume & Income Cards ── */}
      <div className="net-duo-row">
        <div className="net-volume-card">
          <div className="net-section-header">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--cyan)" strokeWidth="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
            <span className="net-section-title">Volume</span>
          </div>
          <div className="net-income-breakdown">
            <div className="net-inc-row">
              <span className="net-inc-dot gold" />
              <span className="net-inc-label">F1 Volume</span>
              <span className="net-inc-val">{Number(d.teamStats?.f1Volume) ? d.teamStats?.f1Volume : '-'}</span>
            </div>
            <div className="net-inc-row">
              <span className="net-inc-dot purple" />
              <span className="net-inc-label">F2 Volume</span>
              <span className="net-inc-val">{Number(d.teamStats?.f2Volume) ? d.teamStats?.f2Volume : '-'}</span>
            </div>
            <div className="net-inc-row">
              <span className="net-inc-dot cyan" />
              <span className="net-inc-label">Team Volume</span>
              <span className="net-inc-val">{Number(d.teamStats?.groupVolume) ? d.teamStats?.groupVolume : '-'}</span>
            </div>
          </div>
        </div>

        <div className="net-income-card">
          <div className="net-section-header">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
            <span className="net-section-title">Income</span>
          </div>
          <div className="net-income-breakdown">
            <div className="net-inc-row">
              <span className="net-inc-dot gold" />
              <span className="net-inc-label">F1 (7%)</span>
              <span className="net-inc-val">{Number(d.income?.f1) ? d.income?.f1 : '-'}</span>
            </div>
            <div className="net-inc-row">
              <span className="net-inc-dot purple" />
              <span className="net-inc-label">F2 (3%)</span>
              <span className="net-inc-val">{Number(d.income?.f2) ? d.income?.f2 : '-'}</span>
            </div>
            <div className="net-inc-row">
              <span className="net-inc-dot cyan" />
              <span className="net-inc-label">Team Bonus</span>
              <span className="net-inc-val">{Number(d.income?.gv) ? d.income?.gv : '-'}</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Referral Commission ── */}
      <div className="net-section-card">
        <div className="net-section-header">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>
          <span className="net-section-title">Referral Commission — 10%</span>
        </div>
        <div className="net-info-note">Pre-Sale &amp; MICE only (USDT revenue portion only, NOT Seed). Paid instantly on-chain in USDT.</div>
        <div className="net-reward-table">
          <div className="net-reward-row net-reward-header">
            <span>Level</span><span>Rate</span><span>Payment</span>
          </div>
          <div className="net-reward-row">
            <span className="net-reward-label"><span className="net-dot gold" />F1 — Direct Referral</span>
            <span className="net-reward-rate net-gold">7%</span>
            <span className="net-reward-tag">USDT</span>
          </div>
          <div className="net-reward-row">
            <span className="net-reward-label"><span className="net-dot purple" />F2 — Second Level</span>
            <span className="net-reward-rate net-purple">3%</span>
            <span className="net-reward-tag">USDT</span>
          </div>
        </div>
      </div>

      {/* ── Team Bonus — 9% (rate-dynamic, admin-configurable) ── */}
      <div className="net-section-card">
        <div className="net-section-header">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
          <span className="net-section-title">Team Bonus — {d.teamBonusRate || 9}%</span>
        </div>
        <div className="net-info-note">{d.teamBonusRate || 9}% of revenue. Calculated on entire team volume (all generations). Override: earn only the difference between your rate and each direct downline&apos;s rate.</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginTop: 12 }}>
          {GV_TIERS.map((t) => {
            const isActive = t.rank === currentRank
            const nftBonus = t.rank === 'Believer' ? null : t.rank === 'Builder' ? '3× Builder' : t.rank === 'Connector' ? '3× Maker' : t.rank === 'Champion' ? '3× Luminary' : t.rank === 'Ambassador' ? '5× Luminary' : '10× Luminary'
            return (
              <div key={t.rank} style={{
                background: isActive ? 'rgba(201,168,76,.1)' : 'rgba(123,45,139,.06)',
                border: `1px solid ${isActive ? 'rgba(201,168,76,.35)' : 'rgba(123,45,139,.12)'}`,
                borderRadius: 10, padding: '12px 10px', position: 'relative', overflow: 'hidden',
              }}>
                {isActive && <div style={{ position: 'absolute', top: 0, right: 0, background: 'var(--gold)', color: '#0C0812', fontSize: '0.5rem', fontWeight: 700, padding: '2px 8px', borderRadius: '0 0 0 8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>You</div>}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                  <span style={{ fontSize: '1.1rem' }}>{t.icon}</span>
                  <span style={{ fontSize: '0.75rem', fontWeight: 700, color: t.color }}>{t.rank}</span>
                </div>
                <div style={{ fontSize: '1rem', fontWeight: 800, fontFamily: 'var(--font-d)', color: t.color, marginBottom: 4 }}>{t.rate}</div>
                <div style={{ fontSize: '0.6rem', color: 'var(--muted)', marginBottom: 6 }}>{t.threshold}</div>
                {nftBonus ? (
                  <div style={{ fontSize: '0.58rem', color: 'var(--cream)', background: 'rgba(201,168,76,.1)', border: '1px solid rgba(201,168,76,.15)', borderRadius: 4, padding: '3px 6px', display: 'inline-block' }}>
                    {nftBonus}
                  </div>
                ) : (
                  <div style={{ fontSize: '0.58rem', color: 'var(--muted)', opacity: 0.5 }}>No NFT bonus</div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Incentives — 2.5% ── */}
      <div className="net-section-card">
        <div className="net-section-header">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
          <span className="net-section-title">Incentives Pool — 1.5%</span>
        </div>
        <div className="net-info-note">1.5% of Pre-Sale + MICE USDT revenue. DAO-governed fund for community campaigns, special bonuses, and growth incentives.</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 12 }}>
          <div style={{ background: 'rgba(201,168,76,.08)', border: '1px solid rgba(201,168,76,.15)', borderRadius: 8, padding: '10px 12px' }}>
            <div style={{ fontSize: '0.6rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>Total Distributed</div>
            <div style={{ fontSize: '0.85rem', fontWeight: 700, fontFamily: 'var(--font-d)', color: 'var(--gold)' }}>-</div>
          </div>
          <div style={{ background: 'rgba(0,188,212,.06)', border: '1px solid rgba(0,188,212,.15)', borderRadius: 8, padding: '10px 12px' }}>
            <div style={{ fontSize: '0.6rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>Available Balance</div>
            <div style={{ fontSize: '0.85rem', fontWeight: 700, fontFamily: 'var(--font-d)', color: 'var(--cyan)' }}>-</div>
          </div>
        </div>
      </div>

      {/* ── My Community (recursive tree of F1 → F2 → ...) — moved up ── */}
      <div className="net-community-card">
        <div className="net-section-header">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
          <span className="net-section-title">My Community</span>
        </div>
        <div className="net-tree-head">
          <span className="net-tree-head-userid">Member</span>
          <span className="net-tree-head-wallet">Wallet</span>
          <span className="net-tree-head-date">Joined</span>
          <span className="net-tree-head-pv">PV</span>
          <span className="net-tree-head-gv">Team</span>
          <span className="net-tree-head-rank-label">Rank</span>
          <span className="net-tree-head-f1">F1</span>
        </div>
        <MyCommunityTree />
      </div>

      {/* ── Pointer to NFT Manager for other reward streams ── */}
      <div className="net-section-card net-nft-pointer">
        <div className="net-info-note" style={{ margin: 0, textAlign: 'center', fontStyle: 'italic' }}>
          For details on <strong>Weekly Growth Reward</strong>, <strong>Monthly Reward Pool</strong>, and <strong>Weekly Lucky Draw</strong> distributions → see <a href="/nft" style={{ color: 'var(--gold)', textDecoration: 'none', fontWeight: 700 }}>NFT Manager →</a>
        </div>
      </div>

      {/* ── Referral Link — moved to bottom ── */}
      <div className="net-referral-card">
        <div className="net-referral-shine" />
        <div className="net-section-header">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
          <span className="net-section-title">Your Referral Link</span>
        </div>
        <div className="net-ref-link-box">
          <code className="net-ref-url">
            {(() => {
              const uid = typeof window !== 'undefined' ? localStorage.getItem('mc-userId') : null
              const o = typeof window !== 'undefined' ? window.location.origin : 'https://missionchain.io'
              return uid ? `${o}?ref=${uid}` : 'Connect wallet to generate'
            })()}
          </code>
          <button className="net-ref-copy-btn" onClick={() => {
            const uid = localStorage.getItem('mc-userId')
            if (uid) navigator.clipboard.writeText(`${window.location.origin}?ref=${uid}`)
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          </button>
        </div>
      </div>
    </div>
    </>
  )
}
