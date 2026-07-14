'use client'

import { useState } from 'react'
import Link from 'next/link'
import SubNav, { SALES_TABS } from '@/components/layout/SubNav'
import { useApi } from '@/hooks/useApi'
import LoadingSpinner from '@/components/ui/LoadingSpinner'
import { useAccount } from 'wagmi'
import { ethers } from 'ethers'
import { CONTRACTS, USDT_ABI, MICE_ABI } from '@/lib/contracts'

interface MiceData {
  data?: {
    totalSold?: number
    currentRound?: number
    currentPrice?: number
    referralF1Total?: string
    referralF2Total?: string
    referralF1Count?: number
    referralF2Count?: number
    myF1Volume?: string
    myF2Volume?: string
  }
}

const ROUNDS = [
  { num: 1, price: 100, range: '0 – 20K',     label: 'Early' },
  { num: 2, price: 200, range: '20K – 40K',   label: 'Growth' },
  { num: 3, price: 300, range: '40K – 60K',   label: 'Expansion' },
  { num: 4, price: 400, range: '60K – 80K',   label: 'Mature' },
  { num: 5, price: 500, range: '80K – 100K',  label: 'Premium' },
]

const fmt = (n: number | undefined | string | null) => {
  if (n == null || n === '') return '-'
  const v = typeof n === 'string' ? parseFloat(n) : n
  return isNaN(v) ? '-' : v.toLocaleString()
}

