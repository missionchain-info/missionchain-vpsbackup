'use client'

interface Milestone {
  position: number // 0-100
  label?: string
}

interface ProgressBarProps {
  value: number // 0-100
  label?: string
  displayValue?: string
  milestones?: Milestone[]
  height?: number
  className?: string
}

export default function ProgressBar({
  value,
  label,
  displayValue,
  milestones,
  height = 8,
  className = '',
}: ProgressBarProps) {
  const clampedValue = Math.min(100, Math.max(0, value))

  return (
    <div className={className}>
      {label && (
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '6px',
        }}>
          <span style={{ fontSize: '12px', color: 'var(--gray)', fontFamily: 'var(--font-body)' }}>
            {label}
          </span>
          {displayValue && (
            <span className="font-mono" style={{ fontSize: '12px', color: 'var(--white)', fontWeight: 600 }}>
              {displayValue}
            </span>
          )}
        </div>
      )}

      <div style={{
        position: 'relative',
        width: '100%',
        height: `${height}px`,
        background: 'var(--bg3)',
        borderRadius: `${height / 2}px`,
        overflow: 'visible',
      }}>
        {/* Fill bar */}
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          height: '100%',
          width: `${clampedValue}%`,
          borderRadius: `${height / 2}px`,
          background: 'linear-gradient(90deg, var(--purple) 0%, var(--gold) 100%)',
          transition: 'width 0.5s ease-out',
        }} />

        {/* Milestones */}
        {milestones?.map((m, i) => (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: `${m.position}%`,
              top: '-3px',
              transform: 'translateX(-50%)',
              width: `${height + 6}px`,
              height: `${height + 6}px`,
              borderRadius: '50%',
              background: clampedValue >= m.position ? 'var(--gold)' : 'var(--bg4)',
              border: '2px solid var(--bg2)',
              zIndex: 2,
            }}
            title={m.label}
          />
        ))}
      </div>

      {/* Milestone labels below */}
      {milestones && milestones.some(m => m.label) && (
        <div style={{ position: 'relative', height: '18px', marginTop: '4px' }}>
          {milestones.map((m, i) =>
            m.label ? (
              <span
                key={i}
                style={{
                  position: 'absolute',
                  left: `${m.position}%`,
                  transform: 'translateX(-50%)',
                  fontSize: '10px',
                  color: 'var(--gray2)',
                  whiteSpace: 'nowrap',
                }}
              >
                {m.label}
              </span>
            ) : null
          )}
        </div>
      )}

      {/* Value below bar (when no label header) */}
      {!label && displayValue && (
        <div style={{
          textAlign: 'center',
          marginTop: '4px',
          fontSize: '12px',
          color: 'var(--gray)',
          fontFamily: 'var(--font-mono)',
        }}>
          {displayValue}
        </div>
      )}
    </div>
  )
}
