'use client'

import { useEffect, useMemo, useState } from 'react'
import { useAccount, useReadContract } from 'wagmi'
import { CONTRACTS, MFPNFT_ABI } from '@/lib/contracts'
import { api } from '@/lib/api'
import MfpCard from './MfpCard'
import MfpActionMenu from './MfpActionMenu'

// MAINNET-ONLY as of Phase 0 Genesis 2026-05-06
const BSC_MAINNET_RPC = 'https://bsc-dataseed.binance.org/'
const BSC_MAINNET_HEX = '0x38'

// Detect any injected wallet (MetaMask, Bitget, Trust, EIP-6963, etc.)
async function findInjectedProvider(): Promise<any> {
  if (typeof window === 'undefined') throw new Error('Not in browser')
  const w = window as any
  if (w.ethereum) return w.ethereum
  return new Promise((resolve, reject) => {
    let found: any = null
    const handler = (e: any) => { if (e.detail?.provider && !found) found = e.detail.provider }
    window.addEventListener('eip6963:announceProvider', handler)
    window.dispatchEvent(new Event('eip6963:requestProvider'))
    setTimeout(() => {
      window.removeEventListener('eip6963:announceProvider', handler)
      if (found) resolve(found)
      else reject(new Error('No wallet detected'))
    }, 600)
  })
}

// Switch wallet to BSC Mainnet (auto-add if missing)
async function ensureBscChain(provider: any, _isMainnet: boolean = true) {
  const current = await provider.request({ method: 'eth_chainId' })
  if (current === BSC_MAINNET_HEX) return
  try {
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: BSC_MAINNET_HEX }] })
  } catch (e: any) {
    if (e.code === 4902) {
      await provider.request({
        method: 'wallet_addEthereumChain',
        params: [{
          chainId: BSC_MAINNET_HEX, chainName: 'BNB Smart Chain',
          nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 },
          rpcUrls: [BSC_MAINNET_RPC], blockExplorerUrls: ['https://bscscan.com'],
        }],
      })
    } else { throw e }
  }
}

interface MintRecord {
  tokenId: number
  imageId: number
  verseId: number
  mintedAt: string
  txHash: string
}

interface VerseEntry {
  id: number
  imageId: number
  title: string
  soulLine: string
  verse: { text: string; ref: string }
}

let _versePool: VerseEntry[] | null = null
async function getVersePool(): Promise<VerseEntry[]> {
  if (_versePool) return _versePool
  // Bundled JSON would be ideal; fall back to fetch from public path
  const res = await fetch('/verse-pool.json').catch(() => null)
  if (res?.ok) {
    const data = await res.json()
    _versePool = data.entries
    return data.entries
  }
  _versePool = []
  return []
}

