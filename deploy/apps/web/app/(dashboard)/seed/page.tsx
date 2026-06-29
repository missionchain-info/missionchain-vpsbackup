'use client'

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { useAccount } from 'wagmi'
import { useSearchParams } from 'next/navigation'
import { BrowserProvider, Contract, parseUnits } from 'ethers'
import RoundGuard from '@/components/ui/RoundGuard'
import SubNav, { SALES_TABS } from '@/components/layout/SubNav'
import { useApi } from '@/hooks/useApi'
import LoadingSpinner from '@/components/ui/LoadingSpinner'
import { CONTRACTS, ERC20_ABI, SEED_ABI } from '@/lib/contracts'

/* ── Types ── */
interface SeedInfo {
  data?: {
    round?: string
    pricePerMic?: number
    allocationMic?: number
    totalMicSold?: string
    remainingMic?: string
    participants?: number
    purchaseCount?: number
    packages?: Array<{ name: string; price: number; mic: number; mfp: number }>
    referral?: boolean
    mfpMinted?: number
    mfpMaxSupply?: number
    promotion?: {
      active: boolean
      pct: number
      start: string | null
      end: string | null
      label: string | null
    }
  }
}

interface RoundConfigRes {
  data?: Array<{
    roundType: string
    status: string
    displayCap?: string | null
    totalSold?: string
    countdownStart?: string | null
    countdownEnd?: string | null
    micPrice?: string | null
  }>
}

interface PurchaseRes {
  data?: Array<{
    id: string
    type: string
    packageName?: string
    usdtAmount: string
    micAmount: string
    nftBonusType?: string
    nftBonusTokenId?: string
    txHash: string
    createdAt: string
  }>
}

interface DistributorStats {
  data?: {
    isDistributor: boolean
    commissionRate?: number
    totalBuyers?: number
    totalVolume?: string
    totalEarned?: string
    claimed?: string
    unclaimed?: string
    totalOrders?: number
    activeRequest?: {
      id: string
      status: 'PENDING' | 'APPROVED'
      grossAmount: string
      feeBps: number
      feeAmount: string
      netAmount: string
      earningCount: number
      requestedAt: string
      approvedAt?: string | null
    } | null
    lastClosedRequest?: {
      id: string
      status: 'PAID' | 'REJECTED'
      netAmount: string
      paidAt?: string | null
      paidTxHash?: string | null
      rejectedReason?: string | null
    } | null
  }
}

/* ── Constants (Whitepaper Apr 22 canonical SEED packages) ── */
const PACKAGES = [
  { price: 1000, mic: 400_000, mfp: 1, label: 'SEED', tier: 1, desc: 'Early Bird — entry point for early supporters' },
  { price: 2500, mic: 1_000_000, mfp: 3, label: 'SEED', tier: 2, desc: 'Founding Partner I — grow your stewardship stake' },
  { price: 5000, mic: 2_000_000, mfp: 8, label: 'SEED', tier: 3, desc: 'Founding Partner II — premium governance package' },
  { price: 10000, mic: 4_000_000, mfp: 20, label: 'SEED', tier: 4, desc: 'Founding Partner III — maximum stewardship allocation' },
]

const VESTING_STEPS = [
  { label: 'Purchase', sub: 'Day 0' },
  { label: 'Cliff', sub: '6 Months' },
  { label: '10% Unlock', sub: 'Month 6' },
  { label: '2.5%/mo', sub: 'Month 7+' },
  { label: '100%', sub: 'Month 42' },
]

const HIGHLIGHTS = [
  { icon: '\u{1F4B0}', title: '$0.0025/MIC', desc: 'Lowest price in the ecosystem' },
  { icon: '\u{1F3C6}', title: 'MFP-NFT Included', desc: 'Governance + x10 multiplier' },
  { icon: '\u{1F512}', title: 'Vesting Protected', desc: '6-month cliff, gradual unlock' },
  { icon: '\u{1F6AB}', title: 'No Referral', desc: 'Private round — invite only' },
]

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'

function fmt(n: number): string {
  if (!n || isNaN(n)) return '-'
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(0) + 'K'
  return n.toLocaleString()
}

function fmtUsd(n: number): string {
  if (!n || isNaN(n)) return '-'
  if (n >= 1_000_000) return '$' + (n / 1_000_000).toFixed(2) + 'M'
  if (n >= 1_000) return '$' + (n / 1_000).toFixed(0) + 'K'
  return '$' + n.toLocaleString()
}