export default function MiceLicensesPage() {
  const { data: resp, loading } = useApi<MiceData>('/sales/mice/info')
  const d = resp?.data ?? {}
  const { address } = useAccount()

  const totalSold = d.totalSold ?? 0
  const curRound = d.currentRound ?? 1
  const curPrice = d.currentPrice ?? 100
  const roundSold = totalSold - (curRound - 1) * 20_000

  const [buying, setBuying] = useState(false)
  const [buyResult, setBuyResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const [customQty, setCustomQty] = useState('')

  const handleBuy = async (priceUsdt: number) => {
    if (!address) {
      setBuyResult({ ok: false, msg: 'Connect your wallet first' })
      return
    }
    setBuying(true)
    setBuyResult(null)
    try {
      const eth = (window as any).ethereum
      if (!eth) throw new Error('No wallet provider detected')
      const provider = new ethers.BrowserProvider(eth)
      const signer = await provider.getSigner()
      const usdt = new ethers.Contract(CONTRACTS.usdt, USDT_ABI, signer)
      const mice = new ethers.Contract(CONTRACTS.mice, MICE_ABI, signer)
      const amt = ethers.parseUnits(priceUsdt.toString(), 6)
      const allowance: bigint = await usdt.allowance(address, CONTRACTS.mice)
      if (allowance < amt) {
        const ap = await usdt.approve(CONTRACTS.mice, amt)
        await ap.wait()
      }
      const tx = await mice.buy()
      const r = await tx.wait()
      setBuyResult({ ok: true, msg: 'MICE License purchased! Tx: ' + r.hash.slice(0, 10) + '...' })
    } catch (e: any) {
      setBuyResult({ ok: false, msg: e?.shortMessage || e?.message || 'Purchase failed' })
    } finally {
      setBuying(false)
    }
  }

  const handleBuyCustom = async () => {
    const qty = parseInt(customQty, 10)
    if (!qty || qty < 1) {
      setBuyResult({ ok: false, msg: 'Quantity must be ≥ 1 MICE' })
      return
    }
    const totalUsdt = qty * curPrice
    setBuyResult({
      ok: true,
      msg: 'Buying ' + qty + ' MICE License(s) at $' + curPrice + ' each = $' + totalUsdt.toLocaleString() + ' USDT' +
        ' (50% MIC burned + 50% USDT to RevenueRouter) — full on-chain implementation pending.',
    })
  }

  if (loading) return <LoadingSpinner />
  const pct = (a: number, b: number) => (b > 0 ? (a / b) * 100 : 0)

  return (
    <>
      <SubNav items={SALES_TABS} />
      <div className="page-hd">
        <div>
          <div className="page-eyebrow">Token Sales</div>
          <div className="page-title">MICE Licenses</div>
        </div>
      </div>

      {/* Round progress */}
      <div className="mice-round-progress-card" style={{ marginBottom: 16 }}>
        <div className="mice-round-progress-top">
          <div>
            <div className="mice-round-progress-title">
              Round {curRound} &mdash; {ROUNDS[curRound - 1]?.label}
            </div>
            <div className="mice-round-progress-sub">${curPrice} per license (50% MIC burned + 50% USDT)</div>
          </div>
          <div className="mice-round-progress-count">
            <span className="mice-round-progress-sold">{fmt(roundSold)}</span>
            <span className="mice-round-progress-cap"> / 20,000</span>
          </div>
        </div>
        <div className="mice-progress-bar">
          <div className="mice-progress-fill" style={{ width: pct(roundSold, 20000) + '%' }}>
            <div className="mice-progress-glow" />
          </div>
        </div>
        <div className="mice-progress-labels">
          <span>{pct(roundSold, 20000).toFixed(1)}% sold</span>
          <span>Network: {fmt(totalSold)} / 100,000</span>
        </div>
      </div>

      {/* 5 Round cards */}
      <div className="mice-rounds-scroll" style={{ marginBottom: 16 }}>
        <div className="mice-rounds">
          {ROUNDS.map(r => {
            const isActive = r.num === curRound
            const isPast = r.num < curRound
            return (
              <div className={'mice-round ' + (isActive ? 'mice-round-active ' : '') + (isPast ? 'mice-round-past' : '')} key={r.num}>
                {isActive && <div className="mice-round-active-badge">ACTIVE</div>}
                <div className="mice-round-num">Round {r.num}</div>
                <div className="mice-round-price">${r.price}</div>
                <div className="mice-round-label">{r.label}</div>
                <div className="mice-round-divider" />
                <div className="mice-round-range">{r.range}</div>
                <div className="mice-round-split">
                  <div className="mice-round-split-row">
                    <span className="mice-round-split-icon">{'\u{1F525}'}</span>
                    <span>${r.price / 2} MIC Burned</span>
                  </div>
                  <div className="mice-round-split-row">
                    <span className="mice-round-split-icon">{'\u{1F4B5}'}</span>
                    <span>${r.price / 2} USDT</span>
                  </div>
                </div>
                {isActive && (
                  <button className="mice-round-btn" onClick={() => handleBuy(r.price)} disabled={buying}>
                    {buying ? 'Processing...' : 'Buy MICE'}
                  </button>
                )}
                {isPast && <div className="mice-round-sold-out">SOLD OUT</div>}
              </div>
            )
          })}
        </div>
      </div>

      {/* Buy result */}
      {buyResult && (
        <div style={{
          margin: '12px 0', padding: '12px 16px', borderRadius: 10,
          background: buyResult.ok ? 'rgba(76,175,80,.12)' : 'rgba(244,67,54,.12)',
          border: '1px solid ' + (buyResult.ok ? 'rgba(76,175,80,.3)' : 'rgba(244,67,54,.3)'),
          display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.7rem',
        }}>
          <span style={{ flex: 1, color: buyResult.ok ? '#66BB6A' : '#EF5350' }}>{buyResult.msg}</span>
          <button onClick={() => setBuyResult(null)} style={{ background: 'none', border: 'none', color: 'var(--gray2)', cursor: 'pointer', fontSize: '1rem' }}>x</button>
        </div>
      )}

      {/* Custom Quantity Purchase */}
      <div className="mice-custom-card">
        <div className="mice-custom-header">
          <span className="mice-custom-icon">{'\u{1F39F}\u{FE0F}'}</span>
          <span className="mice-custom-title">Buy Multiple MICE Licenses</span>
          <span className="mice-custom-badge">${curPrice} / MICE (Round {curRound})</span>
        </div>
        <p className="mice-custom-note">
          Enter the quantity of MICE Licenses you want (1, 2, 3, ...). Total USDT = quantity × ${curPrice}. 50% MIC burned + 50% USDT to RevenueRouter.
        </p>
        <div className="mice-custom-input-row">
          <div className="mice-custom-input-wrap">
            <input
              type="number"
              min={1}
              step={1}
              value={customQty}
              onChange={(e) => setCustomQty(e.target.value)}
              placeholder="1"
              className="mice-custom-input"
            />
            <span className="mice-custom-input-suffix">MICE</span>
          </div>
          <button
            onClick={handleBuyCustom}
            disabled={buying || !customQty || parseInt(customQty, 10) < 1}
            className="mice-round-btn"
            style={{ minWidth: 180 }}
          >
            {buying ? 'Processing...' : 'Buy MICE'}
          </button>
        </div>
        {customQty && parseInt(customQty, 10) >= 1 && (
          <div className="mice-custom-preview">
            Total: <strong>{parseInt(customQty, 10).toLocaleString()} MICE</strong>
            {' '}× ${curPrice} = <strong>${(parseInt(customQty, 10) * curPrice).toLocaleString()} USDT</strong>
          </div>
        )}
      </div>

      {/* My Direct Sales / Referral Revenue */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>{'\u{1F4CA}'}</span>
          <span>My Direct Sales (Referral Revenue from MICE)</span>
        </div>
        <p style={{ fontSize: '0.7rem', color: '#D4C098', lineHeight: 1.5, marginBottom: 12 }}>
          Earnings from buyers you introduced. F1 = direct (7%), F2 = indirect (3%). Paid instantly on-chain in USDT.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
          <Stat label="F1 Direct (7%)" value={'$' + fmt(d.referralF1Total)} sub={(d.referralF1Count ?? 0) + ' buyers'} accent="#F5D56E" />
          <Stat label="F2 Indirect (3%)" value={'$' + fmt(d.referralF2Total)} sub={(d.referralF2Count ?? 0) + ' buyers'} accent="#C9A4E6" />
          <Stat label="My F1 Volume" value={'$' + fmt(d.myF1Volume)} sub="USDT routed" accent="#66BB6A" />
          <Stat label="My F2 Volume" value={'$' + fmt(d.myF2Volume)} sub="USDT routed" accent="#66BB6A" />
        </div>
        <div style={{ marginTop: 10, fontSize: '0.6rem', color: '#B8A894', fontStyle: 'italic' }}>
          See <Link href="/network" style={{ color: '#F5D56E' }}>Building / My Community</Link> for full referral tree & Team Bonus.
        </div>
      </div>

      <div style={{ fontSize: '0.65rem', color: '#B8A894', textAlign: 'center', padding: '12px', fontStyle: 'italic' }}>
        For mining stats, pool emission, and your active MICE rewards → see <Link href="/mining" style={{ color: '#F5D56E' }}>Mining Pool</Link>.
      </div>
    </>
  )
}

function Stat({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div style={{
      padding: 12, borderRadius: 10,
      background: 'rgba(40,26,58,0.50)',
      border: '1px solid rgba(212,160,23,0.18)',
    }}>
      <div style={{ fontSize: '0.6rem', color: '#D4C098', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      <div style={{ fontSize: '1.05rem', fontWeight: 700, color: accent || '#F5D56E' }}>{value}</div>
      {sub && <div style={{ fontSize: '0.6rem', color: '#B8A894', marginTop: 2 }}>{sub}</div>}
    </div>
  )
}
