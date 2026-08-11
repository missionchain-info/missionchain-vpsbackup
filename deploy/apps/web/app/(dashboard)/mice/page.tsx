'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import SwapPanel from '@/components/SwapPanel'
import { getActiveChain } from '@missionchain/sdk'
import SubNav, { SALES_TABS } from '@/components/layout/SubNav'
import { useApi } from '@/hooks/useApi'
import LoadingSpinner from '@/components/ui/LoadingSpinner'
import { useAccount } from 'wagmi'
import { ethers } from 'ethers'
import { CONTRACTS, USDT_ABI, MICE_ABI, isDeployed, LOCK_MANAGER_ABI} from '@/lib/contracts'
import { USDT_DECIMALS } from '@missionchain/sdk'

const ACTIVE_CHAIN = getActiveChain()

interface MiceData {
  data?: {
    totalSold?: number
    currentRound?: number
    currentPrice?: number
  }
}

/**
 * `/sales/mice/info` is a public, wallet-agnostic snapshot of the sale — it has no idea
 * who is asking, so it never carried referral figures. The page read six fields off it
 * (referralF1Total, referralF1Count, referralF2Total, referralF2Count, myF1Volume,
 * myF2Volume) that the route has never returned, so every tile rendered "$-".
 *
 * The real source is `/network/overview`, the same authenticated endpoint the Building /
 * My Community page reads, so the two pages cannot drift apart.
 */
