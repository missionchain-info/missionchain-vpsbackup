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
  // EmissionControllerV2's actual inputs. The six-factor engine below it is gone.
  activeLicences?: number
  micPerLicencePerDay?: number
  minerShare?: number
  damper?: number
  factors: {
    eBase: number; demandFactor: number; warmUpFactor: number
    coverageDays: number; coverageFactor: number; trendFactor: number
    adoptionFactor: number; brakeEngaged: boolean
  }
  split: { miners: number; staking: number; dao: number; communityNft: number; mfpReward: number }
  currentEpoch: number
  lastDistribution: number
}

interface MyMiceData {
  totalMice: number
  activeMice: number
  inMining: number
  idle: number
  pendingMice?: number
  activatableMice?: number
  expiredMice: number
  claimableMic: string
  // Null when the API cannot know it — see the note on claimedKnown.
  totalMined: string
  claimedMic: string
  claimedSince?: string
  currentEpoch: number
  licenses: Array<{
    id: number
    round: number
    mintTime: number
    activatedAt?: number
    /** NONE | PENDING | ACTIVE | EXPIRED | RECYCLED, straight from the contract. */
    status?: string
    activatable?: boolean
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

  // The published split and the split running today are different numbers, and showing
  // either without the other reads as an error. `split` is the steady state (59/25/10/5/1);
  // `minerShare` is what the contract is actually applying, because the 90-day Early
  // Staking Boost lends part of the miners' share to staking. Miners are not paid less —
  // more is issued so the larger staking slice comes out of the gross, not out of them.
  const pubSplit = n.split || { miners: 59, staking: 25, dao: 10, communityNft: 5, mfpReward: 1 }
  const boostOn = typeof n.minerShare === 'number' && n.minerShare < pubSplit.miners
  const liveSplit = boostOn
    ? { ...pubSplit, miners: n.minerShare!, staking: pubSplit.staking + (pubSplit.miners - n.minerShare!) }
    : pubSplit
  const m = myMice || {} as MyMiceData

  // Live counter
  const liveMinedToday = useLiveCounter(
    n.dailyEmission || 0,
    n.todayMidnightUtc || 0,
    n.serverTimestamp || 0
  )

  // Pending MICE = purchased but not yet activated. Prefer API field, fallback to derived
  // Bought but not yet activated. The API now reports this directly; the subtraction is
  // only a fallback for an older API. It used to be the only path, and it read
  // total − mining − expired — which is zero when the API has mislabelled a pending
  // licence as expired, and a zero here is what greys out the Activate button.
  const pendingMice = (m.pendingMice ?? m.idle ?? Math.max(0, (m.totalMice || 0) - (m.inMining || 0) - (m.expiredMice || 0)))
  const unclaimedNum = parseFloat(m.claimableMic || '0')
  // What a wallet has already withdrawn lives only in the pool's Claimed events, and no
  // reachable RPC serves eth_getLogs. Deriving it from rate x time-since-activation was
  // tried and was wrong — it assumes the pool paid from the second of activation, while
  // the first distribution ran a day later, and it reported one wallet as having taken out
  // 112.79 MIC when the whole system had paid 23.93. Unknown is shown as unknown.
  const claimedNum = parseFloat(m.claimedMic || '0')
  const claimedSince = m.claimedSince
  const totalMinedNum = claimedNum + unclaimedNum

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

      // `activate(uint256)` — one call per licence, or `activateBatch(uint256[])` for
      // several. This used to call `activate()` with no arguments, guarded by
      // `?? null` and a comment saying the method "may be activate() or per-license.
      // Backend handles which." Nobody had checked: there is no zero-argument
      // `activate()` on the contract, and the SDK ABI carries neither, so the call
      // resolved to undefined and the button reported "Activate not yet enabled on
      // contract" no matter what the buyer did. The ABI is written out here rather than
      // taken from the SDK, which is a build behind the deployed contract.
      const ACTIVATE_ABI = [
        'function activate(uint256 licenseId)',
        'function activateBatch(uint256[] licenseIds)',
        'function isActivatable(uint256) view returns (bool)',
      ]
      const mice = new ethers.Contract(CONTRACTS.mice, ACTIVATE_ABI, signer)

      const ready: bigint[] = []
      for (const l of (m.licenses || [])) {
        if (await mice.isActivatable(BigInt(l.id)).catch(() => false)) ready.push(BigInt(l.id))
      }
      if (ready.length === 0) throw new Error('No licence is ready to activate yet')

      const tx = ready.length === 1
        ? await mice.activate(ready[0])
        : await mice.activateBatch(ready)
      const receipt = await tx.wait()
      // /mining/record-activate does not exist either; activation is read from the
      // licence contract, so nothing needs recording.

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

      // Settle every licence that is currently mining, plus anything already banked from
      // a licence that expired or was sold on. Passing the ids is what lets the contract
      // move each licence's earnings into the caller's balance in one transaction.
      const activeIds = (myMice?.licenses || [])
        .filter((l) => l.inMining)
        .map((l) => BigInt(l.id))

      const tx = activeIds.length > 0
        ? await miningContract.claim(activeIds)
        : await miningContract.claimAccrued()
      const receipt = await tx.wait()

      // MiningPool keeps no per-wallet claimed total, so this is the only record of what
      // this wallet has withdrawn. The route takes the amount from the receipt, not from
      // here. Awaited rather than fire-and-forget, and any failure is surfaced — the
      // version of this call that swallowed a 404 is why CLAIMED read zero for two days.
      try {
        await api('/mining/record-claim', { method: 'POST', body: { txHash: receipt.hash } })
      } catch (e: any) {
        console.warn('claim recorded on chain but not logged:', e?.message)
      }

      setActionResult({ ok: true, msg: `Claimed ${unclaimedNum.toLocaleString()} MIC to your wallet. Tx: ${receipt.hash.slice(0, 10)}...` })
      loadData()
    } catch (err: any) {
      setActionResult({ ok: false, msg: err?.shortMessage || err.message || 'Claim failed' })
    } finally {
      setClaiming(false)
    }
  }, [myMice, unclaimedNum, loadData])

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
        {/* Two different facts were being shown as one. `split` is the PUBLISHED steady
            state (59/25/10/5/1); `minerShare` is what is actually running today, because
            the 90-day Early Staking Boost lends part of the miners' share to staking. One
            screen showed 59/25 and another 49.12/34.88, both correct and neither labelled.
            The ring now shows what is live, and says so. */}
        <div className="mine-split-card" style={{ marginBottom: 16 }}>
          <div className="mine-section-header">
            <span className="mine-section-icon">{'\uD83D\uDCC8'}</span>
            <span className="mine-section-title">Emission Split (85% Mining Pool = 5.95B MIC)</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 24, justifyContent: 'center', padding: '12px 0' }}>
            <EmissionRing split={liveSplit} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {[
                { k: 'miners', c: '#C9A34C', l: 'Miners (MICE)' },
                { k: 'staking', c: '#72ABE8', l: 'Staking Rewards' },
                { k: 'dao', c: '#849ED4', l: 'DAO Treasury' },
                { k: 'communityNft', c: '#CD9E32', l: 'Community NFT Pool' },
                { k: 'mfpReward', c: '#E8C168', l: 'MFP-NFT Pool' },
              ].map(s => (
                <div key={s.k} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 10, height: 10, borderRadius: '50%', background: s.c }} />
                  <span style={{ fontFamily: 'var(--font-m)', fontSize: '0.6rem', color: 'var(--gray)' }}>
                    {((liveSplit as any)?.[s.k] ?? 0).toFixed(2).replace(/\.00$/, '')}% {s.l}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {boostOn && (
            <div style={{
              margin: '4px 14px 14px', padding: '10px 12px', borderRadius: 8,
              background: 'rgba(114,171,232,.10)', border: '1px solid rgba(114,171,232,.22)',
              fontSize: '0.66rem', lineHeight: 1.6, color: 'var(--gray)',
            }}>
              <strong style={{ color: 'var(--gold2)' }}>Early Staking Boost is running.</strong>{' '}
              For the first 90 days part of the miners&rsquo; share is lent to staking, so the
              live split is <strong>{liveSplit.miners.toFixed(2)}% / {liveSplit.staking.toFixed(2)}%</strong> rather
              than the published <strong>{pubSplit.miners}% / {pubSplit.staking}%</strong>. Miners are not
              paid less: every active licence still earns the full{' '}
              {(n.micPerLicencePerDay ?? 83.3333).toFixed(4)} MIC/day &mdash; more is issued to
              cover the larger staking slice. DAO, Community NFT and MFP-NFT are untouched.
            </div>
          )}
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
              <StatCard
                icon={'\uD83D\uDCE6'}
                label="Total MIC (Mined)"
                value={totalMinedNum > 0 ? fmtBig(totalMinedNum) : '-'}
                unit="MIC"
                color="gold"
                sub={claimedSince ? `Claimed + unclaimed, from ${claimedSince}` : undefined}
              />
              <StatCard
                icon={'\uD83D\uDC5B'}
                label="Claimed MIC"
                value={claimedNum > 0 ? fmtBig(claimedNum) : '-'}
                unit="MIC"
                color="g"
                sub={claimedSince ? `In your wallet \u00B7 recorded since ${claimedSince}` : 'In your wallet'}
              />
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
                background: actionResult.ok ? 'rgba(76,175,80,.12)' : 'rgba(244,54,78,.12)',
                border: `1px solid ${actionResult.ok ? 'rgba(76,175,80,.3)' : 'rgba(244,54,78,.3)'}`,
                display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.7rem',
              }}>
                <span style={{ flex: 1, color: actionResult.ok ? '#66BB6A' : '#EF5064' }}>{actionResult.msg}</span>
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
                                background: l.status === 'PENDING' ? 'rgba(212,166,60,.15)'
                                          : l.active ? 'rgba(76,175,80,.15)' : 'rgba(244,54,78,.12)',
                                color: l.status === 'PENDING' ? '#D4A63C'
                                     : l.active ? '#66BB6A' : '#EF5064',
                              }}>
                                {/* PENDING had no branch here, so a licence bought minutes
                                    ago — not active, not expired — was labelled EXPIRED. */}
                                {l.status === 'PENDING' ? 'PENDING'
                                  : l.active ? (l.inMining ? 'MINING' : 'ACTIVE')
                                  : 'EXPIRED'}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Mobile view. globals.css hides .mine-table-desktop below 768px and shows
                  .mine-cards-mobile in its place — but nothing ever rendered the cards, so
                  the whole licence list simply vanished on a phone. The stylesheet had
                  been waiting for this markup. */}
              {(m.licenses || []).length > 0 && (
                <div className="mine-cards-mobile">
                  {m.licenses!.map((l) => {
                    const label = l.status === 'PENDING' ? 'PENDING'
                      : l.active ? (l.inMining ? 'MINING' : 'ACTIVE') : 'EXPIRED'
                    const tone = l.status === 'PENDING' ? { bg: 'rgba(212,166,60,.15)', fg: '#D4A63C' }
                      : l.active ? { bg: 'rgba(76,175,80,.15)', fg: '#66BB6A' }
                      : { bg: 'rgba(244,54,78,.12)', fg: '#EF5064' }
                    const row = (k: string, v: React.ReactNode) => (
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '5px 0' }}>
                        <span style={{ color: 'var(--gray2)', fontSize: '0.68rem' }}>{k}</span>
                        <span style={{ fontSize: '0.72rem', fontWeight: 600, textAlign: 'right' }}>{v}</span>
                      </div>
                    )
                    return (
                      <div key={l.id} className="mine-card" style={{
                        borderRadius: 12, padding: '12px 14px', marginBottom: 10,
                        border: '1px solid var(--border)',
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                          <span style={{ fontFamily: 'var(--font-m)', fontWeight: 700 }}>#{l.id}</span>
                          <span style={{
                            padding: '2px 8px', borderRadius: 6, fontSize: '0.55rem', fontWeight: 700,
                            background: tone.bg, color: tone.fg,
                          }}>{label}</span>
                        </div>
                        {row('Round', `Round ${l.round}`)}
                        {row('Purchased', l.mintTime ? new Date(l.mintTime * 1000).toLocaleDateString() : '-')}
                        {row('Expires', l.expiryTime ? new Date(l.expiryTime * 1000).toLocaleDateString() : '-')}
                        {row('Days left', (
                          <span style={{ color: l.daysLeft > 30 ? 'var(--copper)' : l.daysLeft > 0 ? 'var(--gold)' : 'var(--crimson2)' }}>
                            {l.daysLeft > 0 ? `${l.daysLeft}d` : 'Expired'}
                          </span>
                        ))}
                      </div>
                    )
                  })}
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
                {/* EmissionControllerV2, 2026-08-18. What stood here was V1's six-factor
                    engine — E_base x D x L x G x A x W — which is gone entirely. Four of
                    those six were functions of N or of time and multiplied out to roughly
                    1/24,000, so two licences drew 7.89 MIC/day instead of 166.67, and
                    A = sqrt(N/10,000) made each licence earn LESS as more joined. */}
                <div className="mine-formula-line">
                  <span className="mine-f-fn">E</span>
                  <span className="mine-f-op"> = </span>
                  <span className="mine-f-fn">N</span>
                  <span className="mine-f-op"> {'\u00D7'} </span>
                  <span className="mine-f-fn">r</span>
                  <span className="mine-f-op"> {'\u00F7'} </span>
                  <span className="mine-f-fn">minerShare</span>
                  <span className="mine-f-op"> {'\u00D7'} </span>
                  <span className="mine-f-fn">damper</span>
                </div>
              </div>

              <div className="mine-params">
                {[
                  { sym: 'N', color: 'var(--cyan)', desc: `Licences mining right now = ${n.activeLicences ?? 0}. Counted from MiningPool, which retires a licence the second its term ends.`, icon: '\u26CF\uFE0F' },
                  { sym: 'r', color: 'var(--gold)', desc: `${(n.micPerLicencePerDay ?? 83.3333).toFixed(4)} MIC per licence per day — $100 \u00F7 $0.01 \u00F7 120 days. Every active licence earns this, whatever round it was bought in and however many others join.`, icon: '\u26A1' },
                  { sym: 'minerShare', color: 'var(--purple2)', desc: `${(n.minerShare ?? 59).toFixed(1)}% of issuance goes to miners${(n.minerShare ?? 59) < 59 ? ' — still inside the 90-day Early Staking Boost, which lends part of the miners\u2019 share to staking' : ''}. Issuance is divided by it so miners receive exactly N \u00D7 r and the other four pools are still funded in full.`, icon: '\u2696\uFE0F' },
                  { sym: 'damper', color: 'var(--gold2)', desc: `${(n.damper ?? 1).toFixed(2)} \u2014 an emergency brake, and the only discretionary input. It ships disengaged at 1.00 and can never fall below 0.25.`, icon: '\uD83D\uDD25' },
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
                  {/* V1 decayed E_base on an 8-year half-life. V2 has no base rate to decay:
                      issuance is whatever the active licences earn, and it ends when their
                      360-day terms do. */}
                  <strong>No decay curve.</strong> Issuance is set by how many licences are
                  mining, not by a clock. A licence earns for its own 360 days &mdash;
                  30,000 MIC in all &mdash; and then stops.
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

function EmissionRing({ split }: { split: { miners: number; staking: number; dao: number; communityNft: number; mfpReward: number } }) {
  const segments = [
    { pct: split.miners, color: '#C9A34C' },
    { pct: split.staking, color: '#72ABE8' },
    { pct: split.dao, color: '#849ED4' },
    { pct: split.communityNft, color: '#CD9E32' },
    { pct: split.mfpReward, color: '#E8C168' },
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
      <text x={75} y={70} textAnchor="middle" fill="#F0E7D3" fontSize="11" fontWeight="800" fontFamily="Montserrat,sans-serif">5.95B</text>
      <text x={75} y={85} textAnchor="middle" fill="#B09094" fontSize="8" fontFamily="Inter,sans-serif">MIC Pool</text>
    </svg>
  )
}
