'use client'

interface Segment {
  label: string
  value: number
  color: string
}

interface PieChartProps {
  segments: Segment[]
  size?: number
  className?: string
}

export default function PieChart({ segments, size = 160, className = '' }: PieChartProps) {
  const total = segments.reduce((sum, s) => sum + s.value, 0)
  if (total === 0) return null

  // Build conic-gradient stops
  let accumulated = 0
  const stops = segments.map((seg) => {
    const start = accumulated
    const pct = (seg.value / total) * 100
    accumulated += pct
    return `${seg.color} ${start}% ${accumulated}%`
  })

  const gradientStr = `conic-gradient(from 0deg, ${stops.join(', ')})`

  return (
    <div className={className}>
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '16px',
      }}>
        {/* Chart circle */}
        <div style={{
          position: 'relative',
          width: `${size}px`,
          height: `${size}px`,
        }}>
          <div style={{
            width: '100%',
            height: '100%',
            borderRadius: '50%',
            background: gradientStr,
          }} />
          {/* Inner hole for donut look */}
          <div style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            width: `${size * 0.55}px`,
            height: `${size * 0.55}px`,
            borderRadius: '50%',
            background: 'var(--bg2)',
          }} />
        </div>

        {/* Legend */}
        <div style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '8px 16px',
          justifyContent: 'center',
        }}>
          {segments.map((seg) => (
            <div
              key={seg.label}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '11px',
              }}
            >
              <div style={{
                width: '10px',
                height: '10px',
                borderRadius: '3px',
                background: seg.color,
                flexShrink: 0,
              }} />
              <span style={{ color: 'var(--gray)' }}>{seg.label}</span>
              <span className="font-mono" style={{ color: 'var(--white)', fontWeight: 600 }}>
                {total > 0 && seg.value > 0 ? `${((seg.value / total) * 100).toFixed(1)}%` : '-'}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
