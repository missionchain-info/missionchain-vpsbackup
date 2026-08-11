'use client'

import { useAccount } from 'wagmi'
import SubNav, { EARN_TABS } from '@/components/layout/SubNav'
import { useApi } from '@/hooks/useApi'
import LoadingSpinner from '@/components/ui/LoadingSpinner'

/**
 * Global staking stats — GET /staking/info.
 * The page used to read these off /staking/tiers, which only ever returned the static
 * rule book (model / lockPeriods / stakingRules / daoRequirement). Every number on the
 * hero was therefore `undefined` and rendered as "--".
 */
interface StakingInfo {
  data: {
    totalStaked: string
    totalWeightedStaked: string
    activePositions: number
    stakingEmissionPct: number
    estimatedAPY: string
  }
}

/** One row of GET /staking/positions (auth) — mirrors the StakingPosition table. */
interface StakingPositionRow {
  stakeId: number
  amount: string
  weightedAmount: string
  tier: string
  lockPeriod: string
  stakeTime: string
  unlockTime: string
  active: boolean
}

interface StakingPositions {
  data: StakingPositionRow[]
  pagination: { page: number; limit: number; total: number }
}

const num = (v: string | number | undefined | null) => {
  const n = Number(v ?? NaN)
  return Number.isFinite(n) ? n : null
}

/** "Days360" → "360 Days"; anything unexpected is shown as-is. */
function formatLockPeriod(raw: string): string {
  const m = /^Days(\d+)$/.exec(raw)
  return m ? `${m[1]} Days` : raw
}

