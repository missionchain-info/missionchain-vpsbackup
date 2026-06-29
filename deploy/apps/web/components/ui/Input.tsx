'use client'

import { InputHTMLAttributes, forwardRef } from 'react'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  hint?: string
  error?: string
  success?: string
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, hint, error, success, className = '', id, ...props }, ref) => {
    const inputId = id || label?.toLowerCase().replace(/\s+/g, '-')

    const inputClasses = [
      'input',
      error ? 'input-error' : '',
      success ? 'input-success' : '',
      className,
    ].filter(Boolean).join(' ')

    return (
      <div className="form-group">
        {label && (
          <label htmlFor={inputId} className="label">
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          className={inputClasses}
          {...props}
        />
        {hint && !error && !success && (
          <p className="form-hint">{hint}</p>
        )}
        {error && <p className="form-error">{error}</p>}
        {success && <p className="form-success">{success}</p>}
      </div>
    )
  }
)

Input.displayName = 'Input'
export default Input
