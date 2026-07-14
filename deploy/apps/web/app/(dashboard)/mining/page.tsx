'use client'

import { useState, useEffect, useCallback } from 'react'
import SubNav, { EARN_TABS } from '@/components/layout/SubNav'
import { useAccount } from 'wagmi'
import { api } from '@/lib/api'
import LoadingSpinner from '@/components/ui/LoadingSpinner'
import { CONTRACTS, MICE_ABI, MINING_ABI } from '@/lib/contracts'

/* ── Types ── */
interface NetworkStats {
  dailyEmission: number
  totalEmitted: number
  todayMidnightUtc: number
  serverTimestamp: number
  poolRemaining: number
  poolTotal: number
  daysSinceStart: number
  totalMiceMinted: number
  currentRound: number
  maxMice: number
  factors: { eBase: number; demandFactor: number; roiFactor: number; warmUpFactor: number }
  split: { miners: number; staking: number; dao: number; communityNft: number }
  currentEpoch: number
  lastDistribution: number
}

interface MyMiceData {
  totalMice: number
  activeMice: number
  inMining: number
  idle: number
  expiredMice: number
  claimableMic: string
  totalMined: string
  currentEpoch: number
  licenses: Array<{
    id: number
    round: number
    mintTime: number
    expiryTime: number
    daysLeft: number
    active: boolean
    inMining: boolean
  }>
}

/* ── Helpers ── */
const fmt = (n: number, dec = 0) => {
  if (!n || isNaN(n)) return '-'
  return n.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec })
}
const fmtBig = (n: number) => {
  if (!n || isNaN(n)) return '-'
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B'
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M'
  if (n >= 1e3) return n.toLocaleString('en-US')
  return n.toFixed(2)
}
/* ── Live Counter Hook ── */
function useLiveCounter(dailyEmission: number, midnightUtc: number, serverTs: number) {
  const [count, setCount] = useState(0)
  const ratePerMs = dailyEmission / 86400000 // MIC per millisecond

  useEffect(() => {
    if (dailyEmission <= 0 || midnightUtc <= 0) { setCount(0); return }

    // Calculate offset between server time and client time
    const serverNowMs = serverTs * 1000
    const clientNowMs = Date.now()
    const offsetMs = serverNowMs - clientNowMs

    const tick = () => {
      const adjustedNowMs = Date.now() + offsetMs
      const msSinceMidnight = (adjustedNowMs / 1000 - midnightUtc) * 1000
      if (msSinceMidnight < 0) { setCount(0); return }
      setCount(msSinceMidnight * ratePerMs)
    }

    tick()
    const id = setInterval(tick, 100)
    return () => clearInterval(id)
  }, [dailyEmission, midnightUtc, serverTs, ratePerMs])

  return count
}

