'use client'

import { useState, useCallback } from 'react'
import { useAccount } from 'wagmi'
import { BrowserProvider, Contract, parseUnits } from 'ethers'
import SubNav, { SALES_TABS } from '@/components/layout/SubNav'
import { useApi } from '@/hooks/useApi'
import LoadingSpinner from '@/components/ui/LoadingSpinner'
import { CONTRACTS, ERC20_ABI, PRESALE_ABI } from '@/lib/contracts'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'

interface PresaleData {
  data?: {
    raised?: number
    target?: number
    pctRaised?: number
    referralF1?: string
    referralF2?: string
    orders?: Array<{
      date: string
      package: string
      mic: string
      nft: string
      status: string
      memberId?: string
      unlockedPct?: number
      nextUnlock?: string | null
      txHash?: string | null
    }>
    vestingPct?: number
    nextUnlock?: string
  }
}

const PACKAGES = [
  {
    name: 'BUILDER PACKAGE',
    price: '$1,000',
    mic: '200,000 MIC',
    nftQty: 1,
    nftType: 'Builder NFT',
    tier: 'builder',
    color: '#4CAF50',
  },
  {
    name: 'MAKER PACKAGE',
    price: '$2,500',
    mic: '500,000 MIC',
    nftQty: 1,
    nftType: 'Maker NFT',
    tier: 'maker',
    color: '#9B4DB5',
  },
  {
    name: 'LUMINARY PACKAGE',
    price: '$5,000',
    mic: '1,000,000 MIC',
    nftQty: 1,
    nftType: 'Luminary NFT',
    tier: 'luminary',
    color: '#C9A84C',
  },
]

