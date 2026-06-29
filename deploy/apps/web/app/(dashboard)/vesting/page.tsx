'use client'

import SubNav, { EARN_TABS } from '@/components/layout/SubNav'
import { useApi } from '@/hooks/useApi'
import LoadingSpinner from '@/components/ui/LoadingSpinner'

interface VestingScheduleItem {
  id: string
  source: string
  totalAmount: string
  unlocked: string
  locked: string
  unlockedPct: string
  cliffMonths: number
  initialUnlockPct: number
  monthlyUnlockPct: number
  startTime: string
  nextUnlockDate: string | null
  nextUnlockAmount: string
}

interface VestingSummary {
  data: {
    totalAmount: string
    totalLocked: string
    totalUnlocked: string
    unlockedPct: string
    nextUnlockDate: string | null
    nextUnlockAmount: string
    scheduleCount: number
  }
}

interface VestingSchedules {
  data: VestingScheduleItem[]
}

interface VestingData {
  totalLocked?: string
  nextUnlockDays?: number
  claimable?: string
  unlocked?: string
  lockedPct?: number
  schedules?: Array<{
    round: string
    total: string
    cliff: string
    monthlyRate: string
    unlocked: string
    unlockedPct: number
  }>
}

const STEPS = [
  {
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 12V8H6a2 2 0 0 1-2-2c0-1.1.9-2 2-2h12v4"/><path d="M4 6v12c0 1.1.9 2 2 2h14v-4"/><path d="M18 12a2 2 0 0 0-2 2c0 1.1.9 2 2 2h4v-4h-4z"/></svg>
    ),
    title: 'In Your Wallet',
    desc: 'Tokens visible on MetaMask & BSCScan immediately after purchase',
  },
  {
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
    ),
    title: 'LockManager Tracks',
    desc: 'Smart contract prevents transfers of locked tokens',
  },
  {
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
    ),
    title: 'Auto-Unlock',
    desc: 'No claiming needed — tokens unlock automatically on schedule',
  },
  {
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
    ),
    title: 'Freely Transfer',
    desc: 'Unlocked tokens are fully transferable with no restrictions',
  },
]

