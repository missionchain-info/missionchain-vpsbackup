'use client'

import { ButtonHTMLAttributes, forwardRef } from 'react'

type Variant = 'primary' | 'secondary' | 'outline' | 'danger' | 'ghost'
type Size = 'sm' | 'md' | 'lg'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  isLoading?: boolean
  block?: boolean
}

const variantClass: Record<Variant, string> = {
  primary:   'btn-primary',
  secondary: 'btn-secondary',
  outline:   'btn-outline',
  danger:    'btn-danger',
  ghost:     'btn-ghost',
}

const sizeClass: Record<Size, string> = {
  sm: 'btn-sm',
  md: '',
  lg: 'btn-lg',
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', isLoading, block, children, className = '', disabled, ...props }, ref) => {
    const classes = [
      'btn',
      variantClass[variant],
      sizeClass[size],
      block ? 'btn-block' : '',
      className,
    ].filter(Boolean).join(' ')

    return (
      <button
        ref={ref}
        disabled={disabled || isLoading}
        className={classes}
        {...props}
      >
        {isLoading && (
          <span className="spinner spinner-sm" />
        )}
        {children}
      </button>
    )
  }
)

Button.displayName = 'Button'
export default Button
