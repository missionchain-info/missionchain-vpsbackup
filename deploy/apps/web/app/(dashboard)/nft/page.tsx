'use client'

import { useState, useEffect } from 'react'
import RewardLedger from '../../../components/RewardLedger'
import { useAccount, useReadContract } from 'wagmi'
import SubNav, { EARN_TABS } from '@/components/layout/SubNav'
import { useApi } from '@/hooks/useApi'
import { api } from '@/lib/api'
import LoadingSpinner from '@/components/ui/LoadingSpinner'
import MfpMintCard from '@/components/MfpMintCard'
import { CONTRACTS, MFPNFT_ABI, COMMUNITY_NFT_ABI } from '@/lib/contracts'

interface MyNft {
  id: string
  type: string
  tier?: string
  multiplier: string
  expiresIn?: string
  staked?: boolean
  inPool?: boolean
  mintedAt?: string
  daysElapsed?: number
  daysRemaining?: number
  serial?: string
  status?: string
  txid?: string
}

/**
 * GET /nft/overview — global, project-wide counts. It has never returned
 * builderCount / makerCount / luminaryCount / myNfts; those reads silently produced
 * `undefined`. Per-wallet data comes from /nft/holdings below.
 */
interface NftOverview {
  totalMfp: number
  maxMfp: number
  communityNfts: {
    builder: number
    maker: number
    luminary: number
  }
  userNfts: unknown[]
}

/**
 * A Community NFT the Owner awarded outside the automatic KPI programmes.
 *
 * These are the only Community NFTs a member mints by hand. Referral milestones and
 * Community Growth Award rank bonuses are minted automatically the moment the condition
 * is met, and never appear here.
 */
interface CommunityGrant {
  id: string
  tier: number
  tierName: string
  quantity: number
  note: string
  status: 'PENDING' | 'MINTED'
  txHash: string | null
  grantedAt: string
  mintedAt: string | null
}

interface CommunityGrantsRes {
  data?: {
    grants: CommunityGrant[]
    canMint: boolean
    mintDisabledReason: string | null
  }
}

/** One Community NFT as returned by GET /nft/holdings (auth, per wallet). */
interface HoldingCommunityItem {
  tokenId: string
  tier: string | null
  mintedAt: string
  expiresAt: string | null
  active: boolean
  isExpired: boolean
  rewardPoolWeight: number
  primaryBenefit: string
  mintTxHash?: string
}

interface NftHoldings {
  data: {
    wallet: string
    mfp: { count: number; items: Array<{ tokenId: string; mintedAt: string; active: boolean }> }
    community: HoldingCommunityItem[]
    totalCount: number
  }
}

const DAY_MS = 86_400_000

type NftCategory = 'Builder' | 'Maker' | 'Luminary'
type NftTab = 'mfp' | 'community'

const NFT_COLORS: Record<NftCategory, string> = {
  Builder: '#29B6F6', Maker: '#AB47BC', Luminary: '#C084D4',
}

function filterByCategory(nfts: MyNft[], cat: NftCategory): MyNft[] {
  return nfts.filter(n => n.tier === cat)
}

function shortenTx(tx: string) {
  if (!tx || tx.length < 16) return tx || '-'
  return tx.slice(0, 8) + '...' + tx.slice(-6)
}

const fmtUsd = (v?: string) =>
  v === undefined ? '-' : Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const fmtMic = (v?: string) =>
  v === undefined ? '-' : Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 })

/**
 * One button for every pool, because every pool claims the same way: `claim()` with no
 * arguments, from the holder's own wallet. Disabled when there is nothing there, so a
 * holder never pays gas to be told they are owed zero.
 */
function ClaimButton({ label, amount, address, busy, onClaim }: {
  label: string
  amount?: string
  address?: string
  busy: string
  onClaim: (address: string, label: string) => void
}) {
  const value = Number(amount ?? 0)
  const isBusy = busy === address
  return (
    <button
      className="nft-claim-btn"
      disabled={!address || value <= 0 || isBusy}
      onClick={() => address && onClaim(address, label)}
      style={{
        marginTop: 10, width: '100%', padding: '8px 12px', borderRadius: 8,
        border: 'none', cursor: value > 0 ? 'pointer' : 'not-allowed',
        fontSize: '0.72rem', fontWeight: 700,
        background: value > 0 ? 'var(--gold, #F0B54A)' : 'rgba(255,255,255,.07)',
        color: value > 0 ? '#141018' : 'var(--gray2, #8b8b9a)',
      }}
    >
      {isBusy ? 'Claiming…' : value > 0 ? label : 'Nothing to claim'}
    </button>
  )
}

