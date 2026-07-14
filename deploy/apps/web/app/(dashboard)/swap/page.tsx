'use client'

import { useState, useEffect, useCallback } from 'react'
import SubNav, { EXPLORE_TABS } from '@/components/layout/SubNav'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'

type SwapDirection = 'buy' | 'sell'

export default function SwapPage() {
  const [direction, setDirection] = useState<SwapDirection>('buy') // buy MIC = USDT→MIC, sell MIC = MIC→USDT
  const [inputAmount, setInputAmount] = useState('')
  const [micPrice, setMicPrice] = useState(0)
  const [swapEnabled, setSwapEnabled] = useState(false)
  const [loading, setLoading] = useState(true)
  const [swapping, setSwapping] = useState(false)
  const [slippage, setSlippage] = useState('0.5')
  const [showSettings, setShowSettings] = useState(false)
  const [txResult, setTxResult] = useState<{ success: boolean; message: string } | null>(null)

  // Pool info (will come from contract)
  const [poolMic, setPoolMic] = useState(0)
  const [poolUsdt, setPoolUsdt] = useState(0)

  useEffect(() => {
    fetch(`${API_BASE}/rounds/system-info`)
      .then(r => r.json())
      .then(data => {
        if (data?.data) {
          setSwapEnabled(data.data.swapEnabled || false)
          setMicPrice(parseFloat(data.data.micPrice) || 0.0025)
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  // Calculated output
  const inputNum = parseFloat(inputAmount) || 0
  const slippagePct = parseFloat(slippage) || 0.5
  const fee = inputNum * 0.003 // 0.3% swap fee
  const outputAmount = direction === 'buy'
    ? (micPrice > 0 ? (inputNum - fee) / micPrice : 0) // USDT → MIC
    : (inputNum - fee) * micPrice                        // MIC → USDT
  const minReceived = outputAmount * (1 - slippagePct / 100)
  const priceImpact = poolUsdt > 0 ? (inputNum / poolUsdt * 100) : 0

  const fromToken = direction === 'buy' ? 'USDT' : 'MIC'
  const toToken = direction === 'buy' ? 'MIC' : 'USDT'

  const handleSwap = async () => {
    if (!inputNum || inputNum <= 0) return
    setSwapping(true)
    setTxResult(null)
    try {
      // TODO: Call smart contract LiquidityPool.swap()
      // For now, simulate
      await new Promise(r => setTimeout(r, 2000))
      setTxResult({
        success: true,
        message: `Swapped ${inputNum.toLocaleString()} ${fromToken} → ${outputAmount.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${toToken}`,
      })
      setInputAmount('')
    } catch (err: any) {
      setTxResult({ success: false, message: err.message || 'Swap failed' })
    } finally {
      setSwapping(false)
    }
  }

  const flipDirection = () => {
    setDirection(d => d === 'buy' ? 'sell' : 'buy')
    setInputAmount('')
    setTxResult(null)
  }

  // Not active — show coming soon
  if (!loading && !swapEnabled) {
    return (
      <>
        <SubNav items={EXPLORE_TABS} />
        <SwapComingSoon />
      </>
    )
  }

  return (
    <>
      <SubNav items={EXPLORE_TABS} />
      <div className="swap-page">
        <div className="swap-card">
          <div className="swap-card-bg" />
          <div className="swap-card-content" style={{ padding: '28px 24px' }}>

            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <div>
                <div style={{ fontFamily: 'var(--font-d)', fontSize: '1.1rem', fontWeight: 700, color: 'var(--cream)' }}>Swap</div>
                <div style={{ fontSize: '0.62rem', color: 'var(--gray2)' }}>Trade MIC instantly</div>
              </div>
              <button
                onClick={() => setShowSettings(!showSettings)}
                style={{ background: 'rgba(123,45,139,.15)', border: '1px solid var(--border)', borderRadius: 10, padding: '6px 10px', cursor: 'pointer', color: 'var(--cream)', fontSize: '0.7rem' }}
              >
                {'\u2699\uFE0F'} {slippage}%
              </button>
            </div>

            {/* Slippage settings */}
            {showSettings && (
              <div style={{ background: 'rgba(30,18,48,.6)', border: '1px solid var(--border)', borderRadius: 12, padding: 14, marginBottom: 16 }}>
                <div style={{ fontSize: '0.62rem', color: 'var(--gray2)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.04em' }}>Slippage Tolerance</div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {['0.1', '0.5', '1.0', '2.0'].map(v => (
                    <button key={v} onClick={() => { setSlippage(v); setShowSettings(false); }}
                      style={{
                        flex: 1, padding: '6px 0', borderRadius: 8, cursor: 'pointer',
                        fontFamily: 'var(--font-d)', fontSize: '0.72rem', fontWeight: 600,
                        background: slippage === v ? 'var(--gold)' : 'rgba(123,45,139,.1)',
                        color: slippage === v ? '#000' : 'var(--cream)',
                        border: slippage === v ? 'none' : '1px solid var(--border)',
                      }}
                    >{v}%</button>
                  ))}
                </div>
              </div>
            )}

            {/* FROM token input */}
            <div style={{ background: 'rgba(30,18,48,.5)', borderRadius: 16, padding: '16px 14px', marginBottom: 4 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontSize: '0.6rem', color: 'var(--gray2)', textTransform: 'uppercase', letterSpacing: '.04em' }}>From</span>
                <span style={{ fontSize: '0.58rem', color: 'var(--gray2)' }}>Balance: -</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <input
                  type="number"
                  value={inputAmount}
                  onChange={(e) => setInputAmount(e.target.value)}
                  placeholder="0.00"
                  style={{
                    flex: 1, background: 'transparent', border: 'none', outline: 'none',
                    fontFamily: 'var(--font-d)', fontSize: '1.3rem', fontWeight: 700,
                    color: 'var(--cream)', width: '100%',
                  }}
                />
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  background: 'rgba(123,45,139,.15)', borderRadius: 10, padding: '6px 12px',
                }}>
                  <div style={{ width: 20, height: 20, borderRadius: '50%', background: fromToken === 'USDT' ? 'var(--success)' : 'var(--gold)' }} />
                  <span style={{ fontFamily: 'var(--font-d)', fontSize: '0.78rem', fontWeight: 700, color: 'var(--cream)' }}>{fromToken}</span>
                </div>
              </div>
            </div>

            {/* Flip button */}
            <div style={{ display: 'flex', justifyContent: 'center', margin: '-8px 0', zIndex: 2, position: 'relative' }}>
              <button onClick={flipDirection}
                style={{
                  width: 36, height: 36, borderRadius: '50%',
                  background: 'var(--gold)', border: '3px solid rgba(30,18,48,.8)',
                  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '1rem', transition: 'transform .2s',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.transform = 'rotate(180deg)')}
                onMouseLeave={(e) => (e.currentTarget.style.transform = 'rotate(0deg)')}
              >
                {'\u2B07'}
              </button>
            </div>

            {/* TO token output */}
            <div style={{ background: 'rgba(30,18,48,.5)', borderRadius: 16, padding: '16px 14px', marginBottom: 16, marginTop: 4 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontSize: '0.6rem', color: 'var(--gray2)', textTransform: 'uppercase', letterSpacing: '.04em' }}>To (estimated)</span>
                <span style={{ fontSize: '0.58rem', color: 'var(--gray2)' }}>Balance: -</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{
                  flex: 1, fontFamily: 'var(--font-d)', fontSize: '1.3rem', fontWeight: 700,
                  color: outputAmount > 0 ? 'var(--cream)' : 'var(--gray2)',
                }}>
                  {outputAmount > 0 ? outputAmount.toLocaleString('en-US', { maximumFractionDigits: toToken === 'USDT' ? 2 : 0 }) : '-'}
                </div>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  background: 'rgba(123,45,139,.15)', borderRadius: 10, padding: '6px 12px',
                }}>
                  <div style={{ width: 20, height: 20, borderRadius: '50%', background: toToken === 'USDT' ? 'var(--success)' : 'var(--gold)' }} />
                  <span style={{ fontFamily: 'var(--font-d)', fontSize: '0.78rem', fontWeight: 700, color: 'var(--cream)' }}>{toToken}</span>
                </div>
              </div>
            </div>

            {/* Swap details */}
            {inputNum > 0 && (
              <div style={{ background: 'rgba(30,18,48,.4)', borderRadius: 12, padding: '10px 14px', marginBottom: 16, fontSize: '0.62rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ color: 'var(--gray2)' }}>Rate</span>
                  <span style={{ color: 'var(--cream)', fontFamily: 'var(--font-d)' }}>{micPrice > 0 ? `1 MIC = $${micPrice.toFixed(6)}` : '-'}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ color: 'var(--gray2)' }}>Fee (0.3%)</span>
                  <span style={{ color: 'var(--cream)', fontFamily: 'var(--font-d)' }}>{fee.toFixed(4)} {fromToken}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ color: 'var(--gray2)' }}>Min. Received</span>
                  <span style={{ color: 'var(--cream)', fontFamily: 'var(--font-d)' }}>
                    {minReceived.toLocaleString('en-US', { maximumFractionDigits: toToken === 'USDT' ? 2 : 0 })} {toToken}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--gray2)' }}>Slippage</span>
                  <span style={{ color: parseFloat(slippage) > 1 ? 'var(--warning)' : 'var(--cream)', fontFamily: 'var(--font-d)' }}>{slippage}%</span>
                </div>
              </div>
            )}

            {/* Swap button */}
            <button
              onClick={handleSwap}
              disabled={swapping || !inputNum || inputNum <= 0}
              style={{
                width: '100%', padding: '14px 0', borderRadius: 14, border: 'none', cursor: 'pointer',
                fontFamily: 'var(--font-d)', fontSize: '0.88rem', fontWeight: 700,
                background: inputNum > 0 ? 'var(--gold)' : 'rgba(123,45,139,.2)',
                color: inputNum > 0 ? '#000' : 'var(--gray2)',
                opacity: swapping ? 0.6 : 1,
                transition: 'all .2s',
              }}
            >
              {swapping ? 'Swapping...' : !inputNum || inputNum <= 0 ? 'Enter amount' : `Swap ${fromToken} → ${toToken}`}
            </button>

            {/* Tx result */}
            {txResult && (
              <div style={{
                marginTop: 12, padding: '10px 14px', borderRadius: 12, fontSize: '0.68rem', fontWeight: 600,
                background: txResult.success ? 'rgba(76,177,80,.15)' : 'rgba(229,57,53,.15)',
                color: txResult.success ? 'var(--success)' : 'var(--error)',
                textAlign: 'center',
              }}>
                {txResult.success ? '\u2705' : '\u274C'} {txResult.message}
              </div>
            )}
          </div>
        </div>

        {/* Pool info card below */}
        <div style={{ maxWidth: 520, margin: '16px auto 0', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8 }}>
          <div style={{ background: 'rgba(38,20,58,.35)', borderRadius: 14, padding: '14px 16px', textAlign: 'center' }}>
            <div style={{ fontSize: '0.52rem', color: 'var(--gray2)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 4 }}>MIC in Pool</div>
            <div style={{ fontFamily: 'var(--font-d)', fontSize: '0.85rem', fontWeight: 700, color: 'var(--gold)' }}>
              {poolMic > 0 ? poolMic.toLocaleString() : '-'}
            </div>
          </div>
          <div style={{ background: 'rgba(38,20,58,.35)', borderRadius: 14, padding: '14px 16px', textAlign: 'center' }}>
            <div style={{ fontSize: '0.52rem', color: 'var(--gray2)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 4 }}>USDT in Pool</div>
            <div style={{ fontFamily: 'var(--font-d)', fontSize: '0.85rem', fontWeight: 700, color: 'var(--success)' }}>
              {poolUsdt > 0 ? `$${poolUsdt.toLocaleString()}` : '-'}
            </div>
          </div>
        </div>

        {/* Info */}
        <div style={{ maxWidth: 520, margin: '12px auto 24px', textAlign: 'center', fontSize: '0.56rem', color: 'var(--gray2)', lineHeight: 1.6 }}>
          Swap directly from the Mission Chain liquidity pool. 0.3% fee per trade. Pool is locked for 10 years.
        </div>
      </div>
    </>
  )
}

/* Coming Soon fallback (shown when swap_enabled = false) */
function SwapComingSoon() {
  return (
    <div className="swap-page">
      <div className="swap-card">
        <div className="swap-card-bg" />
        <div className="swap-card-shine" />
        <div className="swap-card-content">
          <div className="swap-icon-wrap">
            <div className="swap-icon-ring" />
            <div className="swap-icon-ring swap-icon-ring-2" />
            <div className="swap-icon-center">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>
            </div>
          </div>
          <div className="swap-title">Swap Coming Soon</div>
          <div className="swap-subtitle">Trade MIC tokens directly on BSC</div>
          <div className="swap-pairs">
            <div className="swap-pair">
              <div className="swap-pair-token"><div className="swap-pair-dot swap-pair-dot-mic" /><span>MIC</span></div>
              <div className="swap-pair-arrow">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>
              </div>
              <div className="swap-pair-token"><div className="swap-pair-dot swap-pair-dot-usdt" /><span>USDT</span></div>
            </div>
          </div>
          <div className="swap-price-card">
            <div className="swap-price-label">Current Price</div>
            <div className="swap-price-value">$0.0025 <span className="swap-price-unit">/ MIC</span></div>
          </div>
          <div className="swap-notify">
            <div className="swap-notify-hint">Swap will be activated after sufficient liquidity is added to the pool</div>
          </div>
        </div>
      </div>
    </div>
  )
}
