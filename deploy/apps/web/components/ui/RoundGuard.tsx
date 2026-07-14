'use client'

import { useRoundConfig, type RoundStatus } from '@/hooks/useRoundConfig'
import LoadingSpinner from './LoadingSpinner'

interface RoundGuardProps {
  roundId: string
  children: React.ReactNode
}

export default function RoundGuard({ roundId, children }: RoundGuardProps) {
  const { getRoundStatus, loading } = useRoundConfig()
  const status: RoundStatus = loading ? 'UPCOMING' : getRoundStatus(roundId)

  if (loading) return <LoadingSpinner />

  if (status === 'UPCOMING') {
    // Don't redirect — show "Coming Soon" placeholder so users can preview
    // the round design (per Thomas: "dù chức năng này chưa bật, nhưng cần chuẩn bị sẵn")
    return (
      <div className="round-inactive" style={{ position: 'relative' }}>
        <div
          style={{
            background: 'rgba(212,160,23,0.08)',
            border: '1px solid rgba(212,160,23,0.3)',
            borderRadius: 12,
            padding: '14px 18px',
            margin: '0 0 20px',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <div style={{ fontSize: 22 }}>{'✨'}</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
              {roundId} — Coming Soon
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
              Round not yet active. Preview only — actions are disabled.
            </div>
          </div>
        </div>
        {/* pointer-events: none disables clicks/inputs WITHOUT fading the visuals.
            Anh Thomas: layer opacity 0.55 was making text appear "mờ tịt" — removed. */}
        <div style={{ pointerEvents: 'none' }}>{children}</div>
      </div>
    )
  }

  if (status === 'CLOSED') {
    return (
      <div className="round-inactive">
        <div className="pending-title" style={{ color: 'var(--muted)' }}>Round Closed</div>
        {children}
      </div>
    )
  }

  return <>{children}</>
}
