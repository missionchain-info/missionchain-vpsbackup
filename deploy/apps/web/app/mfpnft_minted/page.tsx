'use client'

import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import MfpCard from '@/components/MfpCard'
import { JsonRpcProvider, Contract } from 'ethers'
import { CONTRACTS } from '@/lib/contracts'

// Override body's overflow:hidden so this gallery scrolls naturally
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

interface MintedToken {
  tokenId: number
  imageId: number
  verseId: number
  owner: string
}

const BSC_RPC = 'https://bsc-dataseed.binance.org'
const MFPNFT_VIEW_ABI = [
  'function totalMinted() view returns (uint256)',
  'function tokenByIndex(uint256 index) view returns (uint256)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function pairOf(uint256 tokenId) view returns (uint256, uint256)',
] as const

const PAGE_SIZE = 24

type Mode = 'dark' | 'light'

export default function MfpMintedPage() {
  useEnableBodyScroll()
  const searchParams = useSearchParams()
  const ownerFilterRaw = searchParams?.get('owner') || null
  const ownerFilter = ownerFilterRaw && /^0x[a-fA-F0-9]{40}$/.test(ownerFilterRaw)
    ? ownerFilterRaw.toLowerCase()
    : null

  const [pool, setPool] = useState<Map<number, VerseEntry>>(new Map())
  const [tokens, setTokens] = useState<MintedToken[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  const [compactView, setCompactView] = useState(false)
  const [mode, setMode] = useState<Mode>('dark')

  // ── Load verse pool (image + verse text mapping) ───────────────
  useEffect(() => {
    fetch('/verse-pool.json')
      .then((r) => r.json())
      .then((data) => {
        const m = new Map<number, VerseEntry>()
        ;(data.entries as VerseEntry[]).forEach((e) => m.set(e.id, e))
        setPool(m)
      })
      .catch(() => {})
  }, [])

  // ── Load mode preference ──────────────────────────────────────
  useEffect(() => {
    try {
      const saved = localStorage.getItem('mfp-mode') as Mode | null
      if (saved === 'light' || saved === 'dark') setMode(saved)
    } catch { /* ignore */ }
  }, [])
  useEffect(() => {
    try { localStorage.setItem('mfp-mode', mode) } catch { /* ignore */ }
  }, [mode])

  // ── Load minted tokens from on-chain ──────────────────────────
  useEffect(() => {
    let mounted = true
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const provider = new JsonRpcProvider(BSC_RPC)
        const contract = new Contract(CONTRACTS.mfpNft, MFPNFT_VIEW_ABI, provider)
        const total = Number(await contract.totalMinted().catch(() => 0n))
        if (total === 0) {
          if (mounted) { setTokens([]); setLoading(false) }
          return
        }
        const max = Math.min(total, 500) // safety cap
        const list: MintedToken[] = []
        // Fetch in chunks of 10 parallel to balance speed & RPC limit
        for (let chunk = 0; chunk < max; chunk += 10) {
          const indices = Array.from({ length: Math.min(10, max - chunk) }, (_, k) => chunk + k)
          const batch = await Promise.all(indices.map(async (i) => {
            try {
              const tokenId = Number(await contract.tokenByIndex(BigInt(i)))
              const [owner, pair] = await Promise.all([
                contract.ownerOf(BigInt(tokenId)),
                contract.pairOf(BigInt(tokenId)),
              ])
              return {
                tokenId,
                imageId: Number(pair[0]),
                verseId: Number(pair[1]),
                owner: String(owner),
              }
            } catch {
              return null
            }
          }))
          batch.forEach(t => { if (t) list.push(t) })
          if (!mounted) return
          // Progressive update so user sees tokens loading
          setTokens([...list].sort((a, b) => a.tokenId - b.tokenId))
        }
      } catch (err: any) {
        if (mounted) setError(err?.message || 'Failed to load on-chain data')
      } finally {
        if (mounted) setLoading(false)
      }
    })()
    return () => { mounted = false }
  }, [])

  // Apply owner filter if ?owner=0x... query param present
  const filteredTokens = useMemo(
    () => ownerFilter ? tokens.filter(t => t.owner.toLowerCase() === ownerFilter) : tokens,
    [tokens, ownerFilter]
  )
  const totalPages = Math.max(1, Math.ceil(filteredTokens.length / PAGE_SIZE))
  const visibleTokens = useMemo(
    () => filteredTokens.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE),
    [filteredTokens, page]
  )

  // Reset page if list shrinks
  useEffect(() => {
    if (page >= totalPages) setPage(0)
  }, [page, totalPages])

  // Reset page when filter changes
  useEffect(() => { setPage(0) }, [ownerFilter])

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
        {/* ─── Header ─── */}
        <div style={{ textAlign: 'center', marginBottom: 'clamp(20px, 5vw, 36px)' }}>
          <h1
            style={{
              fontFamily: 'Montserrat, sans-serif',
              fontWeight: 900,
              fontSize: 'clamp(32px, 8vw, 56px)',
              letterSpacing: -1.5,
              margin: 0,
              lineHeight: 1.05,
              display: 'inline-block',
              color: 'transparent',
              backgroundImage: isLight
                ? 'linear-gradient(90deg, #5B2D9E, #6B1428, #9A7B2E)'
                : 'linear-gradient(90deg, #7B2D8B, #6B1428, #C9A84C)',
              WebkitBackgroundClip: 'text',
              backgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
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
              opacity: 0.9,
              marginTop: 6,
              padding: '0 12px',
            }}
          >
            {ownerFilter
              ? `✦ My MFP-NFTs — On-chain (${filteredTokens.length} of ${tokens.length} ${tokens.length === 1 ? 'token' : 'tokens'}) ✦`
              : `✦ MFP-NFT Minted Gallery — On-chain (${tokens.length} ${tokens.length === 1 ? 'token' : 'tokens'}) ✦`}
          </p>

          {/* Owner-filter banner (only when ?owner=0x... is set) */}
          {ownerFilter && (
            <div
              style={{
                marginTop: 'clamp(12px, 3vw, 16px)',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 12,
                padding: '8px 14px',
                background: isLight ? 'rgba(212,160,23,0.10)' : 'rgba(212,160,23,0.12)',
                border: `1px solid ${theme.btnBorder}`,
                borderRadius: 100,
                fontSize: 12,
                color: theme.btnText,
                fontFamily: 'Inter, sans-serif',
                flexWrap: 'wrap',
                justifyContent: 'center',
                maxWidth: 'min(560px, 92vw)',
              }}
            >
              <span style={{ fontWeight: 600 }}>
                Filtered by owner: <code style={{ fontFamily: 'monospace', fontSize: 11 }}>
                  {ownerFilter.slice(0, 8)}…{ownerFilter.slice(-6)}
                </code>
              </span>
              <a
                href="/mfpnft_minted"
                style={{
                  padding: '4px 12px',
                  fontSize: 11,
                  background: theme.btnBgActive,
                  border: `1px solid ${theme.btnBorder}`,
                  color: theme.btnText,
                  borderRadius: 100,
                  textDecoration: 'none',
                  fontWeight: 600,
                }}
              >
                ✕ Clear filter — view all
              </a>
            </div>
          )}

          {/* Controls */}
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
              }}
            >
              <span style={{ fontSize: 14, lineHeight: 1 }}>
                {isLight ? '\u{1F319}' : '\u{2600}\u{FE0F}'}
              </span>
              {isLight ? 'Dark Mode' : 'Light Mode'}
            </button>
          </div>

          {/* Pagination tabs */}
          {totalPages > 1 && (
            <div
              style={{
                marginTop: 'clamp(14px, 3vw, 18px)',
                display: 'inline-flex',
                gap: 0,
                border: `1px solid ${theme.btnBorder}`,
                borderRadius: 6,
                overflow: 'hidden',
                flexWrap: 'wrap',
                maxWidth: '100%',
              }}
            >
              {Array.from({ length: totalPages }).map((_, i) => {
                const start = i * PAGE_SIZE + 1
                const end = Math.min((i + 1) * PAGE_SIZE, filteredTokens.length)
                const active = page === i
                return (
                  <button
                    key={i}
                    onClick={() => setPage(i)}
                    style={{
                      padding: '10px 18px',
                      fontSize: 11,
                      letterSpacing: '0.15em',
                      textTransform: 'uppercase',
                      background: active ? theme.btnBgActive : 'transparent',
                      color: theme.btnText,
                      border: 'none',
                      cursor: 'pointer',
                      fontFamily: 'Inter, sans-serif',
                      fontWeight: active ? 700 : 500,
                    }}
                  >
                    {start}-{end}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* ─── Status ─── */}
        {loading && tokens.length === 0 && (
          <div style={{ textAlign: 'center', padding: 40, color: theme.tagline, fontStyle: 'italic' }}>
            Loading minted MFP-NFTs from on-chain...
          </div>
        )}
        {error && (
          <div style={{ textAlign: 'center', padding: 40, color: '#E53935' }}>
            Error: {error}
          </div>
        )}
        {!loading && tokens.length === 0 && !error && (
          <div style={{ textAlign: 'center', padding: 40, color: theme.subtitle, fontStyle: 'italic' }}>
            No MFP-NFTs minted yet. Be the first to mint via{' '}
            <a href="/seed" style={{ color: theme.tagline, textDecoration: 'underline' }}>
              SEED Sale
            </a>{' '}
            → /nft Mint flow.
          </div>
        )}
        {!loading && tokens.length > 0 && filteredTokens.length === 0 && ownerFilter && (
          <div style={{ textAlign: 'center', padding: 40, color: theme.subtitle, fontStyle: 'italic' }}>
            This wallet has no MFP-NFTs yet.{' '}
            <a href="/mfpnft_minted" style={{ color: theme.tagline, textDecoration: 'underline' }}>
              View all minted tokens →
            </a>
          </div>
        )}

        {/* ─── Cards Grid ─── */}
        {filteredTokens.length > 0 && (
          <div
            style={{
              display: 'grid',
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
                <a
                  key={t.tokenId}
                  href={`https://bscscan.com/token/${CONTRACTS.mfpNft}?a=${t.tokenId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    textDecoration: 'none',
                    color: 'inherit',
                    display: 'block',
                    transition: 'transform 0.2s ease',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-3px)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)' }}
                  title={`Token #${t.tokenId} — Owner ${t.owner.slice(0, 6)}…${t.owner.slice(-4)} — Click to view on BSCScan`}
                >
                  <MfpCard
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
                </a>
              )
            })}
          </div>
        )}

        {/* Pagination footer (mobile-friendly) */}
        {totalPages > 1 && (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12, marginTop: 32 }}>
            <button
              onClick={() => setPage(Math.max(0, page - 1))}
              disabled={page === 0}
              style={{
                padding: '8px 16px',
                background: theme.btnBg,
                border: `1px solid ${theme.btnBorder}`,
                color: theme.btnText,
                borderRadius: 6,
                cursor: page === 0 ? 'not-allowed' : 'pointer',
                opacity: page === 0 ? 0.4 : 1,
                fontFamily: 'Inter, sans-serif',
                fontSize: 12,
              }}
            >
              ← Prev
            </button>
            <span style={{ fontSize: 12, color: theme.subtitle, fontFamily: 'Inter, sans-serif' }}>
              Page {page + 1} of {totalPages}
            </span>
            <button
              onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
              disabled={page === totalPages - 1}
              style={{
                padding: '8px 16px',
                background: theme.btnBg,
                border: `1px solid ${theme.btnBorder}`,
                color: theme.btnText,
                borderRadius: 6,
                cursor: page === totalPages - 1 ? 'not-allowed' : 'pointer',
                opacity: page === totalPages - 1 ? 0.4 : 1,
                fontFamily: 'Inter, sans-serif',
                fontSize: 12,
              }}
            >
              Next →
            </button>
          </div>
        )}

        {/* Footer note */}
        {tokens.length > 0 && (
          <div style={{ textAlign: 'center', marginTop: 28, fontSize: 11, color: theme.subtitle, opacity: 0.7, fontFamily: 'Inter, sans-serif' }}>
            On-chain MFPNFT contract:{' '}
            <a
              href={`https://bscscan.com/address/${CONTRACTS.mfpNft}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: theme.tagline }}
            >
              {CONTRACTS.mfpNft.slice(0, 8)}…{CONTRACTS.mfpNft.slice(-6)} ↗
            </a>
          </div>
        )}
      </div>
    </div>
  )
}