export default function MfpMintCard() {
  const { address } = useAccount()
  const [quantity, setQuantity] = useState(1)
  const [history, setHistory] = useState<MintRecord[]>([])
  // Per-NFT action menu state
  const [actionTokenId, setActionTokenId] = useState<number | null>(null)
  const [versePool, setVersePool] = useState<VerseEntry[]>([])
  const [revealOpen, setRevealOpen] = useState(false)
  const [revealedTokens, setRevealedTokens] = useState<MintRecord[]>([])
  const [busy, setBusy] = useState(false)
  const [mintError, setMintError] = useState<string | null>(null)

  // ─── Read on-chain allowance ─────────────────────────────────────
  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: CONTRACTS.mfpNft as `0x${string}`,
    abi: MFPNFT_ABI,
    functionName: 'mintAllowance',
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  })

  const { data: minted, refetch: refetchMinted } = useReadContract({
    address: CONTRACTS.mfpNft as `0x${string}`,
    abi: MFPNFT_ABI,
    functionName: 'mintedCount',
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  })

  const granted = allowance ? Number(allowance) : 0
  const mintedCount = minted ? Number(minted) : 0
  const remaining = Math.max(0, granted - mintedCount)

  // ─── Mint flow — direct ethers BrowserProvider (bypass wagmi for mobile compat) ─
  // Bitget Wallet's wagmi injected adapter can hang silently. We sign + poll
  // via ethers ourselves which works reliably across MetaMask/Bitget/Trust/etc.
  const [isPending, setIsPending] = useState(false)
  const [phase, setPhase] = useState<'idle' | 'wallet' | 'mining'>('idle')

  const handleMint = async () => {
    if (!address || quantity < 1 || quantity > remaining) return
    if (busy) return
    setMintError(null)
    setBusy(true)
    setPhase('wallet')
    setIsPending(true)

    let timeoutId: ReturnType<typeof setTimeout> | null = null
    try {
      const { BrowserProvider, JsonRpcProvider, Contract } = await import('ethers')
      const isMainnet = process.env.NEXT_PUBLIC_CHAIN_ID === '56'

      // 1) Find wallet provider + ensure BSC chain
      const injected = await findInjectedProvider()
      await injected.request({ method: 'eth_requestAccounts' })
      await ensureBscChain(injected, isMainnet)

      // 2) Send tx via wallet (resolves once user signs OR rejects)
      const browser = new BrowserProvider(injected)
      const signer = await browser.getSigner()
      const mfp = new Contract(CONTRACTS.mfpNft, MFPNFT_ABI as any, signer)

      // 120s wallet-response watchdog: if Bitget hangs without confirming/rejecting
      const walletTimeout = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('Wallet did not respond in 120s — please check the wallet app')), 120_000)
      })
      const tx: any = await Promise.race([mfp.mint(BigInt(quantity)), walletTimeout])
      if (timeoutId) { clearTimeout(timeoutId); timeoutId = null }

      setIsPending(false)
      setPhase('mining')

      // 3) Poll receipt via public RPC (more reliable than wallet's RPC)
      const rpcUrl = BSC_MAINNET_RPC // mainnet-only
      const publicProv = new JsonRpcProvider(rpcUrl)
      const receipt = await publicProv.waitForTransaction(tx.hash, 1, 90_000)
      if (!receipt || receipt.status !== 1) throw new Error('Transaction reverted on-chain')

      // 4) Read freshly-minted tokens directly on-chain
      const mfpRead = new Contract(CONTRACTS.mfpNft, MFPNFT_ABI as any, publicProv)
      const balance: bigint = await mfpRead.balanceOf(address)
      const records: MintRecord[] = []
      for (let i = 0n; i < balance; i++) {
        const tokenId = await mfpRead.tokenOfOwnerByIndex(address, i)
        const pair = await mfpRead.pairOf(tokenId)
        records.push({
          tokenId: Number(tokenId),
          imageId: Number(pair[0]),
          verseId: Number(pair[1]),
          mintedAt: new Date().toISOString(),
          txHash: '',
        })
      }
      records.sort((a, b) => a.tokenId - b.tokenId)

      const newOnes = records.slice(history.length)
      setHistory(records)
      setRevealedTokens(newOnes)
      setRevealOpen(true)
      await Promise.all([refetchAllowance(), refetchMinted()])
    } catch (e: any) {
      const code = e?.code
      const msg = e?.shortMessage || e?.message || 'Mint failed'
      const isReject = code === 4001 || code === 'ACTION_REJECTED' || /reject|denied|user/i.test(msg)
      setMintError(isReject ? 'Transaction cancelled' : msg)
      console.error('[mint]', e)
    } finally {
      if (timeoutId) clearTimeout(timeoutId)
      setBusy(false)
      setIsPending(false)
      setPhase('idle')
    }
  }

  const cancelMint = () => {
    setBusy(false)
    setIsPending(false)
    setPhase('idle')
    setMintError('Cancelled by you')
  }

  // ─── Initial load: try API first, fall back to on-chain ─────────
  // The DB indexer can lag (or skip blocks) so on-chain is the source of truth.
  useEffect(() => {
    if (!address) return
    getVersePool().then(setVersePool)

    const loadFromChain = async () => {
      try {
        const { JsonRpcProvider, Contract } = await import('ethers')
        const rpcUrl = 'https://bsc-dataseed.binance.org/' // mainnet only
        const provider = new JsonRpcProvider(rpcUrl)
        const mfp = new Contract(CONTRACTS.mfpNft, MFPNFT_ABI as any, provider)
        const balance: bigint = await mfp.balanceOf(address)
        const records: MintRecord[] = []
        for (let i = 0n; i < balance; i++) {
          const tokenId = await mfp.tokenOfOwnerByIndex(address, i)
          const pair = await mfp.pairOf(tokenId)
          records.push({
            tokenId: Number(tokenId),
            imageId: Number(pair[0]),
            verseId: Number(pair[1]),
            mintedAt: new Date().toISOString(),
            txHash: '',
          })
        }
        return records.sort((a, b) => a.tokenId - b.tokenId)
      } catch (err) {
        console.error('[MFP on-chain history]', err)
        return []
      }
    }

    api(`/nft/mfp/history/${address}`)
      .then(async (r: any) => {
        const apiRecords = r?.data ?? []
        if (apiRecords.length > 0) { setHistory(apiRecords); return }
        // Fallback: read directly on-chain
        const onChain = await loadFromChain()
        setHistory(onChain)
      })
      .catch(async () => setHistory(await loadFromChain()))
  }, [address])

  const verseById = useMemo(() => {
    const m = new Map<number, VerseEntry>()
    versePool.forEach((v) => m.set(v.id, v))
    return m
  }, [versePool])

  if (!address) {
    return (
      <div className="card" style={{ padding: 20, textAlign: 'center' }}>
        <div style={{ color: 'var(--gray2)', fontSize: 13 }}>
          Connect your wallet to view MFP-NFT mint allowance
        </div>
      </div>
    )
  }

  return (
    <>
      {/* ─── Allowance + Mint Card ─── */}
      <div className="card" style={{ padding: 24, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 11, color: 'var(--gray2)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
              Mission Founding Partner
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--gold)' }}>
              MFP-NFT Mint
            </div>
          </div>
          <div
            style={{
              fontSize: 11,
              padding: '4px 10px',
              borderRadius: 12,
              background: 'rgba(212,160,23,0.12)',
              color: 'var(--gold)',
              border: '1px solid rgba(212,160,23,0.3)',
            }}
          >
            DAO governance × 10 staking weight
          </div>
        </div>

        <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
          <Stat label="Granted" value={granted} color="var(--copper)" />
          <Stat label="Minted" value={mintedCount} color="var(--cyan)" />
          <Stat label="Pending" value={remaining} color="var(--gold)" highlight />
        </div>

        {remaining > 0 ? (
          <div
            style={{
              padding: 16,
              borderRadius: 10,
              background: 'rgba(212,160,23,0.05)',
              border: '1px dashed rgba(212,160,23,0.4)',
              marginBottom: 16,
            }}
          >
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, color: 'var(--gray2)', marginBottom: 4 }}>QUANTITY TO MINT (max {remaining})</div>
              <input
                type="number"
                min={1}
                max={remaining}
                value={quantity}
                onChange={(e) => setQuantity(Math.max(1, Math.min(remaining, parseInt(e.target.value || '1', 10))))}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  fontSize: 16,
                  background: 'var(--bg3)',
                  border: '1px solid var(--border)',
                  color: 'var(--white)',
                  borderRadius: 8,
                  fontFamily: 'monospace',
                }}
              />
            </div>
            <button
              className="btn btn-gold"
              onClick={handleMint}
              disabled={busy || quantity < 1 || quantity > remaining}
              style={{ width: '100%', padding: '12px', fontSize: 14, fontWeight: 700 }}
            >
              {phase === 'wallet'
                ? 'Confirm in wallet...'
                : phase === 'mining'
                ? 'Drawing your sacred pair...'
                : `✦ Mint ${quantity} MFP-NFT${quantity > 1 ? 's' : ''}`}
            </button>
            {busy && (
              <button
                onClick={cancelMint}
                style={{
                  width: '100%', marginTop: 8, padding: '8px',
                  background: 'transparent', border: '1px solid rgba(229,57,53,0.4)',
                  color: '#FCA5A5', borderRadius: 6, fontSize: 12, cursor: 'pointer',
                }}
              >
                Cancel
              </button>
            )}
            {mintError && (
              <div style={{
                marginTop: 10,
                padding: '10px 12px',
                background: 'rgba(229,57,53,0.10)',
                border: '1px solid rgba(229,57,53,0.35)',
                borderRadius: 8,
                fontSize: 12,
                color: '#FCA5A5',
                lineHeight: 1.5,
              }}>
                <strong>Mint error:</strong> {mintError}
                <div style={{ marginTop: 6 }}>
                  <button
                    onClick={() => setMintError(null)}
                    style={{
                      background: 'transparent',
                      border: '1px solid rgba(229,57,53,0.5)',
                      color: '#FCA5A5',
                      padding: '4px 12px',
                      borderRadius: 6,
                      fontSize: 11,
                      cursor: 'pointer',
                    }}
                  >
                    Dismiss & try again
                  </button>
                </div>
              </div>
            )}
            <div style={{ fontSize: 11, color: 'var(--gray2)', marginTop: 8, lineHeight: 1.5 }}>
              Each NFT is a unique sacred pair: 1 random artwork (out of 100) + 1 random Bible verse (out of 100) + a unique serial number.
            </div>
          </div>
        ) : granted > 0 ? (
          <div
            style={{
              padding: 16,
              textAlign: 'center',
              fontSize: 13,
              color: 'var(--gray)',
              fontStyle: 'italic',
              background: 'var(--bg4)',
              borderRadius: 10,
            }}
          >
            ✓ You've minted all {granted} of your granted MFP-NFTs.
          </div>
        ) : (
          <div
            style={{
              padding: 16,
              textAlign: 'center',
              fontSize: 13,
              color: 'var(--gray)',
              fontStyle: 'italic',
              background: 'var(--bg4)',
              borderRadius: 10,
            }}
          >
            No MFP-NFT mint rights yet. Buy a SEED package to receive grant automatically.
          </div>
        )}

        {/* History grid — Genesis cards (compact) */}
        {history.length > 0 && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--white)' }}>
                Your Collection ({history.length})
              </div>
              {address && (
                <a
                  href={`/mfpnft_minted?owner=${address}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: '0.04em',
                    padding: '6px 14px',
                    borderRadius: 100,
                    background: 'rgba(212,160,23,0.12)',
                    color: '#F5D56E',
                    border: '1px solid rgba(212,160,23,0.35)',
                    textDecoration: 'none',
                    fontFamily: 'var(--font-d, Inter, sans-serif)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                  title="Open My MFP-NFTs gallery in new tab — full-card view of all your minted tokens"
                >
                  ✦ View My Gallery <span style={{ opacity: 0.8 }}>↗</span>
                </a>
              )}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 16 }}>
              {history.map((rec) => {
                const v = verseById.get(rec.verseId)
                return (
                  <div
                    key={rec.tokenId}
                    onClick={() => setActionTokenId(rec.tokenId)}
                    role="button"
                    tabIndex={0}
                    aria-label={`Open actions for MFP-NFT #${rec.tokenId}`}
                    style={{
                      cursor: 'pointer',
                      transition: 'transform 0.15s, filter 0.15s',
                      borderRadius: 12,
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.transform = 'translateY(-2px)'
                      e.currentTarget.style.filter = 'drop-shadow(0 6px 16px rgba(245,213,110,0.20))'
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.transform = ''
                      e.currentTarget.style.filter = ''
                    }}
                  >
                    <MfpCard
                      tokenId={rec.tokenId}
                      imageId={rec.imageId}
                      verseId={rec.verseId}
                      title={v?.title}
                      soulLine={v?.soulLine}
                      verseText={v?.verse.text}
                      verseRef={v?.verse.ref}
                      thumbnail
                      compact
                      year={2026}
                    />
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>

      {/* ─── Reveal Modal — full Mission Founding Pass cards ─── */}
      {revealOpen && revealedTokens.length > 0 && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.92)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'center',
            padding: 20,
            paddingTop: 40,
            overflowY: 'auto',
          }}
          onClick={() => setRevealOpen(false)}
        >
          <div
            style={{ maxWidth: 900, width: '100%' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                fontSize: 14,
                color: '#F5D56E',
                textTransform: 'uppercase',
                letterSpacing: '0.2em',
                marginBottom: 24,
                textAlign: 'center',
                animation: 'mfp-fade-in 0.8s ease-out',
              }}
            >
              ✦ Your sacred pair has been drawn ✦
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(360px, max-content))',
                gap: 28,
                justifyContent: 'center',
                animation: 'mfp-fade-in 1.2s ease-out 0.2s both',
              }}
            >
              {revealedTokens.map((rec) => {
                const v = verseById.get(rec.verseId)
                return (
                  <MfpCard
                    key={rec.tokenId}
                    tokenId={rec.tokenId}
                    imageId={rec.imageId}
                    verseId={rec.verseId}
                    title={v?.title}
                    soulLine={v?.soulLine}
                    verseText={v?.verse.text}
                    verseRef={v?.verse.ref}
                    thumbnail={false}
                    year={2026}
                  />
                )
              })}
            </div>
            <div style={{ textAlign: 'center', marginTop: 28 }}>
              <button
                onClick={() => setRevealOpen(false)}
                style={{
                  padding: '10px 28px',
                  fontSize: 12,
                  letterSpacing: '0.15em',
                  textTransform: 'uppercase',
                  background: 'transparent',
                  border: '1px solid #D4A017',
                  color: '#F5D56E',
                  borderRadius: 6,
                  cursor: 'pointer',
                  fontFamily: 'Inter, sans-serif',
                }}
              >
                Close
              </button>
            </div>
          </div>
          <style>{`@keyframes mfp-fade-in { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }`}</style>
        </div>
      )}

      {/* ─── Per-NFT Action Menu (Transfer / P2P / Element / Magic Eden) ─── */}
      <MfpActionMenu
        open={actionTokenId !== null}
        tokenId={actionTokenId}
        ownerAddress={address}
        onClose={() => setActionTokenId(null)}
        onTransferred={() => {
          // Refetch on-chain state + remove from local history (no longer owned)
          refetchAllowance()
          refetchMinted()
          setHistory((prev) => prev.filter((r) => r.tokenId !== actionTokenId))
        }}
      />
    </>
  )
}

function Stat({
  label,
  value,
  color,
  highlight,
}: {
  label: string
  value: number
  color?: string
  highlight?: boolean
}) {
  return (
    <div
      style={{
        flex: 1,
        padding: 12,
        background: highlight ? 'rgba(212,160,23,0.08)' : 'var(--bg4)',
        border: highlight ? '1px solid rgba(212,160,23,0.4)' : '1px solid var(--border)',
        borderRadius: 8,
      }}
    >
      <div style={{ fontSize: 10, color: 'var(--gray2)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, color: color || 'var(--white)' }}>{value.toLocaleString()}</div>
    </div>
  )
}
