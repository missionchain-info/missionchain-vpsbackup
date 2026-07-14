'use client'

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAccount, useConnect, useDisconnect, useSignMessage } from 'wagmi'
import { useTheme } from '@/hooks/useTheme'
import { useApi } from '@/hooks/useApi'
import { api, authApi } from '@/lib/api'
import { fmtCompact, fmtUsd } from '@missionchain/sdk'

interface DashboardOverview {
  data: {
    micPrice?: string
    totalSupply?: number
    preIssued?: number
    miningPool?: number
    circulatingSupply?: string
    totalStaked?: string
    totalBurned?: string
    totalEmitted?: string
    mfpMinted?: number
    communityNfts?: number
    activeMice?: number
    totalUsers?: number
  }
}

// No more hardcoded constants — all from API/DB; formatters live in @missionchain/sdk.

export default function LandingPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { address, isConnected } = useAccount()
  const { connectAsync, connectors } = useConnect()
  const { disconnectAsync } = useDisconnect()
  const { signMessageAsync } = useSignMessage()
  const { toggleTheme, isDark } = useTheme()
  const { data: resp } = useApi<DashboardOverview>('/dashboard/overview')
  const stats = resp?.data

  const [connecting, setConnecting] = useState(false)

  // Auto-redirect if already authenticated
  useEffect(() => {
    const jwt = typeof window !== 'undefined' ? localStorage.getItem('mc-jwt') : null
    if (jwt && isConnected && address) {
      router.push('/dashboard')
    }
  }, [isConnected, address, router])

  // ── Check membership → sign → get JWT → redirect ──
  const checkAndRedirect = async (walletAddress: string) => {
    try {
      const res = await api<{ nonce: string; userId: string }>(`/auth/nonce?wallet=${walletAddress}`)
      if (res.nonce) {
        const message = `Mission Chain Authentication\nNonce: ${res.nonce}`
        const signature = await signMessageAsync({ message })
        const verifyRes = await authApi.verify({ wallet: walletAddress, signature })
        localStorage.setItem('mc-jwt', verifyRes.jwt)
        localStorage.setItem('mc-userId', verifyRes.user.userId)
        localStorage.setItem('mc-wallet', verifyRes.user.wallet)
        router.push('/dashboard')
      }
    } catch (err: any) {
      if (err?.message?.includes('NOT_FOUND') || err?.message?.includes('not found') || err?.message?.includes('Request failed')) {
        const ref = searchParams.get('ref')
        router.push(ref ? `/register?ref=${encodeURIComponent(ref)}` : '/register')
      } else {
        console.error('Auth failed:', err)
      }
    } finally {
      setConnecting(false)
    }
  }

  // ── CONNECT WALLET FLOW ──
  // ALWAYS: open wallet picker → connect → check membership → redirect
  const handleConnect = async () => {
    // Save connector reference BEFORE disconnect
    const connector = connectors[0]
    if (!connector) {
      window.open('https://metamask.io/download/', '_blank')
      return
    }

    setConnecting(true)
    try {
      // If already connected (auto-reconnect), use existing address
      let walletAddress = address
      if (!isConnected || !walletAddress) {
        try { await disconnectAsync() } catch {}
        await new Promise(r => setTimeout(r, 200))
        const result = await connectAsync({ connector })
        walletAddress = result.accounts[0]
      }

      if (!walletAddress) return

      await checkAndRedirect(walletAddress)
    } catch (err) {
      console.error('Connect failed:', err)
    } finally {
      setConnecting(false)
    }
  }

  return (
    <div className="screen screen-landing">
      <button className="theme-toggle" onClick={toggleTheme}>
        {isDark ? '🌙' : '☀'}
      </button>

      <div className="landing-content">
        {/* ── Logo with orbiting circles ── */}
        <div className="orbit-logo">
          <div className="orbit-ring orbit-ring-1"><div className="orbit-dot" /></div>
          <div className="orbit-ring orbit-ring-2"><div className="orbit-dot" /><div className="orbit-dot orbit-dot-opposite" /></div>
          <div className="orbit-ring orbit-ring-3"><div className="orbit-dot" /></div>
          <img src="/images/mission-chain-logo-clear.png" alt="Mission Chain" />
        </div>

        <h1 className="landing-title">MISSION CHAIN</h1>
        <p className="landing-subtitle">WEB3 &middot; CREATOR ECONOMY</p>
        <p className="landing-tagline">&ldquo;Inspired by Faith. Built for People.&rdquo;</p>
        <p className="landing-verse">&#10022; You are the light of the world. A city on a hill cannot be hidden. &mdash; Matthew 5:14 &#10022;</p>

        {/* ── White Paper link ── */}
        <div className="landing-whitepaper">
          <a
            href="https://missionchain.io/documents/White_Paper.html"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-secondary btn-sm"
          >
            Read White Paper
          </a>
        </div>

        {/* ── Combined Stats Card ── */}
        <div className="land-card">
          <div className="land-card-shine" />
          <div className="land-card-header">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
            <span className="land-card-title">MIC Token</span>
            <span className="land-card-badge">BEP-20 on BSC</span>
          </div>

          {/* Row 1: Fixed tokenomics */}
          <div className="land-row land-row-fixed">
            <div className="land-cell">
              <div className="land-cell-label">Total Supply</div>
              <div className="land-cell-value">{fmtCompact(stats?.totalSupply)}</div>
              <div className="land-cell-tag fixed">Fixed</div>
            </div>
            <div className="land-divider" />
            <div className="land-cell">
              <div className="land-cell-label">Pre-Issued (15%)</div>
              <div className="land-cell-value">{fmtCompact(stats?.preIssued)}</div>
              <div className="land-cell-tag fixed">Fixed</div>
            </div>
            <div className="land-divider" />
            <div className="land-cell">
              <div className="land-cell-label">Mining Cap (85%)</div>
              <div className="land-cell-value">{fmtCompact(stats?.miningPool)}</div>
              <div className="land-cell-tag fixed">Fixed</div>
            </div>
          </div>

          {/* Row 2: Live data */}
          <div className="land-row land-row-live">
            <div className="land-cell">
              <div className="land-cell-label">
                <span className="land-live-dot" />
                MIC Price
              </div>
              <div className="land-cell-value gold">{fmtUsd(stats?.micPrice, 4)}</div>
            </div>
            <div className="land-cell">
              <div className="land-cell-label">
                <span className="land-live-dot" />
                Circulating
              </div>
              <div className="land-cell-value gold">{fmtCompact(stats?.circulatingSupply)}</div>
            </div>
            <div className="land-cell">
              <div className="land-cell-label">
                <span className="land-live-dot" />
                Total Burned
              </div>
              <div className="land-cell-value gold">{fmtCompact(stats?.totalBurned)}</div>
            </div>
            <div className="land-cell">
              <div className="land-cell-label">
                <span className="land-live-dot" />
                Total Staked
              </div>
              <div className="land-cell-value gold">{fmtCompact(stats?.totalStaked)}</div>
            </div>
          </div>

          {/* Row 3: Wallet integration shortcuts */}
          <div
            style={{
              display: 'flex',
              gap: 10,
              flexWrap: 'wrap',
              marginTop: 14,
              paddingTop: 14,
              borderTop: '1px solid rgba(212,160,23,0.15)',
            }}
          >
            <a
              href={`https://bscscan.com/address/0xf27ec0c311728b923b22828002c992c799326182`}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                flex: 1,
                minWidth: 160,
                padding: '10px 14px',
                fontSize: 12,
                textAlign: 'center',
                background: 'rgba(212,160,23,0.08)',
                border: '1px solid rgba(212,160,23,0.4)',
                color: '#F5D56E',
                borderRadius: 8,
                textDecoration: 'none',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                fontWeight: 600,
              }}
            >
              <span>📜</span> Smart Contract (MIC)
            </a>
            <button
              onClick={async () => {
                const eth = (typeof window !== 'undefined' && (window as any).ethereum) || null
                if (!eth) { alert('No wallet detected. Please install MetaMask or compatible wallet.'); return }
                try {
                  await eth.request({
                    method: 'wallet_watchAsset',
                    params: {
                      type: 'ERC20',
                      options: {
                        address: '0xf27ec0c311728b923b22828002c992c799326182',
                        symbol: 'MIC',
                        decimals: 18,
                        image: 'https://app.missionchain.io/icon.png',
                      },
                    },
                  })
                } catch (e: any) {
                  if (e?.code !== 4001) console.error('Add to wallet failed:', e)
                }
              }}
              style={{
                flex: 1,
                minWidth: 160,
                padding: '10px 14px',
                fontSize: 12,
                background: 'rgba(155, 91, 201, 0.12)',
                border: '1px solid rgba(155, 91, 201, 0.5)',
                color: '#C9A4E6',
                borderRadius: 8,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                fontWeight: 600,
                fontFamily: 'inherit',
              }}
            >
              <span>➕</span> Add to Wallet (BEP20)
            </button>
          </div>
        </div>

        {/* ── Ecosystem Stats Card ── */}
        <div className="land-card land-card-eco">
          <div className="land-card-header">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--purple2)" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
            <span className="land-card-title">Ecosystem</span>
            <span className="land-card-badge live">Live</span>
          </div>
          <div className="land-eco-grid">
            <div className="land-eco-item">
              <div className="land-eco-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
              </div>
              <div className="land-eco-val">{fmtCompact(stats?.totalUsers)}</div>
              <div className="land-eco-lbl">Members</div>
            </div>
            <div className="land-eco-item">
              <div className="land-eco-icon purple">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--purple2)" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><path d="M12 8v8"/><path d="M8 12h8"/></svg>
              </div>
              <div className="land-eco-val">{fmtCompact(stats?.activeMice)}</div>
              <div className="land-eco-lbl">Active MICE</div>
            </div>
            <div className="land-eco-item">
              <div className="land-eco-icon gold">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
              </div>
              <div className="land-eco-val">{fmtCompact(stats?.mfpMinted)}<span className="land-eco-cap"> / 2.5K</span></div>
              <div className="land-eco-lbl">MFP-NFT Minted</div>
            </div>
            <div className="land-eco-item">
              <div className="land-eco-icon cyan">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--cyan)" strokeWidth="2"><path d="M20.24 12.24a6 6 0 0 0-8.49-8.49L5 10.5V19h8.5z"/><line x1="16" y1="8" x2="2" y2="22"/><line x1="17.5" y1="15" x2="9" y2="15"/></svg>
              </div>
              <div className="land-eco-val">{fmtCompact(stats?.communityNfts)}</div>
              <div className="land-eco-lbl">Community NFTs</div>
            </div>
          </div>
        </div>

        {/* ── App Introduction ── */}
        <div className="landing-app-intro">
          <h2 className="app-intro-title">MISSION CHAIN APPLICATION</h2>
          <p className="app-intro-text">
            Your gateway to the faith-powered Web3 ecosystem on BNB Smart Chain.
            Purchase MIC tokens, acquire MICE mining licenses, stake for rewards,
            and participate in DAO governance.
          </p>
        </div>

        {/* ── Connect Wallet CTA ── */}
        <div className="landing-connect">
          <button className="btn btn-primary btn-lg" onClick={handleConnect} disabled={connecting}>
            {connecting ? 'Connecting...' : 'Connect Wallet'}
          </button>
          <p className="connect-hint">
            Connect your wallet to get started. Supports MetaMask, Trust Wallet,
            SafePal, TokenPocket, Bitget Wallet, and other BNB Smart Chain compatible wallets.
          </p>
        </div>
      </div>
    </div>
  )
}