function formatDate(iso: string): string {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return '-'
  return new Date(t).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

const timeLocks = [
  { days: 30, label: '30 Days', mult: '\u00D71.0', badge: null },
  { days: 90, label: '90 Days', mult: '\u00D71.25', badge: null },
  { days: 180, label: '180 Days', mult: '\u00D71.5', badge: null },
  { days: 360, label: '360 Days', mult: '\u00D72.0', badge: 'MAX' },
]

export default function StakingPage() {
  const { address } = useAccount()
  const { data: infoRes, loading: loadingInfo } = useApi<StakingInfo>('/staking/info')
  // Per-wallet positions need a JWT, so only ask once a wallet is connected.
  const { data: posRes, loading: loadingPositions } = useApi<StakingPositions>('/staking/positions', { enabled: !!address })

  const loading = loadingInfo || (!!address && loadingPositions)

  const info = infoRes?.data
  const positions = (posRes?.data || []).filter((p) => p.active)

  const poolTotal = num(info?.totalStaked)
  const myStaked = address ? positions.reduce((sum, p) => sum + (num(p.amount) ?? 0), 0) : null
  // With nothing staked network-wide the APY is undefined, not zero — don't print "0%".
  const currentApy = poolTotal && poolTotal > 0 ? num(info?.estimatedAPY) : null
  const estMonthly = currentApy !== null && myStaked !== null && myStaked > 0
    ? (myStaked * currentApy) / 100 / 12
    : null

  const fmt = (v: number | null, digits = 0) =>
    v === null ? '--' : v.toLocaleString('en-US', { maximumFractionDigits: digits })

  return (
    <>
      <SubNav items={EARN_TABS} />
      {loading ? <LoadingSpinner /> : null}
      <div className="stk-page">

        {/* ── Staking Overview Hero ── */}
        <div className="stk-hero">
          <div className="stk-hero-bg" />
          <div className="stk-hero-shine" />
          <div className="stk-hero-content">
            <div className="stk-hero-top">
              <div className="stk-hero-icon-wrap">
                <span className="stk-hero-icon">{'\uD83D\uDD12'}</span>
              </div>
              <div className="stk-hero-title-group">
                <div className="stk-hero-label">MY STAKING</div>
              </div>
            </div>

            <div className="stk-hero-stats">
              <div className="stk-hero-stat">
                <div className="stk-hero-stat-label">Pool Total</div>
                <div className="stk-hero-stat-value">{fmt(poolTotal)}</div>
                <div className="stk-hero-stat-unit">MIC</div>
              </div>
              <div className="stk-hero-stat stk-hero-stat-highlight">
                <div className="stk-hero-stat-label">My Staked</div>
                <div className="stk-hero-stat-value gold">{fmt(myStaked)}</div>
                <div className="stk-hero-stat-unit">MIC</div>
              </div>
            </div>

            <div className="stk-hero-row-bottom">
              <div className="stk-hero-apy">
                <span className="stk-apy-dot" />
                <span className="stk-apy-label">Current APY</span>
                <span className="stk-apy-value">{currentApy === null ? '--' : `${fmt(currentApy, 2)}%`}</span>
              </div>
              <div className="stk-hero-est">
                <span className="stk-est-label">Est. Monthly</span>
                <span className="stk-est-value">{fmt(estMonthly)} MIC</span>
              </div>
            </div>
          </div>
        </div>

        {/* ── Staking Rules ── */}
        <div className="stk-tiers-section">
          <div className="stk-section-header">
            <span className="stk-section-icon">{'\uD83C\uDFC6'}</span>
            <span className="stk-section-title">Staking Rules</span>
          </div>
          <div className="stk-section-note">
            MIC staking is independent from NFT ownership. Staking rewards are based only on staked amount and time-lock duration.
          </div>

          <div className="stk-tiers-scroll">
            {[
              { name: 'Weight Formula', value: 'Stake × Time-Lock', helper: 'No NFT multiplier' },
              { name: 'Reward Pool', value: '20% Emissions', helper: 'Pure MIC staking pool' },
              { name: 'Caps', value: 'No NFT Cap', helper: 'Any MIC holder can stake' },
              { name: 'DAO Vote', value: 'MFP-NFT Required', helper: 'Plus 100K MIC staked + 360d lock' },
            ].map((rule) => (
              <div className="stk-tier-card" key={rule.name}>
                <div className="stk-tier-name">{rule.name}</div>
                <div className="stk-tier-mult">{rule.value}</div>
                <div className="stk-tier-cap">{rule.helper}</div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Time-Lock Selector ── */}
        <div className="stk-lock-section">
          <div className="stk-section-header">
            <span className="stk-section-icon">{'\u23F1\uFE0F'}</span>
            <span className="stk-section-title">Time-Lock Bonus</span>
          </div>
          <div className="stk-section-note">
            Longer lock periods earn higher multipliers on staking rewards.
          </div>

          <div className="stk-lock-grid">
            {timeLocks.map((tl) => (
              <div className={`stk-lock-card${tl.badge ? ' stk-lock-max' : ''}`} key={tl.days}>
                {tl.badge && <div className="stk-lock-badge">{tl.badge}</div>}
                <div className="stk-lock-days">{tl.label}</div>
                <div className="stk-lock-mult">{tl.mult}</div>
                <div className="stk-lock-bar">
                  <div className="stk-lock-bar-fill" style={{ width: `${(tl.days / 360) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>

          <div className="stk-lock-info">
            <div className="stk-lock-info-icon">{'\u2139\uFE0F'}</div>
            <div className="stk-lock-info-text">
              Locked MIC (under vesting) can stake with a minimum 360-day lock. MFP-NFT does not change staking rewards; it only gates DAO voting eligibility.
            </div>
          </div>
        </div>

        {/* ── Active Positions ── */}
        <div className="stk-positions-section">
          <div className="stk-section-header">
            <span className="stk-section-icon">{'\uD83D\uDCCA'}</span>
            <span className="stk-section-title">Your Active Positions</span>
          </div>

          {positions.length === 0 ? (
            <div className="stk-empty">
              <div className="stk-empty-icon">{'\uD83D\uDD12'}</div>
              <div className="stk-empty-text">No active positions</div>
              <div className="stk-empty-sub">Stake your MIC tokens to earn rewards from the 20% emission pool</div>
            </div>
          ) : (
            <>
              {/* Desktop table */}
              <div className="stk-table-desktop">
                <div className="table-responsive">
                  <table className="stk-table">
                    <thead>
                      <tr>
                        <th>Amount</th>
                        <th>Lock Period</th>
                        <th>Rewards</th>
                        <th>Unlock Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {positions.map((p) => (
                        <tr key={p.stakeId}>
                          <td className="stk-td-amount">{fmt(num(p.amount))}</td>
                          <td>{formatLockPeriod(p.lockPeriod)}</td>
                          {/* Pending reward lives on-chain (NFTStaking.pendingReward); the API does not expose it yet. */}
                          <td className="stk-td-rewards">-</td>
                          <td>{formatDate(p.unlockTime)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Mobile cards */}
              <div className="stk-cards-mobile">
                {positions.map((p) => (
                  <div className="stk-position-card" key={p.stakeId}>
                    <div className="stk-pc-top">
                      <span className="stk-pc-amount">{fmt(num(p.amount))} MIC</span>
                    </div>
                    <div className="stk-pc-grid">
                      <div className="stk-pc-field">
                        <span className="stk-pc-flabel">Lock Period</span>
                        <span className="stk-pc-fvalue">{formatLockPeriod(p.lockPeriod)}</span>
                      </div>
                      <div className="stk-pc-field">
                        <span className="stk-pc-flabel">Rewards</span>
                        <span className="stk-pc-fvalue gold">-</span>
                      </div>
                      <div className="stk-pc-field stk-pc-field-full">
                        <span className="stk-pc-flabel">Unlock Date</span>
                        <span className="stk-pc-fvalue">{formatDate(p.unlockTime)}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

      </div>
    </>
  )
}