export default function PresalePage() {
  const { address } = useAccount()
  const { data, loading, refetch } = useApi<PresaleData>('/sales/presale/info')
  const [customAmount, setCustomAmount] = useState('')
  const d = data?.data || {}
  const pct = d.pctRaised || 0
  const customMic = customAmount ? Math.floor(Number(customAmount) / 0.005) : 0

  // Buy state
  const [buyingIndex, setBuyingIndex] = useState<number | null>(null) // 0=custom, 1/2/3=package
  const [buyStatus, setBuyStatus] = useState('')
  const [buyError, setBuyError] = useState('')
  const [successPopup, setSuccessPopup] = useState<{
    show: boolean
    txHash: string
    label: string
    mic: number
    usdt: number
    nftBonus?: string | null
  } | null>(null)

  const handleBuy = useCallback(
    async (packageIndex: number, usdtAmount: number, label: string, nftBonus?: string | null) => {
      setBuyError('')
      if (!address) {
        setBuyError('Please connect your wallet first.')
        return
      }
      if (typeof window === 'undefined' || !(window as any).ethereum) {
        setBuyError('No wallet detected. Please install MetaMask.')
        return
      }
      setBuyingIndex(packageIndex)
      try {
        setBuyStatus('Connecting wallet...')
        const provider = new BrowserProvider((window as any).ethereum)
        await provider.send('eth_requestAccounts', [])
        const signer = await provider.getSigner()
        const signerAddr = (await signer.getAddress()).toLowerCase()
        if (signerAddr !== address.toLowerCase()) {
          throw new Error('Wallet account mismatch — switch MetaMask account to match.')
        }

        const usdt = new Contract(CONTRACTS.usdt, ERC20_ABI, signer)
        const presale = new Contract(CONTRACTS.presale, PRESALE_ABI as any, signer)
        const usdtAddr = CONTRACTS.usdt
        const presaleAddr = CONTRACTS.presale

        const usdtWei = parseUnits(usdtAmount.toString(), 6)
        const gasPrice = parseUnits('5', 'gwei')

        // Step 1: Check + approve USDT (exact amount)
        setBuyStatus('Checking allowance...')
        const allowance = (await usdt.allowance(signerAddr, presaleAddr)) as bigint
        if (allowance < usdtWei) {
          setBuyStatus('Approving USDT,\nconfirm in wallet!')
          const approveTx = await usdt.approve(presaleAddr, usdtWei, { gasPrice })
          setBuyStatus('Waiting for approval...')
          await approveTx.wait(2)
          await new Promise((r) => setTimeout(r, 3000))
        }

        // Step 2: Call PreSale.buy(usdtAmount, packageIndex)
        setBuyStatus('Confirm purchase\nin wallet!')
        const buyTx = await presale.buy(usdtWei, BigInt(packageIndex), {
          gasLimit: 1_500_000n,
          gasPrice,
        })
        setBuyStatus('Waiting for confirmation...')
        const receipt = await buyTx.wait(2)
        if (!receipt || receipt.status !== 1) throw new Error('Transaction reverted on-chain')
        const txHash = receipt.hash

        // Step 3: Notify backend
        setBuyStatus('Recording purchase...')
        try {
          const jwt = typeof window !== 'undefined' ? localStorage.getItem('mc-jwt') : null
          const micAmount = usdtAmount * 200 // 1 USDT = 200 MIC
          await fetch(`${API_BASE}/sales/presale/record-onchain`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
            },
            body: JSON.stringify({
              txHash,
              packageIndex,
              usdtAmount,
              micAmount,
              blockNumber: receipt.blockNumber,
            }),
          })
        } catch (dbErr) {
          // On-chain succeeded; DB record is best-effort
          console.warn('Failed to record purchase in DB (on-chain succeeded):', dbErr)
        }

        // Show success popup
        setSuccessPopup({
          show: true,
          txHash,
          label,
          mic: usdtAmount * 200,
          usdt: usdtAmount,
          nftBonus,
        })
        setBuyStatus('')
        setBuyingIndex(null)
        setCustomAmount('')
        refetch?.()
      } catch (e: any) {
        const code = e?.code
        const friendly =
          code === 4001 || code === 'ACTION_REJECTED'
            ? 'Transaction rejected in wallet'
            : e?.shortMessage || e?.message || 'Unknown error'
        setBuyError('Pre-Sale buy failed: ' + friendly)
        setBuyStatus('')
        setBuyingIndex(null)
      }
    },
    [address, refetch],
  )

  const PACKAGE_PRICE_USD = [0, 1000, 2500, 5000] // index 0 = custom (variable)
  const PACKAGE_NFT_TIER = [null, 'Builder', 'Maker', 'Luminary']

  return (
    <>
      <SubNav items={SALES_TABS} />
      {loading ? <LoadingSpinner /> : null}
      <div className="pre-page">
        {/* ── Hero Fundraise Card (mirror SEED layout: tagline + 4 stats + features) ── */}
        <div className="pre-hero">
          <div className="pre-hero-bg" />
          <div className="pre-hero-shine" />
          <div className="pre-hero-content">
            <div className="pre-hero-top">
              <div className="pre-hero-left">
                <div className="pre-hero-badge">
                  <span className="pre-hero-emoji">&#x1F680;</span>
                </div>
                <div>
                  <div className="pre-hero-label">PRE-SALE ROUND — PUBLIC</div>
                  <div className="pre-hero-title">Mission Chain</div>
                  <div className="pre-hero-verse">
                    <em>&ldquo;For we walk by faith, not by sight.&rdquo;</em>
                    <span className="pre-hero-verse-ref">— 2 Corinthians 5:7</span>
                  </div>
                </div>
              </div>
              <div className="pre-hero-price">$0.005<span className="pre-hero-price-unit">/MIC</span></div>
            </div>

            {/* 4 stat cards (mirror SEED's stats row) */}
            <div className="pre-stats-row" style={{ marginTop: 8 }}>
              <div className="pre-stat">
                <div className="pre-stat-value">$25</div>
                <div className="pre-stat-label">MIN BUY</div>
              </div>
              <div className="pre-stat">
                <div className="pre-stat-value">
                  {d.raised ? (d.raised / 0.005).toLocaleString() : '0'}
                </div>
                <div className="pre-stat-label">SOLD (MIC)</div>
              </div>
              <div className="pre-stat">
                <div className="pre-stat-value">315M</div>
                <div className="pre-stat-label">MIC ALLOCATION</div>
              </div>
              <div className="pre-stat">
                <div className="pre-stat-value">3</div>
                <div className="pre-stat-label">NFT BONUS TIERS</div>
              </div>
            </div>
          </div>
        </div>

        {/* ── 4 feature cards (mirror SEED bottom features) ── */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
            gap: 12,
            marginBottom: 16,
          }}
        >
          <FeatureCard icon="💰" title="$0.005/MIC" desc="2× SEED price, public access" />
          <FeatureCard icon="🎁" title="Community NFT Bonus" desc="Builder / Maker / Luminary tiers" />
          <FeatureCard icon="🔒" title="Vesting Protected" desc="6-month cliff, gradual unlock" />
          <FeatureCard icon="✨" title="Referral Active" desc="F1 7% + F2 3% USDT instant" />
        </div>

        {/* ── Referral Section ── */}
        <div className="pre-referral">
          <div className="pre-referral-bg" />
          <div className="pre-referral-content">
            <div className="pre-referral-header">
              <span className="pre-referral-icon">&#x1F517;</span>
              <span className="pre-referral-title">Referral Program</span>
              <span className="pre-referral-badge-live">ACTIVE</span>
            </div>
            <div className="pre-referral-chips">
              <div className="pre-referral-chip">
                <div className="pre-referral-chip-label">F1 Direct</div>
                <div className="pre-referral-chip-value">7% <span className="pre-referral-usdt">USDT</span></div>
              </div>
              <div className="pre-referral-chip">
                <div className="pre-referral-chip-label">F2 Indirect</div>
                <div className="pre-referral-chip-value">3% <span className="pre-referral-usdt">USDT</span></div>
              </div>
            </div>
            <div className="pre-referral-note">Paid instantly on-chain</div>
          </div>
        </div>

        {/* ── Package Cards ── */}
        <div className="pre-section-header">
          <span className="pre-section-icon">&#x1F4E6;</span>
          <span className="pre-section-title">Pre-Sale Packages</span>
        </div>

        <div className="pre-packages">
          {PACKAGES.map((pkg) => (
            <div className={`pre-pkg pre-pkg-${pkg.tier}`} key={pkg.tier}>
              <div
                className="pre-pkg-nft-badge"
                style={{ background: `${pkg.color}22`, borderColor: `${pkg.color}55`, color: pkg.color }}
              >
                {pkg.name}
              </div>
              <div className="pre-pkg-price">{pkg.price}</div>
              <div className="pre-pkg-divider" />
              <div className="pre-pkg-row">
                <span className="pre-pkg-icon">{'\u{1F48E}'}</span>
                <span className="pre-pkg-text">
                  <strong>{pkg.mic}</strong>
                </span>
              </div>
              <div className="pre-pkg-row">
                <span className="pre-pkg-icon">{'\u{1F381}'}</span>
                <span className="pre-pkg-text">
                  + <strong>{pkg.nftQty}</strong> {pkg.nftType} bonus
                </span>
              </div>
              <button
                className={`pre-pkg-btn pre-pkg-btn-${pkg.tier}`}
                disabled={buyingIndex !== null}
                onClick={() => {
                  // pkg.tier maps: builder=1, maker=2, luminary=3
                  const idx = pkg.tier === 'builder' ? 1 : pkg.tier === 'maker' ? 2 : 3
                  handleBuy(idx, PACKAGE_PRICE_USD[idx], pkg.name, PACKAGE_NFT_TIER[idx])
                }}
              >
                {buyingIndex === (pkg.tier === 'builder' ? 1 : pkg.tier === 'maker' ? 2 : 3) ? (
                  <span style={{ whiteSpace: 'pre-line', fontSize: '0.8em' }}>{buyStatus || 'Processing...'}</span>
                ) : (
                  'Buy Package'
                )}
              </button>
            </div>
          ))}
        </div>

        {/* Buy error banner */}
        {buyError && (
          <div style={{
            margin: '12px 0',
            padding: '10px 14px',
            background: 'rgba(229,57,53,0.1)',
            border: '1px solid rgba(229,57,53,0.4)',
            borderRadius: 8,
            color: '#FCB5B3',
            fontSize: '0.78rem',
            lineHeight: 1.5,
          }}>
            ⚠ {buyError}
          </div>
        )}

        {/* ── Custom Amount ── */}
        <div className="pre-custom-card">
          <div className="pre-section-header" style={{ marginBottom: 16 }}>
            <span className="pre-section-icon">&#x270F;</span>
            <span className="pre-section-title">Custom Amount</span>
          </div>
          <div className="pre-custom-note">No package required. Min $25 purchase.</div>
          <div className="pre-custom-input-row">
            <div className="pre-custom-input-wrap">
              <span className="pre-custom-input-prefix">$</span>
              <input
                type="number"
                className="pre-custom-input"
                placeholder="Enter amount (min $25)"
                min={25}
                value={customAmount}
                onChange={(e) => setCustomAmount(e.target.value)}
              />
            </div>
            <button
              className="pre-custom-btn"
              disabled={!customAmount || Number(customAmount) < 25 || buyingIndex !== null}
              onClick={() => {
                const amt = Number(customAmount)
                if (!amt || amt < 25) return
                handleBuy(0, amt, `Custom $${amt.toLocaleString()}`, null)
              }}
            >
              {buyingIndex === 0 ? (
                <span style={{ whiteSpace: 'pre-line', fontSize: '0.85em' }}>{buyStatus || 'Processing...'}</span>
              ) : (
                'Buy MIC'
              )}
            </button>
          </div>
          {customMic > 0 && (
            <div className="pre-custom-result">
              You receive: <strong>{customMic.toLocaleString()} MIC</strong>
            </div>
          )}
        </div>

        {/* ── My Orders ── */}
        <div className="pre-orders-card">
          <div className="pre-section-header">
            <span className="pre-section-icon">&#x1F4CB;</span>
            <span className="pre-section-title">My Pre-Sale Orders</span>
          </div>
          <div className="pre-vesting-info" style={{ marginBottom: 12, opacity: 0.7 }}>
            Vesting: 10% cliff after 6 months, then +2.5%/month per order
          </div>

          {/* Desktop table */}
          <div className="pre-orders-table">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Member ID</th>
                  <th>Package</th>
                  <th>MIC</th>
                  <th>NFT Bonus</th>
                  <th>Unlocked</th>
                  <th>Next Unlock</th>
                  <th>Status</th>
                  <th>TX</th>
                </tr>
              </thead>
              <tbody>
                {(d.orders || []).length === 0 ? (
                  <tr><td colSpan={9} className="pre-orders-empty">No orders yet</td></tr>
                ) : d.orders!.map((o, i) => (
                  <tr key={i}>
                    <td>{o.date}</td>
                    <td>{o.memberId || '-'}</td>
                    <td>{o.package}</td>
                    <td className="pre-orders-bold">{o.mic}</td>
                    <td>{o.nft || '-'}</td>
                    <td>{typeof o.unlockedPct === 'number' ? `${o.unlockedPct}%` : '-'}</td>
                    <td>{o.nextUnlock || '—'}</td>
                    <td><span className="pre-badge-success">{o.status}</span></td>
                    <td>
                      {o.txHash ? (
                        <a
                          href={`https://bscscan.com/tx/${o.txHash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ color: 'var(--gold)', fontFamily: 'var(--font-m)', fontSize: '0.7em' }}
                        >
                          {o.txHash.slice(0, 6)}...{o.txHash.slice(-4)} ↗
                        </a>
                      ) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile card list */}
          <div className="pre-orders-cards">
            {(d.orders || []).length === 0 ? (
              <div className="pre-orders-empty-card">No orders yet</div>
            ) : d.orders!.map((o, i) => (
              <div className="pre-order-card" key={i}>
                <div className="pre-order-card-top">
                  <span className="pre-order-card-pkg">{o.package || 'Custom'}</span>
                  <span className="pre-badge-success">{o.status}</span>
                </div>
                <div className="pre-order-card-row">
                  <span className="pre-order-card-label">Date</span>
                  <span>{o.date}</span>
                </div>
                <div className="pre-order-card-row">
                  <span className="pre-order-card-label">Member ID</span>
                  <span>{o.memberId || '-'}</span>
                </div>
                <div className="pre-order-card-row">
                  <span className="pre-order-card-label">MIC</span>
                  <span className="pre-orders-bold">{o.mic}</span>
                </div>
                <div className="pre-order-card-row">
                  <span className="pre-order-card-label">NFT Bonus</span>
                  <span>{o.nft || '-'}</span>
                </div>
                <div className="pre-order-card-row">
                  <span className="pre-order-card-label">Unlocked</span>
                  <span>{typeof o.unlockedPct === 'number' ? `${o.unlockedPct}%` : '-'}</span>
                </div>
                <div className="pre-order-card-row">
                  <span className="pre-order-card-label">Next Unlock</span>
                  <span>{o.nextUnlock || '—'}</span>
                </div>
                <div className="pre-order-card-row">
                  <span className="pre-order-card-label">TX</span>
                  <span>
                    {o.txHash ? (
                      <a
                        href={`https://bscscan.com/tx/${o.txHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: 'var(--gold)', fontFamily: 'var(--font-m)' }}
                      >
                        {o.txHash.slice(0, 6)}...{o.txHash.slice(-4)} ↗
                      </a>
                    ) : '—'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Success Popup (mirror SEED page style) ── */}
      {successPopup?.show && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 9999,
            background: 'rgba(0,0,0,0.7)',
            backdropFilter: 'blur(6px)',
            WebkitBackdropFilter: 'blur(6px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 16,
          }}
          onClick={() => setSuccessPopup(null)}>
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 'min(440px, 100%)',
              background: 'linear-gradient(135deg, #1a0b2e 0%, #050210 100%)',
              border: '1px solid rgba(212,160,23,0.35)',
              borderRadius: 16,
              padding: 28,
              boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
              color: '#E8D8B8', textAlign: 'center',
            }}>
            <div style={{ fontSize: 48, marginBottom: 8 }}>{'\u{1F389}'}</div>
            <h2 style={{
              margin: '0 0 6px 0', fontSize: '1.2rem', fontWeight: 700,
              color: 'var(--gold)', fontFamily: 'var(--font-d)',
            }}>Pre-Sale Purchase Complete</h2>
            <p style={{ fontSize: '0.78rem', color: '#A89878', margin: '0 0 18px 0', fontStyle: 'italic' }}>
              {successPopup.label}
            </p>
            <div style={{
              padding: '14px 16px', marginBottom: 16,
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.06)',
              borderRadius: 10, textAlign: 'left',
            }}>
              <Row label="Paid" value={`$${successPopup.usdt.toLocaleString()} USDT`} />
              <Row label="Received" value={`${successPopup.mic.toLocaleString()} MIC`} highlight />
              {successPopup.nftBonus && (
                <Row label="NFT Bonus" value={`1× ${successPopup.nftBonus} NFT`} />
              )}
            </div>
            <a
              href={`https://bscscan.com/tx/${successPopup.txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'inline-block', marginBottom: 14,
                fontSize: '0.7rem', color: 'var(--gold)', textDecoration: 'none',
                fontFamily: 'var(--font-m)',
              }}>
              View tx: {successPopup.txHash.slice(0, 10)}...{successPopup.txHash.slice(-6)} {'↗'}
            </a>
            <div>
              <button
                onClick={() => setSuccessPopup(null)}
                style={{
                  width: '100%', padding: '12px 0',
                  background: 'linear-gradient(135deg, var(--gold), #b8942f)',
                  color: '#000', border: 'none', borderRadius: 10,
                  fontWeight: 700, fontSize: '0.85rem', cursor: 'pointer',
                  fontFamily: 'var(--font-d)', letterSpacing: '0.04em',
                }}>
                Got it
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function Row({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between',
      padding: '6px 0',
      borderBottom: '1px solid rgba(255,255,255,0.04)',
      fontSize: '0.78rem',
    }}>
      <span style={{ color: '#A89878' }}>{label}</span>
      <span style={{
        color: highlight ? 'var(--gold)' : '#E8D8B8',
        fontWeight: highlight ? 800 : 600,
      }}>{value}</span>
    </div>
  )
}

function FeatureCard({ icon, title, desc }: { icon: string; title: string; desc: string }) {
  return (
    <div
      style={{
        padding: '14px 16px',
        borderRadius: 14,
        background: 'rgba(40, 26, 58, 0.55)',
        border: '1px solid rgba(212, 160, 23, 0.25)',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
      }}
      className="pre-feature-card"
    >
      <div style={{ fontSize: '1.4rem', flexShrink: 0 }}>{icon}</div>
      <div>
        <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#F5D56E' }} className="pre-feature-title">{title}</div>
        <div style={{ fontSize: '0.65rem', color: '#D4C098', marginTop: 2 }} className="pre-feature-desc">{desc}</div>
      </div>
    </div>
  )
}
