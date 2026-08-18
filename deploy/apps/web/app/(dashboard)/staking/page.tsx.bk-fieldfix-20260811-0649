'use client'

import SubNav, { EARN_TABS } from '@/components/layout/SubNav'
import { useApi } from '@/hooks/useApi'
import LoadingSpinner from '@/components/ui/LoadingSpinner'

interface StakingData {
  poolTotal?: string
  myStaked?: string
  currentApy?: string
  estMonthly?: string
  positions?: Array<{
    amount: string
    lockPeriod: string
    rewards: string
    unlock: string
  }>
}

const timeLocks = [
  { days: 30, label: '30 Days', mult: '\u00D71.0', badge: null },
  { days: 90, label: '90 Days', mult: '\u00D71.25', badge: null },
  { days: 180, label: '180 Days', mult: '\u00D71.5', badge: null },
  { days: 360, label: '360 Days', mult: '\u00D72.0', badge: 'MAX' },
]

export default function StakingPage() {
  const { data, loading } = useApi<StakingData>('/staking/tiers')
  const d = data || {}

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
                <div className="stk-hero-stat-value">{d.poolTotal || '--'}</div>
                <div className="stk-hero-stat-unit">MIC</div>
              </div>
              <div className="stk-hero-stat stk-hero-stat-highlight">
                <div className="stk-hero-stat-label">My Staked</div>
                <div className="stk-hero-stat-value gold">{d.myStaked || '--'}</div>
                <div className="stk-hero-stat-unit">MIC</div>
              </div>
            </div>

            <div className="stk-hero-row-bottom">
              <div className="stk-hero-apy">
                <span className="stk-apy-dot" />
                <span className="stk-apy-label">Current APY</span>
                <span className="stk-apy-value">{d.currentApy || '--'}%</span>
              </div>
              <div className="stk-hero-est">
                <span className="stk-est-label">Est. Monthly</span>
                <span className="stk-est-value">{d.estMonthly || '--'} MIC</span>
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

          {(d.positions || []).length === 0 ? (
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
                      {d.positions!.map((p, i) => (
                        <tr key={i}>
                          <td className="stk-td-amount">{p.amount}</td>
                          <td>{p.lockPeriod}</td>
                          <td className="stk-td-rewards">{p.rewards}</td>
                          <td>{p.unlock}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Mobile cards */}
              <div className="stk-cards-mobile">
                {d.positions!.map((p, i) => (
                  <div className="stk-position-card" key={i}>
                    <div className="stk-pc-top">
                      <span className="stk-pc-amount">{p.amount} MIC</span>
                    </div>
                    <div className="stk-pc-grid">
                      <div className="stk-pc-field">
                        <span className="stk-pc-flabel">Lock Period</span>
                        <span className="stk-pc-fvalue">{p.lockPeriod}</span>
                      </div>
                      <div className="stk-pc-field">
                        <span className="stk-pc-flabel">Rewards</span>
                        <span className="stk-pc-fvalue gold">{p.rewards}</span>
                      </div>
                      <div className="stk-pc-field stk-pc-field-full">
                        <span className="stk-pc-flabel">Unlock Date</span>
                        <span className="stk-pc-fvalue">{p.unlock}</span>
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
