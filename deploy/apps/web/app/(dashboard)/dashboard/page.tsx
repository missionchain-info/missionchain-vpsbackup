'use client'

import { useState, useEffect } from 'react'
import { useApi } from '@/hooks/useApi'
import { useAccount, useBalance } from 'wagmi'
import { BrowserProvider, Contract, formatUnits, formatEther } from 'ethers'
import LoadingSpinner from '@/components/ui/LoadingSpinner'
import { CONTRACTS, ERC20_ABI, MIC_ABI, LOCK_MANAGER_ABI, MFPNFT_ABI, COMMUNITY_NFT_ABI } from '@/lib/contracts'
import { getActiveChain } from '@missionchain/sdk'

const ACTIVE_CHAIN = getActiveChain()

interface DashboardData {
  data?: {
    micPrice?: string
    totalSupply?: number
    preIssued?: number
    miningPool?: number
    circulatingSupply?: string
    totalEmitted?: string
    totalStaked?: string
    totalBurned?: string
    totalLocked?: string
    inContractReserves?: string
    vestingLocked?: string
    dailyOutput?: number
    emissionSplit?: {
      miners?: number
      staking?: number
      dao?: number
      burn?: number
    }
    mfpTotal?: number
    mfpMinted?: number
    communityNfts?: number
    activeMice?: number
    totalUsers?: number
  }
}

interface WalletData {
  data?: {
    micTotal?: string
    micAvailable?: string
    micVesting?: string
    micStaked?: string
    usdtBalance?: string
    bnbBalance?: string
    mfpNfts?: number
    builders?: number
    makers?: number
    luminaries?: number
    incomeUsdt?: {
      claimed?: string
      unclaimed?: string
    }
    incomeMic?: {
      claimed?: string
      unclaimed?: string
    }
  }
}

function fmt(n: number | string | undefined, fallback: string = '-'): string {
  if (n === undefined || n === null || n === '') return '-'
  const num = typeof n === 'string' ? parseFloat(n) : n
  if (isNaN(num)) return '-'
  if (num === 0) return '-'
  if (num >= 1_000_000_000) return (num / 1_000_000_000).toFixed(2) + 'B'
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + 'M'
  if (num >= 1_000) return num.toLocaleString('en-US')
  return num.toString()
}

