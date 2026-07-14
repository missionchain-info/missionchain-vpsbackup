'use client'

import { useState, useRef, useEffect } from 'react'
import { useAccount, useDisconnect, useConnect } from 'wagmi'
import { Copy, ExternalLink, LogOut, ChevronDown, Check, Wallet } from 'lucide-react'

interface ConnectButtonProps {
  className?: string
}

export default function ConnectButton({ className = '' }: ConnectButtonProps) {
  const { address, isConnected, chain } = useAccount()
  const { disconnect } = useDisconnect()
  const { connect, connectors, isPending } = useConnect()
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleCopy = async () => {
    if (!address) return
    try {
      await navigator.clipboard.writeText(address)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // fallback
    }
  }

  const handleConnect = () => {
    const injected = connectors.find(c => c.id === 'injected') || connectors[0]
    if (injected) {
      connect({ connector: injected })
    }
  }

  if (!isConnected || !address) {
    return (
      <button
        onClick={handleConnect}
        disabled={isPending}
        className={`btn btn-primary ${className}`}
      >
        {isPending ? (
          <span className="spinner spinner-sm" />
        ) : (
          <Wallet size={16} />
        )}
        <span>{isPending ? 'Connecting...' : 'Connect Wallet'}</span>
      </button>
    )
  }

  const truncated = `${address.slice(0, 6)}...${address.slice(-4)}`
  const explorerUrl = chain?.blockExplorers?.default?.url
    ? `${chain.blockExplorers.default.url}/address/${address}`
    : `https://bscscan.com/address/${address}`

  return (
    <div ref={dropdownRef} className={`connect-btn-wrapper ${className}`} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        onClick={() => setOpen(!open)}
        className="connect-btn-trigger"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '8px 12px',
          background: 'var(--bg3)',
          border: '1px solid var(--border)',
          borderRadius: '10px',
          cursor: 'pointer',
          transition: 'all 0.2s',
        }}
      >
        <div style={{
          width: '8px',
          height: '8px',
          borderRadius: '50%',
          background: 'var(--success)',
          flexShrink: 0,
        }} />
        <span className="font-mono" style={{ fontSize: '13px', color: 'var(--white)' }}>
          {truncated}
        </span>
        {chain && (
          <span className="badge badge-purple" style={{ fontSize: '10px', padding: '2px 6px' }}>
            {chain.name === 'BNB Smart Chain Testnet' ? 'BSC Test' : 'BSC'}
          </span>
        )}
        <ChevronDown size={14} style={{
          color: 'var(--gray)',
          transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
          transition: 'transform 0.2s',
        }} />
      </button>

      {open && (
        <div style={{
          position: 'absolute',
          top: 'calc(100% + 6px)',
          right: 0,
          minWidth: '200px',
          background: 'var(--bg2)',
          border: '1px solid var(--border)',
          borderRadius: '10px',
          padding: '4px',
          zIndex: 50,
          boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
        }}>
          <button
            onClick={handleCopy}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              width: '100%',
              padding: '10px 12px',
              background: 'transparent',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
              color: 'var(--gray)',
              fontSize: '13px',
              transition: 'background 0.15s',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg3)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            {copied ? <Check size={14} style={{ color: 'var(--success)' }} /> : <Copy size={14} />}
            <span>{copied ? 'Copied!' : 'Copy Address'}</span>
          </button>

          <a
            href={explorerUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              width: '100%',
              padding: '10px 12px',
              background: 'transparent',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
              color: 'var(--gray)',
              fontSize: '13px',
              textDecoration: 'none',
              transition: 'background 0.15s',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg3)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            <ExternalLink size={14} />
            <span>View on BSCScan</span>
          </a>

          <div style={{
            height: '1px',
            background: 'var(--border)',
            margin: '4px 8px',
          }} />

          <button
            onClick={() => { disconnect(); setOpen(false) }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              width: '100%',
              padding: '10px 12px',
              background: 'transparent',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
              color: 'var(--error)',
              fontSize: '13px',
              transition: 'background 0.15s',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg3)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            <LogOut size={14} />
            <span>Disconnect</span>
          </button>
        </div>
      )}
    </div>
  )
}
