'use client'

import { HTMLAttributes, forwardRef } from 'react'

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  title?: string
  subtitle?: string
  hover?: boolean
}

const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ title, subtitle, hover = false, children, className = '', ...props }, ref) => {
    const classes = [
      'card',
      hover ? 'card-hover' : '',
      className,
    ].filter(Boolean).join(' ')

    return (
      <div ref={ref} className={classes} {...props}>
        {title && <div className="card-title">{title}</div>}
        {subtitle && <div className="card-subtitle">{subtitle}</div>}
        {children}
      </div>
    )
  }
)

Card.displayName = 'Card'
export default Card