export default function NftPage() {
  const { address } = useAccount()
  const [tab, setTab] = useState<NftTab>('mfp')
  // Project-wide totals; kept for the initial load gate. Per-wallet numbers come from /nft/holdings.
  const { loading } = useApi<NftOverview>('/nft/overview')
  // Per-wallet holdings need a JWT, so only ask once a wallet is connected.
  const { data: holdingsRes } = useApi<NftHoldings>('/nft/holdings', { enabled: !!address })
  const [popupCategory, setPopupCategory] = useState<NftCategory | null>(null)
  const [poolStats, setPoolStats] = useState<any>(null)
  const [rewards, setRewards] = useState<any>(null)
  const [claiming, setClaiming] = useState<string>('')
  const [claimMsg, setClaimMsg] = useState<{ ok: boolean; text: string } | null>(null)

  // ── Owner-granted Community NFTs awaiting the recipient's own mint (Path 2) ──
  const {
    data: grantsRes,
    refetch: refetchGrants,
  } = useApi<CommunityGrantsRes>('/nft/community-grants', { enabled: !!address })
  const myGrants = grantsRes?.data?.grants ?? []
  const pendingGrants = myGrants.filter((g) => g.status === 'PENDING')
  const canMintGrant = grantsRes?.data?.canMint ?? false
  const mintDisabledReason = grantsRes?.data?.mintDisabledReason ?? null
  const [mintingId, setMintingId] = useState<string | null>(null)

  /**
   * The recipient holds no MINTER_ROLE, so this cannot mint from the browser. The API
   * verifies the grant is theirs and unspent, then the platform's keeper wallet mints to
   * their address — so no gas is charged to the member.
   */
  const mintGrant = async (g: CommunityGrant) => {
    setMintingId(g.id)
    setClaimMsg(null)
    try {
      const res = await api<{ data?: { txHash?: string; quantity?: number } }>(
        `/nft/community-grants/${g.id}/mint`,
        // An empty body with a JSON content-type is rejected by Fastify
        // (FST_ERR_CTP_EMPTY_JSON_BODY), and api() always sets that header.
        { method: 'POST', body: {} },
      )
      setClaimMsg({
        ok: true,
        text: `${res?.data?.quantity ?? g.quantity}× ${g.tierName} minted to your wallet. `
            + 'Your validity period starts now.',
      })
      refetchGrants()
    } catch (err) {
      setClaimMsg({
        ok: false,
        text: err instanceof Error ? err.message : 'Mint failed — your award is unchanged.',
      })
    }
    setMintingId(null)
  }

  // Every pool exposes the same no-argument `claim()`, and all of them are pull-based:
  // the reward is already credited on chain, this only moves it to the wallet.
  const claimFrom = async (poolAddress: string, label: string) => {
    setClaiming(poolAddress)
    setClaimMsg(null)
    try {
      const eth = (window as any).ethereum
      if (!eth) throw new Error('No wallet found')
      const chainId = await eth.request({ method: 'eth_chainId' })
      if (chainId !== '0x38') throw new Error('Switch to BSC Mainnet')

      const { BrowserProvider, Contract } = await import('ethers')
      const signer = await new BrowserProvider(eth).getSigner()
      const c = new Contract(poolAddress, ['function claim()'], signer)
      const tx = await c.claim()
      await tx.wait()

      setClaimMsg({ ok: true, text: `${label} sent to your wallet — ${tx.hash.slice(0, 12)}…` })
      const base = process.env.NEXT_PUBLIC_API_URL || 'https://api.missionchain.io'
      if (address) {
        const r = await fetch(`${base}/nft/rewards/${address}`)
        if (r.ok) setRewards((await r.json()).data)
      }
    } catch (e: any) {
      setClaimMsg({ ok: false, text: e?.shortMessage || e?.message || 'Claim failed' })
    }
    setClaiming('')
  }

  // ── On-chain reads for MFP-NFT ─────────────────────────────────
  const { data: mfpUserBalance } = useReadContract({
    address: CONTRACTS.mfpNft,
    abi: MFPNFT_ABI,
    functionName: 'balanceOf',
    args: address ? [address as `0x${string}`] : undefined,
    query: { enabled: !!address },
  })
  const mfpUserCount = mfpUserBalance ? Number(mfpUserBalance) : 0

  // ── On-chain reads for Community NFTs (Builder/Maker/Luminary) ──
  // Uses public JsonRpcProvider so it works on mobile browsers without injected wallet.
  const [chainCommunity, setChainCommunity] = useState<{ builder: number; maker: number; luminary: number } | null>(null)
  useEffect(() => {
    if (!address) return
    ;(async () => {
      try {
        const { JsonRpcProvider, Contract } = await import('ethers')
        const rpcUrl = process.env.NEXT_PUBLIC_CHAIN_ID === '56'
          ? 'https://bsc-dataseed1.binance.org/'
          : 'https://bsc-dataseed.binance.org/'
        const provider = new JsonRpcProvider(rpcUrl)
        const cnft = new Contract(CONTRACTS.communityNft, COMMUNITY_NFT_ABI as any, provider)
        const [b, m, l] = await Promise.all([
          cnft.balanceOf(address, 1).catch(() => 0n) as Promise<bigint>,
          cnft.balanceOf(address, 2).catch(() => 0n) as Promise<bigint>,
          cnft.balanceOf(address, 3).catch(() => 0n) as Promise<bigint>,
        ])
        setChainCommunity({ builder: Number(b), maker: Number(m), luminary: Number(l) })
      } catch (err) {
        console.error('[Community NFT on-chain]', err)
      }
    })()
  }, [address])

  useEffect(() => {
    const base = process.env.NEXT_PUBLIC_API_URL || ''
    fetch(`${base}/nft/pool/stats`).then(r => r.ok ? r.json() : null).then(d => { if (d) setPoolStats(d) }).catch(() => {})
    if (address) {
      fetch(`${base}/nft/rewards/${address}`)
        .then(r => (r.ok ? r.json() : null))
        .then(d => { if (d?.data) setRewards(d.data) })
        .catch(() => {})
    }
  }, [])

  if (loading) return <LoadingSpinner />

  // This block is "My Community NFTs", so every count here must be per-wallet.
  // /nft/overview only carries project-wide totals — it is deliberately not used for it.
  const held = holdingsRes?.data.community ?? []
  const now = Date.now()
  const myNfts: MyNft[] = held.map((n) => {
    const minted = Date.parse(n.mintedAt)
    const expires = n.expiresAt ? Date.parse(n.expiresAt) : null
    return {
      id: n.tokenId,
      type: 'COMMUNITY',
      tier: n.tier ?? undefined,
      multiplier: `×${n.rewardPoolWeight}`,
      serial: n.tokenId,
      mintedAt: n.mintedAt,
      daysElapsed: Number.isNaN(minted) ? undefined : Math.floor((now - minted) / DAY_MS),
      daysRemaining: expires === null || Number.isNaN(expires)
        ? undefined
        : Math.max(0, Math.ceil((expires - now) / DAY_MS)),
      status: n.isExpired ? 'Expired' : 'Active',
      txid: n.mintTxHash,
    }
  })

  const heldByTier = (tier: string) => held.filter((n) => n.tier === tier && !n.isExpired).length
  // Prefer on-chain when available (the DB indexer can lag); fall back to per-wallet holdings.
  const builderCount = Math.max(heldByTier('Builder'), chainCommunity?.builder ?? 0)
  const makerCount = Math.max(heldByTier('Maker'), chainCommunity?.maker ?? 0)
  const luminaryCount = Math.max(heldByTier('Luminary'), chainCommunity?.luminary ?? 0)
  const communityCount = builderCount + makerCount + luminaryCount

  // What a US$ claim actually pays out: the pool keeps one balance per wallet, so this is
  // the same figure in both tabs and both Claim buttons send the same transaction.
  const usdWeeklyAmount = Number(rewards?.weekly?.claimable ?? 0)
  const usdMonthlyAmount = Number(rewards?.monthly?.claimable ?? 0)
  const usdPools = [
    { address: rewards?.ledgers?.pools?.usdWeekly ?? null, label: 'Claim weekly US$', amount: usdWeeklyAmount },
    { address: rewards?.ledgers?.pools?.usdMonthly ?? null, label: 'Claim monthly US$', amount: usdMonthlyAmount },
  ]
  const usdMerged = usdWeeklyAmount + usdMonthlyAmount

  return (
    <>
    <SubNav items={EARN_TABS} />
    <div className="nft-page">

      {/* ─── 2-Tab Switcher ─── */}
      <div className="nft-page-tabs">
        <button
          className={`nft-page-tab ${tab === 'mfp' ? 'active' : ''}`}
          onClick={() => setTab('mfp')}
        >
          <span className="nft-page-tab-icon">{'\u{1F451}'}</span>
          <span>MFP-NFTs</span>
          <span className="nft-page-tab-badge">{mfpUserCount}</span>
        </button>
        <button
          className={`nft-page-tab ${tab === 'community' ? 'active' : ''}`}
          onClick={() => setTab('community')}
        >
          <span className="nft-page-tab-icon">{'\u{1F465}'}</span>
          <span>Community NFTs</span>
          <span className="nft-page-tab-badge">{communityCount || '-'}</span>
        </button>
      </div>

      {/* ════════════════ TAB 1: MFP-NFTs ════════════════ */}
      {tab === 'mfp' && (
        <>
          {/* Mint card (allowance + mint + reveal + Your Collection grid) */}
          <MfpMintCard />

          <RewardLedger
            title="My NFT Rewards — MFP-NFTs"
            usd={rewards?.ledgers?.mfp?.usd}
            micLedger={rewards?.ledgers?.mfp?.mic}
            usdReliable={rewards?.ledgers?.usdSplitReliable}
            usdMerged={usdMerged}
            micPool={rewards?.ledgers?.pools?.mfpMic}
            usdPools={usdPools}
            busy={claiming}
            onClaim={claimFrom}
          />

          {/* MFP-only Reward Pools */}
          <div className="nft-section-card">
            <div className="nft-section-header">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
              <span className="nft-section-title">MFP Reward Pools</span>
            </div>
            <div className="nft-pool-note">Separate from Community pools — only MFP-NFT holders share these revenue streams.</div>

            <div className="nft-mfp-pools-grid">
              {/* Weekly 0.5% */}
              <div className="nft-pool-mini">
                <div className="nft-pool-mini-icon">{'\u{23F0}'}</div>
                <div className="nft-pool-mini-body">
                  <div className="nft-pool-mini-name">Weekly Reward Pool</div>
                  <div className="nft-pool-mini-pct">0.5% of Pre-Sale + MICE revenue · no holding restriction</div>
                  <div className="nft-pool-mini-stats">
                    <div><span>This week:</span> <strong>${rewards?.weekly ? fmtUsd(rewards.weekly.poolMfp) : '-'}</strong></div>
                    <div><span>Claimable:</span> <strong className="net-stat-gold">${rewards?.weekly ? fmtUsd(rewards.weekly.claimable) : '-'}</strong></div>
                  </div>
                  <ClaimButton
                    label="Claim weekly"
                    amount={rewards?.weekly?.claimable}
                    address={rewards?.weekly?.address}
                    busy={claiming}
                    onClaim={claimFrom}
                  />
                </div>
              </div>
              {/* Monthly 0.5% */}
              <div className="nft-pool-mini">
                <div className="nft-pool-mini-icon">{'\u{1F4C5}'}</div>
                <div className="nft-pool-mini-body">
                  <div className="nft-pool-mini-name">Monthly Reward Pool</div>
                  <div className="nft-pool-mini-pct">0.5% of Pre-Sale + MICE revenue · no holding restriction</div>
                  <div className="nft-pool-mini-stats">
                    <div><span>This month:</span> <strong>${rewards?.monthly ? fmtUsd(rewards.monthly.poolMfp) : '-'}</strong></div>
                    <div><span>Claimable:</span> <strong className="net-stat-gold">${rewards?.monthly ? fmtUsd(rewards.monthly.claimable) : '-'}</strong></div>
                  </div>
                  <ClaimButton
                    label="Claim monthly"
                    amount={rewards?.monthly?.claimable}
                    address={rewards?.monthly?.address}
                    busy={claiming}
                    onClaim={claimFrom}
                  />
                </div>
              </div>
            </div>

            <div className="nft-pool-detail-rows">
              <div className="nft-pool-detail-row">
                <span className="nft-pool-detail-label">Multiplier</span>
                <span className="nft-pool-detail-value">Highest share of the MFP reward pool</span>
              </div>
              <div className="nft-pool-detail-row">
                <span className="nft-pool-detail-label">Eligibility</span>
                <span className="nft-pool-detail-value">Hold ≥ 1 MFP-NFT (lifetime — no expiry)</span>
              </div>
              <div className="nft-pool-detail-row">
                <span className="nft-pool-detail-label">Distribution</span>
                <span className="nft-pool-detail-value">Auto-calculated by system. Claimed via /network → My Earnings.</span>
              </div>
            </div>
          </div>

          {/* MFP Per-NFT Actions hint */}
          <div className="nft-section-card nft-actions-hint">
            <div className="nft-section-header">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
              <span className="nft-section-title">Per-NFT Actions</span>
            </div>
            <div className="nft-pool-note">Each MFP-NFT in your collection (above) supports the following actions. Click any card → action menu.</div>
            <div className="nft-actions-row">
              <div className="nft-action-pill">
                <span>{'\u{1F4E4}'}</span>
                <span><strong>Transfer</strong> — send to another wallet (no fee)</span>
              </div>
              <div className="nft-action-pill">
                <span>{'\u{1F4B0}'}</span>
                <span><strong>Sell on P2P</strong> — list internally (5% royalty enforced)</span>
              </div>
              <div className="nft-action-pill">
                <span>{'\u{1F30A}'}</span>
                <span><strong>Element</strong> — list on element.market (BSC native)</span>
              </div>
              <div className="nft-action-pill">
                <span>{'\u{1F52E}'}</span>
                <span><strong>Magic Eden</strong> — list on magiceden.io (multi-chain)</span>
              </div>
            </div>
            <div className="nft-pool-note" style={{ marginTop: 10, fontStyle: 'italic', fontSize: '0.7rem' }}>
              Tap any MFP-NFT card above → action menu. Transfer + external marketplaces ready. P2P contract shipping next sprint.
            </div>
          </div>
        </>
      )}

      {/* ════════════════ TAB 2: Community NFTs ════════════════ */}
      {tab === 'community' && (
        <>
          {/* Tier counts (clickable → popup) */}
          <div className="nft-my-hero">
            <div className="nft-my-hero-bg" />
            <div className="nft-my-hero-content">
              <div className="nft-hero-title-row">
                <div className="nft-my-hero-icon">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                </div>
                <div>
                  <div className="nft-my-hero-label">My Community NFTs</div>
                  <div className="nft-hero-total">{communityCount || '-'} <span className="nft-hero-total-unit">NFTs</span></div>
                </div>
              </div>
              <div className="nft-portfolio-grid">
                {([
                  { cat: 'Builder' as NftCategory, label: 'Builder', sub: '×1 · 60 days', iconCls: 'builder', count: builderCount,
                    icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#29B6F6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg> },
                  { cat: 'Maker' as NftCategory, label: 'Maker', sub: '×2.5 · 90 days', iconCls: 'maker', count: makerCount,
                    icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#AB47BC" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg> },
                  { cat: 'Luminary' as NftCategory, label: 'Luminary', sub: '×5 · 180 days', iconCls: 'luminary', count: luminaryCount,
                    icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#C084D4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z"/></svg> },
                ]).map(({ cat, label, sub, iconCls, icon, count }) => {
                  const color = NFT_COLORS[cat]
                  return (
                    <div key={cat} className={`nft-pcard nft-pcard-my nft-pcard-${iconCls}`}
                      onClick={() => setPopupCategory(cat)} style={{ cursor: 'pointer' }}>
                      <div className={`nft-pcard-icon nft-pcard-icon-${iconCls}`}>{icon}</div>
                      <div className="nft-pcard-count" style={{ color }}>{count || '-'}</div>
                      <div className="nft-pcard-name">{label}</div>
                      <div className="nft-pcard-sub">{sub}</div>
                      <div className="nft-pcard-tap-hint">Tap to view details</div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>

          {/*
            Only rendered when something is actually awarded. An empty "you have no awards"
            panel on every member's page would imply this is a programme they can qualify
            for, when in fact it is the Owner's discretion alone.
          */}
          {pendingGrants.length > 0 && (
            <div className="nft-section-card" style={{ marginBottom: 14 }}>
              <div className="nft-section-header">
                <span className="nft-section-title">Awarded to You — Ready to Mint</span>
              </div>
              <div className="nft-pool-note">
                Granted by Mission Chain outside the automatic reward programmes. Mint it to your
                wallet to activate it — the validity period starts at the moment you mint, not now.
                No gas is charged to you.
              </div>

              {!canMintGrant && mintDisabledReason && (
                <div style={{
                  margin: '10px 0 0', padding: '10px 13px', borderRadius: 9, fontSize: '0.68rem',
                  lineHeight: 1.6, color: '#D4C098',
                  background: 'rgba(212,160,23,.08)', border: '1px solid rgba(212,160,23,.25)',
                }}>
                  {mintDisabledReason} Your award is safely recorded and stays available — you will
                  be able to mint it as soon as this is switched on.
                </div>
              )}

              <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
                {pendingGrants.map((g) => (
                  <div key={g.id} style={{
                    display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
                    padding: '12px 14px', borderRadius: 10,
                    background: 'rgba(40,26,58,0.50)', border: '1px solid rgba(212,160,23,0.18)',
                  }}>
                    <div style={{ flex: '1 1 200px' }}>
                      <div style={{ fontSize: '0.9rem', fontWeight: 700, color: '#F5D56E' }}>
                        {g.quantity}× {g.tierName}
                      </div>
                      {g.note && (
                        <div style={{ fontSize: '0.65rem', color: '#D4C098', marginTop: 3 }}>{g.note}</div>
                      )}
                      <div style={{ fontSize: '0.6rem', color: '#B8A894', marginTop: 3 }}>
                        Awarded {new Date(g.grantedAt).toISOString().slice(0, 10)}
                      </div>
                    </div>
                    <button
                      onClick={() => mintGrant(g)}
                      disabled={!canMintGrant || mintingId === g.id}
                      title={!canMintGrant && mintDisabledReason ? mintDisabledReason : undefined}
                      style={{
                        padding: '9px 18px', borderRadius: 8, fontSize: '0.7rem', fontWeight: 700,
                        border: '1px solid rgba(212,160,23,0.45)',
                        background: canMintGrant ? '#F5D56E' : 'rgba(212,160,23,0.12)',
                        color: canMintGrant ? '#281A3A' : '#B8A894',
                        cursor: canMintGrant && mintingId !== g.id ? 'pointer' : 'not-allowed',
                        opacity: canMintGrant ? 1 : 0.55,
                      }}
                    >
                      {mintingId === g.id ? 'Minting…' : canMintGrant ? 'Mint to my wallet' : 'Mint unavailable'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* A claim that succeeds silently reads as a claim that failed. */}
          {claimMsg && (
            <div
              style={{
                margin: '0 0 14px', padding: '11px 15px', borderRadius: 10, fontSize: '0.7rem',
                lineHeight: 1.6,
                color: claimMsg.ok ? '#66BB6A' : '#EF5350',
                background: claimMsg.ok ? 'rgba(76,175,80,.12)' : 'rgba(244,67,54,.12)',
                border: `1px solid ${claimMsg.ok ? 'rgba(76,175,80,.3)' : 'rgba(244,67,54,.3)'}`,
                display: 'flex', alignItems: 'center', gap: 10,
              }}
            >
              <span style={{ flex: 1 }}>{claimMsg.text}</span>
              <button
                onClick={() => setClaimMsg(null)}
                style={{ background: 'none', border: 'none', color: 'var(--gray2)', cursor: 'pointer', fontSize: '1rem' }}
                aria-label="Dismiss"
              >
                ×
              </button>
            </div>
          )}

          <RewardLedger
            title="My NFT Rewards — Community NFTs"
            usd={rewards?.ledgers?.community?.usd}
            micLedger={rewards?.ledgers?.community?.mic}
            usdReliable={rewards?.ledgers?.usdSplitReliable}
            usdMerged={usdMerged}
            micPool={rewards?.ledgers?.pools?.communityMic}
            usdPools={usdPools}
            busy={claiming}
            onClaim={claimFrom}
          />

          {/* Community NFT Reward Pool 5% Daily Emission */}
          <div className="nft-section-card">
            <div className="nft-section-header">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
              <span className="nft-section-title">Community NFT Reward Pool — 5% Daily Emission</span>
            </div>
            <div className="nft-pool-note">5% of MIC daily emission distributed to active Community NFT holders by tier weight (Builder ×1 · Maker ×2.5 · Luminary ×5).</div>
            <div className="nft-mfp-pools-grid">
              <div className="nft-pool-mini">
                <div className="nft-pool-mini-icon">{'\u{2696}\u{FE0F}'}</div>
                <div className="nft-pool-mini-body">
                  <div className="nft-pool-mini-name">Pool Weight</div>
                  <div className="nft-pool-mini-pct">Sum of all active multipliers</div>
                  <div className="nft-pool-mini-stats">
                    <div><span>Total weight:</span> <strong>{poolStats?.totalWeightedShares ? poolStats.totalWeightedShares.toLocaleString() : '-'}</strong></div>
                    <div><span>Active NFTs:</span> <strong>{poolStats?.activeEntries || '-'}</strong></div>
                  </div>
                </div>
              </div>
              <div className="nft-pool-mini">
                <div className="nft-pool-mini-icon">{'\u{1F4B0}'}</div>
                <div className="nft-pool-mini-body">
                  <div className="nft-pool-mini-name">My Pending</div>
                  <div className="nft-pool-mini-pct">Daily MIC accrued (claimable)</div>
                  <div className="nft-pool-mini-stats">
                    <div><span>Pending:</span> <strong className="net-stat-gold">{rewards?.mining ? fmtMic(rewards.mining.claimable) : '-'} MIC</strong></div>
                    <div><span>Per day:</span> <strong>{rewards?.mining ? fmtMic(rewards.mining.myRewardPerDay) : '-'} MIC</strong></div>
                  </div>
                  <ClaimButton
                    label="Claim MIC"
                    amount={rewards?.mining?.claimable}
                    address={rewards?.mining?.address}
                    busy={claiming}
                    onClaim={claimFrom}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Weekly + Monthly Reward Pools — Community-only */}
          <div className="nft-section-card">
            <div className="nft-section-header">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              <span className="nft-section-title">Community Reward Pools</span>
            </div>
            <div className="nft-pool-note">Distributed by tier weight to active Community NFTs only (separate from MFP pools).</div>
            <div className="nft-mfp-pools-grid">
              <div className="nft-pool-mini">
                <div className="nft-pool-mini-icon">{'\u{23F0}'}</div>
                <div className="nft-pool-mini-body">
                  <div className="nft-pool-mini-name">Weekly Reward Pool</div>
                  <div className="nft-pool-mini-pct">5% of Pre-Sale + MICE revenue · only NFTs minted this week</div>
                  <div className="nft-pool-mini-stats">
                    <div><span>This week:</span> <strong>${rewards?.weekly ? fmtUsd(rewards.weekly.poolCommunity) : '-'}</strong></div>
                    <div><span>Claimable:</span> <strong className="net-stat-gold">${rewards?.weekly ? fmtUsd(rewards.weekly.claimable) : '-'}</strong></div>
                  </div>
                  <ClaimButton
                    label="Claim weekly"
                    amount={rewards?.weekly?.claimable}
                    address={rewards?.weekly?.address}
                    busy={claiming}
                    onClaim={claimFrom}
                  />
                </div>
              </div>
              <div className="nft-pool-mini">
                <div className="nft-pool-mini-icon">{'\u{1F4C5}'}</div>
                <div className="nft-pool-mini-body">
                  <div className="nft-pool-mini-name">Monthly Reward Pool</div>
                  <div className="nft-pool-mini-pct">7.5% of Pre-Sale + MICE revenue · every NFT valid at 24:00 UTC on the last day</div>
                  <div className="nft-pool-mini-stats">
                    <div><span>This month:</span> <strong>${rewards?.monthly ? fmtUsd(rewards.monthly.poolCommunity) : '-'}</strong></div>
                    <div><span>Claimable:</span> <strong className="net-stat-gold">${rewards?.monthly ? fmtUsd(rewards.monthly.claimable) : '-'}</strong></div>
                  </div>
                  <ClaimButton
                    label="Claim monthly"
                    amount={rewards?.monthly?.claimable}
                    address={rewards?.monthly?.address}
                    busy={claiming}
                    onClaim={claimFrom}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Weekly Lucky Draw — Community NFTs only */}
          <div className="nft-section-card">
            <div className="nft-section-header">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 12V8H6a2 2 0 0 1-2-2c0-1.1.9-2 2-2h12v4"/><path d="M4 6v12c0 1.1.9 2 2 2h14v-4"/><path d="M18 12a2 2 0 0 0-2 2c0 1.1.9 2 2 2h4v-4h-4z"/></svg>
              <span className="nft-section-title">Weekly Lucky Draw</span>
            </div>
            <div className="nft-pool-note">1% of Revenue · CAP $5,000/week. Community NFTs active within the week only (MFP-NFT not eligible). Entry by NFT serial numbers.</div>

            <div className="nft-rp-stats-grid">
              <div className="nft-rp-stat-box nft-rp-stat-gold">
                <div className="nft-rp-stat-label">This Week Prize Pool</div>
                <div className="nft-rp-stat-value nft-rp-val-gold">-</div>
              </div>
              <div className="nft-rp-stat-box" style={{ background: 'rgba(123,45,139,.06)', border: '1px solid rgba(123,45,139,.12)' }}>
                <div className="nft-rp-stat-label">Weekly CAP</div>
                <div className="nft-rp-stat-value" style={{ color: 'var(--purple2)' }}>$5,000</div>
              </div>
            </div>

            <div className="nft-lucky-prizes">
              <div className="nft-lucky-row nft-lucky-1st">
                <span className="nft-lucky-icon">{'\u{1F947}'}</span>
                <span className="nft-lucky-label">Prize #1</span>
                <span className="nft-lucky-winners">1 winner</span>
                <span className="nft-lucky-share">30%</span>
                <span className="nft-lucky-example">~$1,500</span>
              </div>
              <div className="nft-lucky-row nft-lucky-2nd">
                <span className="nft-lucky-icon">{'\u{1F948}'}</span>
                <span className="nft-lucky-label">Prize #2</span>
                <span className="nft-lucky-winners">2 winners</span>
                <span className="nft-lucky-share">10% each</span>
                <span className="nft-lucky-example">~$500</span>
              </div>
              <div className="nft-lucky-row nft-lucky-3rd">
                <span className="nft-lucky-icon">{'\u{1F949}'}</span>
                <span className="nft-lucky-label">Prize #3</span>
                <span className="nft-lucky-winners">5 winners</span>
                <span className="nft-lucky-share">5% each</span>
                <span className="nft-lucky-example">~$250</span>
              </div>
              <div className="nft-lucky-row nft-lucky-con">
                <span className="nft-lucky-icon">{'\u{1F381}'}</span>
                <span className="nft-lucky-label">Consolation</span>
                <span className="nft-lucky-winners">10 winners</span>
                <span className="nft-lucky-share">2.5% each</span>
                <span className="nft-lucky-example">~$125</span>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── NFT Detail Popup (shared by both tabs) ── */}
      {popupCategory && (() => {
        const nfts = filterByCategory(myNfts, popupCategory)
        const color = NFT_COLORS[popupCategory]
        return (
          <div className="nft-popup-overlay" onClick={() => setPopupCategory(null)}>
            <div className="nft-popup" onClick={(e) => e.stopPropagation()}>
              <div className="nft-popup-header">
                <h3 className="nft-popup-title" style={{ color }}>{popupCategory} NFTs</h3>
                <span className="nft-popup-count">{nfts.length} total</span>
                <button className="nft-popup-close" onClick={() => setPopupCategory(null)}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </div>
              {nfts.length === 0 ? (
                <div className="nft-popup-empty">No {popupCategory} NFTs owned</div>
              ) : (
                <div className="nft-popup-table-wrap">
                  <table className="nft-popup-table">
                    <thead>
                      <tr>
                        <th>Serial</th>
                        <th>Minted</th>
                        <th>Elapsed</th>
                        <th>Remaining</th>
                        <th>Status</th>
                        <th>Pool</th>
                        <th>TXID</th>
                      </tr>
                    </thead>
                    <tbody>
                      {nfts.map((nft, i) => (
                        <tr key={i} className={nft.status === 'Expired' ? 'nft-row-expired' : ''}>
                          <td className="nft-popup-serial">#{nft.serial || nft.id}</td>
                          <td className="nft-popup-date">{nft.mintedAt ? new Date(nft.mintedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }) : '-'}</td>
                          <td>{nft.daysElapsed != null ? `${nft.daysElapsed}d` : '-'}</td>
                          <td>{nft.daysRemaining != null ? `${nft.daysRemaining}d` : '-'}</td>
                          <td>
                            <span className={`nft-status-badge ${nft.status === 'Active' ? 'nft-status-active' : 'nft-status-expired'}`}>
                              {nft.status || 'Active'}
                            </span>
                          </td>
                          <td>
                            {nft.inPool ? (
                              <span className="nft-pool-badge-in">In Pool</span>
                            ) : nft.status !== 'Expired' ? (
                              <button className="nft-join-pool-btn-sm">Join</button>
                            ) : '-'}
                          </td>
                          <td className="nft-popup-tx">
                            {nft.txid ? (
                              <a href={`https://bscscan.com/tx/${nft.txid}`} target="_blank" rel="noopener noreferrer" title={nft.txid}>
                                {shortenTx(nft.txid)}
                              </a>
                            ) : '-'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )
      })()}
    </div>
    </>
  )
}
