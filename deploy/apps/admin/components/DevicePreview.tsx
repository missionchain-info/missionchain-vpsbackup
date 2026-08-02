'use client'

/**
 * DevicePreview — a floating "responsive preview" switcher for desktop/tablet.
 *
 * Lets a laptop/tablet user preview the app as it renders on Laptop / Tablet /
 * Smartphone. Tablet & Phone modes load the current page inside an iframe sized
 * to that device, so the app's own CSS media queries fire at the real width
 * (a plain max-width container would NOT re-trigger them → wrong preview).
 *
 * Self-contained & additive: renders nothing on real phones (< 768px) and never
 * inside its own preview iframe (?_vp=1), so it can't recurse or affect mobile.
 */
import { useEffect, useState } from 'react'

type Mode = 'laptop' | 'tablet' | 'phone'

const MODES: { key: Mode; label: string; w: number; icon: string }[] = [
  { key: 'laptop', label: 'Laptop',     w: 0,   icon: '\u{1F4BB}' }, // 0 = native/full
  { key: 'tablet', label: 'Tablet',     w: 834, icon: '\u{1F4DF}' },
  { key: 'phone',  label: 'Smartphone', w: 390, icon: '\u{1F4F1}' },
]

export default function DevicePreview() {
  const [mounted, setMounted] = useState(false)
  const [eligible, setEligible] = useState(false)
  const [mode, setMode] = useState<Mode>('laptop')
  const [src, setSrc] = useState('')

  useEffect(() => {
    // Never render inside the preview iframe (prevents nested bars / recursion).
    const params = new URLSearchParams(window.location.search)
    if (params.has('_vp') || window.self !== window.top) return

    const check = () => setEligible(window.innerWidth >= 768) // desktop + tablet only
    check()
    window.addEventListener('resize', check)

    const saved = localStorage.getItem('mc-viewport') as Mode | null
    if (saved === 'tablet' || saved === 'phone' || saved === 'laptop') {
      setMode(saved)
      if (saved !== 'laptop') setSrc(buildSrc())
    }
    setMounted(true)
    return () => window.removeEventListener('resize', check)
  }, [])

  const buildSrc = () => {
    const u = new URL(window.location.href)
    u.searchParams.set('_vp', '1')
    return u.toString()
  }

  const pick = (m: Mode) => {
    setMode(m)
    localStorage.setItem('mc-viewport', m)
    if (m !== 'laptop') setSrc(buildSrc())
  }

  if (!mounted || !eligible) return null
  const active = MODES.find((x) => x.key === mode)!

  return (
    <>
      <div
        role="toolbar"
        aria-label="Display mode"
        style={{
          position: 'fixed', top: 8, left: '50%', transform: 'translateX(-50%)',
          zIndex: 2147483000, display: 'flex', alignItems: 'center', gap: 2,
          padding: 4, borderRadius: 999,
          background: 'rgba(18,18,28,.92)', border: '1px solid rgba(255,255,255,.12)',
          backdropFilter: 'blur(8px)', boxShadow: '0 6px 24px rgba(0,0,0,.35)',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        {MODES.map((m) => {
          const on = mode === m.key
          return (
            <button
              key={m.key}
              type="button"
              onClick={() => pick(m.key)}
              aria-pressed={on}
              title={m.label}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '6px 12px', borderRadius: 999, cursor: 'pointer',
                fontSize: 12.5, fontWeight: 600, lineHeight: 1,
                border: 'none',
                background: on ? 'rgba(255,255,255,.16)' : 'transparent',
                color: on ? '#fff' : 'rgba(255,255,255,.6)',
              }}
            >
              <span style={{ fontSize: 14 }}>{m.icon}</span>
              <span>{m.label}</span>
            </button>
          )
        })}
        {mode !== 'laptop' && (
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,.45)', padding: '0 8px 0 4px' }}>
            {active.w}px
          </span>
        )}
      </div>

      {mode !== 'laptop' && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 2147482000,
            background: '#0a0a12', display: 'flex', justifyContent: 'center',
            alignItems: 'flex-start', overflow: 'auto', padding: '52px 16px 16px',
          }}
        >
          <iframe
            key={active.w}
            src={src}
            title={`Preview — ${active.label}`}
            style={{
              width: active.w, height: '100%', maxWidth: '100%', border: 'none',
              borderRadius: 18, background: '#fff', boxShadow: '0 12px 48px rgba(0,0,0,.55)',
            }}
          />
        </div>
      )}
    </>
  )
}