interface NetworkOverview {
  teamStats?: {
    f1Members?: number
    f1Volume?: string
    f2Members?: number
    f2Volume?: string
    groupVolume?: string
    totalTeam?: number
  }
  earnings?: {
    referralClaimed?: string
    referralUnclaimed?: string
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

  // Gated: /network/overview requires a JWT, so asking before connect only earns a 401.
  const { data: net, loading: netLoading } = useApi<NetworkOverview>('/network/overview', {
    enabled: !!address,
  })
  const team = net?.teamStats
  const earn = net?.earnings

  const totalSold = d.totalSold ?? 0
  const curRound = d.currentRound ?? 1
  const curPrice = d.currentPrice ?? 100
  const roundSold = totalSold - (curRound - 1) * 20_000

  const [buying, setBuying] = useState(false)
  const [buyResult, setBuyResult] = useState<{ ok: boolean; msg: string; bought?: number } | null>(null)
  const [customQty, setCustomQty] = useState('')

  /**
   * What the wallet can actually pay with.
   *
   * A MICE purchase costs 50% USDT **and** 50% in MIC the buyer already owns — the
   * contract pulls that MIC and burns it. A wallet holding only USDT looks ready to buy
   * and fails at the transfer, after the user has signed and paid gas. Read both sides up
   * front and say plainly what is missing.
   */
  const [funds, setFunds] = useState<{ usdt: number; mic: number; micFree: number; bnb: number } | null>(null)
  /** SWAP only exists once the pool holds MIC; until then the button cannot help. */
  const [swapOpen, setSwapOpen] = useState(false)
  const [swapOpenModal, setSwapOpenModal] = useState(false)
  const [micNeeded, setMicNeeded] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    if (!address || !isDeployed(CONTRACTS.mice)) { setFunds(null); return }
    ;(async () => {
      try {
        const prov = new ethers.JsonRpcProvider(ACTIVE_CHAIN.rpcUrls[0])
        const usdtC = new ethers.Contract(CONTRACTS.usdt, USDT_ABI, prov)
        const micC = new ethers.Contract(CONTRACTS.mic, USDT_ABI, prov)
        const miceC = new ethers.Contract(CONTRACTS.mice, MICE_ABI, prov)
        const lockC = new ethers.Contract(CONTRACTS.lockManager, LOCK_MANAGER_ABI, prov)
        const poolC = new ethers.Contract(CONTRACTS.liquidityPoolV6,
          ['function isSeeded() view returns (bool)'], prov)

        const [u, m, b, locked, seeded] = await Promise.all([
          usdtC.balanceOf(address) as Promise<bigint>,
          micC.balanceOf(address) as Promise<bigint>,
          prov.getBalance(address),
          // MICToken blocks any transfer that would dip into a vesting lock
          // (`balance - value >= locked`), so a wallet can hold millions of MIC and
          // still be unable to pay for a licence. The number that matters is what is
          // free to move, not what is owned.
          (lockC.lockedOf(address) as Promise<bigint>).catch(() => 0n),
          (poolC.isSeeded() as Promise<boolean>).catch(() => false),
        ])
        const micTotal = Number(m) / 1e18
        const micLocked = Number(locked) / 1e18
        if (!cancelled) {
          setFunds({
            usdt: Number(u) / 10 ** USDT_DECIMALS,
            mic: micTotal,
            micFree: Math.max(0, micTotal - micLocked),
            bnb: Number(b) / 1e18,
          })
          setSwapOpen(Boolean(seeded))
        }
        try {
          const need = (await miceC.quoteMicRequired(1n)) as bigint
          if (!cancelled) setMicNeeded(Number(need) / 1e18)
        } catch { if (!cancelled) setMicNeeded(null) }
      } catch { if (!cancelled) setFunds(null) }
    })()
    return () => { cancelled = true }
  }, [address])

  const fmtNum = (n: number, dp: number) =>
    n.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp })

  const qtyNum = Math.max(1, parseInt(customQty || '1', 10) || 1)

  /** Half the price in USDT, and the MIC half quoted by the contract, times quantity. */
  const needUsdt = (curPrice / 2) * qtyNum
  const needMic = micNeeded === null ? null : micNeeded * qtyNum

  /**
   * A shortfall must come from a real reading. A slow RPC or a disconnected wallet leaves
   * `funds` null, and treating that as "not enough" would block a buyer who has the money.
   */
  const shortUsdt = funds === null ? 0 : Math.max(0, needUsdt - funds.usdt)
  const shortMic = funds === null || needMic === null ? 0 : Math.max(0, needMic - funds.micFree)
  const shortOfMic = shortMic > 0

  /** USDT to swap to close the MIC gap, at the same reference price the contract uses. */
  const swapUsdtForGap = needMic && needMic > 0 ? (needUsdt * shortMic) / needMic : 0

  /** Never claim a wallet cannot pay until both sides have actually been read. */
  const canBuy = funds !== null && needMic !== null && shortUsdt === 0 && shortMic === 0

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
      const amt = ethers.parseUnits(priceUsdt.toString(), USDT_DECIMALS)
      const allowance: bigint = await usdt.allowance(address, CONTRACTS.mice)
      if (allowance < amt) {
        const ap = await usdt.approve(CONTRACTS.mice, amt)
        await ap.wait()
      }

      // The other half is paid in MIC, which the contract pulls and burns. Approving only
      // USDT left every purchase to fail at that transfer.
      const micC = new ethers.Contract(CONTRACTS.mic, USDT_ABI, signer)
      const micNeed: bigint = await mice.quoteMicRequired(1n)
      const micBal: bigint = await micC.balanceOf(address)
      if (micBal < micNeed) {
        throw new Error(
          `Not enough MIC. This licence burns ${(Number(micNeed) / 1e18).toLocaleString(undefined, { maximumFractionDigits: 0 })} MIC and your wallet holds ${(Number(micBal) / 1e18).toLocaleString(undefined, { maximumFractionDigits: 0 })}. Swap USDT for MIC first — nothing has been charged.`,
        )
      }
      const micAllow: bigint = await micC.allowance(address, CONTRACTS.mice)
      if (micAllow < micNeed) {
        const ap2 = await micC.approve(CONTRACTS.mice, micNeed)
        await ap2.wait()
      }

      const tx = await mice.buyLicense(1n)
      const r = await tx.wait()
      setBuyResult({ ok: true, msg: 'MICE License purchased. Tx: ' + r.hash.slice(0, 10) + '...', bought: 1 })
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
              <div
                className={'mice-round ' + (isActive ? 'mice-round-active ' : '') + (isPast ? 'mice-round-past' : '')}
                key={r.num}
                // Rounds open in sequence, so every card but one describes a price nobody
                // can pay today. Dimming them makes the live round findable at a glance.
                style={isActive ? undefined : { opacity: 0.42, filter: 'saturate(0.55)' }}
              >
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
                {/* Buying happens in one place below. A second entry point here bought a
                    single licence with no visible cost breakdown and no wallet check. */}
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

      {/*
        A purchased licence earns nothing at all until it is activated, and there is no
        way to tell that from the wallet — the tokens are simply there. Without this the
        obvious reading of a successful purchase is that mining has started.
      */}
      {buyResult?.ok && (
        <div style={{
          margin: '12px 0', padding: '16px 18px', borderRadius: 10,
          background: 'rgba(240,181,74,.10)', border: '1px solid rgba(240,181,74,.32)',
        }}>
          <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--gold, #F0B54A)', marginBottom: 6 }}>
            Next step — activate to start earning
          </div>
          <div style={{ fontSize: '0.7rem', lineHeight: 1.75, color: 'var(--gray, #b9b9c6)' }}>
            Your licence is not mining yet. Activation is a separate step, and you can
            take it <strong>right now</strong> — there is no waiting period.
            <br />
            Two things start at the moment you activate, not at the moment you bought:
            your <strong>360-day term</strong>, and your <strong>daily MIC rewards</strong>.
            Activate at 3pm and you earn from 3pm — rewards then accrue every second and
            you can claim them to your wallet whenever you like. There is no daily window
            to catch and nothing is lost by claiming late. Earning stops the second your
            360 days are up, and anything earned by then stays claimable.
          </div>
          <Link
            href="/mining"
            style={{
              display: 'inline-block', marginTop: 12, padding: '9px 18px', borderRadius: 8,
              background: 'var(--gold, #F0B54A)', color: '#141018', fontWeight: 700,
              fontSize: '0.72rem', textDecoration: 'none',
            }}
          >
            Go to Mining &rarr;
          </Link>
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
        {/* Row 1 — how many */}
        <div className="mice-custom-input-row">
          <div className="mice-custom-input-wrap" style={{ flex: 1 }}>
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
        </div>

        {/* Row 2 — what it costs, on both sides, against what the wallet holds.
            A licence is half USDT and half MIC-to-burn, and the MIC must already be
            held. Showing only a dollar total is what let a wallet look ready to buy and
            then fail at the transfer, after signing and paying gas. */}
        <div className="mice-cost-row">
          <div className={'mice-cost-box' + (shortUsdt > 0 ? ' mice-cost-short' : '')}>
            <div className="mice-cost-label">USDT REQUIRED</div>
            <div className="mice-cost-value">${fmtNum(needUsdt, 2)}</div>
            <div className="mice-cost-sub">
              {funds === null
                ? 'Connect your wallet to check your balance'
                : <>Your wallet holds <strong>${fmtNum(funds.usdt, 2)}</strong></>}
            </div>
            {shortUsdt > 0 && (
              <div className="mice-cost-gap">
                Short ${fmtNum(shortUsdt, 2)}. Deposit USDT to this wallet to buy MICE.
              </div>
            )}
          </div>

          <div className={'mice-cost-box' + (shortMic > 0 ? ' mice-cost-short' : '')}>
            <div className="mice-cost-label">MIC REQUIRED (BURNED)</div>
            <div className="mice-cost-value">{needMic === null ? '—' : fmtNum(needMic, 0)}</div>
            <div className="mice-cost-sub">
              {funds === null
                ? 'Connect your wallet to check your balance'
                : <>
                    Your wallet holds <strong>{fmtNum(funds.mic, 0)} MIC</strong>
                    {' — '}<strong>{fmtNum(funds.micFree, 0)}</strong> of it spendable
                    {funds.mic > funds.micFree && ', the rest is still vesting'}
                  </>}
            </div>
            {shortMic > 0 && (
              <>
                <div className="mice-cost-gap">
                  Short {fmtNum(shortMic, 0)} MIC. Deposit MIC to this wallet, or swap USDT
                  for MIC, to buy MICE.
                </div>
                <button
                  className="mice-short-btn"
                  style={{ marginTop: 10, width: '100%', border: 'none', cursor: swapOpen ? 'pointer' : 'not-allowed', opacity: swapOpen ? 1 : 0.45 }}
                  disabled={!swapOpen}
                  onClick={() => setSwapOpenModal(true)}
                  title={swapOpen ? 'Swap USDT for MIC without leaving this page'
                                  : 'SWAP opens once the liquidity pool is funded'}
                >
                  {swapOpen ? 'SWAP USDT → MIC' : 'SWAP USDT → MIC (opens soon)'}
                </button>
              </>
            )}
          </div>
        </div>

        <button
          onClick={handleBuyCustom}
          disabled={buying || !canBuy}
          className="mice-round-btn"
          style={{ width: '100%', marginTop: 14 }}
        >
          {buying ? 'Processing…' : canBuy ? `BUY ${qtyNum} MICE` : 'NOT ENOUGH BALANCE'}
        </button>

      {/* Swapping happens here rather than on another page: a buyer who is short of MIC
          should not have to abandon the purchase to fix it. Closing returns them to the
          quantity they had already entered. */}
      {swapOpenModal && (
        <div className="swap-modal-back" onClick={() => setSwapOpenModal(false)}>
          <div className="swap-modal" onClick={(e) => e.stopPropagation()}>
            <button
              className="swap-modal-close"
              onClick={() => setSwapOpenModal(false)}
              aria-label="Close"
            >×</button>
            <SwapPanel onDone={() => setSwapOpenModal(false)} />
          </div>
        </div>
      )}

      </div>

      {/* My Direct Sales / Referral Revenue */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>{'\u{1F4CA}'}</span>
          <span>My Referral Network &amp; Volume</span>
        </div>
        <p style={{ fontSize: '0.7rem', color: '#D4C098', lineHeight: 1.5, marginBottom: 12 }}>
          Your referral network and the volume it has purchased. F1 = direct (7%), F2 = indirect (3%).
          Referral commission is paid instantly on-chain in USDT.
        </p>

        {!address ? (
          <div style={{
            padding: 14, borderRadius: 10, background: 'rgba(40,26,58,0.50)',
            border: '1px solid rgba(212,160,23,0.18)', fontSize: '0.7rem', color: '#D4C098',
          }}>
            Connect your wallet to see your referral network and volume.
          </div>
        ) : netLoading ? (
          <div style={{ fontSize: '0.7rem', color: '#D4C098', padding: 14 }}>Loading your network…</div>
        ) : !team ? (
          <div style={{
            padding: 14, borderRadius: 10, background: 'rgba(40,26,58,0.50)',
            border: '1px solid rgba(212,160,23,0.18)', fontSize: '0.7rem', color: '#D4C098',
          }}>
            Your network summary is unavailable right now. Open{' '}
            <Link href="/network" style={{ color: '#F5D56E' }}>Building / My Community</Link> to retry.
          </div>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
              <Stat label="F1 Direct Referrals" value={fmt(team.f1Members)} sub="members you introduced" accent="#F5D56E" />
              <Stat label="F1 Team Volume" value={'$' + fmt(team.f1Volume)} sub="USDT purchased by F1" accent="#66BB6A" />
              <Stat label="F2 Indirect Referrals" value={fmt(team.f2Members)} sub="members introduced by your F1" accent="#C9A4E6" />
              <Stat label="F2 Team Volume" value={'$' + fmt(team.f2Volume)} sub="USDT purchased by F2" accent="#66BB6A" />
            </div>

            {/*
              The indexer records every referral payout under a single combined type
              (REFERRAL_RESERVE) taken straight from the on-chain event, which does not say
              whether a given payout was the 7% or the 3% leg. Splitting the total into F1 and
              F2 here would be a guess, so it is shown as one figure and labelled as such.
            */}
            <div style={{ marginTop: 10 }}>
              <Stat
                label="Referral Commission Earned (F1 + F2 combined)"
                value={'$' + fmt(
                  (Number(earn?.referralClaimed ?? 0) + Number(earn?.referralUnclaimed ?? 0)).toFixed(2),
                )}
                sub="paid on-chain in USDT — not split by tier at source"
                accent="#F5D56E"
              />
            </div>

            <div style={{ marginTop: 8, fontSize: '0.6rem', color: '#B8A894', lineHeight: 1.5 }}>
              Volume figures cover all qualifying sales (PreSale and MICE combined), not MICE alone.
            </div>
          </>
        )}
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
