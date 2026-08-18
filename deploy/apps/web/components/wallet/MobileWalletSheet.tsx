'use client'

import { useConnect } from 'wagmi'
import { openInMetaMask, openInTrust } from '@/lib/wallet'

/**
 * Bottom sheet shown when connecting on a phone / installed PWA where there is no
 * injected wallet. Offers deep-links into the wallet's in-app browser (the reliable
 * path on mobile) plus WalletConnect QR as a fallback.
 */
export default function MobileWalletSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { connect, connectors } = useConnect()
  if (!open) return null

  const wc = connectors.find((c) => c.id === 'walletConnect')

  const overlay: React.CSSProperties = {
    position: 'fixed', inset: 0, zIndex: 9999, display: 'flex',
    alignItems: 'flex-end', justifyContent: 'center',
    background: 'rgba(0,0,0,.55)', backdropFilter: 'blur(2px)',
  }
  const sheet: React.CSSProperties = {
    width: '100%', maxWidth: 440, background: 'var(--bg2, #0E2148)',
    border: '1px solid var(--border, rgba(201,163,76,.25))', borderBottom: 'none',
    borderRadius: '20px 20px 0 0', padding: '20px 18px calc(20px + env(safe-area-inset-bottom))',
    boxShadow: '0 -8px 40px rgba(0,0,0,.5)', animation: 'mwUp .22s ease-out',
  }
  const title: React.CSSProperties = {
    color: 'var(--white, #F5E9CC)', fontWeight: 800, fontSize: 15,
    textAlign: 'center', marginBottom: 4,
  }
  const hint: React.CSSProperties = {
    color: 'var(--gray2, #9FB3C8)', fontSize: 12, textAlign: 'center', margin: '2px 0 16px',
  }
  const opt: React.CSSProperties = {
    width: '100%', display: 'flex', alignItems: 'center', gap: 12,
    padding: '14px 16px', marginBottom: 10, borderRadius: 14, cursor: 'pointer',
    background: 'var(--bg3, #1B273F)', border: '1px solid var(--border, rgba(201,163,76,.25))',
    color: 'var(--white, #F5E9CC)', fontSize: 15, fontWeight: 600, textAlign: 'left',
  }
  const cancel: React.CSSProperties = {
    width: '100%', padding: '12px', marginTop: 4, borderRadius: 12, cursor: 'pointer',
    background: 'transparent', border: '1px solid var(--border, rgba(201,163,76,.25))',
    color: 'var(--gray, #B0C0E0)', fontSize: 14, fontWeight: 600,
  }

  return (
    <div style={overlay} onClick={onClose}>
      <style>{`@keyframes mwUp{from{transform:translateY(100%)}to{transform:translateY(0)}}`}</style>
      <div style={sheet} onClick={(e) => e.stopPropagation()}>
        <div style={title}>Connect a wallet</div>
        <div style={hint}>On phone, open in your wallet's browser — most reliable.</div>

        <button style={opt} onClick={openInMetaMask}>🦊&nbsp; Open in MetaMask</button>
        <button style={opt} onClick={openInTrust}>🛡️&nbsp; Open in Trust Wallet</button>
        {wc && (
          <button style={opt} onClick={() => { connect({ connector: wc }); onClose() }}>
            🔗&nbsp; WalletConnect (scan QR)
          </button>
        )}

        <button style={cancel} onClick={onClose}>Cancel</button>
      </div>
    </div>
  )
}
