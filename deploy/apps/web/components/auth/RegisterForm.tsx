'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useSearchParams } from 'next/navigation'
import Input from '@/components/ui/Input'
import Button from '@/components/ui/Button'
import { authApi } from '@/lib/api'

interface RegisterFormProps {
  onRegister: (userId: string, referrer?: string) => Promise<void>
  isLoading: boolean
}

export default function RegisterForm({ onRegister, isLoading }: RegisterFormProps) {
  const searchParams = useSearchParams()
  const refFromUrl = searchParams.get('ref') || ''

  const [introducer, setIntroducer] = useState(refFromUrl)
  const [introducerLocked, setIntroducerLocked] = useState(!!refFromUrl)
  const [introducerStatus, setIntroducerStatus] = useState<'idle' | 'checking' | 'valid' | 'invalid'>('idle')
  const [introducerName, setIntroducerName] = useState('')

  const [username, setUsername] = useState('')
  const [usernameStatus, setUsernameStatus] = useState<'idle' | 'checking' | 'available' | 'taken' | 'invalid'>('idle')

  const [termsAccepted, setTermsAccepted] = useState(false)
  const [error, setError] = useState('')

  const debounceRef = useRef<NodeJS.Timeout | null>(null)

  // Validate introducer from URL on mount
  useEffect(() => {
    if (refFromUrl) {
      checkIntroducer(refFromUrl)
    }
  }, [refFromUrl])

  const checkIntroducer = useCallback(async (ref: string) => {
    if (!ref) {
      setIntroducerStatus('idle')
      return
    }
    setIntroducerStatus('checking')
    try {
      const { valid, name } = await authApi.checkReferrer(ref)
      setIntroducerStatus(valid ? 'valid' : 'invalid')
      if (name) setIntroducerName(name)
    } catch {
      setIntroducerStatus('invalid')
    }
  }, [])

  const handleIntroducerChange = useCallback(
    (val: string) => {
      if (introducerLocked) return
      setIntroducer(val)
      if (debounceRef.current) clearTimeout(debounceRef.current)
      if (val.length >= 5) {
        debounceRef.current = setTimeout(() => checkIntroducer(val), 500)
      } else {
        setIntroducerStatus('idle')
      }
    },
    [introducerLocked, checkIntroducer]
  )

  const handleUsernameChange = useCallback((val: string) => {
    const clean = val.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20)
    setUsername(clean)
    setUsernameStatus('idle')

    if (debounceRef.current) clearTimeout(debounceRef.current)

    if (clean.length < 5) {
      if (clean.length > 0) setUsernameStatus('invalid')
      return
    }

    setUsernameStatus('checking')
    debounceRef.current = setTimeout(async () => {
      try {
        const { available } = await authApi.checkUserId(clean)
        setUsernameStatus(available ? 'available' : 'taken')
      } catch {
        setUsernameStatus('idle')
      }
    }, 500)
  }, [])

  const canSubmit =
    username.length >= 5 &&
    usernameStatus === 'available' &&
    termsAccepted &&
    !isLoading &&
    (introducer === '' || introducerStatus === 'valid')

  const handleSubmit = async () => {
    if (!canSubmit) return
    setError('')
    try {
      await onRegister(username, introducer || undefined)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Registration failed')
    }
  }

  return (
    <div className="w-full" style={{ textAlign: 'left' }}>
      <h2 style={{ fontFamily: 'var(--font-d)', fontWeight: 800, color: 'var(--white)', fontSize: '1.2rem', marginBottom: '8px' }}>
        Become a Member
      </h2>
      <p style={{ fontSize: '0.85rem', color: 'var(--gray)', marginBottom: '24px', lineHeight: 1.6 }}>
        Create your Mission Chain identity. Your username is permanent and cannot be changed.
      </p>

      <div className="space-y-5">
        {/* Username */}
        <Input
          label="Username"
          placeholder="Choose a unique username (min 5 characters)"
          value={username}
          onChange={(e) => handleUsernameChange(e.target.value)}
          hint="5-20 characters, lowercase letters, numbers, underscore only"
          success={usernameStatus === 'available' ? 'Username is available!' : undefined}
          error={
            usernameStatus === 'taken'
              ? 'Username is already taken'
              : usernameStatus === 'invalid'
                ? 'Minimum 5 characters required'
                : undefined
          }
        />

        {/* Introducer */}
        <Input
          label="Introducer"
          placeholder="Enter your Introducer's username"
          value={introducer}
          onChange={(e) => handleIntroducerChange(e.target.value)}
          disabled={introducerLocked}
          hint={introducerLocked ? 'Auto-filled from referral link' : 'Enter the username of the person who introduced you'}
          success={introducerStatus === 'valid' ? `Valid introducer${introducerName ? `: ${introducerName}` : ''}` : undefined}
          error={introducerStatus === 'invalid' ? 'Introducer not found — please check the username' : undefined}
        />

        {/* Terms & Conditions */}
        <label style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={termsAccepted}
            onChange={(e) => setTermsAccepted(e.target.checked)}
            style={{
              marginTop: '2px',
              width: '20px',
              height: '20px',
              minWidth: '20px',
              borderRadius: '4px',
              cursor: 'pointer',
              accentColor: 'var(--gold)',
            }}
          />
          <span style={{ fontSize: '0.8rem', color: 'var(--gray)', lineHeight: 1.6 }}>
            I have read and agree to the{' '}
            <a href="/documents" target="_blank" style={{ color: 'var(--gold)', textDecoration: 'underline' }}>
              Terms of Use
            </a>
            {', '}
            <a href="/documents" target="_blank" style={{ color: 'var(--gold)', textDecoration: 'underline' }}>
              Disclaimer & Privacy Policy
            </a>
          </span>
        </label>

        {/* Error message */}
        {error && (
          <div style={{
            fontSize: '0.85rem',
            color: 'var(--error)',
            background: 'rgba(224, 85, 85, 0.1)',
            border: '1px solid rgba(224, 85, 85, 0.2)',
            borderRadius: 'var(--radius)',
            padding: '12px',
          }}>
            {error}
          </div>
        )}

        {/* Register Button */}
        <Button
          variant="primary"
          size="lg"
          onClick={handleSubmit}
          disabled={!canSubmit}
          isLoading={isLoading}
          className="btn-block"
        >
          Register
        </Button>
      </div>
    </div>
  )
}