/* ═══════════════════════════════════════════
   MAIN PAGE
═══════════════════════════════════════════ */
export default function MiningPage() {
  const { address, isConnected } = useAccount()
  const [net, setNet] = useState<NetworkStats | null>(null)
  const [myMice, setMyMice] = useState<MyMiceData | null>(null)
  const [loading, setLoading] = useState(true)
  const [activating, setActivating] = useState(false)
  const [claiming, setClaiming] = useState(false)
  const [actionResult, setActionResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const [showEngine, setShowEngine] = useState(false)

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [netRes, myRes] = await Promise.all([
        api<{ data: NetworkStats }>('/mining/network-stats').catch(() => null),
        isConnected && address
          ? api<{ data: MyMiceData }>(`/mining/my-mice?wallet=${address}`).catch(() => null)
          : null,
      ])
      if (netRes?.data) setNet(netRes.data)
      if (myRes?.data) setMyMice(myRes.data)
    } catch {}
    setLoading(false)
  }, [isConnected, address])

  useEffect(() => { loadData() }, [loadData])

  const n = net || {} as NetworkStats
  const m = myMice || {} as MyMiceData

  // Live counter
  const liveMinedToday = useLiveCounter(
    n.dailyEmission || 0,
    n.todayMidnightUtc || 0,
    n.serverTimestamp || 0
  )

  // Pending MICE = purchased but not yet activated. Prefer API field, fallback to derived
  const pendingMice = (m.idle ?? Math.max(0, (m.totalMice || 0) - (m.inMining || 0) - (m.expiredMice || 0)))
  const totalMinedNum = parseFloat(m.totalMined || '0')
  const unclaimedNum = parseFloat(m.claimableMic || '0')
  const claimedNum = Math.max(0, totalMinedNum - unclaimedNum)

  // Activate pending MICE — locks 360 days + starts daily rewards
  const handleActivate = useCallback(async () => {
    setActivating(true)
    setActionResult(null)
    try {
      const ethereum = (window as any).ethereum
      if (!ethereum) throw new Error('Please install MetaMask')
      const chainId = await ethereum.request({ method: 'eth_chainId' })
      if (chainId !== '0x38') throw new Error('Switch to BSC Mainnet (Chain ID 56)')

      const { ethers } = await import('ethers')
      const provider = new ethers.BrowserProvider(ethereum)
      const signer = await provider.getSigner()
      const miceContract = new ethers.Contract(CONTRACTS.mice, MICE_ABI, signer)

      // Activate: contract method may be `activate()` or per-license. Backend handles which.
      const tx = await miceContract.activate?.() ?? null
      if (!tx) throw new Error('Activate not yet enabled on contract')
      const receipt = await tx.wait()

      await api('/mining/record-activate', {
        method: 'POST',
        body: JSON.stringify({ txHash: receipt.hash }),
      }).catch(() => {})

      setActionResult({ ok: true, msg: `Activated ${pendingMice} MICE — locked 360 days, daily rewards live. Tx: ${receipt.hash.slice(0, 10)}...` })
      loadData()
    } catch (err: any) {
      setActionResult({ ok: false, msg: err?.shortMessage || err.message || 'Activate failed' })
    } finally {
      setActivating(false)
    }
  }, [pendingMice, loadData])

  // Claim unclaimed MIC rewards
  const handleClaim = useCallback(async () => {
    setClaiming(true)
    setActionResult(null)
    try {
      const ethereum = (window as any).ethereum
      if (!ethereum) throw new Error('Please install MetaMask')
      const chainId = await ethereum.request({ method: 'eth_chainId' })
      if (chainId !== '0x38') throw new Error('Switch to BSC Mainnet (Chain ID 56)')

      const { ethers } = await import('ethers')
      const provider = new ethers.BrowserProvider(ethereum)
      const signer = await provider.getSigner()
      const miningContract = new ethers.Contract(CONTRACTS.mining, MINING_ABI, signer)

      const epoch = n.currentEpoch || 0
      const tx = await miningContract.claimReward(epoch)
      const receipt = await tx.wait()

      await api('/mining/record-claim', {
        method: 'POST',
        body: JSON.stringify({ txHash: receipt.hash, epoch }),
      }).catch(() => {})

      setActionResult({ ok: true, msg: `Claimed ${unclaimedNum.toLocaleString()} MIC to your wallet. Tx: ${receipt.hash.slice(0, 10)}...` })
      loadData()
    } catch (err: any) {
      setActionResult({ ok: false, msg: err?.shortMessage || err.message || 'Claim failed' })
    } finally {
      setClaiming(false)
    }
  }, [n.currentEpoch, unclaimedNum, loadData])

  if (loading && !net) return <LoadingSpinner />

  return (
    <>
      <SubNav items={EARN_TABS} />
      <div className="mine-page">



        {/* ═══════ BLOCK 2: Network Mining Stats ═══════ */}
        <div className="mine-hero">
          <div className="mine-hero-bg" />
          <div className="mine-hero-shine" />
          <div className="mine-hero-content">
            <div className="mine-hero-top">
              <div className="mine-hero-icon-wrap">
                <span className="mine-hero-icon">{'\u26CF'}</span>
              </div>
              <div className="mine-hero-title-group">
                <div className="mine-hero-label">MICE &amp; MINING</div>
                <div className="mine-hero-member-id">Epoch #{n.currentEpoch || 0} &middot; Day {n.daysSinceStart || 0}</div>
              </div>
            </div>

            {/* Live MIC Mined Today */}
            <div className="mine-hero-active" style={{ position: 'relative' }}>
              <div className="mine-hero-active-label">
                <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: '#f44', marginRight: 6, animation: 'pulse 1.5s infinite' }} />
                MIC Mined Today
              </div>
              <div className="mine-hero-active-value" style={{ fontVariantNumeric: 'tabular-nums', fontSize: '2rem' }}>
                {n.dailyEmission > 0 ? fmtBig(liveMinedToday) : '-'}
              </div>
              <div className="mine-hero-active-sub">
                resets at 00:00 UTC &middot; rate: {n.dailyEmission > 0 ? fmtBig(n.dailyEmission) : '-'} MIC/day
              </div>
            </div>
          </div>
        </div>

        {/* Network stat cards */}
        <div className="mine-stat-duo" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 16 }}>
          <StatCard icon={'\uD83D\uDCE6'} label="Total MIC Mined" value={fmtBig(n.totalEmitted || 0)} unit="MIC" />
          <StatCard icon={'\u26CF'} label="Total MICE Active" value={fmt(n.totalMiceMinted || 0)} unit={`/ ${fmt(n.maxMice || 100000)}`} />
          <StatCard icon={'\uD83D\uDCC9'} label="Daily Emission" value={fmtBig(n.dailyEmission || 0)} unit="MIC/day" />
          <StatCard icon={'\uD83C\uDFE6'} label="Pool Remaining" value={fmtBig(n.poolRemaining || 5950000000)} unit={`of ${fmtBig(n.poolTotal || 5950000000)}`} />
        </div>

        {/* Emission Split Ring */}
        <div className="mine-split-card" style={{ marginBottom: 16 }}>
          <div className="mine-section-header">
            <span className="mine-section-icon">{'\uD83D\uDCC8'}</span>
            <span className="mine-section-title">Emission Split (85% Mining Pool = 5.95B MIC)</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 24, justifyContent: 'center', padding: '12px 0' }}>
            <EmissionRing split={n.split || { miners: 60, staking: 25, dao: 10, communityNft: 5 }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {[
                { k: 'miners', c: '#C9A84C', l: 'Miners (MICE)' },
                { k: 'staking', c: '#00BCD4', l: 'Staking Rewards' },
                { k: 'dao', c: '#C084D4', l: 'DAO Treasury' },
                { k: 'communityNft', c: '#CD7F32', l: 'Community NFT Pool' },
              ].map(s => (
                <div key={s.k} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 10, height: 10, borderRadius: '50%', background: s.c }} />
                  <span style={{ fontFamily: 'var(--font-m)', fontSize: '0.6rem', color: 'var(--gray)' }}>
                    {(n.split as any)?.[s.k] || 0}% {s.l}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ═══════ BLOCK 3: My MICE Overview (wallet connected) ═══════ */}
        {isConnected && address && (
          <>
            <div className="mine-section-header" style={{ marginTop: 20 }}>
              <span className="mine-section-icon">{'\uD83D\uDC64'}</span>
              <span className="mine-section-title">My MICE &amp; Mining</span>
            </div>

            <div className="mine-stat-duo" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 10 }}>
              <StatCard icon={'\uD83C\uDFAB'} label="My MICE" value={fmt(m.totalMice || 0)} color="gold" />
              <ActionStatCard
                icon={'\u23F3'}
                label="MICE (Pending)"
                value={fmt(pendingMice)}
                color="gold"
                sub="Activate to lock 360d & earn daily"
                btnLabel={activating ? 'Activating...' : 'Activate'}
                btnDisabled={activating || pendingMice < 1}
                onClick={handleActivate}
              />
              <StatCard icon={'\u26CF'} label="In Mining" value={fmt(m.inMining || 0)} color="g" sub="Locked 360 days" />
              <StatCard icon={'\u23F3'} label="Expired" value={fmt(m.expiredMice || 0)} color="c" />
            </div>

            {/* Total / Claimed / Unclaimed MIC */}
            <div className="mine-stat-duo" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 16 }}>
              <StatCard icon={'\uD83D\uDCE6'} label="Total MIC (Mined)" value={totalMinedNum > 0 ? fmtBig(totalMinedNum) : '-'} unit="MIC" color="gold" />
              <StatCard icon={'\u2705'} label="Claimed MIC" value={claimedNum > 0 ? fmtBig(claimedNum) : '-'} unit="MIC" color="g" sub="In your wallet" />
              <ActionStatCard
                icon={'\uD83D\uDCB0'}
                label="Unclaimed MIC"
                value={unclaimedNum > 0 ? fmtBig(unclaimedNum) : '-'}
                unit="MIC"
                color="gold"
                sub="Click Claim to withdraw to wallet"
                btnLabel={claiming ? 'Claiming...' : 'Claim'}
                btnDisabled={claiming || unclaimedNum <= 0}
                onClick={handleClaim}
              />
            </div>

            {/* Action result */}
            {actionResult && (
              <div style={{
                margin: '4px 0 16px', padding: '12px 16px', borderRadius: 10,
                background: actionResult.ok ? 'rgba(76,175,80,.12)' : 'rgba(244,67,54,.12)',
                border: `1px solid ${actionResult.ok ? 'rgba(76,175,80,.3)' : 'rgba(244,67,54,.3)'}`,
                display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.7rem',
              }}>
                <span style={{ flex: 1, color: actionResult.ok ? '#66BB6A' : '#EF5350' }}>{actionResult.msg}</span>
                <button onClick={() => setActionResult(null)} style={{ background: 'none', border: 'none', color: 'var(--gray2)', cursor: 'pointer', fontSize: '1rem' }}>&times;</button>
              </div>
            )}

            {/* ═══════ BLOCK 4: My MICE Licenses Table ═══════ */}
            <div className="mine-licenses-card" style={{ marginBottom: 20 }}>
              <div className="mine-section-header">
                <span className="mine-section-icon">{'\uD83C\uDFAB'}</span>
                <span className="mine-section-title">My MICE Licenses</span>
              </div>

              {(m.licenses || []).length === 0 ? (
                <div className="mine-empty">
                  <div className="mine-empty-icon">{'\u26CF'}</div>
                  <div className="mine-empty-text">No licenses yet</div>
                  <div className="mine-empty-sub">Purchase a MICE license below to start mining MIC tokens</div>
                </div>
              ) : (
                <div className="mine-table-desktop">
                  <div className="table-responsive">
                    <table className="mine-table">
                      <thead>
                        <tr>
                          <th>ID</th>
                          <th>Round</th>
                          <th>Purchased</th>
                          <th>Expires</th>
                          <th>Days Left</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {m.licenses!.map((l) => (
                          <tr key={l.id}>
                            <td style={{ fontFamily: 'var(--font-m)' }}>#{l.id}</td>
                            <td>Round {l.round}</td>
                            <td>{l.mintTime ? new Date(l.mintTime * 1000).toLocaleDateString() : '-'}</td>
                            <td>{l.expiryTime ? new Date(l.expiryTime * 1000).toLocaleDateString() : '-'}</td>
                            <td style={{ fontWeight: 700, color: l.daysLeft > 30 ? 'var(--copper)' : l.daysLeft > 0 ? 'var(--gold)' : 'var(--crimson2)' }}>
                              {l.daysLeft > 0 ? `${l.daysLeft}d` : 'Expired'}
                            </td>
                            <td>
                              <span style={{
                                padding: '2px 8px', borderRadius: 6, fontSize: '0.55rem', fontWeight: 700,
                                background: l.active ? 'rgba(76,175,80,.15)' : 'rgba(244,67,54,.12)',
                                color: l.active ? '#66BB6A' : '#EF5350',
                              }}>
                                {l.active ? (l.inMining ? 'MINING' : 'ACTIVE') : 'EXPIRED'}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        {/* ═══════ BLOCK 5: Emission Engine (collapsible) ═══════ */}
        <div className="mine-engine-card" style={{ marginBottom: 16 }}>
          <div className="mine-section-header" style={{ cursor: 'pointer' }} onClick={() => setShowEngine(!showEngine)}>
            <span className="mine-section-icon">{'\u2699\uFE0F'}</span>
            <span className="mine-section-title">Adaptive Emission Engine</span>
            <span style={{ marginLeft: 'auto', fontSize: '0.7rem', color: 'var(--gray2)' }}>{showEngine ? '\u25B2' : '\u25BC'}</span>
          </div>

          {showEngine && (
            <>
              <div className="mine-formula-block">
                <div className="mine-formula-line">
                  <span className="mine-f-fn">E</span><span className="mine-f-paren">(</span><span className="mine-f-var">t</span><span className="mine-f-paren">)</span>
                  <span className="mine-f-op"> = </span>
                  <span className="mine-f-fn">E_base</span><span className="mine-f-paren">(</span><span className="mine-f-var">t</span><span className="mine-f-paren">)</span>
                  <span className="mine-f-op"> {'\u00D7'} </span>
                  <span className="mine-f-fn">D</span><span className="mine-f-paren">(</span><span className="mine-f-var">t</span><span className="mine-f-paren">)</span>
                  <span className="mine-f-op"> {'\u00D7'} </span>
                  <span className="mine-f-fn">R</span><span className="mine-f-paren">(</span><span className="mine-f-var">t</span><span className="mine-f-paren">)</span>
                  <span className="mine-f-op"> {'\u00D7'} </span>
                  <span className="mine-f-fn">W</span><span className="mine-f-paren">(</span><span className="mine-f-var">t</span><span className="mine-f-paren">)</span>
                </div>
              </div>

              <div className="mine-params">
                {[
                  { sym: 'E_base(t)', color: 'var(--gold)', desc: `Base emission ~${fmtBig(n.factors?.eBase || 22907500)} MIC/day, exponential decay`, icon: '\u26A1' },
                  { sym: 'D(t)', color: 'var(--cyan)', desc: `Demand factor = ${(n.factors?.demandFactor || 1).toFixed(2)} [0.5 — 1.5]`, icon: '\uD83D\uDCC8' },
                  { sym: 'R(t)', color: 'var(--purple2)', desc: `ROI regulator = ${(n.factors?.roiFactor || 1).toFixed(2)} clamp(250%/ROI, 0.5, 2.0)`, icon: '\u2696\uFE0F' },
                  { sym: 'W(t)', color: 'var(--gold2)', desc: `Warm-up factor = ${(n.factors?.warmUpFactor || 0).toFixed(2)} min(1.0, t/30)`, icon: '\uD83D\uDD25' },
                ].map(p => (
                  <div className="mine-param-row" key={p.sym}>
                    <div className="mine-param-icon">{p.icon}</div>
                    <div className="mine-param-info">
                      <div className="mine-param-sym" style={{ color: p.color }}>{p.sym}</div>
                      <div className="mine-param-desc">{p.desc}</div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mine-halflife">
                <div className="mine-halflife-icon">{'\u23F3'}</div>
                <div className="mine-halflife-text">
                  <strong>Half-life:</strong> 180 days &mdash; ~3 years to 99% emitted
                </div>
              </div>
            </>
          )}
        </div>

      </div>

      <style jsx>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </>
  )
}

/* ── Sub-components ── */

function StatCard({ icon, label, value, unit, color, sub }: {
  icon: string; label: string; value: string; unit?: string; color?: string; sub?: string
}) {
  return (
    <div className="mine-stat-box">
      <div className="mine-stat-box-icon">{icon}</div>
      <div className="mine-stat-box-info">
        <div className="mine-stat-box-label">{label}</div>
        <div className={`mine-stat-box-value ${color || ''}`}>{value}</div>
        {unit && <div className="mine-stat-box-unit">{unit}</div>}
        {sub && <div style={{ fontFamily: 'var(--font-m)', fontSize: '0.5rem', color: 'var(--gray2)', marginTop: 2 }}>{sub}</div>}
      </div>
    </div>
  )
}

function ActionStatCard({ icon, label, value, unit, color, sub, btnLabel, btnDisabled, onClick }: {
  icon: string; label: string; value: string; unit?: string; color?: string; sub?: string;
  btnLabel: string; btnDisabled?: boolean; onClick: () => void
}) {
  return (
    <div className="mine-stat-box mine-stat-action">
      <div className="mine-stat-box-icon">{icon}</div>
      <div className="mine-stat-box-info">
        <div className="mine-stat-box-label">{label}</div>
        <div className={`mine-stat-box-value ${color || ''}`}>{value}</div>
        {unit && <div className="mine-stat-box-unit">{unit}</div>}
        {sub && <div style={{ fontFamily: 'var(--font-m)', fontSize: '0.5rem', color: 'var(--gray2)', marginTop: 2 }}>{sub}</div>}
        <button
          onClick={onClick}
          disabled={btnDisabled}
          className="mine-stat-action-btn"
        >
          {btnLabel}
        </button>
      </div>
    </div>
  )
}

function EmissionRing({ split }: { split: { miners: number; staking: number; dao: number; communityNft: number } }) {
  const segments = [
    { pct: split.miners, color: '#C9A84C' },
    { pct: split.staking, color: '#00BCD4' },
    { pct: split.dao, color: '#C084D4' },
    { pct: split.communityNft, color: '#CD7F32' },
  ]
  const r = 60, sw = 14, circ = 2 * Math.PI * r
  let offset = 0

  return (
    <svg width={150} height={150} viewBox="0 0 150 150">
      <circle cx={75} cy={75} r={r} fill="none" stroke="rgba(255,255,255,.06)" strokeWidth={sw} />
      {segments.map((seg, i) => {
        const dash = (seg.pct / 100) * circ
        const el = (
          <circle key={i} cx={75} cy={75} r={r} fill="none" stroke={seg.color} strokeWidth={sw}
            strokeDasharray={`${dash} ${circ - dash}`} strokeDashoffset={-offset}
            transform="rotate(-90 75 75)" opacity={0.85} />
        )
        offset += dash
        return el
      })}
      <text x={75} y={70} textAnchor="middle" fill="#F0E6D3" fontSize="11" fontWeight="800" fontFamily="Montserrat,sans-serif">5.95B</text>
      <text x={75} y={85} textAnchor="middle" fill="#B09090" fontSize="8" fontFamily="Inter,sans-serif">MIC Pool</text>
    </svg>
  )
}
