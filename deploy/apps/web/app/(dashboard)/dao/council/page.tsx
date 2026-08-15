'use client'

import { useEffect, useState, useCallback, type CSSProperties } from 'react'
import { useAccount } from 'wagmi'
import { BrowserProvider, Contract, parseUnits } from 'ethers'
import { api } from '@/lib/api'
import { USDT_DECIMALS } from '@missionchain/sdk'

// OperationalSalaryPoolV3 — Phase 2c-pivot (centralized vault, policy-only pool)
const OPERATIONAL_POOL_V3 = '0xB2f318b07B7501f6A03b53066610032418F66b85' as const
const OPERATIONAL_POOL_V3_ABI = [
  { type: 'function', name: 'claim', inputs: [], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'claimable', inputs: [{ name: '', type: 'address' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
] as const

// ManagementBonusPoolV3 — Phase 2c-pivot. The approval threshold is read from chain
// (data.thresholdBps), never hardcoded here: it was lowered 75% → 60% on 2026-08-08 so
// five seats pass at three votes, matching DAOGovernor's fixed quorum of 3.
const MGMT_BONUS_POOL_V3 = '0x2bfA50146C01d6c4BFA4A2550385988C2619f033' as const
interface CouncilMember {
  memberId: string
  wallet: string
  role: string
  rightLabel: string
  note: string | null
  active: boolean
  joinedAt: string
}

interface MyStatus {
  isMember: boolean
  member: CouncilMember | null
}

interface FundsMember {
  memberId: string
  wallet: string
  role: string
  active: boolean
  sharePctBps: number
  weeklyMaxoutUsdt: number
  totalReceived: number
  totalClaimed: number
  claimable: number
  allocatedThisWeek: number
  isMe: boolean
}

interface FundsData {
  round: string
  active: boolean
  totalShareBps: number
  totalReceived: number
  totalClaimed: number
  totalClaimable: number
  weekIdx: number
  members: FundsMember[]
}



/**
 * The seven funds, in the admin console's order and under its names.
 *
 * Matching the console exactly is the point: the two surfaces naming the same pool
 * differently is what produced the overlap this rebuild unwound, so a member and an operator
 * discussing "Contingency Reserve" are now certain to mean one contract.
 *
 * This replaces the old Members / Funds Distribution / Proposals / My Activity tabs, which
 * cut governance the wrong way — a member acting on one fund had to know which tab held it.
 */
const FUND_TABS = [
  { id: 'salaries',    label: 'Steward Salaries' },
  { id: 'mgmtops',     label: 'Management & Ops' },
  { id: 'seedbonus',   label: 'Management Bonus' },
  { id: 'contingency', label: 'Contingency Reserve' },
  { id: 'treasury',    label: 'DAO Treasury' },
  { id: 'listing',     label: 'Reserved Listing' },
  { id: 'mi',          label: 'Milestones & Incentives' },
] as const

type FundTabId = (typeof FUND_TABS)[number]['id']

export default function StewardCouncilPage() {
  const { address, isConnected } = useAccount()
  const [myStatus, setMyStatus] = useState<MyStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [seat, setSeat] = useState<any>(null)
  const [fundTab, setFundTab] = useState<FundTabId>('salaries')
  const fundStats = useFundBalances()

  // Tab-specific data
  const [fundsData, setFundsData] = useState<FundsData | null>(null)
  const [claiming, setClaiming] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  // Check council membership on mount
  useEffect(() => {
    if (!isConnected) {
      setLoading(false)
      return
    }
    api<{ data: MyStatus }>('/governance/council/me')
      .then((res) => setMyStatus(res.data))
      .catch(() => setMyStatus({ isMember: false, member: null }))
      .finally(() => setLoading(false))
  }, [isConnected, address])

  // Load tab-specific data when tab changes
  const loadFunds = useCallback(async () => {
    if (!myStatus?.isMember) return
    try {
      const res = await api<{ data: FundsData }>('/governance/funds-distribution/seed')
      setFundsData(res.data)
    } catch (e) { console.error(e) }
  }, [myStatus])

  useEffect(() => { loadFunds() }, [loadFunds])

  /* Eligibility and the current bar come from the server, never inferred here — the same
     answer the admin console reads, so the two cannot disagree about who may vote. */
  useEffect(() => {
    if (!isConnected) return
    api<{ data: any }>('/governance/mgmt-ops/me')
      .then((r) => setSeat(r.data))
      .catch(() => setSeat(null))
  }, [isConnected, address])

  const handleClaim = async () => {
    setClaiming(true)
    try {
      const ethereum = (window as any).ethereum
      if (!ethereum) {
        throw new Error('No wallet detected. Please install MetaMask.')
      }

      const provider = new BrowserProvider(ethereum)
      const signer = await provider.getSigner()
      const pool = new Contract(OPERATIONAL_POOL_V3, OPERATIONAL_POOL_V3_ABI, signer)

      const claimableRaw = await pool.claimable(await signer.getAddress()) as bigint
      if (claimableRaw === 0n) {
        throw new Error('Nothing to claim right now')
      }
      const amountUsdt = Number(claimableRaw) / 10 ** USDT_DECIMALS

      setToast(`Sign wallet to claim $${amountUsdt} USDT...`)
      const tx = await pool.claim()
      setToast(`Confirming on-chain... (${tx.hash.slice(0, 10)}...)`)
      await tx.wait()

      // Record claim history in DB (best-effort — on-chain claim already persisted)
      try {
        await api('/governance/funds-distribution/seed/claim', {
          method: 'POST',
          body: { txHash: tx.hash, amountUsdt } as any,
        } as any)
      } catch { /* ignore — claim already executed on-chain */ }

      setToast(`Claimed $${amountUsdt} USDT on-chain ✓`)
      setTimeout(() => setToast(null), 5000)
      await loadFunds()
    } catch (e: any) {
      const msg = e?.shortMessage || e?.reason || e?.message || 'Unknown error'
      setToast('Claim failed: ' + msg)
      setTimeout(() => setToast(null), 6000)
    } finally {
      setClaiming(false)
    }
  }

  // ─── RENDER ──────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>Loading...</div>
    )
  }

  // Non-council member: greyed/locked state (Option B)
  if (!myStatus?.isMember) {
    return (
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '40px 20px' }}>
        <div className="page-eyebrow">DAO Governance</div>
        <h1 style={{ margin: '6px 0 4px', fontSize: '1.6rem', color: 'var(--white)' }}>
          Steward Council
        </h1>
        <p style={{ color: 'var(--muted)', fontSize: '0.74rem', marginBottom: 24 }}>
          Council members govern revenue distribution, vote on bonus orders, and steer the project.
        </p>

        <div style={{
          padding: 32, textAlign: 'center', background: 'var(--card)',
          border: '1px solid var(--border)', borderRadius: 12, opacity: 0.85,
        }}>
          <div style={{ fontSize: '2.4rem', marginBottom: 12 }}>🔒</div>
          <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--gold)', marginBottom: 8 }}>
            Council Members Only
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--muted)', maxWidth: 480, margin: '0 auto', lineHeight: 1.6 }}>
            This section is reserved for Steward Council members.
          </div>
        </div>
      </div>
    )
  }

  // ─── COUNCIL MEMBER VIEW ─────────────────────────────────────────────

  return (
    <div style={{ padding: '24px 20px', maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div className="page-eyebrow">DAO Governance</div>
          <h1 style={{ margin: '6px 0 4px', fontSize: '1.6rem', color: 'var(--white)' }}>
            Steward Council
          </h1>
          <div style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>
            Welcome, <strong style={{ color: 'var(--gold)' }}>{myStatus.member?.memberId}</strong>{' '}
            (<span style={{ fontFamily: 'var(--font-m)' }}>{myStatus.member?.role}</span>)
          </div>
        </div>
        <div style={{ fontSize: '0.55rem', color: 'var(--gray2)', textAlign: 'right', lineHeight: 1.5 }}>
          One member = one vote<br />
          No token, stake or NFT weighting
        </div>
      </div>

      {/* ─── My seat ──────────────────────────────────────────────────── */}
      <MySeat seat={seat} mine={fundsData?.members?.find((m) => m.isMe) ?? null}
        onClaim={handleClaim} claiming={claiming} />

      {/* ─── Fund tabs, mirroring the admin console ───────────────────── */}
      <div style={{ display: 'flex', gap: 2, marginTop: 18, borderBottom: '1px solid var(--border)', overflowX: 'auto' }}>
        {FUND_TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setFundTab(t.id)}
            style={{
              padding: '9px 14px', fontSize: '0.62rem', fontFamily: 'var(--font-d)',
              letterSpacing: '0.05em', textTransform: 'uppercase',
              background: 'transparent', border: 'none',
              borderBottom: fundTab === t.id ? '2px solid var(--gold)' : '2px solid transparent',
              color: fundTab === t.id ? 'var(--gold)' : 'var(--white)',
              cursor: 'pointer', whiteSpace: 'nowrap',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {fundTab === 'salaries' && (
        <FundSection
          title="Steward Salaries"
          source="SEED 20%"
          layer="APP"
          note="Council salaries via OperationalSalaryPoolV3 — a percentage share with a weekly maxout. Each member claims their own accrual; there is nothing to propose here."
          stat={fundStats?.salaries}
        >
          <FundsTab
            data={fundsData}
            onClaim={handleClaim}
            claiming={claiming}
          />
        </FundSection>
      )}

      {fundTab === 'mgmtops' && (
        <FundSection
          title="Management & Ops"
          source="Pre-Sale + MICE 7.5%"
          layer="APP"
          note="One ManagementPool with two purposes: the six role wallets claim their salary share (66.67%), and the residual (33.33%) is the bonus budget you can propose against below. The six role percentages do not apply to the bonus — a proposal names any wallet and any amount within the balance, and the Council vote decides both. The Owner signs distributeBonus because the contract accepts no other caller; that signature is not a veto."
          stat={fundStats?.mgmtops}
        >
          <MyRoleClaim myWallet={address?.toLowerCase()} setToast={setToast} />
        <UnifiedProposals myWallet={address?.toLowerCase()} setToast={setToast} restrictTo="MGMT_OPS" poolBalance={fundStats?.mgmtops?.balance} />
        </FundSection>
      )}

      {fundTab === 'seedbonus' && (
        <FundSection
          title="Management Bonus"
          source="SEED 10%"
          layer="CONTRACT"
          note="ManagementBonusPoolV3 counts the approvals itself and refuses to pay below the bar, so this vote is enforced by the contract rather than by this website. Only the Owner can cancel an order here."
          stat={fundStats?.seedbonus}
        >
          <UnifiedProposals myWallet={address?.toLowerCase()} setToast={setToast} restrictTo="MGMT_BONUS" poolBalance={fundStats?.seedbonus?.balance} />
        </FundSection>
      )}

      {fundTab === 'contingency' && (
        <FundSection
          title="Contingency Reserve"
          source="SEED 50%"
          layer="CONTRACT"
          note="ReservedExpensesPoolV3, for DAO-decided expenses. Enforced on chain like Management Bonus, and unlike it the member who raised an order may withdraw it themselves."
          stat={fundStats?.contingency}
        >
          <UnifiedProposals myWallet={address?.toLowerCase()} setToast={setToast} restrictTo="CONTINGENCY" poolBalance={fundStats?.contingency?.balance} />
        </FundSection>
      )}

      {fundTab === 'treasury' && (
        <FundSection
          title="DAO Treasury"
          source="Pre-Sale + MICE 12.5%"
          layer="APP"
          note="Split into World Dev 20% / App & Add-ons 40% / Reserved 40%. Each sub-pool allows two transfers per 30 days of at most 5% of its balance, so one proposal names one recipient."
          stat={fundStats?.treasury}
        >
          <UnifiedProposals myWallet={address?.toLowerCase()} setToast={setToast} restrictTo="TREASURY" poolBalance={fundStats?.treasury?.balance} />
        </FundSection>
      )}

      {fundTab === 'listing' && (
        <FundSection
          title="Reserved Listing"
          source="Pre-Sale + MICE 5%"
          layer="APP"
          note="Listing and external-market reserve. Payment is request → 24-hour timelock → execute, and the contract holds one pending request at a time."
          stat={fundStats?.listing}
        >
          <UnifiedProposals myWallet={address?.toLowerCase()} setToast={setToast} restrictTo="LISTING" poolBalance={fundStats?.listing?.balance} />
        </FundSection>
      )}

      {fundTab === 'mi' && (
        <FundSection
          title="Milestones & Incentives"
          source="1.5% of gross + referral with no upline"
          layer="APP"
          note="Held by ClaimRewardsV2 and signed by a CREDITOR_ROLE wallet. Most of the balance is referral commission that had no upline to pay."
          stat={fundStats?.mi}
        >
          <UnifiedProposals myWallet={address?.toLowerCase()} setToast={setToast} restrictTo="MI" poolBalance={fundStats?.mi?.balance} />
        </FundSection>
      )}

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24,
          background: 'var(--card)', border: '1px solid var(--gold)',
          padding: '12px 18px', borderRadius: 8,
          fontSize: '0.7rem', color: 'var(--white)', maxWidth: 400, zIndex: 9999,
        }}>
          {toast}
        </div>
      )}
    </div>
  )
}