// Full-precision USD with thousands separator: 1700 → "$1,700.00"
function fmtUsdFull(n: number | string | undefined | null): string {
  if (n == null || n === '') return '-'
  const v = typeof n === 'string' ? parseFloat(n) : n
  if (!v || isNaN(v)) return '-'
  return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/* ── Countdown Hook ── */
function useCountdown(endDateStr?: string | null) {
  const [timeLeft, setTimeLeft] = useState({ d: 0, h: 0, m: 0, s: 0, expired: true })

  useEffect(() => {
    if (!endDateStr) return
    const end = new Date(endDateStr).getTime()

    const update = () => {
      const now = Date.now()
      const diff = end - now
      if (diff <= 0) {
        setTimeLeft({ d: 0, h: 0, m: 0, s: 0, expired: true })
        return
      }
      setTimeLeft({
        d: Math.floor(diff / 86400000),
        h: Math.floor((diff % 86400000) / 3600000),
        m: Math.floor((diff % 3600000) / 60000),
        s: Math.floor((diff % 60000) / 1000),
        expired: false,
      })
    }

    update()
    const interval = setInterval(update, 1000)
    return () => clearInterval(interval)
  }, [endDateStr])

  return timeLeft
}

/* ── Countdown Timer ── */
function PromoCountdown({ endDate }: { endDate: string }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  const diff = Math.max(0, new Date(endDate).getTime() - now)
  const d = Math.floor(diff / 86400000)
  const h = Math.floor((diff % 86400000) / 3600000)
  const m = Math.floor((diff % 3600000) / 60000)
  const s = Math.floor((diff % 60000) / 1000)
  if (diff <= 0) return <div style={{ fontSize: '0.75rem', color: '#ff6b6b', marginTop: 4, paddingLeft: 36 }}>Promotion ended</div>
  const boxStyle: React.CSSProperties = {
    display: 'inline-flex', flexDirection: 'column', alignItems: 'center',
    background: 'rgba(201,168,76,0.12)', borderRadius: 6, padding: '4px 8px', minWidth: 42,
    border: '1px solid rgba(201,168,76,0.2)',
  }
  const numStyle: React.CSSProperties = { fontSize: '1rem', fontWeight: 700, color: 'var(--gold)', fontFamily: 'var(--font-m)', lineHeight: 1.2 }
  const lblStyle: React.CSSProperties = { fontSize: '0.55rem', color: 'var(--muted)', textTransform: 'uppercase' as const, letterSpacing: '0.05em' }
  const sepStyle: React.CSSProperties = { fontSize: '0.9rem', fontWeight: 700, color: 'var(--gold)', opacity: 0.5, margin: '0 2px' }
  return (
    <div style={{ marginTop: 8, paddingLeft: 36, display: 'flex', alignItems: 'center', gap: 4 }}>
      <span style={{ fontSize: '0.7rem', color: 'var(--muted)', marginRight: 6 }}>Ends in</span>
      <div style={boxStyle}><span style={numStyle}>{String(d).padStart(2,'0')}</span><span style={lblStyle}>days</span></div>
      <span style={sepStyle}>:</span>
      <div style={boxStyle}><span style={numStyle}>{String(h).padStart(2,'0')}</span><span style={lblStyle}>hrs</span></div>
      <span style={sepStyle}>:</span>
      <div style={boxStyle}><span style={numStyle}>{String(m).padStart(2,'0')}</span><span style={lblStyle}>min</span></div>
      <span style={sepStyle}>:</span>
      <div style={boxStyle}><span style={numStyle}>{String(s).padStart(2,'0')}</span><span style={lblStyle}>sec</span></div>
    </div>
  )
}

/* ── Page ── */
export default function SeedPage() {
  const { address } = useAccount()
  const searchParams = useSearchParams()
  const referrerUserId = searchParams.get('ref') || null
  const { data: seedData, loading: seedLoading, refetch: refetchSeed } = useApi<SeedInfo>('/sales/seed/info')
  const { data: roundsData } = useApi<RoundConfigRes>('/rounds/config')
  const { data: purchaseData, refetch: refetchPurchases } = useApi<PurchaseRes>('/sales/purchases', { enabled: !!address })

  // Buy state
  const [buyingIndex, setBuyingIndex] = useState<number | null>(null)
  const [buyStatus, setBuyStatus] = useState<string>('')
  const [buyError, setBuyError] = useState<string>('')

  // Success popup
  const [successPopup, setSuccessPopup] = useState<{
    show: boolean; txHash: string; packageLabel: string;
    mic: number; mfp: number; usdt: number;
  } | null>(null)

  // Distributor stats
  const [distStats, setDistStats] = useState<DistributorStats['data'] | null>(null)
  const [claiming, setClaiming] = useState(false)

  // Payout request history (for bottom-of-page table)
  interface PayoutHistoryRow {
    id: string
    wallet: string
    status: 'PENDING' | 'APPROVED' | 'PAID' | 'REJECTED'
    grossAmount: string
    feeBps: number
    feeAmount: string
    netAmount: string
    earningCount: number
    requestedAt: string
    paidAt: string | null
    paidTxHash: string | null
    rejectedReason: string | null
  }
  const [payoutHistory, setPayoutHistory] = useState<PayoutHistoryRow[]>([])

  // Payout popup (MC-style replacement for alert())
  const [payoutPopup, setPayoutPopup] = useState<{
    type: 'success' | 'error'
    grossAmount?: string
    earningCount?: number
    message?: string
  } | null>(null)

  useEffect(() => {
    if (!address) return
    const jwt = localStorage.getItem('mc-jwt')
    if (!jwt) return
    fetch(`${API_BASE}/sales/seed/distributor-stats`, {
      headers: { Authorization: `Bearer ${jwt}` },
    })
      .then(r => r.json())
      .then(res => { if (res.data) setDistStats(res.data) })
      .catch(() => {})
    fetch(`${API_BASE}/sales/seed/payout-history`, {
      headers: { Authorization: `Bearer ${jwt}` },
    })
      .then(r => r.json())
      .then(res => { if (Array.isArray(res?.data)) setPayoutHistory(res.data) })
      .catch(() => {})
  }, [address])

  const handleClaim = async () => {
    setClaiming(true)
    try {
      const jwt = localStorage.getItem('mc-jwt')
      const res = await fetch(`${API_BASE}/sales/seed/request-payout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const data = await res.json()
      if (data.data) {
        setPayoutPopup({
          type: 'success',
          grossAmount: data.data.grossAmount,
          earningCount: data.data.earningCount,
        })
        const r2 = await fetch(`${API_BASE}/sales/seed/distributor-stats`, {
          headers: { Authorization: `Bearer ${jwt}` },
        })
        const d2 = await r2.json()
        if (d2.data) setDistStats(d2.data)
        const rh = await fetch(`${API_BASE}/sales/seed/payout-history`, {
          headers: { Authorization: `Bearer ${jwt}` },
        })
        const dh = await rh.json()
        if (Array.isArray(dh?.data)) setPayoutHistory(dh.data)
      } else {
        setPayoutPopup({ type: 'error', message: data.message || 'Request failed. Please try again.' })
      }
    } catch {
      setPayoutPopup({ type: 'error', message: 'Network error. Please check your connection and try again.' })
    } finally {
      setClaiming(false)
    }
  }

  // ── Buy Package Handler ──
  const BSC_CHAIN_ID = 56

  const handleBuy = useCallback(async (packageIndex: number, priceUsdt: number) => {
    if (!address) {
      setBuyError('Please connect your wallet first')
      return
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ethereum = (window as any).ethereum
    if (!ethereum) {
      setBuyError('No wallet detected. Please install MetaMask.')
      return
    }

    setBuyingIndex(packageIndex)
    setBuyStatus('Checking network...')
    setBuyError('')

    try {
      const provider = new BrowserProvider(ethereum)

      // 1. Check chain — must be BSC Mainnet (56)
      const network = await provider.getNetwork()
      if (Number(network.chainId) !== BSC_CHAIN_ID) {
        setBuyStatus('Switching to BSC Mainnet...')
        try {
          await ethereum.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: '0x38' }], // 56 in hex
          })
        } catch (switchErr: unknown) {
          // Chain not added — add it
          if ((switchErr as { code?: number })?.code === 4902) {
            await ethereum.request({
              method: 'wallet_addEthereumChain',
              params: [{
                chainId: '0x38',
                chainName: 'BSC Mainnet',
                rpcUrls: ['https://bsc-dataseed.binance.org/'],
                nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 },
                blockExplorerUrls: ['https://bscscan.com/'],
              }],
            })
          } else {
            throw switchErr
          }
        }
        // Re-create provider after chain switch
        const newProvider = new BrowserProvider(ethereum)
        const signer = await newProvider.getSigner()
        await executeBuy(signer, packageIndex, priceUsdt)
        return
      }

      const signer = await provider.getSigner()
      await executeBuy(signer, packageIndex, priceUsdt)
    } catch (err: unknown) {
      console.error('Buy error:', err)
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('user rejected') || msg.includes('ACTION_REJECTED')) {
        setBuyError('Transaction cancelled by user')
      } else if (msg.includes('Not whitelisted')) {
        setBuyError('Your wallet is not whitelisted for SEED Round')
      } else if (msg.includes('Sale not active')) {
        setBuyError('SEED sale is not active yet')
      } else if (msg.includes('insufficient') || msg.includes('exceeds balance')) {
        setBuyError('Insufficient USDT balance')
      } else if (msg.includes('could not decode')) {
        setBuyError('Wrong network — please switch to BSC Mainnet (Chain ID 56)')
      } else {
        setBuyError(msg.length > 120 ? msg.slice(0, 120) + '...' : msg)
      }
    } finally {
      setBuyingIndex(null)
      setBuyStatus('')
    }
  }, [address, refetchSeed, refetchPurchases])

  // Separated buy execution logic
  const executeBuy = useCallback(async (signer: Awaited<ReturnType<BrowserProvider['getSigner']>>, packageIndex: number, priceUsdt: number) => {
    const usdtContract = new Contract(CONTRACTS.usdt, ERC20_ABI, signer)
    const seedAddr = CONTRACTS.seed
    const usdtAmount = parseUnits(priceUsdt.toString(), 6)
    const signerAddr = await signer.getAddress()

    // Check USDT balance first
    setBuyStatus('Checking balance...')
    const balance = await usdtContract.balanceOf(signerAddr) as bigint
    if (balance < usdtAmount) {
      throw new Error(`Insufficient USDT balance. Need ${fmtUsdFull(priceUsdt)}, have ${fmtUsdFull(Number(balance) / 1e6)}`)
    }

    // Check & approve allowance (EXACT amount — no MetaMask "Unlimited" alert)
    setBuyStatus('Checking allowance...')
    const allowance = await usdtContract.allowance(signerAddr, seedAddr) as bigint
    // Explicit gas price — BSC testnet default is sometimes <1 gwei which
    // MetaMask flags as "Network fee too low" → red Review alert.
    // 5 gwei is well above floor and still negligible cost on testnet.
    const gasPrice = parseUnits('5', 'gwei')
    if (allowance < usdtAmount) {
      setBuyStatus('Approving USDT,\nconfirm in wallet!')
      // Approve exact package amount only. User-friendly + least-privilege security.
      const approveTx = await usdtContract.approve(seedAddr, usdtAmount, { gasPrice })
      setBuyStatus('Waiting for approval...')
      // Wait for 2 confirmations to ensure all RPC nodes see the new allowance
      await approveTx.wait(2)
      // Extra 3s buffer for BSC testnet RPC node sync
      await new Promise(r => setTimeout(r, 3000))
    }

    // Buy package
    setBuyStatus('Buying package,\nconfirm in wallet!')
    const seedContract = new Contract(seedAddr, SEED_ABI, signer)
    // Gas scales with NFT count: ~120K per NFT + 800K base overhead
    const nftCounts = [1, 3, 8, 20]
    const estimatedGas = 800_000 + nftCounts[packageIndex] * 35_000
    const gasWithBuffer = Math.min(Math.ceil(estimatedGas * 1.3), 15_000_000) // cap under 16M RPC limit
    const buyTx = await seedContract.buyPackage(BigInt(packageIndex), { gasLimit: gasWithBuffer, gasPrice })
    setBuyStatus('Confirming transaction...')
    const receipt = await buyTx.wait()

    // Find package info
    const pkg = PACKAGES[packageIndex]
    const txHash = receipt.hash

    // Record purchase in DB via API
    setBuyStatus('Recording purchase data...')
    try {
      const jwt = typeof window !== 'undefined' ? localStorage.getItem('mc-jwt') : null
      await fetch(`${API_BASE}/sales/seed/record-onchain`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
        },
        body: JSON.stringify({
          txHash,
          packageIndex,
          packageName: pkg?.label || `Package ${packageIndex}`,
          usdtAmount: priceUsdt,
          micAmount: pkg?.mic || 0,
          mfpCount: pkg?.mfp || 0,
          blockNumber: receipt.blockNumber,
        }),
      })
    } catch (dbErr) {
      console.warn('Failed to record purchase in DB (tx still succeeded on-chain):', dbErr)
    }

    // Show success popup
    setSuccessPopup({
      show: true, txHash,
      packageLabel: pkg?.label || `Package ${packageIndex}`,
      mic: pkg?.mic || 0, mfp: pkg?.mfp || 0, usdt: priceUsdt,
    })

    setBuyStatus('')
    setBuyingIndex(null)
    refetchSeed?.()
    refetchPurchases?.()
  }, [refetchSeed, refetchPurchases])

  // Extract countdown end BEFORE early return (hook must be unconditional)
  const seedRound = (roundsData?.data || []).find(r => r.roundType === 'SEED')
  const countdown = useCountdown(seedRound?.countdownEnd)

  if (seedLoading) return <><SubNav items={SALES_TABS} /><LoadingSpinner /></>

  const d = seedData?.data || {}
  const packages = d.packages || PACKAGES.map(p => ({ name: p.label, price: p.price, mic: p.mic, mfp: p.mfp }))

  // Key stats — SOLD / CAP / Participants
  const totalMicSold = Number(d.totalMicSold || 0)
  const allocationMic = d.allocationMic || 227_500_000
  const participants = d.participants || 0
  const pctSold = allocationMic > 0 ? Math.min((totalMicSold / allocationMic) * 100, 100) : 0

  // Promotion
  const promo = d.promotion

  // User's SEED purchases from DB
  const allOrders = (purchaseData?.data || []).filter(p => p.type === 'SEED').map(o => ({
    txHash: o.txHash || '',
    packageLabel: 'SEED',
    usdt: Number(o.usdtAmount),
    mic: Number(o.micAmount),
    mfp: PACKAGES.find(p => p.price === Number(o.usdtAmount))?.mfp || 0,
    date: o.createdAt,
    id: o.id,
  }))

  return (
    <>
      <SubNav items={SALES_TABS} />
      <RoundGuard roundId="SEED">
      <div className="seed-page">

        {/* ── Countdown Timer ── */}
        {seedRound?.countdownEnd && !countdown.expired && (
          <div className="seed-countdown">
            <div className="seed-countdown-label">SEED Round Closes In</div>
            <div className="seed-countdown-grid">
              <div className="seed-cd-unit">
                <span className="seed-cd-num">{String(countdown.d).padStart(2, '0')}</span>
                <span className="seed-cd-text">Days</span>
              </div>
              <span className="seed-cd-sep">:</span>
              <div className="seed-cd-unit">
                <span className="seed-cd-num">{String(countdown.h).padStart(2, '0')}</span>
                <span className="seed-cd-text">Hours</span>
              </div>
              <span className="seed-cd-sep">:</span>
              <div className="seed-cd-unit">
                <span className="seed-cd-num">{String(countdown.m).padStart(2, '0')}</span>
                <span className="seed-cd-text">Min</span>
              </div>
              <span className="seed-cd-sep">:</span>
              <div className="seed-cd-unit">
                <span className="seed-cd-num">{String(countdown.s).padStart(2, '0')}</span>
                <span className="seed-cd-text">Sec</span>
              </div>
            </div>
          </div>
        )}

        {/* ── Distributor Attribution ── */}
        {referrerUserId && (
          <div style={{
            textAlign: 'center', padding: '8px 16px', marginBottom: 12,
            background: 'rgba(201,168,76,0.08)', borderRadius: 8, border: '1px solid rgba(201,168,76,0.15)',
            fontSize: '0.8rem', color: 'var(--gold)',
          }}>
            Introduced by Distributor
          </div>
        )}

        {/* ── Hero Card — Sold / CAP / Participants ── */}
        <div className="seed-hero">
          <div className="seed-hero-bg" />
          <div className="seed-hero-shine" />
          <div className="seed-hero-content">
            <div className="seed-hero-top">
              <div className="seed-hero-left">
                <div className="seed-hero-badge">
                  <span className="seed-hero-emoji">{'\u{1F331}'}</span>
                </div>
                <div>
                  <div className="seed-hero-label">SEED Round — Private Sale</div>
                  <div className="seed-hero-verse">
                    <em>&ldquo;Whoever sows sparingly will also reap sparingly, and whoever sows generously will also reap generously.&rdquo;</em>
                    <span className="seed-hero-verse-ref">&mdash; 2 Corinthians 9:6</span>
                  </div>
                </div>
              </div>
              <div className="seed-hero-price">$0.0025<span className="seed-hero-price-unit">/MIC</span></div>
            </div>

            <div className="seed-stats-row">
              <div className="seed-stat">
                <div className="seed-stat-value">{fmt(totalMicSold)}</div>
                <div className="seed-stat-label">Sold (MIC)</div>
              </div>
              <div className="seed-stat">
                <div className="seed-stat-value">{fmt(allocationMic)}</div>
                <div className="seed-stat-label">CAP (MIC)</div>
              </div>
              <div className="seed-stat">
                <div className="seed-stat-value">{participants > 0 ? participants : '-'}</div>
                <div className="seed-stat-label">Participant{participants !== 1 ? 's' : ''}</div>
              </div>
              <div className="seed-stat">
                <div className="seed-stat-value">{d.mfpMinted ? `${d.mfpMinted}/${fmt(d.mfpMaxSupply ?? 2500)}` : '-'}</div>
                <div className="seed-stat-label">MFP-NFT</div>
              </div>
            </div>

            {/* Progress bar */}
            <div className="seed-progress-wrap">
              <div className="seed-progress-bar">
                <div className="seed-progress-fill" style={{ width: `${Math.min(pctSold, 100)}%` }}>
                  <div className="seed-progress-glow" />
                </div>
              </div>
              <div className="seed-progress-labels">
                <span>{pctSold.toFixed(1)}% sold</span>
                <span>{fmt(Number(d.remainingMic || 0))} MIC remaining</span>
              </div>
            </div>
          </div>
        </div>

        {/* ── Promotion Block ── */}
        <div className="seed-promo-card" style={{
          opacity: promo?.active ? 1 : 0.4,
          background: promo?.active
            ? 'linear-gradient(135deg, rgba(201,168,76,0.12), rgba(201,168,76,0.04))'
            : 'var(--card-bg)',
          border: promo?.active ? '1px solid rgba(201,168,76,0.3)' : '1px solid var(--border)',
          borderRadius: 12, padding: '16px 20px', marginBottom: 16,
          position: 'relative', overflow: 'hidden',
        }}>
          {promo?.active && (
            <div style={{
              position: 'absolute', top: 0, right: 0,
              background: 'var(--gold)', color: '#000', padding: '2px 12px',
              fontSize: '0.7rem', fontWeight: 700, borderBottomLeftRadius: 8,
            }}>ACTIVE</div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
            <span style={{ fontSize: '1.5rem' }}>{'\u{1F381}'}</span>
            <div>
              <div style={{ fontWeight: 700, fontSize: '1rem', color: promo?.active ? 'var(--gold)' : 'var(--muted)' }}>
                {promo?.active ? promo.label : 'No Active Promotion'}
              </div>
              <div style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>
                {promo?.active
                  ? `Buy now and receive ${promo.pct}% extra MIC on your purchase`
                  : 'Check back later for special bonus offers'}
              </div>
            </div>
          </div>
          {promo?.active && promo.end && <PromoCountdown endDate={promo.end} />}
        </div>


        {/* ── Highlights ── */}
        <div className="seed-highlights">
          {HIGHLIGHTS.map((h) => (
            <div className="seed-hl" key={h.title}>
              <span className="seed-hl-icon">{h.icon}</span>
              <div>
                <div className="seed-hl-title">{h.title}</div>
                <div className="seed-hl-desc">{h.desc}</div>
              </div>
            </div>
          ))}
        </div>

        {/* ── Package Cards ── */}
        <div className="seed-section-header">
          <span className="seed-section-icon">{'\u{1F4E6}'}</span>
          <span className="seed-section-title">SEED Packages</span>
          {promo?.active && (
            <span style={{
              marginLeft: 8, background: 'var(--gold)', color: '#000',
              padding: '2px 8px', borderRadius: 8, fontSize: '0.7rem', fontWeight: 700,
            }}>+{promo.pct}% BONUS</span>
          )}
        </div>

        <div className="seed-packages">
          {PACKAGES.map((pkg) => {
            const apiPkg = packages.find(p => p.name === pkg.label)
            const baseMic = apiPkg?.mic || pkg.mic
            const bonusMic = promo?.active ? Math.round(baseMic * (promo.pct / 100)) : 0
            return (
              <div className={`seed-pkg seed-pkg-tier${pkg.tier}`} key={pkg.label}>
                {pkg.tier >= 3 && <div className="seed-pkg-badge">{pkg.tier === 4 ? 'BEST VALUE' : 'POPULAR'}</div>}
                <div className="seed-pkg-label">{pkg.label}</div>
                <div className="seed-pkg-price">${(apiPkg?.price || pkg.price).toLocaleString()}</div>
                <div className="seed-pkg-desc">{pkg.desc}</div>
                <div className="seed-pkg-divider" />
                <div className="seed-pkg-row">
                  <span className="seed-pkg-icon">{'\u{1FA99}'}</span>
                  <span className="seed-pkg-text">{fmt(baseMic)} MIC</span>
                  {bonusMic > 0 && (
                    <span style={{ color: 'var(--gold)', fontSize: '0.75rem', fontWeight: 700, marginLeft: 4 }}>
                      +{fmt(bonusMic)}
                    </span>
                  )}
                </div>
                <div className="seed-pkg-row">
                  <span className="seed-pkg-icon">{'\u{1F3C6}'}</span>
                  <span className="seed-pkg-text seed-pkg-mfp">{apiPkg?.mfp || pkg.mfp} MFP-NFT</span>
                </div>
                <div className="seed-pkg-row seed-pkg-row-sub">
                  <span className="seed-pkg-icon">{'\u23F1'}</span>
                  <span className="seed-pkg-text-sub">10% unlock after 6 months</span>
                </div>
                <button
                  className={`seed-pkg-btn ${pkg.tier >= 3 ? 'seed-pkg-btn-gold' : ''} ${buyingIndex === pkg.tier - 1 ? 'seed-pkg-btn-active' : ''}`}
                  disabled={buyingIndex !== null}
                  onClick={() => handleBuy(pkg.tier - 1, apiPkg?.price || pkg.price)}
                >
                  {buyingIndex === pkg.tier - 1
                    ? (buyStatus || 'Processing...').split('\n').map((line, i) => (
                        <span key={i}>{i > 0 && <br />}{line}</span>
                      ))
                    : 'Buy Package'}
                </button>
              </div>
            )
          })}
        </div>
        {buyError && (
          <div style={{
            color: '#ff6b6b', fontSize: '0.8rem', marginTop: 10, textAlign: 'center',
            padding: '8px 16px', background: 'rgba(255,80,80,0.1)', borderRadius: 8,
            border: '1px solid rgba(255,80,80,0.2)',
          }}>
            {buyError}
          </div>
        )}

        {/* ── Vesting Timeline ── */}
        <div className="seed-vesting-card">
          <div className="seed-section-header" style={{ marginBottom: 20 }}>
            <span className="seed-section-icon">{'\u{1F512}'}</span>
            <span className="seed-section-title">Vesting Schedule</span>
          </div>
          <div className="seed-vesting-timeline">
            {VESTING_STEPS.map((step, i) => (
              <div className={`seed-vesting-step ${i === 0 ? 'done' : ''}`} key={i}>
                <div className="seed-vesting-dot">{i === 0 ? '\u2713' : i + 1}</div>
                {i < VESTING_STEPS.length - 1 && <div className={`seed-vesting-line ${i === 0 ? 'filled' : ''}`} />}
                <div className="seed-vesting-info">
                  <div className="seed-vesting-label">{step.label}</div>
                  <div className="seed-vesting-sub">{step.sub}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── My Orders ── */}
        <div className="seed-orders-card">
          <div className="seed-section-header">
            <span className="seed-section-icon">{'\u{1F4CB}'}</span>
            <span className="seed-section-title">My SEED Orders</span>
          </div>

          {/* Desktop table */}
          <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
            <table style={{ minWidth: 800, width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th className="seed-orders-th" style={{ width: 100 }}>Date</th>
                  <th className="seed-orders-th" style={{ width: 120 }}>Package</th>
                  <th className="seed-orders-th" style={{ width: 80 }}>USDT</th>
                  <th className="seed-orders-th" style={{ width: 80 }}>MIC</th>
                  <th className="seed-orders-th" style={{ width: 70 }}>MFP-NFT</th>
                  <th className="seed-orders-th" style={{ width: 100 }}>Status</th>
                  <th className="seed-orders-th" style={{ minWidth: 200 }}>TXID</th>
                </tr>
              </thead>
              <tbody>
                {allOrders.length === 0 ? (
                  <tr><td colSpan={7} className="seed-orders-empty">No SEED purchases yet</td></tr>
                ) : allOrders.map((o, i) => (
                  <tr key={o.txHash || o.id || i} style={{ borderBottom: '1px solid rgba(123,45,139,.08)' }}>
                    <td className="seed-orders-td">{new Date(o.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                    <td className="seed-orders-td">{o.packageLabel}</td>
                    <td className="seed-orders-td seed-orders-bold">${o.usdt.toLocaleString()}</td>
                    <td className="seed-orders-td seed-orders-bold">{fmt(o.mic)}</td>
                    <td className="seed-orders-td">{o.mfp}</td>
                    <td className="seed-orders-td"><span className="seed-badge-success">{'\u2713'} Done</span></td>
                    <td className="seed-orders-td" style={{ whiteSpace: 'normal', wordBreak: 'break-all' }}>
                      {o.txHash ? (
                        <a
                          href={`https://bscscan.com/tx/${o.txHash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ color: 'var(--gold)', fontSize: '0.68rem', textDecoration: 'none', fontFamily: 'monospace' }}
                          title={o.txHash}
                        >
                          {o.txHash.slice(0, 8)}...{o.txHash.slice(-6)} {'\u2197'}
                        </a>
                      ) : <span style={{ color: 'var(--gray2)' }}>-</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile card list */}
          <div className="seed-orders-cards">
            {allOrders.length === 0 ? (
              <div className="seed-orders-empty-card">No SEED purchases yet</div>
            ) : allOrders.map((o, i) => (
              <div className="seed-order-card" key={o.txHash || i}>
                <div className="seed-order-card-top">
                  <span className="seed-order-card-pkg">{o.packageLabel}</span>
                  <span className="seed-badge-success">{'\u2713'} Done</span>
                </div>
                <div className="seed-order-card-row">
                  <span className="seed-order-card-label">Date</span>
                  <span>{new Date(o.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                </div>
                <div className="seed-order-card-row">
                  <span className="seed-order-card-label">USDT</span>
                  <span className="seed-orders-bold">${o.usdt.toLocaleString()}</span>
                </div>
                <div className="seed-order-card-row">
                  <span className="seed-order-card-label">MIC</span>
                  <span className="seed-orders-bold">{fmt(o.mic)}</span>
                </div>
                <div className="seed-order-card-row">
                  <span className="seed-order-card-label">MFP-NFT</span>
                  <span>{o.mfp}</span>
                </div>
                <div className="seed-order-card-row">
                  <span className="seed-order-card-label">TX</span>
                  <a href={`https://bscscan.com/tx/${o.txHash}`} target="_blank" rel="noopener noreferrer"
                    style={{ color: 'var(--gold)', fontSize: '0.72rem', textDecoration: 'none' }}>
                    {o.txHash.slice(0, 10)}... {'\u2197'}
                  </a>
                </div>
              </div>
            ))}
          </div>
        </div>
        {/* ── Distributor Panel (bottom of page, only for distributors) ── */}
        {distStats && distStats.isDistributor && (
          <div className="seed-dist-card" style={{
            background: 'linear-gradient(135deg, rgba(91,45,158,0.1), rgba(91,45,158,0.03))',
            border: '1px solid rgba(91,45,158,0.25)',
            borderRadius: 12, padding: '16px 20px', marginTop: 24, marginBottom: 16,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <span style={{ fontSize: '1.3rem' }}>{'\u{1F91D}'}</span>
              <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>Distributor Panel</div>
              <span style={{
                marginLeft: 'auto', background: 'rgba(91,45,158,0.2)', color: '#9b72cf',
                padding: '2px 10px', borderRadius: 10, fontSize: '0.7rem', fontWeight: 600,
              }}>
                {((distStats.commissionRate ?? 0) * 100).toFixed(0)}% Commission
              </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10, marginBottom: 12 }}>
              <div style={{ textAlign: 'center', padding: 10, background: 'rgba(255,255,255,0.03)', borderRadius: 8 }}>
                <div style={{ fontSize: '1.1rem', fontWeight: 700 }}>{Number(distStats.totalBuyers) > 0 ? distStats.totalBuyers : '-'}</div>
                <div style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>Buyers</div>
              </div>
              <div style={{ textAlign: 'center', padding: 10, background: 'rgba(255,255,255,0.03)', borderRadius: 8 }}>
                <div style={{ fontSize: '1.1rem', fontWeight: 700 }}>{Number(distStats.totalVolume) > 0 ? fmtUsdFull(distStats.totalVolume) : '-'}</div>
                <div style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>Volume</div>
              </div>
              <div style={{ textAlign: 'center', padding: 10, background: 'rgba(255,255,255,0.03)', borderRadius: 8 }}>
                <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--gold)' }}>{Number(distStats.claimed) > 0 ? fmtUsdFull(distStats.claimed) : '-'}</div>
                <div style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>Claimed</div>
              </div>
              <div style={{ textAlign: 'center', padding: 10, background: 'rgba(255,255,255,0.03)', borderRadius: 8 }}>
                <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--gold)' }}>{Number(distStats.unclaimed) > 0 ? fmtUsdFull(distStats.unclaimed) : '-'}</div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                  <span style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>Unclaimed</span>
                  {Number(distStats.unclaimed) > 0 && !distStats.activeRequest && (
                    <button
                      onClick={handleClaim}
                      disabled={claiming}
                      style={{
                        padding: '2px 10px', background: 'var(--gold)', color: '#000',
                        border: 'none', borderRadius: 6, fontWeight: 700, fontSize: '0.65rem', cursor: 'pointer',
                        whiteSpace: 'nowrap',
                      }}>
                      {claiming ? '...' : 'Request Payout ›'}
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Request Payment history table */}
            <div style={{ marginTop: 14, marginBottom: 4, fontSize: '0.78rem', fontWeight: 700, color: '#D4C098' }}>
              Request Payment
            </div>
            <div style={{
              maxHeight: 280, overflowY: 'auto',
              background: 'rgba(255,255,255,0.02)',
              border: '1px solid rgba(255,255,255,0.06)',
              borderRadius: 8,
            }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.72rem' }}>
                <thead style={{ position: 'sticky', top: 0, background: 'rgba(91,45,158,0.18)' }}>
                  <tr>
                    <th style={{ padding: '8px 10px', textAlign: 'left', color: 'var(--muted)', fontWeight: 600, fontSize: '0.65rem' }}>Date Time</th>
                    <th style={{ padding: '8px 10px', textAlign: 'left', color: 'var(--muted)', fontWeight: 600, fontSize: '0.65rem' }}>Wallet</th>
                    <th style={{ padding: '8px 10px', textAlign: 'right', color: 'var(--muted)', fontWeight: 600, fontSize: '0.65rem' }}>Amount</th>
                    <th style={{ padding: '8px 10px', textAlign: 'right', color: 'var(--muted)', fontWeight: 600, fontSize: '0.65rem' }}>Fee</th>
                    <th style={{ padding: '8px 10px', textAlign: 'right', color: 'var(--muted)', fontWeight: 600, fontSize: '0.65rem' }}>Est. Received</th>
                    <th style={{ padding: '8px 10px', textAlign: 'left', color: 'var(--muted)', fontWeight: 600, fontSize: '0.65rem' }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {payoutHistory.length === 0 ? (
                    <tr>
                      <td colSpan={6} style={{ padding: 16, textAlign: 'center', color: 'var(--muted)', fontStyle: 'italic' }}>
                        No payout requests yet.
                      </td>
                    </tr>
                  ) : (
                    payoutHistory.map((r) => {
                      const dt = new Date(r.requestedAt)
                      const dtFmt = `${dt.toLocaleDateString()} ${dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                      const statusColor =
                        r.status === 'PAID' ? '#66BB6A'
                        : r.status === 'REJECTED' ? '#EF5350'
                        : r.status === 'APPROVED' ? '#42A5F5'
                        : 'var(--gold)'
                      const feePct = r.feeBps > 0 ? (r.feeBps / 100).toFixed(1) + '%' : '—'
                      const isFeeFinal = r.status === 'PAID' || r.status === 'APPROVED'
                      return (
                        <tr key={r.id} style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                          <td style={{ padding: '8px 10px', color: 'var(--muted)', fontFamily: 'var(--font-m)', fontSize: '0.65rem' }}>{dtFmt}</td>
                          <td style={{ padding: '8px 10px', fontFamily: 'var(--font-m)', fontSize: '0.65rem', color: '#D4C098' }}>
                            {r.wallet.slice(0, 6)}...{r.wallet.slice(-4)}
                          </td>
                          <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600 }}>{fmtUsdFull(r.grossAmount)}</td>
                          <td style={{ padding: '8px 10px', textAlign: 'right', color: isFeeFinal ? 'var(--white)' : 'var(--muted)', fontStyle: isFeeFinal ? 'normal' : 'italic' }}>
                            {feePct}{!isFeeFinal && r.status === 'PENDING' ? ' (TBD)' : ''}
                          </td>
                          <td style={{ padding: '8px 10px', textAlign: 'right', color: 'var(--gold)', fontWeight: 600 }}>
                            {isFeeFinal ? fmtUsdFull(r.netAmount) : <span style={{ color: 'var(--muted)', fontStyle: 'italic', fontWeight: 400 }}>{'—'}</span>}
                          </td>
                          <td style={{ padding: '8px 10px' }}>
                            <span style={{ color: statusColor, fontWeight: 600, fontSize: '0.65rem' }}>{r.status}</span>
                            {r.status === 'PAID' && r.paidTxHash && (
                              <a
                                href={`https://bscscan.com/tx/${r.paidTxHash}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{ marginLeft: 6, color: 'var(--gold)', fontSize: '0.6rem', textDecoration: 'none' }}
                              >
                                {r.paidTxHash.slice(0, 6)}... {'↗'}
                              </a>
                            )}
                            {r.status === 'REJECTED' && r.rejectedReason && (
                              <span style={{ marginLeft: 6, color: 'var(--muted)', fontSize: '0.6rem', fontStyle: 'italic' }}>
                                ({r.rejectedReason})
                              </span>
                            )}
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
            <div style={{ marginTop: 8, fontSize: '0.62rem', color: 'var(--muted)', fontStyle: 'italic', lineHeight: 1.5 }}>
              Note: Processing Fee (0{'–'}10%) may be applied at admin review and is subject to change without prior notice.
            </div>

            {distStats.activeRequest && (
              <div style={{
                marginTop: 12, padding: 12, borderRadius: 8,
                background: distStats.activeRequest.status === 'APPROVED' ? 'rgba(102, 187, 106, 0.1)' : 'rgba(245, 213, 110, 0.1)',
                border: `1px solid ${distStats.activeRequest.status === 'APPROVED' ? '#66BB6A' : 'var(--gold)'}`,
              }}>
                <div style={{ fontWeight: 700, fontSize: '0.85rem', color: distStats.activeRequest.status === 'APPROVED' ? '#66BB6A' : 'var(--gold)' }}>
                  {distStats.activeRequest.status === 'PENDING' ? 'Payout Request Pending Admin Review' : 'Payout Approved — Awaiting USDT Transfer'}
                </div>
                <div style={{ fontSize: '0.72rem', color: 'var(--muted)', marginTop: 4 }}>
                  Request: {fmtUsdFull(distStats.activeRequest.grossAmount)} ({distStats.activeRequest.earningCount} orders)
                  {distStats.activeRequest.status === 'APPROVED' && distStats.activeRequest.feeBps > 0 && (
                    <> &middot; Fee {(distStats.activeRequest.feeBps / 100).toFixed(1)}% {'→'} Net {fmtUsdFull(distStats.activeRequest.netAmount)}</>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Success Popup ── */}
      {successPopup?.show && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(6px)',
        }} onClick={() => setSuccessPopup(null)}>
          <div onClick={(e) => e.stopPropagation()} style={{
            background: 'linear-gradient(145deg, #1a1a2e, #16213e)',
            border: '1px solid rgba(201,168,76,0.3)',
            borderRadius: 20, padding: '32px 28px', maxWidth: 420, width: '90%',
            textAlign: 'center', position: 'relative',
            boxShadow: '0 20px 60px rgba(0,0,0,0.5), 0 0 40px rgba(201,168,76,0.15)',
          }}>
            {/* Confetti effect */}
            <div style={{ fontSize: 48, marginBottom: 8 }}>{'\u{1F389}'}</div>
            <div style={{
              fontSize: '1.4rem', fontWeight: 800, color: '#F5D56E',
              fontFamily: 'var(--font-d)', marginBottom: 4,
            }}>
              Congratulations!
            </div>
            <div style={{ fontSize: '0.85rem', color: '#F5E8CC', marginBottom: 16, lineHeight: 1.6 }}>
              You have successfully purchased the<br />
              <strong style={{ color: '#F5D56E' }}>{successPopup.packageLabel}</strong> package!
            </div>

            {/* MFP-NFT Gift Banner \u2014 highlight allowance */}
            {successPopup.mfp > 0 && (
              <div style={{
                background: 'linear-gradient(135deg, rgba(201,168,76,0.18), rgba(123,45,139,0.15))',
                border: '1px solid rgba(201,168,76,0.40)',
                borderRadius: 12, padding: '14px 16px', marginBottom: 18,
                display: 'flex', alignItems: 'center', gap: 12,
                boxShadow: '0 0 16px rgba(201,168,76,0.10)',
              }}>
                <div style={{ fontSize: 28, flexShrink: 0 }}>{'\u{1F381}'}</div>
                <div style={{ textAlign: 'left', flex: 1 }}>
                  <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#F5D56E', marginBottom: 4 }}>
                    {successPopup.mfp} MFP-NFT{successPopup.mfp > 1 ? 's' : ''} granted
                  </div>
                  <div style={{ fontSize: '0.72rem', color: '#F5E8CC', lineHeight: 1.45 }}>
                    Mint your MFP-NFT{successPopup.mfp > 1 ? 's' : ''} now to claim {successPopup.mfp > 1 ? 'them' : 'it'} into your wallet.
                  </div>
                </div>
              </div>
            )}

            {/* Purchase details */}
            <div style={{
              background: 'rgba(201,168,76,0.08)', border: '1px solid rgba(201,168,76,0.15)',
              borderRadius: 12, padding: '16px 20px', marginBottom: 18, textAlign: 'left',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontSize: '0.78rem', color: '#D4C098' }}>Paid</span>
                <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#F5E8CC' }}>${successPopup.usdt.toLocaleString()} USDT</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontSize: '0.78rem', color: '#D4C098' }}>MIC Received</span>
                <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#F5D56E' }}>{fmt(successPopup.mic)} MIC</span>
              </div>
              <div style={{ height: 1, background: 'rgba(255,255,255,0.1)', margin: '8px 0' }} />
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '0.78rem', color: '#D4C098' }}>Vesting</span>
                <span style={{ fontSize: '0.78rem', color: '#F5E8CC' }}>10% unlock after 6 months</span>
              </div>
            </div>

            {/* TX link */}
            <a
              href={`https://bscscan.com/tx/${successPopup.txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'block', padding: '8px 0', marginBottom: 14,
                color: '#F5D56E', fontSize: '0.74rem', textDecoration: 'none',
              }}
            >
              View on BSCScan {'\u2197'}
              <div style={{ fontSize: '0.66rem', color: '#B8A894', marginTop: 2 }}>
                {successPopup.txHash.slice(0, 16)}...{successPopup.txHash.slice(-8)}
              </div>
            </a>

            {/* Action buttons */}
            <div style={{ display: 'flex', gap: 8 }}>
              {successPopup.mfp > 0 ? (
                <>
                  <Link
                    href="/nft"
                    onClick={() => setSuccessPopup(null)}
                    style={{
                      flex: 2, padding: '12px 0',
                      background: 'linear-gradient(135deg, var(--gold), #b8942f)',
                      color: '#000', border: 'none', borderRadius: 10,
                      fontWeight: 700, fontSize: '0.85rem', cursor: 'pointer',
                      fontFamily: 'var(--font-d)', letterSpacing: '0.04em',
                      textDecoration: 'none', textAlign: 'center',
                    }}
                  >
                    {'\u{1F3A8}'} Mint MFP-NFT Now
                  </Link>
                  <button
                    onClick={() => setSuccessPopup(null)}
                    style={{
                      flex: 1, padding: '12px 0',
                      background: 'transparent',
                      color: 'var(--gold)',
                      border: '1px solid rgba(201,168,76,0.45)',
                      borderRadius: 10,
                      fontWeight: 700, fontSize: '0.82rem', cursor: 'pointer',
                      fontFamily: 'var(--font-d)', letterSpacing: '0.04em',
                    }}
                  >
                    Close
                  </button>
                </>
              ) : (
                <button
                  onClick={() => setSuccessPopup(null)}
                  style={{
                    width: '100%', padding: '12px 0',
                    background: 'linear-gradient(135deg, var(--gold), #b8942f)',
                    color: '#000', border: 'none', borderRadius: 10,
                    fontWeight: 700, fontSize: '0.9rem', cursor: 'pointer',
                    fontFamily: 'var(--font-d)', letterSpacing: '0.04em',
                  }}
                >
                  AWESOME!
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Payout Request Popup (MC-style replacement for alert) ── */}
      {payoutPopup && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(6px)',
        }} onClick={() => setPayoutPopup(null)}>
          <div onClick={(e) => e.stopPropagation()} style={{
            background: 'linear-gradient(145deg, #1a1a2e, #16213e)',
            border: `1px solid ${payoutPopup.type === 'success' ? 'rgba(201,168,76,0.3)' : 'rgba(239,83,80,0.3)'}`,
            borderRadius: 20, padding: '32px 28px', maxWidth: 440, width: '90%',
            textAlign: 'center', position: 'relative',
            boxShadow: payoutPopup.type === 'success'
              ? '0 20px 60px rgba(0,0,0,0.5), 0 0 40px rgba(201,168,76,0.15)'
              : '0 20px 60px rgba(0,0,0,0.5), 0 0 40px rgba(239,83,80,0.15)',
          }}>
            {payoutPopup.type === 'success' ? (
              <>
                {/* Icon */}
                <div style={{
                  width: 64, height: 64, margin: '0 auto 12px',
                  borderRadius: '50%',
                  background: 'linear-gradient(135deg, rgba(201,168,76,0.25), rgba(123,45,139,0.15))',
                  border: '1px solid rgba(201,168,76,0.40)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 32,
                  boxShadow: '0 0 20px rgba(201,168,76,0.20)',
                }}>
                  {'\u{1F4B0}'}
                </div>

                <div style={{
                  fontSize: '1.3rem', fontWeight: 800, color: '#F5D56E',
                  fontFamily: 'var(--font-d)', marginBottom: 6, letterSpacing: '0.02em',
                }}>
                  Payout Request Submitted
                </div>

                <div style={{ fontSize: '0.78rem', color: '#B8A894', marginBottom: 18 }}>
                  Your commission claim has been queued for admin review.
                </div>

                {/* Details */}
                <div style={{
                  background: 'rgba(201,168,76,0.08)',
                  border: '1px solid rgba(201,168,76,0.15)',
                  borderRadius: 12, padding: '16px 20px', marginBottom: 18,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                    <span style={{ fontSize: '0.78rem', color: '#D4C098' }}>Total Amount</span>
                    <span style={{ fontSize: '1.05rem', fontWeight: 700, color: '#F5D56E' }}>
                      {fmtUsdFull(payoutPopup.grossAmount)}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: '0.78rem', color: '#D4C098' }}>Orders</span>
                    <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#F5E8CC' }}>
                      {payoutPopup.earningCount} order{(payoutPopup.earningCount ?? 0) > 1 ? 's' : ''}
                    </span>
                  </div>
                </div>

                {/* Status timeline */}
                <div style={{
                  background: 'rgba(255,255,255,0.02)',
                  border: '1px solid rgba(255,255,255,0.06)',
                  borderRadius: 12, padding: '14px 16px', marginBottom: 18,
                  textAlign: 'left',
                }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
                    <div style={{
                      width: 16, height: 16, borderRadius: '50%',
                      background: 'var(--gold)', flexShrink: 0, marginTop: 2,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 10, color: '#000', fontWeight: 900,
                    }}>{'✓'}</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#F5E8CC' }}>Submitted</div>
                      <div style={{ fontSize: '0.68rem', color: '#B8A894' }}>Request received and queued</div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
                    <div style={{
                      width: 16, height: 16, borderRadius: '50%',
                      background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(245,213,110,0.4)',
                      flexShrink: 0, marginTop: 2,
                    }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#D4C098' }}>Admin Review</div>
                      <div style={{ fontSize: '0.68rem', color: '#B8A894' }}>1-3 business days</div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                    <div style={{
                      width: 16, height: 16, borderRadius: '50%',
                      background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(102,187,106,0.4)',
                      flexShrink: 0, marginTop: 2,
                    }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#D4C098' }}>USDT Payout</div>
                      <div style={{ fontSize: '0.68rem', color: '#B8A894' }}>USDT transferred to your wallet</div>
                    </div>
                  </div>
                </div>

                {/* Processing fee disclaimer */}
                <div style={{
                  marginBottom: 14, padding: '10px 12px',
                  background: 'rgba(245,213,110,0.06)',
                  border: '1px dashed rgba(245,213,110,0.25)',
                  borderRadius: 10,
                  fontSize: '0.66rem', color: '#D4C098', lineHeight: 1.5, textAlign: 'left',
                }}>
                  <b style={{ color: '#F5D56E' }}>Note:</b> A processing fee of 0–10% may be
                  applied to the final payout. The fee rate is determined at admin review time
                  and may change without prior notice.
                </div>

                <button
                  onClick={() => setPayoutPopup(null)}
                  style={{
                    width: '100%', padding: '12px 0',
                    background: 'linear-gradient(135deg, var(--gold), #b8942f)',
                    color: '#000', border: 'none', borderRadius: 10,
                    fontWeight: 700, fontSize: '0.85rem', cursor: 'pointer',
                    fontFamily: 'var(--font-d)', letterSpacing: '0.04em',
                  }}>
                  Got it
                </button>
              </>
            ) : (
              <>
                {/* Error icon */}
                <div style={{
                  width: 64, height: 64, margin: '0 auto 12px',
                  borderRadius: '50%',
                  background: 'rgba(239,83,80,0.15)',
                  border: '1px solid rgba(239,83,80,0.40)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 32, color: '#EF5350',
                }}>
                  {'⚠'}
                </div>

                <div style={{
                  fontSize: '1.2rem', fontWeight: 800, color: '#EF5350',
                  fontFamily: 'var(--font-d)', marginBottom: 8, letterSpacing: '0.02em',
                }}>
                  Request Failed
                </div>

                <div style={{
                  fontSize: '0.82rem', color: '#F5E8CC', marginBottom: 22,
                  lineHeight: 1.5, padding: '0 12px',
                }}>
                  {payoutPopup.message}
                </div>

                <button
                  onClick={() => setPayoutPopup(null)}
                  style={{
                    width: '100%', padding: '12px 0',
                    background: 'rgba(239,83,80,0.15)',
                    color: '#EF5350', border: '1px solid rgba(239,83,80,0.40)',
                    borderRadius: 10, fontWeight: 700, fontSize: '0.85rem', cursor: 'pointer',
                    fontFamily: 'var(--font-d)', letterSpacing: '0.04em',
                  }}>
                  Close
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </RoundGuard>
    </>
  )
}