function fmtUsd(n: number | string | undefined): string {
  if (n === undefined || n === null || n === '') return '-'
  const num = typeof n === 'string' ? parseFloat(n) : n
  if (isNaN(num) || num === 0) return '-'
  return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default function DashboardPage() {
  const { data: resp, loading } = useApi<DashboardData>('/dashboard/overview')
  const { address } = useAccount()
  const { data: bnbData } = useBalance({ address })

  // On-chain wallet data
  const [w, setW] = useState<NonNullable<WalletData['data']>>({})
  const [walletLoading, setWalletLoading] = useState(false)

  useEffect(() => {
    if (!address) return
    setWalletLoading(true)

    const fetchOnChain = async () => {
      try {
        // Network-aware RPC — resolved from NEXT_PUBLIC_CHAIN at build time.
        const { JsonRpcProvider } = await import('ethers')
        const provider = new JsonRpcProvider(ACTIVE_CHAIN.rpcUrls[0])

        // Create contract instances
        const mic = new Contract(CONTRACTS.mic, MIC_ABI, provider)
        const usdt = new Contract(CONTRACTS.usdt, ERC20_ABI, provider)
        const lockMgr = new Contract(CONTRACTS.lockManager, LOCK_MANAGER_ABI, provider)
        const mfpNft = new Contract(CONTRACTS.mfpNft, MFPNFT_ABI, provider)
        const communityNft = new Contract(CONTRACTS.communityNft, COMMUNITY_NFT_ABI, provider)

        // Fetch all data in parallel
        const [
          micBalance, usdtBalance, lockedAmount,
          mfpCount,
          builderCount, makerCount, luminaryCount,
        ] = await Promise.all([
          mic.balanceOf(address) as Promise<bigint>,
          usdt.balanceOf(address) as Promise<bigint>,
          lockMgr.lockedOf(address).catch(() => 0n) as Promise<bigint>,
          mfpNft.balanceOf(address).catch(() => 0n) as Promise<bigint>,
          communityNft.balanceOf(address, 1).catch(() => 0n) as Promise<bigint>,  // Builder = tier 1
          communityNft.balanceOf(address, 2).catch(() => 0n) as Promise<bigint>,  // Maker = tier 2
          communityNft.balanceOf(address, 3).catch(() => 0n) as Promise<bigint>,  // Luminary = tier 3
        ])

        const micTotal = Number(formatUnits(micBalance, 18))
        const locked = Number(formatUnits(lockedAmount, 18))
        const available = Math.max(0, micTotal - locked)
        const bnbBal = bnbData ? Number(bnbData.formatted) : 0

        setW({
          micTotal: micTotal.toString(),
          micAvailable: available.toString(),
          micVesting: locked.toString(),
          micStaked: '0', // TODO: read from MICStaking contract when deployed
          usdtBalance: formatUnits(usdtBalance, 6),
          bnbBalance: bnbBal.toFixed(4),
          mfpNfts: Number(mfpCount),
          builders: Number(builderCount),
          makers: Number(makerCount),
          luminaries: Number(luminaryCount),
        })
      } catch (err) {
        console.error('Error fetching on-chain wallet data:', err)
      } finally {
        setWalletLoading(false)
      }
    }

    fetchOnChain()
  }, [address, bnbData])

  const d = resp?.data || {}

  if (loading) return <LoadingSpinner />

  const micPrice = d.micPrice || '-'
  const emitted = parseFloat(d.totalEmitted || '0')
  const pool = d.miningPool || 0
  const emissionPct = pool > 0 && emitted > 0 ? ((emitted / pool) * 100).toFixed(2) : '-'
  const es = d.emissionSplit || {}

  return (
    <div className="dash-page">
      {/* Ambient background effects */}
      <div className="dash-bg-glow dash-bg-glow-1" />
      <div className="dash-bg-glow dash-bg-glow-2" />

      {/* ── Hero: Price + Quick Stats ── */}
      <div className="dash-hero">
        <div className="dash-hero-bg" />
        <div className="dash-hero-shine" />
        <div className="dash-hero-content">
          <div className="dash-hero-price">
            <div className="dash-hero-label">MIC Token Price</div>
            <div className="dash-hero-value">
              <span className="dash-hero-dollar">$</span>
              {micPrice}
            </div>
            <div className="dash-hero-glow-dot" />
          </div>
          <div className="dash-hero-meta">
            <div className="dash-hero-chip">
              <span className="chip-icon">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
              </span>
              <span className="chip-label">Users</span>
              <span className="chip-value">{fmt(d.totalUsers, '-')}</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Horizontal Scroll Stats ── */}
      <div className="dash-scroll-stats">
        <div className="scroll-stat gold">
          <div className="scroll-stat-icon-wrap gold">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
          </div>
          <div className="scroll-stat-info">
            <div className="scroll-stat-label">Circulating</div>
            <div className="scroll-stat-value">{fmt(d.circulatingSupply, '-')}</div>
            <div className="scroll-stat-sub">tradeable supply</div>
          </div>
        </div>
        <div className="scroll-stat purple">
          <div className="scroll-stat-icon-wrap purple">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v12M8 10h8M8 14h8"/></svg>
          </div>
          <div className="scroll-stat-info">
            <div className="scroll-stat-label">Pre-Issued</div>
            <div className="scroll-stat-value">{fmt(d.preIssued, '-')}</div>
            <div className="scroll-stat-sub">of {fmt(d.totalSupply, '-')} total</div>
          </div>
        </div>
        <div className="scroll-stat cyan">
          <div className="scroll-stat-icon-wrap cyan">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
          </div>
          <div className="scroll-stat-info">
            <div className="scroll-stat-label">Mined</div>
            <div className="scroll-stat-value">{fmt(d.totalEmitted, '-')}</div>
            <div className="scroll-stat-sub">{emissionPct}% emitted</div>
          </div>
        </div>
        <div className="scroll-stat teal">
          <div className="scroll-stat-icon-wrap teal">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 7l9-4 9 4v6c0 5-4 9-9 11-5-2-9-6-9-11V7z"/><path d="M9 11l2 2 4-4"/></svg>
          </div>
          <div className="scroll-stat-info">
            <div className="scroll-stat-label">Reserves</div>
            <div className="scroll-stat-value">{fmt(d.inContractReserves, '-')}</div>
            <div className="scroll-stat-sub">in contracts</div>
          </div>
        </div>
        <div className="scroll-stat teal">
          <div className="scroll-stat-icon-wrap teal">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9 0v4"/><line x1="12" y1="15" x2="12" y2="17"/></svg>
          </div>
          <div className="scroll-stat-info">
            <div className="scroll-stat-label">Vesting</div>
            <div className="scroll-stat-value">{fmt(d.vestingLocked, '-')}</div>
            <div className="scroll-stat-sub">cliff/monthly unlock</div>
          </div>
        </div>
        <div className="scroll-stat purple">
          <div className="scroll-stat-icon-wrap purple">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
          </div>
          <div className="scroll-stat-info">
            <div className="scroll-stat-label">Staked</div>
            <div className="scroll-stat-value">{fmt(d.totalStaked, '-')}</div>
          </div>
        </div>
        <div className="scroll-stat crimson">
          <div className="scroll-stat-icon-wrap crimson">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></svg>
          </div>
          <div className="scroll-stat-info">
            <div className="scroll-stat-label">Burned</div>
            <div className="scroll-stat-value">{fmt(d.totalBurned, '-')}</div>
          </div>
        </div>
      </div>

      {/* ── Mining Pool ── */}
      <div className="dash-emission">
        <div className="dash-emission-header">
          <div className="dash-emission-title-row">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
            <span className="dash-emission-title">Mining Pool</span>
          </div>
          <div className="dash-emission-stats">
            <span className="dash-emission-pct">{emissionPct}%</span>
            <span className="dash-emission-sub">emitted</span>
          </div>
        </div>
        <div className="progress-bar-wrap">
          <div className="progress-bar">
            <div
              className="progress-fill"
              style={{ width: `${Math.min(parseFloat(emissionPct) || 0, 100)}%` }}
            >
              <div className="progress-glow-tip" />
            </div>
          </div>
          <div className="progress-labels">
            <span>0</span>
            <span>{fmt(d.miningPool, '-')} MIC</span>
          </div>
        </div>
        {/* Quick stats: Active MICE + Daily Output */}
        <div className="em-quick-row">
          <div className="em-quick-chip">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="2"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>
            <span className="em-quick-label">Active MICE</span>
            <span className="em-quick-value">{fmt(d.activeMice, '-')}</span>
          </div>
          <div className="em-quick-chip">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--cyan)" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
            <span className="em-quick-label">Daily Output</span>
            <span className="em-quick-value em-quick-cyan">{fmt(d.dailyOutput, '-')}</span>
            <span className="em-quick-unit">MIC/day</span>
          </div>
        </div>
        <div className="emission-split">
          <div className="em-item em-gold">
            <div className="em-bar-wrap">
              <div className="em-bar em-bar-gold" style={{ height: `${es.miners ?? 0}%` }} />
            </div>
            <div className="em-pct">{es.miners ? `${es.miners}%` : '-'}</div>
            <div className="em-name">Miners</div>
          </div>
          <div className="em-item em-cyan">
            <div className="em-bar-wrap">
              <div className="em-bar em-bar-cyan" style={{ height: `${((es.staking ?? 0) / (es.miners || 60)) * 100}%` }} />
            </div>
            <div className="em-pct">{es.staking ? `${es.staking}%` : '-'}</div>
            <div className="em-name">Staking</div>
          </div>
          <div className="em-item em-purple">
            <div className="em-bar-wrap">
              <div className="em-bar em-bar-purple" style={{ height: `${((es.dao ?? 0) / (es.miners || 60)) * 100}%` }} />
            </div>
            <div className="em-pct">{es.dao ? `${es.dao}%` : '-'}</div>
            <div className="em-name">DAO</div>
          </div>
          <div className="em-item em-red">
            <div className="em-bar-wrap">
              <div className="em-bar em-bar-red" style={{ height: `${((es.burn ?? 0) / (es.miners || 60)) * 100}%` }} />
            </div>
            <div className="em-pct">{es.burn ? `${es.burn}%` : '-'}</div>
            <div className="em-name">Burn</div>
          </div>
        </div>
      </div>

      {/* ── Wallet Card ── */}
      <div className="dash-wallet-card">
        <div className="wallet-card-shine" />
        <div className="wallet-card-pattern" />
        <div className="wallet-card-header">
          <div className="wallet-card-title-row">
            <svg className="wallet-card-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4h-4z"/></svg>
            <span className="wallet-card-title">My Wallet</span>
          </div>
          <div className="wallet-card-addr">
            {address ? `${address.slice(0, 6)}...${address.slice(-4)}` : 'Not Connected'}
          </div>
        </div>
        {/* MIC Balance — Total (what MetaMask shows) */}
        <div className="wci-mic-total">
          <div className="wci-mic-total-left">
            <span className="wci-mic-total-label">MIC Balance</span>
            <span className="wci-mic-total-value">{fmt(w.micTotal, '-')}</span>
            <span className="wci-mic-total-hint">on your wallet</span>
          </div>
          <div className="wci-mic-total-logo">
            <img src="/images/mission-chain-logo-clear.png" alt="MIC" width="36" height="36" />
          </div>
        </div>

        {/* MIC Breakdown: Available / Vesting / Staked */}
        <div className="wallet-card-grid wallet-card-grid-3">
          <div className="wallet-card-item wci-highlight-gold">
            <div className="wci-top">
              <span className="wci-dot wci-dot-gold" />
              <span className="wci-label">Available</span>
            </div>
            <span className="wci-value wci-gold">{fmt(w.micAvailable, '-')}</span>
            <span className="wci-sub">freely transferable</span>
          </div>
          <div className="wallet-card-item">
            <div className="wci-top">
              <span className="wci-dot wci-dot-purple" />
              <span className="wci-label">Vesting</span>
            </div>
            <span className="wci-value">{fmt(w.micVesting, '-')}</span>
            <span className="wci-sub">auto-unlock</span>
          </div>
          <div className="wallet-card-item wci-highlight-cyan">
            <div className="wci-top">
              <span className="wci-dot wci-dot-cyan" />
              <span className="wci-label">Staked</span>
            </div>
            <span className="wci-value wci-cyan">{fmt(w.micStaked, '-')}</span>
            <span className="wci-sub">earning rewards</span>
          </div>
        </div>

        {/* Other Tokens */}
        <div className="wallet-card-section-label">Other Tokens</div>
        <div className="wallet-card-grid">
          <div className="wallet-card-item">
            <div className="wci-top">
              <span className="wci-dot wci-dot-cyan" />
              <span className="wci-label">USDT</span>
            </div>
            <span className="wci-value">{fmt(w.usdtBalance, '-')}</span>
          </div>
          <div className="wallet-card-item">
            <div className="wci-top">
              <span className="wci-dot wci-dot-cream" />
              <span className="wci-label">BNB</span>
            </div>
            <span className="wci-value">{fmt(w.bnbBalance, '-')}</span>
          </div>
        </div>

        {/* NFT Holdings */}
        <div className="wallet-card-section-label">NFT Holdings</div>
        <div className="wallet-card-grid wallet-card-grid-nft">
          <div className="wallet-card-item wci-nft wci-nft-mfp">
            <div className="wci-top">
              <span className="wci-nft-icon">👑</span>
              <span className="wci-label">MFP</span>
            </div>
            <span className="wci-value wci-gold">{w.mfpNfts || '-'}</span>
          </div>
          <div className="wallet-card-item wci-nft">
            <div className="wci-top">
              <span className="wci-nft-icon">🔨</span>
              <span className="wci-label">Builder</span>
            </div>
            <span className="wci-value">{w.builders || '-'}</span>
          </div>
          <div className="wallet-card-item wci-nft">
            <div className="wci-top">
              <span className="wci-nft-icon">⚙️</span>
              <span className="wci-label">Maker</span>
            </div>
            <span className="wci-value">{w.makers || '-'}</span>
          </div>
          <div className="wallet-card-item wci-nft">
            <div className="wci-top">
              <span className="wci-nft-icon">✨</span>
              <span className="wci-label">Luminary</span>
            </div>
            <span className="wci-value">{w.luminaries || '-'}</span>
          </div>
        </div>
      </div>

      {/* ── Income Cards ── */}
      <div className="dash-income-row">
        <div className="dash-income-card income-card-usdt">
          <div className="income-card-header">
            <div className="income-card-icon-wrap income-icon-gold">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
            </div>
            <div className="income-card-title">USDT Income</div>
          </div>
          <div className="income-card-claimed">
            <span className="income-claimed-label">Claimed</span>
            <span className="income-claimed-value income-gold">{fmtUsd(w.incomeUsdt?.claimed)}</span>
          </div>
          <div className="income-card-unclaimed">
            <div className="income-unclaimed-info">
              <span className="income-unclaimed-label">Unclaimed</span>
              <span className="income-unclaimed-value income-gold">{fmtUsd(w.incomeUsdt?.unclaimed)}</span>
            </div>
            <button className="btn-claim btn-claim-gold" disabled={parseFloat(w.incomeUsdt?.unclaimed || '0') <= 0}>
              Claim
            </button>
          </div>
        </div>
        <div className="dash-income-card income-card-mic">
          <div className="income-card-header">
            <div className="income-card-icon-wrap income-icon-cyan">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v12M8 10h8M8 14h8"/></svg>
            </div>
            <div className="income-card-title">MIC Income</div>
          </div>
          <div className="income-card-claimed">
            <span className="income-claimed-label">Claimed</span>
            <span className="income-claimed-value income-cyan">{fmt(w.incomeMic?.claimed, '-')}</span>
          </div>
          <div className="income-card-unclaimed">
            <div className="income-unclaimed-info">
              <span className="income-unclaimed-label">Unclaimed</span>
              <span className="income-unclaimed-value income-cyan">{fmt(w.incomeMic?.unclaimed, '-')}</span>
            </div>
            <button className="btn-claim btn-claim-cyan" disabled={parseFloat(w.incomeMic?.unclaimed || '0') <= 0}>
              Claim
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