/**
 * What this wallet may do, and what it is owed.
 *
 * Two different scopes deliberately sit together: eligibility and the bar apply to every
 * fund below, while the salary figures are this member's own and appear nowhere else on the
 * page — the Steward Salaries section shows the pool, not the person.
 */
function MySeat({ seat, mine, onClaim, claiming }: {
  seat: any
  mine: FundsMember | null
  onClaim: () => void
  claiming: boolean
}) {
  const unclaimed = mine ? Math.max(0, mine.totalReceived - mine.totalClaimed) : null
  return (
    <div className="card" style={{ marginTop: 16, padding: 16 }}>
      <div style={{ fontSize: '0.55rem', color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
        My seat
      </div>

      <div style={{ fontSize: '0.68rem', marginBottom: 12 }}>
        {seat
          ? seat.canVote
            ? (
              <>
                You may propose and vote as{' '}
                <strong>{seat.tier === 'COUNCIL' ? 'a Steward Council member' : seat.tier}</strong>.
                <span style={{ color: 'var(--gray2)' }}>
                  {' '}A proposal carries at <strong>{seat.approvalsRequired} of {seat.eligibleCount}</strong>
                  {' '}({(seat.thresholdBps / 100).toFixed(0)}% of everyone eligible). The bar follows the
                  membership — it is never a fixed count.
                </span>
              </>
            )
            : <span style={{ color: 'var(--muted)' }}>{seat.reason}</span>
          : <span style={{ color: 'var(--gray2)' }}>Checking your seat…</span>}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
        <PoolStat label="TOTAL" value={mine ? `$${mine.totalReceived.toLocaleString()}` : '—'} sub="Salary earned to date" greyed={!mine} />
        <PoolStat label="Claimed" value={mine ? `$${mine.totalClaimed.toLocaleString()}` : '—'} sub="Already withdrawn" greyed={!mine} />
        <PoolStat label="Unclaimed" value={unclaimed === null ? '—' : `$${unclaimed.toLocaleString()}`} sub="Earned, not yet withdrawn" greyed={!mine} />
      </div>

      {mine && (
        <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <button
            className="btn btn-gold btn-sm"
            disabled={claiming || mine.claimable <= 0}
            onClick={onClaim}
            style={{ fontSize: '0.7rem', padding: '6px 18px', fontWeight: 700 }}
          >
            {claiming ? 'CLAIMING…' : `CLAIM $${mine.claimable.toLocaleString()}`}
          </button>
          {/* Claimable and unclaimed differ on purpose — the weekly maxout caps how much of
              what you have earned can be drawn right now. */}
          <span style={{ fontSize: '0.58rem', color: 'var(--gray2)' }}>
            {mine.claimable <= 0
              ? 'Nothing is claimable this week.'
              : `Claimable now after the weekly maxout of $${mine.weeklyMaxoutUsdt.toLocaleString()}.`}
          </span>
        </div>
      )}
    </div>
  )
}

/** One fund, with the layer badge that says who actually enforces its vote. */
/* ══════════════════════════════════════════════════════════════════════════
   FUND BALANCES — the same three figures the finance console shows
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Read straight from the contracts, not from an endpoint of ours.
 *
 * These sat empty at first: the sections were built with their proposal forms and no money on
 * them at all, so every fund read as if it held nothing. A member deciding whether to propose
 * a payment needs the balance in front of them, and it must be the same number the Owner sees
 * when signing — reading the chain in both places is the only way that stays true.
 *
 * Where a contract keeps no spend counter, Spent is accumulated − balance and says so, exactly
 * as the console does.
 */
type FundStat = { accumulated: number | null; spent: number | null; balance: number | null; exact: boolean }

function useFundBalances() {
  const [stats, setStats] = useState<Record<string, FundStat> | null>(null)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const { JsonRpcProvider, Contract, formatUnits } = await import('ethers')
        const { getActiveAddresses, getActiveChain } = await import('@missionchain/sdk')
        const A = getActiveAddresses() as Record<string, string>
        const chain = getActiveChain()
        const p = new JsonRpcProvider(chain.rpcUrls[0], chain.chainId, { staticNetwork: true })
        const n = (v: bigint) => Number(formatUnits(v, USDT_DECIMALS))

        const budget = new Contract(A.SeedBudgetV5c, [
          'function slotTotalReceived(uint8) view returns (uint256)',
          'function slotTotalReleased(uint8) view returns (uint256)',
          'function slotBalance(uint8) view returns (uint256)',
        ], p)
        /** A SEED slot tracks its own releases, so Spent is exact rather than derived. */
        const slot = async (i: number): Promise<FundStat> => ({
          accumulated: n(await budget.slotTotalReceived(i)),
          spent: n(await budget.slotTotalReleased(i)),
          balance: n(await budget.slotBalance(i)),
          exact: true,
        })

        const usdt = new Contract(chain.usdtAddress ?? '0x55d398326f99059fF775485246999027B3197955',
          ['function balanceOf(address) view returns (uint256)'], p)
        /** These keep no spend counter, so Spent can only be accumulated − balance. */
        const pool = async (addr: string): Promise<FundStat> => {
          const c = new Contract(addr, ['function totalReceived() view returns (uint256)'], p)
          const acc = n(await c.totalReceived().catch(() => 0n))
          const bal = n(await usdt.balanceOf(addr))
          return { accumulated: acc, spent: Math.max(0, acc - bal), balance: bal, exact: false }
        }

        const [salaries, seedBonus, contingency, mgmt, treasury, listing] = await Promise.all([
          slot(1), slot(2), slot(3),
          pool(A.ManagementPool), pool(A.TreasuryManager), pool(A.ListingReserve),
        ])

        /* ManagementPool backs one tab but two purposes. The six role shares sum to 6667 and
           the residual is the bonus budget; pendingAmount is salary accrued and unclaimed, so
           the bonus balance is whatever the pool holds beyond it. */
        const mp = new Contract(A.ManagementPool, [
          'function getRoleBps(uint256) view returns (uint256)',
          'function pendingAmount(uint256) view returns (uint256)',
        ], p)
        let rolesBps = 0, rolesPending = 0
        for (let i = 0; i < 6; i++) {
          rolesBps += Number(await mp.getRoleBps(i).catch(() => 0n))
          rolesPending += n(await mp.pendingAmount(i).catch(() => 0n))
        }
        const bonusBps = rolesBps > 0 ? 10000 - rolesBps : 0
        const bonusAcc = mgmt.accumulated === null || bonusBps === 0
          ? null : (mgmt.accumulated * bonusBps) / 10000
        const bonusBal = mgmt.balance === null ? null : Math.max(0, mgmt.balance - rolesPending)

        const cr = new Contract(A.ClaimRewardsV2, ['function miBalance() view returns (uint256)'], p)
        const miBal = n(await cr.miBalance().catch(() => 0n))

        if (!alive) return
        setStats({
          salaries,
          /* The tab's proposal form spends the bonus residual, so those are the figures it shows. */
          mgmtops: {
            accumulated: bonusAcc,
            spent: bonusAcc === null || bonusBal === null ? null : Math.max(0, bonusAcc - bonusBal),
            balance: bonusBal,
            exact: false,
          },
          seedbonus: seedBonus,
          contingency,
          treasury,
          listing,
          /* ClaimRewardsV2 exposes miBalance and no counters, so the other two are unknown
             rather than zero — a zero here would read as "nothing was ever spent". */
          mi: { accumulated: null, spent: null, balance: miBal, exact: false },
        })
      } catch {
        if (alive) setStats(null)
      }
    })()
    return () => { alive = false }
  }, [])

  return stats
}

