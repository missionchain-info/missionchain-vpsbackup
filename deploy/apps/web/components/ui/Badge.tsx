'use client'

type BadgeVariant = 'success' | 'warning' | 'danger' | 'info' | 'purple' | 'gold'

interface BadgeProps {
  children: React.ReactNode
  variant?: BadgeVariant
  className?: string
}

const variantClass: Record<BadgeVariant, string> = {
  success: 'badge-success',
  warning: 'badge-warning',
  danger:  'badge-danger',
  info:    'badge-info',
  purple:  'badge-purple',
  gold:    'badge-gold',
}

export default function Badge({ children, variant = 'info', className = '' }: BadgeProps) {
  return (
    <span className={`badge ${variantClass[variant]} ${className}`}>
      {children}
    </span>
  )
}
