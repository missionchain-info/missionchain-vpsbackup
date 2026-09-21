import type { Connector } from 'wagmi'

/**
 * Pick which injected wallet to connect through.
 *
 * wagmi discovers wallets over EIP-6963 and gives each its own connector, keyed by the
 * wallet's rdns — `io.metamask`, `com.trustwallet.app`, and so on. Alongside those it
 * keeps one generic `injected` connector that talks to the bare `window.ethereum` global.
 *
 * Always prefer a discovered one. When two extensions are installed they both claim that
 * global and the loser inserts an arbiter: with TronLink beside MetaMask, a "Select
 * Extension" dialog appeared every time anything touched it — on 2026-09-21 that meant a
 * popup on every page change. Addressing the wallet's own provider object sidesteps the
 * contested global completely, and the dialog stops.
 *
 * Returns undefined when nothing injected is available, so callers can fall through to
 * WalletConnect.
 */
export function pickInjectedConnector(connectors: readonly Connector[]): Connector | undefined {
  const discovered = connectors.filter((c) => c.type === 'injected' && c.id !== 'injected')
  if (discovered.length > 0) {
    // This dapp is BSC-only. When several wallets announce themselves, prefer an EVM one
    // rather than whichever happened to answer first — TronLink is a Tron wallet and
    // cannot serve a BSC session at all.
    return (
      discovered.find((c) => c.id === 'io.metamask') ??
      discovered.find((c) => /metamask/i.test(c.name)) ??
      discovered[0]
    )
  }
  return connectors.find((c) => c.id === 'injected')
}

// Mobile wallet helpers — reliable connect UX on phones / installed PWA.
// On mobile there is usually no injected provider (no window.ethereum) and the
// WalletConnect deep-link round-trip is unreliable inside an iOS standalone PWA,
// so we let the user open the DApp directly inside their wallet's in-app browser.

export const DAPP_HOST = 'app.missionchain.io'
export const DAPP_URL = 'https://' + DAPP_HOST

export function isMobileDevice(): boolean {
  if (typeof navigator === 'undefined') return false
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
}

export function hasInjectedProvider(): boolean {
  return typeof window !== 'undefined' && !!(window as any).ethereum
}

// Opens MetaMask and loads the DApp inside its in-app browser (provider injected).
export function openInMetaMask() {
  window.location.href = `https://metamask.app.link/dapp/${DAPP_HOST}`
}

// Opens Trust Wallet's in-app browser at the DApp URL.
export function openInTrust() {
  window.location.href = `https://link.trustwallet.com/open_url?url=${encodeURIComponent(DAPP_URL)}`
}

// Detects an in-app / embedded browser (Telegram, Facebook, Instagram, Zalo, Line, etc.).
// These WebViews block Google reCAPTCHA, which breaks Firebase phone (SMS) verification
// with an obscure `auth/error-code:-39`. We use this to warn the user to open the real browser.
export function isInAppBrowser(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent || ''
  const tokens = [
    'FBAN', 'FBAV', 'FB_IAB', 'Instagram', 'Line/', 'MicroMessenger', 'Zalo',
    'Twitter', 'Snapchat', 'TikTok', 'musical_ly', 'KAKAOTALK', 'NAVER', '; wv',
  ]
  if (tokens.some((t) => ua.includes(t))) return true
  // iOS in-app WebViews render WebKit but lack the "Safari" token that real Safari has
  const isIOS = /iPhone|iPad|iPod/i.test(ua)
  if (isIOS && /AppleWebKit/i.test(ua) && !/Safari/i.test(ua) && !/CriOS|FxiOS|EdgiOS/i.test(ua)) return true
  return false
}

// Best-effort escape from an in-app browser into the real system browser.
// Android: an intent:// URL opens Chrome directly. iOS has no reliable escape scheme,
// so we open a new tab and rely on the user's "Open in Safari" affordance + Copy link.
export function openInSystemBrowser() {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
  if (/Android/i.test(ua)) {
    window.location.href = `intent://${DAPP_HOST}#Intent;scheme=https;package=com.android.chrome;end`
    return
  }
  if (typeof window !== 'undefined') window.open(DAPP_URL, '_blank')
}
