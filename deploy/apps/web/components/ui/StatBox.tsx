'use client'

interface StatBoxProps {
  value: string | number
  label: string
  change?: { value: string; positive: boolean }
  className?: string
}

export default function StatBox({ value, label, change, className = '' }: StatBoxProps) {
  return (
    <div className={`stat-box ${className}`}>
      <div className="stat-val">{value}</div>
      <div className="stat-lbl">{label}</div>
      {change && (
        <div className={`stat-change ${change.positive ? 'stat-change-up' : 'stat-change-down'}`}>
          {change.positive ? '+' : ''}{change.value}
        </div>
      )}
    </div>
  )
}