export default function VestingPage() {
  const { data: summaryData, loading: loadingSummary } = useApi<VestingSummary>('/vesting/summary')
  const { data: schedulesData, loading: loadingSchedules } = useApi<VestingSchedules>('/vesting/schedules')

  const loading = loadingSummary || loadingSchedules
  if (loading) return <LoadingSpinner />

  const summary = summaryData?.data
  const schedules = schedulesData?.data || []

  // Map real API data to the format used by the UI
  const totalLockedNum = Number(summary?.totalLocked || 0)
  const totalUnlockedNum = Number(summary?.totalUnlocked || 0)
  const totalAmountNum = Number(summary?.totalAmount || 0)
  const unlockedPctNum = Number(summary?.unlockedPct || 0)
  const lockedPct = totalAmountNum > 0 ? (100 - unlockedPctNum) : 100

  const nextUnlockDays = summary?.nextUnlockDate
    ? Math.max(0, Math.ceil((new Date(summary.nextUnlockDate).getTime() - Date.now()) / (86400000)))
    : null

  const d: VestingData = {
    totalLocked: totalLockedNum > 0 ? totalLockedNum.toLocaleString() : '-',
    nextUnlockDays: nextUnlockDays ?? undefined,
    claimable: totalUnlockedNum > 0 ? totalUnlockedNum.toLocaleString() : '-',
    unlocked: totalUnlockedNum > 0 ? totalUnlockedNum.toLocaleString() : '-',
    lockedPct,
    schedules: schedules.map((s) => ({
      round: s.source,
      total: Number(s.totalAmount).toLocaleString(),
      cliff: `${s.cliffMonths} months`,
      monthlyRate: `${s.monthlyUnlockPct}%`,
      unlocked: Number(s.unlocked).toLocaleString(),
      unlockedPct: Number(s.unlockedPct),
    })),
  }

  return (
    <>
    <SubNav items={EARN_TABS} />
    <div className="vest-page">
      {/* ── Lock Overview Hero ── */}
      <div className="vest-hero">
        <div className="vest-hero-bg" />
        <div className="vest-hero-shine" />
        <div className="vest-hero-content">
          <div className="vest-hero-title-row">
            <div className="vest-hero-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
            </div>
            <div>
              <div className="vest-hero-label">Total Locked</div>
              <div className="vest-hero-value">{d.totalLocked || '-'} <span className="vest-hero-unit">MIC</span></div>
            </div>
          </div>
          <div className="vest-hero-stats">
            <div className="vest-hero-stat">
              <div className="vest-hero-stat-icon">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              </div>
              <div>
                <div className="vest-hero-stat-value">{d.nextUnlockDays ?? '-'}<span className="vest-hero-stat-unit"> days</span></div>
                <div className="vest-hero-stat-label">Next Unlock</div>
              </div>
            </div>
            <div className="vest-hero-stat">
              <div className="vest-hero-stat-icon">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
              </div>
              <div>
                <div className="vest-hero-stat-value vest-green">{d.claimable || '-'}</div>
                <div className="vest-hero-stat-label">Available</div>
              </div>
            </div>
            <div className="vest-hero-stat">
              <div className="vest-hero-stat-icon">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--cyan)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
              </div>
              <div>
                <div className="vest-hero-stat-value vest-cyan">{d.unlocked || '-'}</div>
                <div className="vest-hero-stat-label">Unlocked</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Unlock Progress ── */}
      <div className="vest-progress-card">
        <div className="vest-progress-header">
          <span className="vest-progress-title">Unlock Progress</span>
          <span className="vest-progress-pct">{(100 - lockedPct).toFixed(1)}% Unlocked</span>
        </div>
        <div className="vest-progress-bar">
          <div className="vest-progress-fill" style={{ width: `${100 - lockedPct}%` }}>
            <div className="vest-progress-glow" />
          </div>
        </div>
        <div className="vest-progress-labels">
          <span>Locked {lockedPct}%</span>
          <span>Unlocked {(100 - lockedPct).toFixed(1)}%</span>
        </div>
      </div>

      {/* ── How It Works ── */}
      <div className="vest-section-card">
        <div className="vest-section-header">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
          <span className="vest-section-title">Hybrid Token-Level Lock</span>
        </div>
        <div className="vest-steps">
          {STEPS.map((step, i) => (
            <div key={i} className="vest-step">
              <div className="vest-step-left">
                <div className="vest-step-dot">
                  <div className="vest-step-num">{i + 1}</div>
                </div>
                {i < STEPS.length - 1 && <div className="vest-step-line" />}
              </div>
              <div className="vest-step-body">
                <div className="vest-step-icon">{step.icon}</div>
                <div className="vest-step-info">
                  <div className="vest-step-title">{step.title}</div>
                  <div className="vest-step-desc">{step.desc}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Vesting Timeline ── */}
      <div className="vest-section-card">
        <div className="vest-section-header">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/></svg>
          <span className="vest-section-title">Vesting Schedules</span>
        </div>
        {(d.schedules || []).length === 0 ? (
          <div className="vest-empty">
            <div className="vest-empty-icon">
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="var(--gray2)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
            </div>
            <div className="vest-empty-text">No vesting schedules</div>
            <div className="vest-empty-sub">Schedules appear after purchasing SEED or Pre-Sale</div>
          </div>
        ) : (
          <div className="vest-timeline">
            {d.schedules!.map((s, i) => (
              <div key={i} className="vest-timeline-item">
                <div className="vest-timeline-left">
                  <div className="vest-timeline-dot" />
                  {i < d.schedules!.length - 1 && <div className="vest-timeline-line" />}
                </div>
                <div className="vest-timeline-body">
                  <div className="vest-timeline-top">
                    <span className="vest-timeline-round">{s.round}</span>
                    <span className="vest-timeline-total">{s.total} MIC</span>
                  </div>
                  <div className="vest-timeline-meta">
                    <span>Cliff: {s.cliff}</span>
                    <span>Rate: {s.monthlyRate}/mo</span>
                  </div>
                  <div className="vest-timeline-bar-wrap">
                    <div className="vest-timeline-bar">
                      <div className="vest-timeline-bar-fill" style={{ width: `${s.unlockedPct || 0}%` }} />
                    </div>
                    <span className="vest-timeline-bar-label">{s.unlocked || '-'} unlocked</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
    </>
  )
}