function FundStats({ stat }: { stat: FundStat | null | undefined }) {
  const money = (v: number | null) =>
    v === null ? 'No data' : `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 12 }}>
      <PoolStat label="TOTAL" value={stat ? money(stat.accumulated) : '…'}
        sub="Lifetime on-chain receipts" greyed={!stat} />
      <PoolStat label="Spent" value={stat ? money(stat.spent) : '…'}
        sub={stat?.exact ? 'Exact — the contract counts releases' : 'Derived: accumulated − balance'} greyed={!stat} />
      <PoolStat label="Balance" value={stat ? money(stat.balance) : '…'}
        sub="Live USDT held, remaining to spend" greyed={!stat} />
    </div>
  )
}

/**
 * The salary half of Management & Ops — the part a role holder claims for themselves.
 *
 * This was missing: the section described a 66.67% share the six role wallets claim, and then
 * offered only the bonus proposal form, so there was nowhere to claim it. `claim(roleIndex)`
 * requires `msg.sender == _roleAddresses[roleIndex]` — the Owner cannot claim for anyone — so
 * the control has to live here rather than in the console.
 *
 * Every role the wallet holds is listed, not just the first: all six currently point at one
 * address, and showing one of them would hide five claims.
 */
function MyRoleClaim({ myWallet, setToast }: { myWallet?: string; setToast: (s: string | null) => void }) {
  const ROLE_NAMES = ['Founder', 'Architect', 'CTO', 'Social Media', 'Global Training', 'Tech Team']
  const [mine, setMine] = useState<any[] | null>(null)
  const [busy, setBusy] = useState<number | null>(null)

  const load = useCallback(async () => {
    if (!myWallet) { setMine([]); return }
    try {
      const { JsonRpcProvider, Contract, formatUnits } = await import('ethers')
      const { getActiveAddresses, getActiveChain } = await import('@missionchain/sdk')
      const A = getActiveAddresses() as Record<string, string>
      const chain = getActiveChain()
      const c = new Contract(A.ManagementPool, [
        'function getRoleAddress(uint256) view returns (address)',
        'function getRoleBps(uint256) view returns (uint256)',
        'function pendingAmount(uint256) view returns (uint256)',
      ], new JsonRpcProvider(chain.rpcUrls[0], chain.chainId, { staticNetwork: true }))
      const held: any[] = []
      for (let i = 0; i < 6; i++) {
        const addr = String(await c.getRoleAddress(i)).toLowerCase()
        if (addr !== myWallet.toLowerCase()) continue
        held.push({
          index: i, name: ROLE_NAMES[i],
          bps: Number(await c.getRoleBps(i)),
          pending: Number(formatUnits(await c.pendingAmount(i), USDT_DECIMALS)),
        })
      }
      setMine(held)
    } catch { setMine([]) }
  }, [myWallet])

  useEffect(() => { load() }, [load])

  const claim = async (role: any) => {
    setBusy(role.index)
    try {
      const { getActiveAddresses } = await import('@missionchain/sdk')
      const { BrowserProvider, Contract } = await import('ethers')
      const eth = (window as any).ethereum
      if (!eth) throw new Error('No wallet detected.')
      await eth.request({ method: 'eth_requestAccounts' })
      const signer = await new BrowserProvider(eth).getSigner()
      const A = getActiveAddresses() as Record<string, string>
      const c = new Contract(A.ManagementPool, ['function claim(uint256 roleIndex)'], signer)
      const tx = await c.claim(role.index)
      setToast('Waiting for confirmation…')
      const r = await tx.wait(1)
      if (!r || r.status !== 1) throw new Error('Transaction reverted')
      setToast(`Claimed ${role.name} ✓`)
      await load()
    } catch (e: any) {
      setToast(e?.code === 4001 || e?.code === 'ACTION_REJECTED'
        ? 'Transaction rejected in wallet'
        : 'Claim failed: ' + (e?.shortMessage || e?.message || 'Unknown error'))
    } finally {
      setBusy(null)
      setTimeout(() => setToast(null), 5000)
    }
  }

  return (
    <div className="card" style={{ padding: 14, marginBottom: 12 }}>
      <div style={{ fontSize: '0.7rem', fontWeight: 700, marginBottom: 2 }}>Salary share (66.67%)</div>
      <div style={{ fontSize: '0.55rem', color: 'var(--gray2)', marginBottom: 10, lineHeight: 1.7 }}>
        Paid by role, not by proposal. The contract only accepts a claim from the wallet holding
        the role, so nobody — the Owner included — can claim it for you.
      </div>
      {mine === null ? (
        <div style={{ fontSize: '0.62rem', color: 'var(--gray2)' }}>Checking your roles…</div>
      ) : mine.length === 0 ? (
        <div style={{ fontSize: '0.62rem', color: 'var(--muted)' }}>
          This wallet holds none of the six management roles, so there is nothing to claim on this
          side of the pool. The bonus budget below is open to every Council member.
        </div>
      ) : mine.map((r) => (
        <div key={r.index} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 12, flexWrap: 'wrap', borderTop: '1px solid var(--border)', padding: '9px 0' }}>
          <div style={{ fontSize: '0.65rem' }}>
            <strong>{r.name}</strong>
            <span style={{ color: 'var(--gray2)' }}> · {(r.bps / 100).toFixed(2)}% of the pool</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontFamily: 'var(--font-m)', fontSize: '0.7rem', color: 'var(--gold)' }}>
              ${r.pending.toLocaleString('en-US', { maximumFractionDigits: 4 })}
            </span>
            <button className="btn btn-gold btn-sm" disabled={busy !== null || r.pending <= 0}
              onClick={() => claim(r)}
              title={r.pending > 0 ? 'Claim to your own wallet' : 'Nothing has accrued to this role yet'}
              style={{ fontSize: '0.6rem', padding: '4px 14px' }}>
              {busy === r.index ? '…' : 'Claim'}
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}

function FundSection({ title, source, layer, note, stat, children }: {
  title: string
  source: string
  layer: 'CONTRACT' | 'APP'
  note: string
  stat: FundStat | null | undefined
  children: React.ReactNode
}) {
  return (
    <div style={{ marginTop: 20 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: '1rem', color: 'var(--gold)' }}>{title}</h2>
        <span style={{ fontSize: '0.6rem', color: 'var(--gray2)', fontFamily: 'var(--font-m)' }}>{source}</span>
        <span style={{ fontSize: '0.58rem', color: layer === 'CONTRACT' ? 'var(--green2)' : 'var(--gold)' }}>
          {layer === 'CONTRACT' ? '🔒 enforced by the contract' : '⚠️ recorded here, not enforced on chain'}
        </span>
      </div>
      <div style={{ fontSize: '0.62rem', color: 'var(--muted)', lineHeight: 1.7, margin: '6px 0 10px', maxWidth: 900 }}>
        {note}
      </div>
      <FundStats stat={stat} />
      {children}
    </div>
  )
}

// ─── STEWARD SALARIES: the pool and its member allocation ──────────────

function FundsTab({
  data, onClaim, claiming,
}: {
  data: FundsData | null
  onClaim: () => void
  claiming: boolean
}) {
  return (
    <div>
      {/* The SEED / Pre-Sale / MICE picker was removed: this pool is funded by SEED and by
          nothing else. Pre-Sale and MICE fund ManagementPool, which is its own tab — offering
          them here implied a salary pool that does not exist and returned an empty round. */}
      {!data ? (
        /* Saying "not yet active" here blamed the roadmap for what is almost always a slow
           or failed read — the SEED call was taking over thirty seconds and the panel
           reported it as an unlaunched feature. */
        <div className="card" style={{ padding: 32, textAlign: 'center', color: 'var(--muted)' }}>
          <div style={{ fontSize: '0.85rem', marginBottom: 4 }}>Could not load the SEED salary pool.</div>
          <div style={{ fontSize: '0.6rem' }}>The on-chain read did not return. Reload to try again.</div>
        </div>
      ) : !data.active ? (
        <div className="card" style={{ padding: 32, textAlign: 'center', color: 'var(--muted)' }}>
          <div style={{ fontSize: '0.85rem' }}>{(data as any)?.round ?? 'SEED'} pool is not open.</div>
        </div>
      ) : (
        <div className="card" style={{ padding: 16 }}>
          {/* No summary boxes here at all. Pool receipts and Paid out repeated TOTAL and SPENT
              from the row above, and the pool-wide claimable figure is already a column of the
              table below — a total printed twice invites the two to be read as different
              things. The table is the whole panel. */}
          {/* Members table */}
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.65rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  <th style={th}>Member ID</th>
                  <th style={th}>%</th>
                  <th style={th}>Weekly Maxout</th>
                  <th style={th}>This Week</th>
                  <th style={th}>Entitled (lifetime)</th>
                  <th style={th}>Received</th>
                  <th style={th}>Not yet received</th>
                  <th style={th}>Claimable now</th>
                  <th style={{ ...th, textAlign: 'right' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {data.members.length === 0 ? (
                  <tr><td colSpan={9} style={{ padding: 20, textAlign: 'center', color: 'var(--muted)' }}>No members enrolled in this pool yet.</td></tr>
                ) : data.members.map((m) => (
                  <tr key={m.wallet} style={{ borderTop: '1px solid var(--border)', background: m.isMe ? 'rgba(212,160,23,0.05)' : undefined }}>
                    <td style={td}>
                      <strong>{m.memberId}</strong>
                      {m.isMe && <span style={{ marginLeft: 6, fontSize: '0.5rem', color: 'var(--gold)' }}>(you)</span>}
                    </td>
                    <td style={td}>{(m.sharePctBps / 100).toFixed(2)}%</td>
                    <td style={td}>${m.weeklyMaxoutUsdt.toLocaleString()}</td>
                    <td style={td}>
                      <span style={{ color: m.allocatedThisWeek >= m.weeklyMaxoutUsdt ? 'var(--crimson2)' : 'var(--white)' }}>
                        ${m.allocatedThisWeek.toLocaleString()}
                      </span>
                      <span style={{ color: 'var(--gray2)', fontSize: '0.5rem' }}> / ${m.weeklyMaxoutUsdt.toLocaleString()}</span>
                    </td>
                    <td style={td}>${m.totalReceived.toLocaleString()}</td>
                    <td style={td}>${m.totalClaimed.toLocaleString()}</td>
                    {/* Entitlement minus what has been taken. This is NOT the same as
                        claimable: the weekly maxout caps how much of it can be drawn now. */}
                    <td style={td}>${Math.max(0, m.totalReceived - m.totalClaimed).toLocaleString()}</td>
                    <td style={{ ...td, color: 'var(--gold)', fontWeight: 700 }}>${m.claimable.toLocaleString()}</td>
                    <td style={{ ...td, textAlign: 'right' }}>
                      {/* Shown on your own row whatever the amount, greyed when there is
                          nothing to take. Hiding it behind `claimable > 0` left a dash where
                          the control belongs, which reads as "this feature is missing"
                          rather than "you have nothing to claim this week". */}
                      {m.isMe ? (
                        <button
                          onClick={onClaim}
                          disabled={claiming || m.claimable <= 0}
                          className="btn btn-gold btn-sm"
                          title={m.claimable > 0 ? 'Claim to your own wallet' : 'Nothing is claimable this week'}
                          style={{ fontSize: '0.6rem', padding: '4px 10px' }}
                        >
                          {claiming ? '...' : 'Claim'}
                        </button>
                      ) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* The two right-hand columns are read as the same number otherwise, and a member
              who sees "not yet received" but a smaller "claimable now" should know why. */}
          <div style={{ fontSize: '0.55rem', color: 'var(--gray2)', marginTop: 8, lineHeight: 1.7 }}>
            <strong>Entitled</strong> is your share of everything the pool has ever received.
            {' '}<strong>Not yet received</strong> is what remains of it. <strong>Claimable now</strong> is
            the part of that you can take this week {'\u2014'} your weekly maxout caps it, and the remainder
            stays in the pool for later weeks. You claim from your own wallet; nobody can claim for you.
          </div>
        </div>
      )}
    </div>
  )
}


/* ══════════════════════════════════════════════════════════════════════════
   UNIFIED PROPOSALS — every fund the DAO decides on, in one board
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Six funds, two enforcement layers, one screen.
 *
 * They were spread across three pages and two mechanisms, so a member had to know which
 * fund lived where before they could vote on anything. What actually differs between them
 * is only *who enforces the threshold*, and that difference is worth showing plainly rather
 * than hiding behind a uniform interface:
 *
 *   🔒 CONTRACT — ManagementBonusPoolV3, ReservedExpensesPoolV3.
 *      The contract counts approvals itself and refuses to execute below 60% of the active
 *      Council. Bypassing this website changes nothing. `executeOrder` has no modifier, so
 *      once the bar is met anyone may push it through — including a member the Owner would
 *      rather not have. That is the point.
 *
 *   ⚠️ APP — TreasuryManager, ListingReserve, ManagementPool, ClaimRewardsV2.
 *      These contracts have no voting code at all; they only ask "does this wallet hold the
 *      role?". The vote is real as a process and is recorded, but a key holder calling the
 *      contract directly would not be stopped by it. Members deserve to know which promise
 *      they are relying on, so each row says so.
 *
 * Eligibility is never decided here — the server answers it, so phase 2 (MFP holders and
 * stakers) needs no change to this file.
 */

type FundKey = 'MGMT_BONUS' | 'CONTINGENCY' | 'TREASURY' | 'LISTING' | 'MGMT_OPS' | 'MI'

/** Fund order on this page, identical to the admin console's tab order. */
const FUND_ORDER: FundKey[] = ['MGMT_OPS', 'MGMT_BONUS', 'CONTINGENCY', 'TREASURY', 'LISTING', 'MI']

const FUNDS: Record<FundKey, {
  label: string
  source: string
  layer: 'CONTRACT' | 'APP'
  addrKey: string
  /** Where an approved payment is finally signed. */
  execution: string
}> = {
  MGMT_BONUS:  { label: 'Management Bonus',    source: 'SEED 10%',            layer: 'CONTRACT', addrKey: 'ManagementBonusPoolV3',  execution: 'Anyone may execute once the bar is met' },
  CONTINGENCY: { label: 'Contingency Reserve', source: 'SEED 50%',            layer: 'CONTRACT', addrKey: 'ReservedExpensesPoolV3', execution: 'Anyone may execute once the bar is met' },
  TREASURY:    { label: 'DAO Treasury',        source: 'Pre-Sale + MICE 12.5%', layer: 'APP',    addrKey: 'TreasuryManager',        execution: 'Owner signs · 5% per transfer, 2 per 30 days' },
  LISTING:     { label: 'Reserved Listing',    source: 'Pre-Sale + MICE 5%',  layer: 'APP',      addrKey: 'ListingReserve',         execution: 'Owner signs · 24-hour timelock' },
  MGMT_OPS:    { label: 'Management & Ops — Bonus', source: '2.5% of gross · the 33.33% residual of the pool', layer: 'APP', addrKey: 'ManagementPool', execution: 'Owner signs distributeBonus — any wallet, any amount within the bonus balance' },
  MI:          { label: 'Milestones & Incentives', source: 'Marketing + unclaimed referral', layer: 'APP', addrKey: 'ClaimRewardsV2', execution: 'Signed by a CREDITOR_ROLE wallet' },
}

/** The two funds whose proposals live on chain rather than in our database. */
const ON_CHAIN: Record<string, { fund: FundKey; thresholdFn: string; ordersAbi: string; extraAbi: string[] }> = {
  MGMT_BONUS: {
    fund: 'MGMT_BONUS',
    thresholdFn: 'thresholdBps',
    ordersAbi: 'function orders(uint256) view returns (uint256 id, address recipient, uint256 amount, string content, address requester, uint64 createdAt, uint8 status, uint64 executedAt)',
    extraAbi: ['function approvalsCount(uint256) view returns (uint256)', 'function hasVoted(uint256,address) view returns (bool)'],
  },
  CONTINGENCY: {
    fund: 'CONTINGENCY',
    thresholdFn: 'threshold',
    ordersAbi: 'function orders(uint256) view returns (address proposer, address recipient, uint256 amount, string content, uint256 approvalCount, bool executed, bool cancelled)',
    extraAbi: ['function approvals(uint256,address) view returns (bool)'],
  },
}

/**
 * `restrictTo` renders one fund instead of all of them.
 *
 * The page shows a section per fund, so the seat card and the fund picker are drawn once at
 * the top rather than repeated seven times; in restricted mode the create form is pinned to
 * the section's own fund, which also removes the way a member could pick one fund's heading
 * and file the proposal against another.
 */
function UnifiedProposals({ myWallet, setToast, restrictTo, poolBalance }: {
  myWallet?: string
  setToast: (s: string | null) => void
  restrictTo?: FundKey
  /** Live balance of this fund, used only to warn — never to block. */
  poolBalance?: number | null
}) {
  const [me, setMe] = useState<any>(null)
  const [rows, setRows] = useState<any[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [fund, setFund] = useState<FundKey>(restrictTo ?? 'MGMT_BONUS')
  const [form, setForm] = useState({ recipient: '', amount: '', content: '' })

  const load = useCallback(async () => {
    try {
      /* Eligibility, and the bar, come from the server — never inferred here. */
      const meRes = await api<{ data: any }>('/governance/mgmt-ops/me').catch(() => null)
      if (meRes) setMe(meRes.data)

      const out: any[] = []

      // ── app-level proposals: all four funds in one call ──
      const app = await api<{ data: any[] }>('/governance/mgmt-ops/proposals').catch(() => ({ data: [] }))
      for (const p of app.data || []) {
        const key = (p.pool === 'LISTING' ? 'LISTING' : p.pool === 'TREASURY' ? 'TREASURY'
          : p.pool === 'MI' ? 'MI' : 'MGMT_OPS') as FundKey
        out.push({
          kind: 'app', id: p.id, fund: key, content: p.content, amount: p.amountUsdt,
          recipient: p.recipient, proposer: p.proposer, status: p.status,
          approvals: p.forVotes, required: p.approvalsRequired, voters: p.councilSize,
          myVote: p.myVote, windowClosed: p.windowClosed, tx: p.executedTx,
        })
      }

      // ── on-chain orders: read the two contracts directly ──
      const { JsonRpcProvider, Contract, formatUnits } = await import('ethers')
      const { getActiveAddresses, getActiveChain } = await import('@missionchain/sdk')
      const A = getActiveAddresses() as Record<string, string>
      const chain = getActiveChain()
      const provider = new JsonRpcProvider(chain.rpcUrls[0], chain.chainId, { staticNetwork: true })

      for (const cfg of Object.values(ON_CHAIN)) {
        const meta = FUNDS[cfg.fund]
        const addr = A[meta.addrKey]
        if (!addr) continue
        try {
          const c = new Contract(addr, [
            `function ${cfg.thresholdFn}() view returns (uint256)`,
            'function nextOrderId() view returns (uint256)',
            'function council() view returns (address)',
            cfg.ordersAbi,
            ...cfg.extraAbi,
          ], provider)
          const [thr, next, councilAddr] = await Promise.all([c[cfg.thresholdFn](), c.nextOrderId(), c.council()])
          const council = new Contract(councilAddr, ['function activeCount() view returns (uint256)'], provider)
          const active = Number(await council.activeCount().catch(() => 0))
          const required = active > 0 ? Math.ceil((active * Number(thr)) / 10000) : 0

          for (let id = Number(next); id >= 1 && id > Number(next) - 10; id--) {
            const raw = await c.orders(id)
            const isBonus = cfg.fund === 'MGMT_BONUS'
            const status = isBonus
              ? (Number(raw[6]) === 1 ? 'EXECUTED' : Number(raw[6]) === 2 ? 'CANCELLED' : 'OPEN')
              : (raw[5] ? 'EXECUTED' : raw[6] ? 'CANCELLED' : 'OPEN')
            const approvals = isBonus
              ? Number(await c.approvalsCount(id).catch(() => 0n))
              : Number(raw[4])
            let mine: boolean | null = null
            if (myWallet) {
              mine = isBonus
                ? await c.hasVoted(id, myWallet).catch(() => false)
                : await c.approvals(id, myWallet).catch(() => false)
            }
            out.push({
              kind: 'chain', id, fund: cfg.fund,
              content: String(isBonus ? raw[3] : raw[3]),
              amount: Number(formatUnits(isBonus ? raw[2] : raw[2], USDT_DECIMALS)),
              recipient: String(isBonus ? raw[1] : raw[1]),
              proposer: String(isBonus ? raw[4] : raw[0]),
              status, approvals, required, voters: active,
              myVote: mine ? true : null,
              address: addr,
            })
          }
        } catch { /* a pool that cannot be read must not hide the others */ }
      }

      setRows(restrictTo ? out.filter((r) => r.fund === restrictTo) : out)
    } catch {
      setRows([])
    }
  }, [myWallet, restrictTo])

  useEffect(() => { load() }, [load])

  const chainWrite = async (label: string, addr: string, abi: string[], call: (c: any) => Promise<any>) => {
    setBusy(label)
    try {
      const { BrowserProvider, Contract } = await import('ethers')
      const eth = (window as any).ethereum
      if (!eth) throw new Error('No wallet detected.')
      await eth.request({ method: 'eth_requestAccounts' })
      const signer = await new BrowserProvider(eth).getSigner()
      const tx = await call(new Contract(addr, abi, signer))
      setToast('Waiting for confirmation…')
      const r = await tx.wait(1)
      if (!r || r.status !== 1) throw new Error('Transaction reverted')
      setToast(`${label} ✓`)
      await load()
    } catch (e: any) {
      setToast(`${label} failed: ${e?.shortMessage || e?.message || 'Unknown error'}`)
    } finally {
      setBusy(null)
      setTimeout(() => setToast(null), 5000)
    }
  }

  const submit = async () => {
    const amt = parseFloat(form.amount)
    if (!/^0x[0-9a-fA-F]{40}$/.test(form.recipient.trim()) || !(amt > 0) || !form.content.trim()) {
      setToast('Recipient, amount and purpose are all required.')
      setTimeout(() => setToast(null), 4000)
      return
    }
    const meta = FUNDS[fund]

    if (meta.layer === 'CONTRACT') {
      const { getActiveAddresses } = await import('@missionchain/sdk')
      const { parseUnits } = await import('ethers')
      const addr = (getActiveAddresses() as Record<string, string>)[meta.addrKey]
      await chainWrite('Proposal created', addr,
        ['function createOrder(address recipient, uint256 amount, string content) returns (uint256)'],
        (c) => c.createOrder(form.recipient.trim(), parseUnits(String(amt), USDT_DECIMALS), form.content.trim()))
    } else {
      setBusy('create')
      try {
        await api('/governance/mgmt-ops/proposals', {
          method: 'POST',
          /* A plain object: api() serialises it. Passing a string here double-encodes it. */
          body: { pool: fund, recipient: form.recipient.trim(), amountUsdt: amt, content: form.content.trim() },
        })
        setToast('Proposal raised ✓')
        await load()
      } catch (e: any) {
        setToast(e?.message || 'Could not raise the proposal.')
      } finally {
        setBusy(null)
        setTimeout(() => setToast(null), 5000)
      }
    }
    setForm({ recipient: '', amount: '', content: '' })
  }

  const vote = async (row: any, support: boolean) => {
    if (row.kind === 'chain') {
      if (!support) {
        setToast('This fund records approvals only — an objection is simply not approving.')
        setTimeout(() => setToast(null), 5000)
        return
      }
      await chainWrite(`Approved #${row.id}`, row.address,
        ['function approveOrder(uint256 id)'], (c) => c.approveOrder(row.id))
      return
    }
    setBusy(`vote-${row.id}`)
    try {
      await api(`/governance/mgmt-ops/proposals/${row.id}/vote`, {
        method: 'POST', body: { support },
      })
      await load()
    } catch (e: any) {
      setToast(e?.message || 'Vote failed')
    } finally {
      setBusy(null)
    }
  }

  const execute = async (row: any) =>
    chainWrite(`Executed #${row.id}`, row.address,
      ['function executeOrder(uint256 id)'], (c) => c.executeOrder(row.id))

  const canAct = me?.canVote === true
  const box = {
    padding: '9px 12px', fontSize: '0.68rem', width: '100%', borderRadius: 8,
    background: 'var(--card-bg)', color: 'var(--white)', border: '1px solid var(--border)',
  }

  return (
    <div>
      {/* Who am I, and what is the bar — straight from the server. Drawn once by the page in
          per-fund mode, so it is suppressed here rather than repeated under every heading. */}
      {!restrictTo && (
      <div className="card" style={{ padding: 14, marginBottom: 12 }}>
        {me ? (
          me.canVote ? (
            <div style={{ fontSize: '0.68rem' }}>
              You may propose and vote as <strong>{me.tier === 'COUNCIL' ? 'a Steward Council member' : me.tier}</strong>.
              <span style={{ color: 'var(--gray2)' }}>
                {' '}A proposal carries at <strong>{me.approvalsRequired} of {me.eligibleCount}</strong>
                {' '}({(me.thresholdBps / 100).toFixed(0)}% of everyone eligible).
              </span>
            </div>
          ) : (
            <div style={{ fontSize: '0.68rem', color: 'var(--muted)' }}>{me.reason}</div>
          )
        ) : (
          <div style={{ fontSize: '0.68rem', color: 'var(--gray2)' }}>Checking your seat…</div>
        )}
      </div>
      )}

      {canAct && (
        <div className="card" style={{ padding: 14, marginBottom: 12 }}>
          <div style={{ fontSize: '0.7rem', fontWeight: 700, marginBottom: 2 }}>
            New proposal{restrictTo ? ` — ${FUNDS[fund].label}` : ''}
          </div>
          <div style={{ fontSize: '0.55rem', color: 'var(--gray2)', marginBottom: 8 }}>
            Spends {FUNDS[fund].source}.
          </div>
          {!restrictTo && (
            <select value={fund} onChange={(e) => setFund(e.target.value as FundKey)}
              style={{ ...box, marginBottom: 6 }}>
              {FUND_ORDER.map((k) => (
                <option key={k} value={k}>{FUNDS[k].label} — {FUNDS[k].source}</option>
              ))}
            </select>
          )}
          <div style={{ fontSize: '0.55rem', color: 'var(--gray2)', lineHeight: 1.7, marginBottom: 8 }}>
            {FUNDS[fund].layer === 'CONTRACT'
              ? '🔒 The contract counts the votes and refuses to pay below the bar. '
              : '⚠️ The vote is recorded here; the contract itself has no voting rule. '}
            {FUNDS[fund].execution}.
          </div>
          <input style={{ ...box, marginBottom: 6 }} value={form.content}
            onChange={(e) => setForm({ ...form, content: e.target.value })}
            placeholder="What is this payment for? (English)" />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 8 }}>
            <input style={box} inputMode="decimal" value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value.replace(/,/g, '.') })}
              placeholder="Amount (USDT)" />
            <input style={box} value={form.recipient}
              onChange={(e) => setForm({ ...form, recipient: e.target.value })}
              placeholder="Recipient wallet (0x...)" />
          </div>
          {/* A warning, not a block. Neither the contracts nor the API check the balance when a
              proposal is raised — only execution moves money — and that is deliberate: these
              pools take revenue continuously, so a proposal can be funded between being agreed
              and being paid. What was missing was saying so, which left "$1 approved out of a
              $0.00 pool" looking like a bug. */}
          {(() => {
            const amt = parseFloat(form.amount)
            if (!(amt > 0) || poolBalance === null || poolBalance === undefined || amt <= poolBalance) return null
            return (
              <div style={{ fontSize: '0.58rem', color: 'var(--gold)', lineHeight: 1.7, marginBottom: 8 }}>
                ⚠️ This fund holds{' '}
                <strong>${poolBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
                {' '}right now, less than the ${amt.toLocaleString()} you are asking for. The proposal can
                still be raised and voted through — nothing checks the balance until execution — but it
                cannot be paid until the fund receives enough.
              </div>
            )
          })()}
          <button onClick={submit} disabled={!!busy}
            style={{ ...box, width: 'auto', padding: '7px 20px', fontWeight: 700, cursor: 'pointer',
              background: 'var(--gold)', color: '#000', border: 'none' }}>
            {busy === 'create' || busy === 'Proposal created' ? '...' : 'CREATE PROPOSAL'}
          </button>
        </div>
      )}

      <div className="card" style={{ padding: 14 }}>
        {rows === null && <div style={{ fontSize: '0.65rem', color: 'var(--gray2)' }}>Loading proposals…</div>}
        {rows?.length === 0 && (
          <div style={{ fontSize: '0.65rem', color: 'var(--gray2)' }}>
            {restrictTo ? 'No proposals raised against this fund yet.' : 'No proposals in any fund yet.'}
          </div>
        )}
        {rows?.map((r) => {
          const meta = FUNDS[r.fund as FundKey]
          const met = r.required > 0 && r.approvals >= r.required
          return (
            <div key={`${r.kind}-${r.fund}-${r.id}`} style={{ borderTop: '1px solid var(--border)', padding: '11px 0' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
                <div style={{ fontSize: '0.7rem', fontWeight: 700 }}>{r.content}</div>
                <span className={`badge ${r.status === 'EXECUTED' ? 'b-green' : r.status === 'CANCELLED' || r.status === 'REJECTED' ? 'b-gray' : 'b-gold'}`}>
                  {r.status}
                </span>
              </div>
              <div style={{ fontSize: '0.56rem', color: 'var(--gray2)', marginTop: 4, lineHeight: 1.7 }}>
                <strong style={{ color: 'var(--gold)' }}>{meta.label}</strong> · {meta.source}
                {' · '}{meta.layer === 'CONTRACT' ? '🔒 enforced by the contract' : '⚠️ enforced by this app'}
                <br />
                ${r.amount.toLocaleString()} → {r.recipient.slice(0, 8)}…{r.recipient.slice(-6)}
                {' · '}<strong style={{ color: met ? 'var(--success)' : 'var(--gold)' }}>
                  {r.approvals}/{r.required}
                </strong> of {r.voters} eligible
                {r.kind === 'app' && r.status === 'OPEN' && (r.windowClosed ? ' · 72h window closed' : ' · inside 72h window')}
                {r.tx && ` · paid ${String(r.tx).slice(0, 10)}…`}
              </div>
              {canAct && r.status === 'OPEN' && (
                <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                  <button onClick={() => vote(r, true)} disabled={!!busy}
                    style={{ ...box, width: 'auto', padding: '4px 14px', fontSize: '0.58rem', cursor: 'pointer',
                      borderColor: r.myVote === true ? 'var(--gold)' : 'var(--border)' }}>
                    Approve
                  </button>
                  {r.kind === 'app' && (
                    <button onClick={() => vote(r, false)} disabled={!!busy}
                      style={{ ...box, width: 'auto', padding: '4px 14px', fontSize: '0.58rem', cursor: 'pointer',
                        borderColor: r.myVote === false ? 'var(--error)' : 'var(--border)' }}>
                      Object
                    </button>
                  )}
                  {r.kind === 'chain' && met && (
                    <button onClick={() => execute(r)} disabled={!!busy}
                      style={{ ...box, width: 'auto', padding: '4px 16px', fontSize: '0.58rem', fontWeight: 700,
                        cursor: 'pointer', background: 'var(--gold)', color: '#000', border: 'none' }}>
                      EXECUTE
                    </button>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* SixRolePool lived here: ManagementPool's six roles and bonus figure, rendered inside the
   Steward Salaries section whenever the API answered model === 'six-role'. That answer only
   came back for the Pre-Sale and MICE rounds, which this page no longer requests, and those
   figures belong to the Management & Ops section in any case. */

/* MgmtOpsProposals lived here: an unused second implementation of the Management & Ops
   proposal list, still describing a fixed "3 of 5" threshold. Nothing rendered it — the live
   one is UnifiedProposals. Deleted rather than left to be found and reused. */

const th = {
  padding: '8px 10px', textAlign: 'left' as const, color: 'var(--gray)',
  fontWeight: 600, fontSize: '0.55rem', fontFamily: 'var(--font-d)',
  letterSpacing: '0.08em', textTransform: 'uppercase' as const,
}
/*
 * Body cells set no size of their own, so they inherited the page default and rendered
 * nearly twice the size of the column headings above them: the member rows dominated the
 * table and pushed the last column off a phone screen. Matching `th` puts the data at the
 * same weight as the labels describing it. Both tables on this page share this style.
 */
const td = {
  padding: '8px 10px',
  color: 'var(--white)',
  fontSize: '0.55rem',
  lineHeight: 1.5,
}

function PoolStat({ label, value, sub, greyed }: { label: string; value: string; sub?: string; greyed?: boolean }) {
  return (
    <div style={{
      padding: 10, background: 'var(--bg4)', borderRadius: 6,
      opacity: greyed ? 0.5 : 1,
    }}>
      <div style={{ fontSize: '0.5rem', color: 'var(--gray2)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</div>
      <div style={{ fontSize: '0.95rem', color: 'var(--white)', fontWeight: 700, marginTop: 4, fontFamily: 'var(--font-m)' }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: '0.5rem', color: 'var(--gray2)', marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border)', fontSize: '0.7rem' }}>
      <span style={{ color: 'var(--muted)' }}>{label}</span>
      <span style={{ color: 'var(--white)', fontFamily: mono ? 'var(--font-m)' : undefined }}>{value}</span>
    </div>
  )
}
