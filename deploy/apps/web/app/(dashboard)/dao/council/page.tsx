'use client'

import { useEffect, useState, useCallback, type CSSProperties } from 'react'
import { useAccount } from 'wagmi'
import { BrowserProvider, Contract, parseUnits } from 'ethers'
import { api } from '@/lib/api'

// OperationalSalaryPoolV3 — Phase 2c-pivot (centralized vault, policy-only pool)
const OPERATIONAL_POOL_V3 = '0xB2f318b07B7501f6A03b53066610032418F66b85' as const
const OPERATIONAL_POOL_V3_ABI = [
  { type: 'function', name: 'claim', inputs: [], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'claimable', inputs: [{ name: '', type: 'address' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
] as const

// ManagementBonusPoolV3 — Phase 2c-pivot (Council vote 75% threshold)
const MGMT_BONUS_POOL_V3 = '0x2bfA50146C01d6c4BFA4A2550385988C2619f033' as const
const MGMT_BONUS_POOL_V3_ABI = [
  'function createOrder(address recipient, uint256 amount, string content) returns (uint256)',
  'function approveOrder(uint256 id)',
  'function executeOrder(uint256 id)',
  'function cancelOrder(uint256 id)',
] as const

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

interface MyActivityData {
  memberId: string
  joinedAt: string
  claims: Array<{ id: string; amountUsdt: number; txHash: string | null; createdAt: string }>
  votes: any[]
  proposals: any[]
}

interface TreasuryData {
  seedOperational: { totalReceived: number; totalClaimed: number; totalClaimable: number }
  seedManagementBonus: { totalReceived: number; status: string }
  seedReserved: { totalReceived: number; status: string }
  presale: { active: boolean; status: string }
  mice: { active: boolean; status: string }
}

interface ProposalOrder {
  id: number
  recipient: string
  recipientLabel: string
  recipientType: 'council' | 'user' | 'external'
  amount: number
  content: string
  requester: string
  requesterLabel: string
  requesterType: 'council' | 'user' | 'external'
  createdAt: number
  status: 'PENDING' | 'EXECUTED' | 'CANCELLED'
  executedAt: number
  approvalsCount: number
  approvalRatioBps: number
  executable: boolean
  myVote: boolean
  createdTxHash: string | null
  executedTxHash: string | null
  cancelledTxHash: string | null
  myVoteTxHash: string | null
}

interface ProposalsData {
  thresholdBps: number
  activeCouncilCount: number
  slotBalance: number
  ownerWallet: string
  callerWallet: string
  callerIsOwner: boolean
  orders: ProposalOrder[]
}

const TABS = [
  { id: 'members',    label: 'Members' },
  { id: 'funds',      label: 'Funds Distribution' },
  { id: 'proposals',  label: 'Proposals' },
  { id: 'activity',   label: 'My Activity' },
] as const

const SUB_ROUNDS = [
  { id: 'seed',    label: 'SEED',     active: true },
  { id: 'presale', label: 'Pre-Sale', active: false },
  { id: 'mice',    label: 'MICE Sale',active: false },
] as const

const shortWallet = (w: string) => (w.length > 12 ? `${w.slice(0, 6)}...${w.slice(-4)}` : w)

export default function StewardCouncilPage() {
  const { address, isConnected } = useAccount()
  const [myStatus, setMyStatus] = useState<MyStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<typeof TABS[number]['id']>('members')

  // Tab-specific data
  const [members, setMembers] = useState<CouncilMember[]>([])
  const [activeRound, setActiveRound] = useState<typeof SUB_ROUNDS[number]['id']>('seed')
  const [fundsData, setFundsData] = useState<FundsData | null>(null)
  const [activity, setActivity] = useState<MyActivityData | null>(null)
  const [treasury, setTreasury] = useState<TreasuryData | null>(null)
  const [memberSearch, setMemberSearch] = useState('')
  const [showMemberModal, setShowMemberModal] = useState<CouncilMember | null>(null)
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
  const loadMembers = useCallback(async () => {
    if (!myStatus?.isMember) return
    try {
      const res = await api<{ data: CouncilMember[] }>('/governance/council/members')
      setMembers(res.data || [])
    } catch (e) { console.error(e) }
  }, [myStatus])

  const loadFunds = useCallback(async () => {
    if (!myStatus?.isMember) return
    try {
      const res = await api<{ data: FundsData }>(`/governance/funds-distribution/${activeRound}`)
      setFundsData(res.data)
    } catch (e) { console.error(e) }
  }, [myStatus, activeRound])

  const loadActivity = useCallback(async () => {
    if (!myStatus?.isMember) return
    try {
      const res = await api<{ data: MyActivityData }>('/governance/my-activity')
      setActivity(res.data)
    } catch (e) { console.error(e) }
  }, [myStatus])

  const loadTreasury = useCallback(async () => {
    if (!myStatus?.isMember) return
    try {
      const res = await api<{ data: TreasuryData }>('/governance/treasury/overview')
      setTreasury(res.data)
    } catch (e) { console.error(e) }
  }, [myStatus])

  useEffect(() => { loadTreasury() }, [loadTreasury])
  useEffect(() => {
    if (activeTab === 'members') loadMembers()
    if (activeTab === 'funds') loadFunds()
    if (activeTab === 'activity') loadActivity()
  }, [activeTab, loadMembers, loadFunds, loadActivity])

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
      const amountUsdt = Number(claimableRaw) / 1e6

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
      await loadTreasury()
      await loadActivity()
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
          Phase 1 voting: 1 member = 1 vote<br />
          Phase 2 (DAO): MFP-NFT weighted (coming)
        </div>
      </div>

      {/* Treasury Overview */}
      {treasury && (
        <div className="card" style={{ marginTop: 16, padding: 16 }}>
          <div style={{ fontSize: '0.55rem', color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
            Treasury Overview
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
            <PoolStat label="SEED Operational" value={`$${treasury.seedOperational.totalReceived.toLocaleString()}`} sub={`Claimable $${treasury.seedOperational.totalClaimable.toLocaleString()}`} />
            <PoolStat label="SEED Mgmt Bonus" value={`$${treasury.seedManagementBonus.totalReceived.toLocaleString()}`} sub="Phase 2c" greyed />
            <PoolStat label="SEED Reserved" value={`$${treasury.seedReserved.totalReceived.toLocaleString()}`} sub="Phase 2c" greyed />
          </div>
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginTop: 16, borderBottom: '1px solid var(--border)', overflowX: 'auto' }}>
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            style={{
              padding: '10px 18px', fontSize: '0.7rem', fontFamily: 'var(--font-d)',
              letterSpacing: '0.06em', textTransform: 'uppercase',
              background: 'transparent', border: 'none',
              borderBottom: activeTab === t.id ? '2px solid var(--gold)' : '2px solid transparent',
              color: activeTab === t.id ? 'var(--gold)' : 'var(--white)',
              cursor: 'pointer', whiteSpace: 'nowrap',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div style={{ marginTop: 16 }}>
        {activeTab === 'members' && (
          <MembersTab members={members} myWallet={address?.toLowerCase()} search={memberSearch} setSearch={setMemberSearch} onSelect={setShowMemberModal} />
        )}
        {activeTab === 'funds' && (
          <FundsTab
            data={fundsData}
            activeRound={activeRound}
            setActiveRound={setActiveRound}
            onClaim={handleClaim}
            claiming={claiming}
          />
        )}
        {activeTab === 'proposals' && (
          <ProposalsTab myWallet={address?.toLowerCase()} setToast={setToast} />
        )}
        {activeTab === 'activity' && <ActivityTab data={activity} />}
      </div>

      {/* Member modal */}
      {showMemberModal && (
        <div
          onClick={() => setShowMemberModal(null)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
            zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--card)', border: '1px solid var(--border)',
              borderRadius: 12, padding: 24, maxWidth: 440, width: '90%',
            }}
          >
            <div style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--gold)', marginBottom: 4 }}>
              {showMemberModal.memberId}
            </div>
            <div style={{ fontSize: '0.7rem', color: 'var(--muted)', marginBottom: 14 }}>
              {showMemberModal.role}
            </div>
            <Row label="Wallet" value={shortWallet(showMemberModal.wallet)} mono />
            <Row label="Right" value={showMemberModal.rightLabel} />
            <Row label="Status" value={showMemberModal.active ? 'Active' : 'Inactive'} />
            <Row label="Joined" value={new Date(showMemberModal.joinedAt).toISOString().slice(0, 10)} />
            {showMemberModal.note && <Row label="Note" value={showMemberModal.note} />}
            <button
              className="btn btn-outline btn-sm"
              style={{ marginTop: 16, width: '100%', fontSize: '0.7rem' }}
              onClick={() => setShowMemberModal(null)}
            >
              Close
            </button>
          </div>
        </div>
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

// ─── MEMBERS TAB ───────────────────────────────────────────────────────

function MembersTab({
  members, myWallet, search, setSearch, onSelect,
}: {
  members: CouncilMember[]
  myWallet?: string
  search: string
  setSearch: (s: string) => void
  onSelect: (m: CouncilMember) => void
}) {
  const filtered = members.filter((m) => {
    if (!search) return true
    const q = search.toLowerCase()
    return m.memberId.toLowerCase().includes(q) || m.wallet.toLowerCase().includes(q) || m.role.toLowerCase().includes(q)
  })

  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
        <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--gold)' }}>
          {members.length} Council Members
        </div>
        <input
          type="text"
          placeholder="Search by ID, wallet, role..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            padding: '6px 12px', fontSize: '0.7rem', borderRadius: 6,
            background: 'var(--card-bg)', color: 'var(--white)',
            border: '1px solid var(--border)', minWidth: 240,
          }}
        />
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.7rem' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              <th style={th}>Member ID</th>
              <th style={th}>Wallet</th>
              <th style={th}>Role</th>
              <th style={th}>Status</th>
              <th style={th}>Joined</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={5} style={{ padding: 20, textAlign: 'center', color: 'var(--muted)' }}>No members found.</td></tr>
            ) : filtered.map((m) => (
              <tr key={m.wallet} onClick={() => onSelect(m)} style={{ borderTop: '1px solid var(--border)', cursor: 'pointer' }}>
                <td style={td}>
                  <strong style={{ color: 'var(--white)' }}>{m.memberId}</strong>
                  {m.wallet.toLowerCase() === myWallet && (
                    <span style={{ marginLeft: 6, fontSize: '0.55rem', color: 'var(--gold)' }}>(you)</span>
                  )}
                </td>
                <td style={{ ...td, fontFamily: 'var(--font-m)', color: 'var(--gold)' }}>{shortWallet(m.wallet)}</td>
                <td style={td}>{m.role}</td>
                <td style={td}>
                  <span style={{
                    fontSize: '0.55rem', padding: '2px 8px', borderRadius: 10,
                    background: m.active ? 'rgba(76,175,80,0.15)' : 'rgba(120,120,120,0.15)',
                    color: m.active ? '#4CAF50' : 'var(--gray2)',
                  }}>{m.active ? 'Active' : 'Inactive'}</span>
                </td>
                <td style={{ ...td, color: 'var(--gray2)' }}>{new Date(m.joinedAt).toISOString().slice(0, 10)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── FUNDS TAB ─────────────────────────────────────────────────────────

function FundsTab({
  data, activeRound, setActiveRound, onClaim, claiming,
}: {
  data: FundsData | null
  activeRound: 'seed' | 'presale' | 'mice'
  setActiveRound: (r: 'seed' | 'presale' | 'mice') => void
  onClaim: () => void
  claiming: boolean
}) {
  return (
    <div>
      {/* Round sub-tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
        {SUB_ROUNDS.map((r) => (
          <button
            key={r.id}
            disabled={!r.active}
            onClick={() => r.active && setActiveRound(r.id)}
            style={{
              padding: '8px 14px', fontSize: '0.65rem', fontFamily: 'var(--font-d)',
              borderRadius: 6,
              background: activeRound === r.id ? 'var(--gold)' : 'var(--card-bg)',
              color: activeRound === r.id ? '#000' : (r.active ? 'var(--white)' : 'var(--gray2)'),
              border: '1px solid var(--border)',
              cursor: r.active ? 'pointer' : 'not-allowed',
              opacity: r.active ? 1 : 0.5,
            }}
          >
            {r.label}{!r.active && ' (soon)'}
          </button>
        ))}
      </div>

      {!data || !data.active ? (
        <div className="card" style={{ padding: 32, textAlign: 'center', color: 'var(--muted)' }}>
          <div style={{ fontSize: '0.85rem', marginBottom: 4 }}>{(data as any)?.round ?? activeRound.toUpperCase()} pool not yet active.</div>
          <div style={{ fontSize: '0.6rem' }}>Coming in Phase 2c.</div>
        </div>
      ) : (
        <div className="card" style={{ padding: 16 }}>
          {/* Pool stats */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 16 }}>
            <PoolStat label="Total Received" value={`$${data.totalReceived.toLocaleString()}`} />
            <PoolStat label="Total Claimed" value={`$${data.totalClaimed.toLocaleString()}`} />
            <PoolStat label="Total Claimable" value={`$${data.totalClaimable.toLocaleString()}`} />
            <PoolStat label="Allocated %" value={`${(data.totalShareBps / 100).toFixed(2)}%`} sub={`Week ${data.weekIdx}`} />
          </div>

          {/* Members table */}
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.65rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  <th style={th}>Member ID</th>
                  <th style={th}>%</th>
                  <th style={th}>Weekly Maxout</th>
                  <th style={th}>This Week</th>
                  <th style={th}>Total Received</th>
                  <th style={th}>Claimed</th>
                  <th style={th}>Claimable</th>
                  <th style={{ ...th, textAlign: 'right' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {data.members.length === 0 ? (
                  <tr><td colSpan={8} style={{ padding: 20, textAlign: 'center', color: 'var(--muted)' }}>No members enrolled in this pool yet.</td></tr>
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
                    <td style={{ ...td, color: 'var(--gold)', fontWeight: 700 }}>${m.claimable.toLocaleString()}</td>
                    <td style={{ ...td, textAlign: 'right' }}>
                      {m.isMe && m.claimable > 0 ? (
                        <button
                          onClick={onClaim}
                          disabled={claiming}
                          className="btn btn-gold btn-sm"
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
        </div>
      )}
    </div>
  )
}

// ─── PROPOSALS TAB ─────────────────────────────────────────────────────
// ManagementBonusPoolV3 wired Phase 2c-pivot. Council members create bonus
// orders → 1 vote each → ≥75% → anyone can execute (releases USDT from
// SeedBudgetV5c slot[2] via release()).

function ProposalsTab({
  myWallet,
  setToast,
}: {
  myWallet?: string
  setToast: (s: string | null) => void
}) {
  const [data, setData] = useState<ProposalsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [recipientInput, setRecipientInput] = useState('')
  const [amountInput, setAmountInput] = useState('')
  const [contentInput, setContentInput] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api<{ data: ProposalsData }>('/governance/proposals')
      setData(res.data)
    } catch (e: any) {
      const msg = e?.shortMessage || e?.message || 'Unknown error'
      setToast('Load proposals failed: ' + msg)
      setTimeout(() => setToast(null), 5000)
    } finally {
      setLoading(false)
    }
  }, [setToast])

  useEffect(() => { load() }, [load])

  const getSigner = async () => {
    const ethereum = (window as any).ethereum
    if (!ethereum) throw new Error('No wallet detected. Please install MetaMask.')
    const provider = new BrowserProvider(ethereum)
    return provider.getSigner()
  }

  const handleCreate = async () => {
    const recipient = recipientInput.trim()
    const amount = parseFloat(amountInput)
    const content = contentInput.trim()
    if (!/^0x[a-fA-F0-9]{40}$/.test(recipient)) {
      setToast('Recipient must be a valid 0x address')
      setTimeout(() => setToast(null), 4000)
      return
    }
    if (isNaN(amount) || amount <= 0) {
      setToast('Amount must be > 0 USDT')
      setTimeout(() => setToast(null), 4000)
      return
    }
    if (content.length < 5) {
      setToast('Content must be at least 5 chars')
      setTimeout(() => setToast(null), 4000)
      return
    }
    setBusy('create')
    try {
      const signer = await getSigner()
      const mbp = new Contract(MGMT_BONUS_POOL_V3, MGMT_BONUS_POOL_V3_ABI, signer)
      const amountWei = parseUnits(amount.toFixed(6), 6)
      setToast('Sign wallet to create order...')
      const tx = await mbp.createOrder(recipient, amountWei, content)
      setToast(`Confirming on-chain... (${tx.hash.slice(0, 10)}...)`)
      await tx.wait()
      setToast('Order created ✓')
      setTimeout(() => setToast(null), 4000)
      setShowCreate(false)
      setRecipientInput('')
      setAmountInput('')
      setContentInput('')
      await load()
    } catch (e: any) {
      const msg = e?.shortMessage || e?.reason || e?.message || 'Unknown error'
      setToast('Create failed: ' + msg)
      setTimeout(() => setToast(null), 6000)
    } finally {
      setBusy(null)
    }
  }

  const handleAction = async (action: 'approve' | 'execute' | 'cancel', id: number) => {
    setBusy(`${action}-${id}`)
    try {
      const signer = await getSigner()
      const mbp = new Contract(MGMT_BONUS_POOL_V3, MGMT_BONUS_POOL_V3_ABI, signer)
      setToast(`Sign wallet to ${action} order #${id}...`)
      let tx
      if (action === 'approve') tx = await mbp.approveOrder(id)
      else if (action === 'execute') tx = await mbp.executeOrder(id)
      else tx = await mbp.cancelOrder(id)
      setToast(`Confirming on-chain... (${tx.hash.slice(0, 10)}...)`)
      await tx.wait()
      setToast(`Order #${id} ${action}d ✓`)
      setTimeout(() => setToast(null), 4000)
      await load()
    } catch (e: any) {
      const msg = e?.shortMessage || e?.reason || e?.message || 'Unknown error'
      setToast(`${action} failed: ` + msg)
      setTimeout(() => setToast(null), 6000)
    } finally {
      setBusy(null)
    }
  }

  if (loading) {
    return <div className="card" style={{ padding: 24, color: 'var(--muted)' }}>Loading proposals...</div>
  }
  if (!data) {
    return <div className="card" style={{ padding: 24, color: 'var(--muted)' }}>No data.</div>
  }

  const thresholdPct = (data.thresholdBps / 100).toFixed(0)

  return (
    <div>
      {/* Stats row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 12 }}>
        <PoolStat label="Threshold" value={`${thresholdPct}%`} sub={`Active council: ${data.activeCouncilCount}`} />
        <PoolStat label="Mgmt Bonus Pool" value={`$${data.slotBalance.toLocaleString()}`} sub="Slot[2] balance" />
        <PoolStat label="Total Orders" value={String(data.orders.length)} />
        <PoolStat label="Pending" value={String(data.orders.filter((o) => o.status === 'PENDING').length)} />
      </div>

      {/* Create button + form */}
      <div className="card" style={{ padding: 16, marginBottom: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <div style={{ fontSize: '0.78rem', color: 'var(--gold)', fontWeight: 700 }}>Bonus Orders</div>
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="btn btn-gold btn-sm"
            style={{ fontSize: '0.65rem', padding: '6px 14px' }}
          >
            {showCreate ? 'Cancel' : '+ Create Order'}
          </button>
        </div>
        {showCreate && (
          <div style={{ marginTop: 12, padding: 12, background: 'var(--bg4)', borderRadius: 6 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 160px', gap: 10, marginBottom: 10 }}>
              <div>
                <label style={lblStyle}>RECIPIENT WALLET</label>
                <input
                  type="text"
                  value={recipientInput}
                  onChange={(e) => setRecipientInput(e.target.value)}
                  placeholder="0x..."
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={lblStyle}>AMOUNT USDT</label>
                <input
                  type="number" min="0" step="0.01"
                  value={amountInput}
                  onChange={(e) => setAmountInput(e.target.value)}
                  placeholder="0.00"
                  style={inputStyle}
                />
              </div>
            </div>
            <div style={{ marginBottom: 10 }}>
              <label style={lblStyle}>CONTENT / REASON</label>
              <textarea
                value={contentInput}
                onChange={(e) => setContentInput(e.target.value)}
                placeholder="Brief description for council vote..."
                rows={2}
                style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
              />
            </div>
            <button
              onClick={handleCreate}
              disabled={busy === 'create'}
              className="btn btn-gold btn-sm"
              style={{ fontSize: '0.65rem', padding: '8px 18px' }}
            >
              {busy === 'create' ? 'Signing...' : 'Submit Order'}
            </button>
            <span style={{ marginLeft: 10, fontSize: '0.55rem', color: 'var(--gray2)' }}>
              You'll sign a tx — fee paid from connected wallet.
            </span>
          </div>
        )}
      </div>

      {/* Orders table */}
      <div className="card" style={{ padding: 16 }}>
        {data.orders.length === 0 ? (
          <div style={{ padding: 20, textAlign: 'center', color: 'var(--muted)', fontSize: '0.7rem' }}>
            No orders yet. Click <strong>+ Create Order</strong> to propose the first one.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.65rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  <th style={th}>#</th>
                  <th style={th}>Requester</th>
                  <th style={th}>Recipient</th>
                  <th style={th}>Amount</th>
                  <th style={th}>Votes</th>
                  <th style={th}>Status</th>
                  <th style={th}>Created</th>
                  <th style={{ ...th, textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.orders.map((o) => {
                  const ratioPct = (o.approvalRatioBps / 100).toFixed(0)
                  const meetsThreshold = o.approvalRatioBps >= data.thresholdBps
                  const statusColor =
                    o.status === 'EXECUTED' ? '#4CAF50' :
                    o.status === 'CANCELLED' ? '#9e9e9e' :
                    meetsThreshold ? 'var(--gold)' : 'var(--white)'
                  return (
                    <tr key={o.id} style={{ borderTop: '1px solid var(--border)' }}>
                      <td style={td}><strong style={{ color: 'var(--gold)' }}>#{o.id}</strong></td>
                      <td style={td}>
                        <div>{o.requesterLabel}</div>
                        <div style={{ fontSize: '0.5rem', color: 'var(--gray2)', fontFamily: 'var(--font-m)' }}>{shortWallet(o.requester)}</div>
                      </td>
                      <td style={td}>
                        <div>{o.recipientLabel}</div>
                        <div style={{ fontSize: '0.5rem', color: 'var(--gray2)', fontFamily: 'var(--font-m)' }}>{shortWallet(o.recipient)}</div>
                      </td>
                      <td style={{ ...td, color: 'var(--gold)', fontWeight: 700 }}>${o.amount.toLocaleString()}</td>
                      <td style={td}>
                        <div>{o.approvalsCount} / {data.activeCouncilCount}</div>
                        <div style={{ fontSize: '0.5rem', color: meetsThreshold ? 'var(--gold)' : 'var(--gray2)' }}>
                          {ratioPct}% {meetsThreshold && '✓'}
                        </div>
                      </td>
                      <td style={td}>
                        <span style={{
                          fontSize: '0.55rem', padding: '2px 8px', borderRadius: 10,
                          background: o.status === 'EXECUTED' ? 'rgba(76,175,80,0.15)' :
                                      o.status === 'CANCELLED' ? 'rgba(120,120,120,0.15)' :
                                      'rgba(212,160,23,0.15)',
                          color: statusColor,
                        }}>{o.status}</span>
                        {o.content && (
                          <div style={{ fontSize: '0.5rem', color: 'var(--gray2)', marginTop: 2, maxWidth: 220, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={o.content}>
                            {o.content}
                          </div>
                        )}
                      </td>
                      <td style={{ ...td, color: 'var(--gray2)', fontSize: '0.55rem' }}>
                        {new Date(o.createdAt * 1000).toISOString().slice(0, 16).replace('T', ' ')}
                      </td>
                      <td style={{ ...td, textAlign: 'right' }}>
                        <div style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end', alignItems: 'center' }}>
                          {o.status === 'PENDING' && !o.myVote && (
                            <button
                              onClick={() => handleAction('approve', o.id)}
                              disabled={!!busy}
                              className="btn btn-gold btn-sm"
                              style={{ fontSize: '0.55rem', padding: '4px 8px' }}
                            >
                              {busy === `approve-${o.id}` ? '...' : 'Approve'}
                            </button>
                          )}
                          {o.status === 'PENDING' && o.myVote && (
                            <span style={{ fontSize: '0.55rem', color: 'var(--gold)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                              ✓ Voted
                              {o.myVoteTxHash && <TxLink hash={o.myVoteTxHash} />}
                            </span>
                          )}
                          {o.executable && (
                            <button
                              onClick={() => handleAction('execute', o.id)}
                              disabled={!!busy}
                              style={{
                                fontSize: '0.55rem', padding: '4px 10px', borderRadius: 4,
                                background: 'transparent', border: '1px solid #4CAF50',
                                color: '#4CAF50', cursor: 'pointer', whiteSpace: 'nowrap',
                                fontFamily: 'var(--font-d)',
                              }}
                            >
                              {busy === `execute-${o.id}` ? '...' : 'Execute'}
                            </button>
                          )}
                          {o.status === 'PENDING' && data.callerIsOwner && (
                            <button
                              onClick={() => handleAction('cancel', o.id)}
                              disabled={!!busy}
                              style={{
                                fontSize: '0.55rem', padding: '4px 10px', borderRadius: 4,
                                background: 'transparent', border: '1px solid #EF5350',
                                color: '#EF5350', cursor: 'pointer', whiteSpace: 'nowrap',
                                fontFamily: 'var(--font-d)',
                              }}
                            >
                              {busy === `cancel-${o.id}` ? '...' : 'Cancel'}
                            </button>
                          )}
                          {o.status === 'EXECUTED' && (
                            <span style={{ fontSize: '0.55rem', color: '#4CAF50', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                              ✓ Executed
                              {o.executedTxHash && <TxLink hash={o.executedTxHash} />}
                            </span>
                          )}
                          {o.status === 'CANCELLED' && (
                            <span style={{ fontSize: '0.55rem', color: '#EF5350', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                              ✗ Cancelled
                              {o.cancelledTxHash && <TxLink hash={o.cancelledTxHash} />}
                            </span>
                          )}
                        </div>
                        {o.status === 'PENDING' && !o.executable && o.approvalRatioBps >= data.thresholdBps && data.slotBalance < o.amount && (
                          <div style={{ fontSize: '0.5rem', color: 'var(--crimson2)', marginTop: 2 }}>
                            Slot[2] insufficient (${data.slotBalance.toLocaleString()})
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

const lblStyle: CSSProperties = {
  display: 'block', fontSize: '0.55rem', color: 'var(--gray2)',
  marginBottom: 4, letterSpacing: '0.06em', textTransform: 'uppercase',
}
const inputStyle: CSSProperties = {
  width: '100%', padding: '8px 10px', borderRadius: 6,
  background: 'var(--card-bg)', color: 'var(--white)',
  border: '1px solid var(--border)', fontSize: '0.7rem',
  fontFamily: 'var(--font-m)',
}

// BSCScan testnet tx link, compact format
function TxLink({ hash }: { hash: string }) {
  return (
    <a
      href={`https://bscscan.com/tx/${hash}`}
      target="_blank"
      rel="noopener noreferrer"
      title={hash}
      style={{
        fontSize: '0.5rem', fontFamily: 'var(--font-m)',
        color: 'inherit', opacity: 0.7,
        textDecoration: 'none', whiteSpace: 'nowrap',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {hash.slice(0, 6)}…{hash.slice(-4)} ↗
    </a>
  )
}

// ─── ACTIVITY TAB ──────────────────────────────────────────────────────

function ActivityTab({ data }: { data: MyActivityData | null }) {
  if (!data) {
    return <div className="card" style={{ padding: 24, color: 'var(--muted)' }}>Loading activity...</div>
  }

  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 16 }}>
        <PoolStat label="My Claims" value={String(data.claims.length)} />
        <PoolStat label="My Votes" value={String(data.votes.length)} sub="Phase 2c" greyed />
        <PoolStat label="My Proposals" value={String(data.proposals.length)} sub="Phase 2c" greyed />
      </div>

      <div style={{ fontSize: '0.6rem', color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
        Recent Claims
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.65rem' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border)' }}>
            <th style={th}>Date</th>
            <th style={th}>Amount</th>
            <th style={th}>TX</th>
          </tr>
        </thead>
        <tbody>
          {data.claims.length === 0 ? (
            <tr><td colSpan={3} style={{ padding: 16, textAlign: 'center', color: 'var(--muted)' }}>No claims yet.</td></tr>
          ) : data.claims.map((c) => (
            <tr key={c.id} style={{ borderTop: '1px solid var(--border)' }}>
              <td style={td}>{new Date(c.createdAt).toISOString().slice(0, 16).replace('T', ' ')}</td>
              <td style={{ ...td, color: 'var(--gold)', fontWeight: 700 }}>${c.amountUsdt.toLocaleString()}</td>
              <td style={td}>
                {c.txHash ? (
                  <a href={`https://bscscan.com/tx/${c.txHash}`} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--gold)' }}>
                    {c.txHash.slice(0, 8)}... ↗
                  </a>
                ) : <span style={{ color: 'var(--gray2)' }}>off-chain</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─── HELPERS ───────────────────────────────────────────────────────────

const th = {
  padding: '8px 10px', textAlign: 'left' as const, color: 'var(--gray)',
  fontWeight: 600, fontSize: '0.55rem', fontFamily: 'var(--font-d)',
  letterSpacing: '0.08em', textTransform: 'uppercase' as const,
}
const td = { padding: '10px', color: 'var(--white)' }

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
