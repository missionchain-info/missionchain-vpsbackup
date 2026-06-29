'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { BrowserProvider, Contract, isAddress } from 'ethers'
import { CONTRACTS } from '@/lib/contracts'

interface MfpActionMenuProps {
  open: boolean
  tokenId: number | null
  ownerAddress: string | undefined
  onClose: () => void
  onTransferred?: () => void
}

const MFP_TRANSFER_ABI = [
  'function safeTransferFrom(address from, address to, uint256 tokenId) external',
  'function ownerOf(uint256 tokenId) external view returns (address)',
] as const

type Mode = 'menu' | 'transfer' | 'sending' | 'success' | 'error'

export default function MfpActionMenu({ open, tokenId, ownerAddress, onClose, onTransferred }: MfpActionMenuProps) {
  const router = useRouter()
  const [mode, setMode] = useState<Mode>('menu')
  const [recipient, setRecipient] = useState('')
  const [error, setError] = useState<string>('')
  const [txHash, setTxHash] = useState<string>('')

  // Reset on open/close
  useEffect(() => {
    if (open) {
      setMode('menu')
      setRecipient('')
      setError('')
      setTxHash('')
    }
  }, [open, tokenId])

  if (!open || tokenId == null) return null

  // External marketplaces (Element, Magic Eden) only index BSC MAINNET — not testnet.
  // On testnet we disable the buttons; on mainnet we deep-link to the collection page
  // (per-token URLs are not standardized — collection page lets users find their NFT reliably).
  const isMainnet = process.env.NEXT_PUBLIC_CHAIN_ID === '56'
  const elementUrl = isMainnet
    ? `https://element.market/collections/${CONTRACTS.mfpNft}?chain=bsc`
    : null
  const magicEdenUrl = isMainnet
    ? `https://magiceden.io/collections/bsc/${CONTRACTS.mfpNft}`
    : null

  const handleTransfer = async () => {
    setError('')
    const to = recipient.trim()
    if (!isAddress(to)) {
      setError('Invalid wallet address. Must be 0x... 42 chars.')
      return
    }
    if (to.toLowerCase() === ownerAddress?.toLowerCase()) {
      setError('Cannot transfer to yourself.')
      return
    }
    if (!ownerAddress) {
      setError('Wallet not connected.')
      return
    }

    setMode('sending')
    try {
      const ethereum = (window as any).ethereum
      if (!ethereum) throw new Error('Please install MetaMask or Trust Wallet')
      const chainId = await ethereum.request({ method: 'eth_chainId' })
      if (chainId !== '0x38') throw new Error('Switch to BSC Mainnet (Chain ID 56)')

      const provider = new BrowserProvider(ethereum)
      const signer = await provider.getSigner()
      const mfp = new Contract(CONTRACTS.mfpNft, MFP_TRANSFER_ABI, signer)

      // Verify ownership before transfer (defensive)
      const onchainOwner: string = await mfp.ownerOf(tokenId)
      if (onchainOwner.toLowerCase() !== ownerAddress.toLowerCase()) {
        throw new Error('You are not the owner of this NFT on-chain.')
      }

      const tx = await mfp.safeTransferFrom(ownerAddress, to, tokenId)
      const receipt = await tx.wait(1)
      if (!receipt || receipt.status !== 1) throw new Error('Transaction reverted')

      setTxHash(receipt.hash)
      setMode('success')
      onTransferred?.()
    } catch (err: any) {
      setError(err?.shortMessage || err?.message || 'Transfer failed')
      setMode('error')
    }
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(6px)',
      }}
      onClick={() => mode !== 'sending' && onClose()}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'linear-gradient(145deg, #1a1a2e, #16213e)',
          border: '1px solid rgba(201,168,76,0.3)',
          borderRadius: 20, padding: '28px 26px', maxWidth: 420, width: '90%',
          textAlign: 'center', position: 'relative',
          boxShadow: '0 20px 60px rgba(0,0,0,0.5), 0 0 40px rgba(201,168,76,0.15)',
        }}
      >
        {/* Header */}
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: '0.65rem', color: '#B8A894', letterSpacing: '0.1em', marginBottom: 4 }}>
            MFP-NFT #{String(tokenId).padStart(5, '0')}
          </div>
          <div style={{
            fontSize: '1.2rem', fontWeight: 800, color: '#F5D56E',
            fontFamily: 'var(--font-d)', letterSpacing: '0.03em',
          }}>
            {mode === 'menu' && 'Choose Action'}
            {mode === 'transfer' && 'Transfer NFT'}
            {mode === 'sending' && 'Processing…'}
            {mode === 'success' && 'Transfer Complete'}
            {mode === 'error' && 'Transfer Failed'}
          </div>
        </div>

        {/* MENU */}
        {mode === 'menu' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <ActionButton
              icon={'\u{1F4E4}'}
              title="Transfer"
              desc="Send to another wallet (no fee, no royalty)"
              onClick={() => setMode('transfer')}
            />
            <ActionButton
              icon={'\u{1F4B0}'}
              title="Sell on P2P"
              desc="List internally (5% royalty enforced)"
              onClick={() => router.push(`/p2p?action=sell&tokenId=${tokenId}`)}
            />
            <ActionButton
              icon={'\u{1F30A}'}
              title="List on Element"
              desc={isMainnet
                ? 'BSC-native marketplace, ERC-2981 royalty'
                : 'BSC mainnet only — not available on testnet'}
              external={isMainnet}
              href={elementUrl ?? undefined}
              disabled={!isMainnet}
              badge={!isMainnet ? 'Mainnet only' : undefined}
            />
            <ActionButton
              icon={'\u{1F52E}'}
              title="List on Magic Eden"
              desc={isMainnet
                ? 'Multi-chain marketplace, growing BSC'
                : 'BSC mainnet only — not available on testnet'}
              external={isMainnet}
              href={magicEdenUrl ?? undefined}
              disabled={!isMainnet}
              badge={!isMainnet ? 'Mainnet only' : undefined}
            />

            <button
              onClick={onClose}
              style={{
                marginTop: 8, padding: '10px 0',
                background: 'transparent', color: 'var(--muted)',
                border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8,
                fontSize: '0.74rem', cursor: 'pointer', fontFamily: 'var(--font-d)',
              }}
            >
              Close
            </button>
          </div>
        )}

        {/* TRANSFER FORM */}
        {mode === 'transfer' && (
          <div>
            <div style={{ textAlign: 'left', marginBottom: 16 }}>
              <label style={{
                display: 'block', fontSize: '0.66rem', color: '#D4C098',
                marginBottom: 6, letterSpacing: '0.05em',
              }}>
                RECIPIENT WALLET
              </label>
              <input
                type="text"
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                placeholder="0x..."
                style={{
                  width: '100%', padding: '12px 14px',
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(201,168,76,0.20)', borderRadius: 8,
                  color: '#F5E8CC', fontSize: '0.85rem',
                  fontFamily: 'var(--font-m)', outline: 'none',
                }}
              />
              {error && (
                <div style={{ marginTop: 8, fontSize: '0.7rem', color: '#EF5350' }}>
                  {error}
                </div>
              )}
            </div>

            <div style={{
              padding: '12px 14px', marginBottom: 16,
              background: 'rgba(239,83,80,0.08)',
              border: '1px solid rgba(239,83,80,0.25)', borderRadius: 8,
              fontSize: '0.7rem', color: '#F5E8CC', textAlign: 'left', lineHeight: 1.5,
            }}>
              ⚠ Transfer is <strong>irreversible</strong>. Verify recipient address carefully. DAO voting power transfers immediately.
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => setMode('menu')}
                style={{
                  flex: 1, padding: '12px 0',
                  background: 'transparent', color: '#D4C098',
                  border: '1px solid rgba(201,168,76,0.30)', borderRadius: 10,
                  fontWeight: 700, fontSize: '0.78rem', cursor: 'pointer',
                  fontFamily: 'var(--font-d)',
                }}
              >
                Back
              </button>
              <button
                onClick={handleTransfer}
                disabled={!recipient}
                style={{
                  flex: 2, padding: '12px 0',
                  background: recipient ? 'linear-gradient(135deg, var(--gold), #b8942f)' : 'rgba(201,168,76,0.20)',
                  color: recipient ? '#000' : '#B8A894',
                  border: 'none', borderRadius: 10,
                  fontWeight: 700, fontSize: '0.85rem', cursor: recipient ? 'pointer' : 'not-allowed',
                  fontFamily: 'var(--font-d)', letterSpacing: '0.04em',
                }}
              >
                Confirm Transfer
              </button>
            </div>
          </div>
        )}

        {/* SENDING */}
        {mode === 'sending' && (
          <div style={{ padding: '20px 0' }}>
            <div style={{
              width: 48, height: 48, margin: '0 auto 16px',
              border: '3px solid rgba(245,213,110,0.20)',
              borderTopColor: '#F5D56E', borderRadius: '50%',
              animation: 'spin 1s linear infinite',
            }} />
            <div style={{ fontSize: '0.78rem', color: '#F5E8CC' }}>
              Confirm in your wallet…
            </div>
            <div style={{ fontSize: '0.66rem', color: '#B8A894', marginTop: 6 }}>
              Do not close this dialog
            </div>
            <style jsx>{`
              @keyframes spin { to { transform: rotate(360deg); } }
            `}</style>
          </div>
        )}

        {/* SUCCESS */}
        {mode === 'success' && (
          <div>
            <div style={{
              width: 64, height: 64, margin: '0 auto 12px',
              borderRadius: '50%',
              background: 'rgba(102,187,106,0.15)',
              border: '1px solid rgba(102,187,106,0.40)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 32, color: '#66BB6A',
            }}>
              ✓
            </div>
            <div style={{ fontSize: '0.85rem', color: '#F5E8CC', marginBottom: 14 }}>
              MFP-NFT #{String(tokenId).padStart(5, '0')} sent successfully.
            </div>
            <a
              href={`https://bscscan.com/tx/${txHash}`}
              target="_blank" rel="noopener noreferrer"
              style={{
                display: 'block', padding: '8px 0', marginBottom: 14,
                color: '#F5D56E', fontSize: '0.74rem', textDecoration: 'none',
              }}
            >
              View on BSCScan ↗
              <div style={{ fontSize: '0.66rem', color: '#B8A894', marginTop: 2 }}>
                {txHash.slice(0, 16)}...{txHash.slice(-8)}
              </div>
            </a>
            <button
              onClick={onClose}
              style={{
                width: '100%', padding: '12px 0',
                background: 'linear-gradient(135deg, var(--gold), #b8942f)',
                color: '#000', border: 'none', borderRadius: 10,
                fontWeight: 700, fontSize: '0.85rem', cursor: 'pointer',
                fontFamily: 'var(--font-d)', letterSpacing: '0.04em',
              }}
            >
              Done
            </button>
          </div>
        )}

        {/* ERROR */}
        {mode === 'error' && (
          <div>
            <div style={{
              width: 64, height: 64, margin: '0 auto 12px',
              borderRadius: '50%',
              background: 'rgba(239,83,80,0.15)',
              border: '1px solid rgba(239,83,80,0.40)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 32, color: '#EF5350',
            }}>
              ⚠
            </div>
            <div style={{
              fontSize: '0.78rem', color: '#F5E8CC', marginBottom: 16,
              padding: '0 8px', lineHeight: 1.5,
            }}>
              {error}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => setMode('transfer')}
                style={{
                  flex: 1, padding: '12px 0',
                  background: 'transparent', color: '#F5D56E',
                  border: '1px solid rgba(201,168,76,0.30)', borderRadius: 10,
                  fontWeight: 700, fontSize: '0.78rem', cursor: 'pointer',
                  fontFamily: 'var(--font-d)',
                }}
              >
                Try Again
              </button>
              <button
                onClick={onClose}
                style={{
                  flex: 1, padding: '12px 0',
                  background: 'rgba(239,83,80,0.15)', color: '#EF5350',
                  border: '1px solid rgba(239,83,80,0.30)', borderRadius: 10,
                  fontWeight: 700, fontSize: '0.78rem', cursor: 'pointer',
                  fontFamily: 'var(--font-d)',
                }}
              >
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

interface ActionButtonProps {
  icon: string
  title: string
  desc: string
  onClick?: () => void
  href?: string
  external?: boolean
  disabled?: boolean
  badge?: string
}

function ActionButton({ icon, title, desc, onClick, href, external, disabled, badge }: ActionButtonProps) {
  const content = (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px',
        background: disabled ? 'rgba(255,255,255,0.02)' : 'rgba(201,168,76,0.06)',
        border: `1px solid ${disabled ? 'rgba(255,255,255,0.08)' : 'rgba(201,168,76,0.20)'}`,
        borderRadius: 10,
        cursor: disabled ? 'not-allowed' : 'pointer',
        textAlign: 'left',
        opacity: disabled ? 0.55 : 1,
        transition: 'background 0.2s',
        textDecoration: 'none',
        color: 'inherit',
      }}
      onMouseEnter={(e) => {
        if (!disabled) e.currentTarget.style.background = 'rgba(201,168,76,0.12)'
      }}
      onMouseLeave={(e) => {
        if (!disabled) e.currentTarget.style.background = 'rgba(201,168,76,0.06)'
      }}
    >
      <div style={{
        fontSize: 22, width: 36, height: 36,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(255,255,255,0.04)', borderRadius: 8,
        flexShrink: 0,
      }}>
        {icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#F5D56E' }}>
            {title}
          </div>
          {badge && (
            <span style={{
              fontSize: '0.55rem', padding: '2px 6px',
              background: 'rgba(255,255,255,0.08)', color: '#B8A894',
              borderRadius: 4, letterSpacing: '0.05em', textTransform: 'uppercase',
            }}>
              {badge}
            </span>
          )}
          {external && (
            <span style={{ fontSize: '0.7rem', color: '#B8A894' }}>↗</span>
          )}
        </div>
        <div style={{ fontSize: '0.68rem', color: '#B8A894', marginTop: 2, lineHeight: 1.4 }}>
          {desc}
        </div>
      </div>
    </div>
  )

  if (href) {
    return (
      <a
        href={disabled ? undefined : href}
        target={external ? '_blank' : undefined}
        rel={external ? 'noopener noreferrer' : undefined}
        onClick={disabled ? (e) => e.preventDefault() : undefined}
      >
        {content}
      </a>
    )
  }
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      style={{ background: 'none', border: 'none', padding: 0, width: '100%' }}
    >
      {content}
    </button>
  )
}
