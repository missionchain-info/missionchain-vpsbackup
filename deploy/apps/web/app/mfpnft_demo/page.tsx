'use client'

import { useEffect, useState } from 'react'
import MfpCard from '@/components/MfpCard'

// Override body's overflow:hidden so this preview page can scroll naturally
// on both desktop and mobile.
function useEnableBodyScroll() {
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'auto'
    document.documentElement.style.overflow = 'auto'
    return () => {
      document.body.style.overflow = prev
      document.documentElement.style.overflow = ''
    }
  }, [])
}

interface VerseEntry {
  id: number
  imageId: number
  title: string
  soulLine: string
  verse: { text: string; ref: string }
}

// Demo: 48 MFP-NFT samples (tokens #1-48, image #1-48, verse #1-48)
const SAMPLE_TOKENS = Array.from({ length: 48 }, (_, i) => ({
  tokenId: i + 1,
  imageId: i + 1,
  verseId: i + 1,
}))

type Mode = 'dark' | 'light'
type TabRange = '1-24' | '25-48'

export default function PreviewMfpPage() {
  useEnableBodyScroll()
  const [pool, setPool] = useState<Map<number, VerseEntry>>(new Map())
  const [compactView, setCompactView] = useState(false)
  const [mode, setMode] = useState<Mode>('dark')
  const [tab, setTab] = useState<TabRange>('1-24')

  const visibleTokens = tab === '1-24'
    ? SAMPLE_TOKENS.slice(0, 24)
    : SAMPLE_TOKENS.slice(24, 48)

  // Load saved mode preference
  useEffect(() => {
    try {
      const saved = localStorage.getItem('mfp-mode') as Mode | null
      if (saved === 'light' || saved === 'dark') setMode(saved)
    } catch { /* localStorage unavailable */ }
  }, [])

  // Persist mode preference
  useEffect(() => {
    try { localStorage.setItem('mfp-mode', mode) } catch { /* ignore */ }
  }, [mode])

  useEffect(() => {
    fetch('/verse-pool.json')
      .then((r) => r.json())
      .then((data) => {
        const m = new Map<number, VerseEntry>()
        ;(data.entries as VerseEntry[]).forEach((e) => m.set(e.id, e))
        setPool(m)
      })
      .catch(console.error)
  }, [])

  const isLight = mode === 'light'
  const theme = {
    bg: isLight
      ? 'radial-gradient(ellipse at top, #FAF6EA 0%, #EFE4CC 70%), #EFE4CC'
      : 'radial-gradient(ellipse at top, #1a0b2e 0%, #050210 70%), #050210',
    tagline: isLight ? '#8A6B17' : '#F5D56E',
    subtitle: isLight ? '#7A5A14' : '#D4A017',
    btnBg: isLight ? 'rgba(212,160,23,0.08)' : 'rgba(212,160,23,0.0)',
    btnBgActive: isLight ? 'rgba(212,160,23,0.25)' : 'rgba(212,160,23,0.2)',
    btnBorder: isLight ? '#A87F12' : '#D4A017',
    btnText: isLight ? '#7A5A14' : '#F5D56E',
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        overflowY: 'auto',
        overflowX: 'hidden',
        WebkitOverflowScrolling: 'touch',
        background: theme.bg,
        color: isLight ? '#3A2A14' : '#E8D8B8',
        transition: 'background 0.4s ease, color 0.4s ease',
      }}
    >
      <div
        style={{
          minHeight: '100%',
          padding: 'clamp(24px, 6vw, 60px) clamp(12px, 4vw, 24px) clamp(40px, 8vw, 80px)',
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: 'clamp(20px, 5vw, 36px)' }}>
          <h1
            style={{
              fontFamily: 'Montserrat, sans-serif',
              fontWeight: 900,
              fontSize: 'clamp(32px, 8vw, 56px)',
              letterSpacing: -1.5,
              margin: 0,
              lineHeight: 1.05,
              background:
                'linear-gradient(90deg, #7B1FA2 0%, #9B1F6A 30%, #B71C5C 50%, #C9526B 70%, #D4A017 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}
          >
            MISSION CHAIN
          </h1>
          <p
            style={{
              fontFamily: 'Crimson Text, serif',
              fontStyle: 'italic',
              fontSize: 'clamp(13px, 3vw, 16px)',
              color: theme.tagline,
              letterSpacing: 1,
              marginTop: 8,
              padding: '0 12px',
              transition: 'color 0.4s ease',
            }}
          >
            &ldquo;Inspired by Faith. Built for People.&rdquo;
          </p>
          <p
            style={{
              fontFamily: 'Crimson Text, serif',
              fontStyle: 'italic',
              fontSize: 'clamp(11px, 2.5vw, 13px)',
              color: theme.subtitle,
              opacity: 0.85,
              marginTop: 6,
              padding: '0 12px',
              transition: 'color 0.4s ease',
            }}
          >
            ✦ MFP-NFT Card Preview · Mission Founding Pass ✦
          </p>

          <div
            style={{
              marginTop: 'clamp(16px, 4vw, 24px)',
              display: 'flex',
              gap: 10,
              justifyContent: 'center',
              flexWrap: 'wrap',
            }}
          >
            <button
              onClick={() => setCompactView(!compactView)}
              style={{
                padding: '10px 22px',
                fontSize: 11,
                letterSpacing: '0.2em',
                textTransform: 'uppercase',
                background: compactView ? theme.btnBgActive : theme.btnBg,
                border: `1px solid ${theme.btnBorder}`,
                color: theme.btnText,
                borderRadius: 4,
                cursor: 'pointer',
                fontFamily: 'Inter, sans-serif',
                transition: 'all 0.3s ease',
              }}
            >
              {compactView ? '✦ Full Cards' : '✦ Compact (Grid)'}
            </button>
            <button
              onClick={() => setMode(isLight ? 'dark' : 'light')}
              aria-label={isLight ? 'Switch to dark mode' : 'Switch to light mode'}
              style={{
                padding: '10px 18px',
                fontSize: 11,
                letterSpacing: '0.2em',
                textTransform: 'uppercase',
                background: theme.btnBg,
                border: `1px solid ${theme.btnBorder}`,
                color: theme.btnText,
                borderRadius: 4,
                cursor: 'pointer',
                fontFamily: 'Inter, sans-serif',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                transition: 'all 0.3s ease',
              }}
            >
              <span style={{ fontSize: 14, lineHeight: 1 }}>
                {isLight ? '\u{1F319}' /* moon */ : '\u{2600}\u{FE0F}' /* sun */}
              </span>
              {isLight ? 'Dark Mode' : 'Light Mode'}
            </button>
          </div>

          {/* Range tabs (24 NFT/tab) */}
          <div
            style={{
              marginTop: 'clamp(14px, 3vw, 18px)',
              display: 'inline-flex',
              gap: 0,
              border: `1px solid ${theme.btnBorder}`,
              borderRadius: 6,
              overflow: 'hidden',
            }}
          >
            {(['1-24', '25-48'] as TabRange[]).map((range) => {
              const active = tab === range
              return (
                <button
                  key={range}
                  onClick={() => setTab(range)}
                  style={{
                    padding: '10px 24px',
                    fontSize: 11,
                    letterSpacing: '0.2em',
                    textTransform: 'uppercase',
                    background: active ? theme.btnBgActive : 'transparent',
                    color: theme.btnText,
                    border: 'none',
                    cursor: 'pointer',
                    fontFamily: 'Inter, sans-serif',
                    fontWeight: active ? 700 : 500,
                    transition: 'all 0.25s ease',
                  }}
                >
                  {range}
                </button>
              )
            })}
          </div>
        </div>

        <div
          style={{
            display: 'grid',
            // min(...) lets cards shrink on narrow phones instead of horizontal-scrolling
            gridTemplateColumns: compactView
              ? 'repeat(auto-fit, minmax(min(220px, 100%), 1fr))'
              : 'repeat(auto-fit, minmax(min(360px, 100%), 1fr))',
            gap: compactView ? 16 : 24,
            maxWidth: 1700,
            margin: '0 auto',
          }}
        >
          {visibleTokens.map((t) => {
            const v = pool.get(t.verseId)
            return (
              <MfpCard
                key={t.tokenId}
                tokenId={t.tokenId}
                imageId={t.imageId}
                verseId={t.verseId}
                title={v?.title}
                soulLine={v?.soulLine}
                verseText={v?.verse.text}
                verseRef={v?.verse.ref}
                thumbnail={compactView}
                compact={compactView}
                year={2026}
              />
            )
          })}
        </div>
      </div>
    </div>
  )
}
