'use client'

import { useState, useEffect } from 'react'
import { useApi } from '@/hooks/useApi'
import { useAccount, useBalance } from 'wagmi'
import { BrowserProvider, Contract, formatUnits, formatEther } from 'ethers'
import LoadingSpinner from '@/components/ui/LoadingSpinner'
import { CONTRACTS, ERC20_ABI, MIC_ABI, LOCK_MANAGER_ABI, MFPNFT_ABI, COMMUNITY_NFT_ABI } from '@/lib/contracts'
import { getActiveChain, USDT_DECIMALS } from '@missionchain/sdk'

const ACTIVE_CHAIN = getActiveChain()

interface DashboardData {
  data?: {
    micPrice?: string
    /** `swap` = the live AMM. `admin` / `admin-fallback` = a configured figure. */
    micPriceSource?: string
    /** Design cap once all mining has happened. Kept under its old name so nothing that
     *  already reads it shifts meaning; `maxSupply` is the same number, named honestly. */
    totalSupply?: number
    maxSupply?: number
    /** What exists on chain right now. */
    currentSupply?: string
    /** Issued at genesis — a historical fact, unchanged by later burns. */
    preIssued?: number
    /** How much of that genesis issuance still exists, after the 2026-08-05 burn. */
    preIssuedNow?: string
    miningPool?: number
    circulatingSupply?: string
    totalEmitted?: string
    totalStaked?: string
    totalBurned?: string
    totalLocked?: string
    inContractReserves?: string
    vestingLocked?: string
    dailyOutput?: number
    emissionSplit?: {
      miners?: number
      staking?: number
      dao?: number
      communityNft?: number
      mfpReward?: number
    }
    mfpTotal?: number
    mfpMinted?: number
    communityNfts?: number
    activeMice?: number
    totalUsers?: number
  }
}

interface WalletData {
  data?: {
    micTotal?: string
    micAvailable?: string
    micVesting?: string
    micStaked?: string
    usdtBalance?: string
    bnbBalance?: string
    mfpNfts?: number
    builders?: number
    makers?: number
    luminaries?: number
    incomeUsdt?: {
      claimed?: string
      unclaimed?: string
    }
    incomeMic?: {
      claimed?: string
      unclaimed?: string
    }
  }
}

function fmt(n: number | string | undefined, fallback: string = '-'): string {
  if (n === undefined || n === null || n === '') return '-'
  const num = typeof n === 'string' ? parseFloat(n) : n
  if (isNaN(num)) return '-'
  if (num === 0) return '-'
  if (num >= 1_000_000_000) return (num / 1_000_000_000).toFixed(2) + 'B'
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + 'M'
  if (num >= 1_000) return num.toLocaleString('en-US')
  // Nhip emission hien tai la so le nho (~26,73 MIC/ngay). num.toString() se in ra
  // ca 18 chu so thap phan, nen cat con 2 so.
  return num.toLocaleString('en-US', { maximumFractionDigits: 2 })
}

function fmtUsdCompact(n: number | undefined): string {
  if (!n || isNaN(n) || n <= 0) return '-'
  if (n >= 1_000_000_000) return '$' + (n / 1_000_000_000).toFixed(2) + 'B'
  if (n >= 1_000_000) return '$' + (n / 1_000_000).toFixed(2) + 'M'
  if (n >= 1_000) return '$' + (n / 1_000).toFixed(1) + 'K'
  return '$' + n.toFixed(0)
}

function fmtUsd(n: number | string | undefined): string {
  if (n === undefined || n === null || n === '') return '-'
  const num = typeof n === 'string' ? parseFloat(n) : n
  if (isNaN(num) || num === 0) return '-'
  return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default function DashboardPage() {
  const { data: resp, loading } = useApi<DashboardData>('/dashboard/overview')
  const { address } = useAccount()
  const { data: bnbData } = useBalance({ address })

  // On-chain wallet data
  const [w, setW] = useState<NonNullable<WalletData['data']>>({})
  const [walletLoading, setWalletLoading] = useState(false)

  /* "Add MIC to Wallet" — nhan phan hoi ngan de nguoi dung biet vi da nhan.
     `image` phai tro toi mot file anh THAT: /icon.png tra ve 200 nhung la
     catch-all cua Next (khong phai anh), MetaMask se khong hien logo. */
  const [micAdded, setMicAdded] = useState<'idle' | 'ok' | 'err'>('idle')
  async function addMicToWallet() {
    const eth = (typeof window !== 'undefined' && (window as any).ethereum) || null
    if (!eth) { setMicAdded('err'); setTimeout(() => setMicAdded('idle'), 2500); return }
    try {
      await eth.request({
        method: 'wallet_watchAsset',
        params: {
          type: 'ERC20',
          options: {
            address: CONTRACTS.mic,
            symbol: 'MIC',
            decimals: 18,
            image: 'https://app.missionchain.io/images/mic-token-256.png',
          },
        },
      })
      setMicAdded('ok')
    } catch (e: any) {
      if (e?.code !== 4001) { console.error('Add MIC to wallet failed:', e); setMicAdded('err') }
    }
    setTimeout(() => setMicAdded('idle'), 2500)
  }

  useEffect(() => {
    if (!address) return
    setWalletLoading(true)

    const fetchOnChain = async () => {
      try {
        // Network-aware RPC — resolved from NEXT_PUBLIC_CHAIN at build time.
        const { JsonRpcProvider } = await import('ethers')
        const provider = new JsonRpcProvider(ACTIVE_CHAIN.rpcUrls[0], undefined, { batchMaxCount: 1 })

        // Create contract instances
        const mic = new Contract(CONTRACTS.mic, MIC_ABI, provider)
        const usdt = new Contract(CONTRACTS.usdt, ERC20_ABI, provider)
        const lockMgr = new Contract(CONTRACTS.lockManager, LOCK_MANAGER_ABI, provider)
        const mfpNft = new Contract(CONTRACTS.mfpNft, MFPNFT_ABI, provider)
        const communityNft = new Contract(CONTRACTS.communityNft, COMMUNITY_NFT_ABI, provider)

        // Fetch all data in parallel
        const [
          micBalance, usdtBalance, lockedAmount,
          mfpCount,
          builderCount, makerCount, luminaryCount,
        ] = await Promise.all([
          mic.balanceOf(address) as Promise<bigint>,
          usdt.balanceOf(address) as Promise<bigint>,
          lockMgr.lockedOf(address).catch(() => 0n) as Promise<bigint>,
          mfpNft.balanceOf(address).catch(() => 0n) as Promise<bigint>,
          // `balanceOf(address, tier)` is the ERC-1155 signature, and CommunityNFTv2 is
          // ERC-721 — so these three calls could only ever fail. The `.catch` hid that,
          // but the page still waited for three round trips to return an error before it
          // could render, on every load.
          //
          // `activeCountOf` is what v2 exposes, and it counts only unexpired tokens —
          // which is the number that belongs on a dashboard anyway.
          communityNft.activeCountOf(address, 1).catch(() => 0n) as Promise<bigint>,
          communityNft.activeCountOf(address, 2).catch(() => 0n) as Promise<bigint>,
          communityNft.activeCountOf(address, 3).catch(() => 0n) as Promise<bigint>,
        ])

        const micTotal = Number(formatUnits(micBalance, 18))
        const locked = Number(formatUnits(lockedAmount, 18))
        const available = Math.max(0, micTotal - locked)
        const bnbBal = bnbData ? Number(bnbData.formatted) : 0

        setW({
          micTotal: micTotal.toString(),
          micAvailable: available.toString(),
          micVesting: locked.toString(),
          micStaked: '0', // TODO: read from MICStaking contract when deployed
          usdtBalance: formatUnits(usdtBalance, USDT_DECIMALS),
          bnbBalance: bnbBal.toFixed(4),
          mfpNfts: Number(mfpCount),
          builders: Number(builderCount),
          makers: Number(makerCount),
          luminaries: Number(luminaryCount),
        })
      } catch (err) {
        console.error('Error fetching on-chain wallet data:', err)
      } finally {
        setWalletLoading(false)
      }
    }

    fetchOnChain()
  }, [address, bnbData])

  const d = resp?.data || {}

  /* ⚠ Hook cua gauge phai nam TRUOC `if (loading) return` ngay duoi.
     Dat sau no thi lan render dau (loading = true) thoat som va khong chay,
     lan sau lai chay — so hook giua hai lan khac nhau, React nem loi va ca trang
     thanh mau trang. Da mac dung loi nay 19/08, dashboard chet han. */
  const gCircEarly = Number(d.circulatingSupply) || 0
  /* Ve tu 0 -> gia tri sau khi mount, lech nhau 80ms tu ngoai vao trong. */
  const [gaugeOn, setGaugeOn] = useState(false)
  useEffect(() => { const t = setTimeout(() => setGaugeOn(true), 80); return () => clearTimeout(t) }, [])
  /* Dem len cho con so loi. Bam theo gia tri nen doi API la chay lai. */
  const [gCount, setGCount] = useState(0)
  useEffect(() => {
    if (!gCircEarly) { setGCount(0); return }
    const reduce = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (reduce) { setGCount(gCircEarly); return }
    const t0 = performance.now(), dur = 900
    let raf = 0
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / dur)
      setGCount(gCircEarly * (1 - Math.pow(1 - k, 3)))
      if (k < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [gCircEarly])
  const [gHover, setGHover] = useState<string | null>(null)

  if (loading) return <LoadingSpinner />

  const micPrice = d.micPrice || '-'
  const emitted = parseFloat(d.totalEmitted || '0')
  const pool = d.miningPool || 0
  const emissionPct = pool > 0 && emitted > 0 ? ((emitted / pool) * 100).toFixed(2) : '-'
  const es = d.emissionSplit || {}
  const marketCap = (() => {
    const circ = parseFloat(d.circulatingSupply || '0')
    const price = parseFloat(d.micPrice || '0')
    return circ > 0 && price > 0 ? circ * price : 0
  })()

  /* Supply partition. `num` tolerates the strings the API returns for big integers. */
  const num = (x: any) => { const n = Number(x); return Number.isFinite(n) ? n : 0 }
  const MINING_POOL = 5_950_000_000
  /* `issued` is what was MINTED (1.05B = 15% of cap), not what survives today.
     Using `currentSupply` here was wrong twice over: it made bar 1 report
     7B - 1.018B = 5.98B as "not yet mined", quietly counting the 31.5M burn as
     unmined tokens, and it left the word "Issued" describing a figure that has already
     had a burn taken out of it. With the minted figure, 1.05B + 5.95B = 7B exactly —
     the pre-issue and the mining pool, with nothing unaccounted for. */
  const issued  = num(d.preIssued) || 1_050_000_000
  const capTot  = num(d.maxSupply ?? d.totalSupply) || 7_000_000_000
  const unmined = Math.max(0, capTot - issued)
  /* The five parts sum to `issued`. Burned belongs INSIDE this bar, not in a footnote:
     those tokens were issued and then destroyed, so leaving them out left a 31.5M hole
     that the eye reads as a rounding error. It is drawn hatched to mark it as gone. */
  const svRaw = [
    { k: 'reserves',    l: 'In contracts', v: num(d.inContractReserves) },
    { k: 'vesting',     l: 'Vesting',      v: num(d.vestingLocked) },
    { k: 'staked',      l: 'Staked',       v: num(d.totalStaked) },
    { k: 'circulating', l: 'Circulating',  v: num(d.circulatingSupply) },
    { k: 'burned',      l: 'Burned',       v: num(d.totalBurned) },
  ]
  const svTotal = svRaw.reduce((a, p) => a + p.v, 0) || 1
  const svParts = svRaw.map((p) => ({ ...p, pct: (p.v / svTotal) * 100 }))

  /* ── Supply Lock Gauge ──────────────────────────────────────────────
     Bon phan, MOT mau so: hard cap 7B. Cong lai dung 100,000%.

     Ban phac ban dau tron hai mau so — 85% va 0,45% la cua cap, con 2,6% la cua
     1,05B pre-issue, va 13,3% khong khop mau nao (khoa that su la 14,2% cua cap).
     Ve theo do thi do dai cung khong so sanh duoc voi nhau. O day moi cung deu la
     phan cua cap; ty le tren 1,05B van hien, nhung o cot so — khong bao gio la do dai cung.

     Luu hanh chi 0,391% cua cap, ve thanh cung thi la mot vach 1,4° khong nhin thay.
     Nen no la LOI dac o giua (dung nhu ban phac ve), khong phai cung — vua la tieu diem,
     vua khong bia ra mot do dai sai. */
  const gv = (k: string) => svRaw.find((p) => p.k === k)?.v ?? 0
  const gLocked = gv('reserves') + gv('vesting') + gv('staked')
  const gCirc = gv('circulating')
  const gBurn = gv('burned')
  const gCap = capTot || 7_000_000_000
  const pctCap = (v: number) => (v / gCap) * 100
  const gaugeRings = [
    { k: 'unmined', l: 'Not yet mined', sub: 'mining pool, does not exist yet', v: unmined,  r: 86 },
    { k: 'locked',  l: 'Locked',        sub: 'in contracts + vesting',          v: gLocked,  r: 70 },
    { k: 'burned',  l: 'Burned',        sub: 'issued, then destroyed',          v: gBurn,    r: 54 },
  ].map((x) => ({ ...x, pct: pctCap(x.v) }))

  return (
    <div className="dash-page">
      {/* Ambient background effects */}
      <div className="dash-bg-glow dash-bg-glow-1" />
      <div className="dash-bg-glow dash-bg-glow-2" />

      {/* ── Hero: Price ── */}
      <div className="dash-hero">
        <div className="dash-hero-bg" />
        <div className="dash-hero-shine" />
        <div className="dash-hero-content">
          <div className="dash-hero-price">
            <div className="dash-hero-label">MIC Token Price</div>
            <div className="dash-hero-value">
              <span className="dash-hero-dollar">$</span>
              {micPrice}
            </div>
            <div className="dash-hero-glow-dot" />
          </div>
        </div>
      </div>

      {/* ── Supply, as a partition rather than eight equal boxes ──
          The four figures under "issued" are not peers of each other: reserves + vesting
          + staked + circulating IS the issued supply, burned has been subtracted from it,
          and market cap is derived from circulating alone. Eight identical cards hid every
          one of those relationships, so the reader could not tell which number was part of
          which. Two proportional bars say it without a caption.

          Two proportional bars said it, but needed a caption explaining that bar 2 was a
          zoom of bar 1. One concentric gauge says it without that caption: the rings run
          outward-to-inward by how free the tokens are — not mined yet, locked in a
          contract, destroyed, freely tradable. Every arc is measured against the same 7B
          cap, so their lengths are comparable and add to 100%. */}
      <div className="supply-viz">
        <div className="sv-head">
          <span className="sv-title">Supply</span>
          <span className="sv-cap">Hard cap {fmt(d.maxSupply ?? d.totalSupply, '-')}</span>
        </div>

        {/* Supply Lock Gauge — cung 270°, doc tu ngoai vao trong theo muc do tu do */}
        <div className="sg-wrap">
          <svg className="sg" viewBox="0 0 200 200" role="img"
               aria-label={`Supply: ${fmt(unmined)} not yet mined, ${fmt(gLocked)} locked, ${fmt(gBurn)} burned, ${fmt(gCirc)} circulating`}>
            <defs>
              <linearGradient id="sgCore" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#C9A34C" /><stop offset="100%" stopColor="#E8C168" />
              </linearGradient>
              <pattern id="sgHatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <rect width="6" height="6" fill="none" />
                <line x1="0" y1="0" x2="0" y2="6" stroke="currentColor" strokeWidth="2.5" />
              </pattern>
            </defs>
            {gaugeRings.map((ring, i) => {
              const C = 2 * Math.PI * ring.r
              const arc = C * 0.75                      /* cung 270° */
              const on = arc * (ring.pct / 100)
              return (
                <g key={ring.k} className={`sg-ring sg-${ring.k} ${gHover && gHover !== ring.k ? 'sg-dim' : ''}`}
                   onMouseEnter={() => setGHover(ring.k)} onMouseLeave={() => setGHover(null)}>
                  <circle className="sg-track" cx="100" cy="100" r={ring.r}
                          strokeDasharray={`${arc} ${C}`} transform="rotate(135 100 100)" />
                  <circle className="sg-val" cx="100" cy="100" r={ring.r}
                          strokeDasharray={`${gaugeOn ? on : 0} ${C}`}
                          transform="rotate(135 100 100)"
                          style={{ transitionDelay: `${i * 80}ms` }} />
                </g>
              )
            })}
            <circle className={`sg-core ${gHover && gHover !== 'circulating' ? 'sg-dim' : ''}`}
                    cx="100" cy="100" r="40"
                    onMouseEnter={() => setGHover('circulating')} onMouseLeave={() => setGHover(null)} />
            <text className="sg-core-v" x="100" y="95" textAnchor="middle">{fmt(gCount || gCirc, '-')}</text>
            <text className="sg-core-u" x="100" y="107" textAnchor="middle">MIC CIRCULATING</text>
            <text className="sg-core-m" x="100" y="119" textAnchor="middle">{fmtUsdCompact(marketCap)}</text>
          </svg>

          <div className="sg-legend">
            {gaugeRings.map((ring) => (
              <button key={ring.k} type="button"
                      className={`sg-leg sg-leg-${ring.k} ${gHover === ring.k ? 'on' : ''}`}
                      onMouseEnter={() => setGHover(ring.k)} onMouseLeave={() => setGHover(null)}
                      onFocus={() => setGHover(ring.k)} onBlur={() => setGHover(null)}>
                <i className={`sg-key sg-key-${ring.k}`} />
                <span className="sg-leg-l">{ring.l}</span>
                <span className="sg-leg-v">{fmt(ring.v, '-')}</span>
                <span className="sg-leg-p">{ring.pct.toFixed(2)}%</span>
                <span className="sg-leg-s">{ring.sub}</span>
              </button>
            ))}
            <button type="button"
                    className={`sg-leg sg-leg-circulating ${gHover === 'circulating' ? 'on' : ''}`}
                    onMouseEnter={() => setGHover('circulating')} onMouseLeave={() => setGHover(null)}
                    onFocus={() => setGHover('circulating')} onBlur={() => setGHover(null)}>
              <i className="sg-key sg-key-circulating" />
              <span className="sg-leg-l">Circulating</span>
              <span className="sg-leg-v">{fmt(gCirc, '-')}</span>
              <span className="sg-leg-p">{pctCap(gCirc).toFixed(2)}%</span>
              <span className="sg-leg-s">freely tradable &mdash; {svParts.find((p) => p.k === 'circulating')?.pct.toFixed(1)}% of the {fmt(issued, '-')} pre-issue</span>
            </button>
          </div>
        </div>

        <p className="sg-foot">
          Every ring is a share of the {fmt(gCap, '-')} hard cap, so the four add to 100%.
          Circulating is drawn as the core rather than an arc: at {pctCap(gCirc).toFixed(2)}% of the
          cap its arc would be a 1.4&deg; tick.
        </p>

        {/* The two figures that are NOT part of the partition, said as such */}
        <div className="sv-notes">
          <div className="sv-note">
            <span className="sv-note-k sv-burned-dot" />
            <span className="sv-note-l">Live supply</span>
            <span className="sv-note-v">{fmt(d.currentSupply ?? d.preIssuedNow, '-')}</span>
            <span className="sv-note-s">pre-issued minus the burn — what exists today</span>
          </div>
          <div className="sv-note">
            <span className="sv-note-k sv-mined-dot" />
            <span className="sv-note-l">Mined</span>
            <span className="sv-note-v">{fmt(d.totalEmitted, '-')}</span>
            <span className="sv-note-s">
              of {fmt(MINING_POOL, '-')} — mining has barely started
            </span>
          </div>
          <div className="sv-note">
            <span className="sv-note-k sv-circulating" />
            <span className="sv-note-l">Market cap</span>
            <span className="sv-note-v">{fmtUsdCompact(marketCap)}</span>
            <span className="sv-note-s">circulating &times; price — only the circulating slice counts</span>
          </div>
        </div>
      </div>

      {/* ── Mining Pool ── */}
      <div className="dash-emission">
        <div className="dash-emission-header">
          <div className="dash-emission-title-row">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
            <span className="dash-emission-title">Mining Pool</span>
          </div>
          <div className="dash-emission-stats">
            <span className="dash-emission-pct">{emissionPct}%</span>
            <span className="dash-emission-sub">emitted</span>
          </div>
        </div>
        <div className="progress-bar-wrap">
          <div className="progress-bar">
            <div
              className="progress-fill"
              style={{ width: `${Math.min(parseFloat(emissionPct) || 0, 100)}%` }}
            >
              <div className="progress-glow-tip" />
            </div>
          </div>
          <div className="progress-labels">
            <span>0</span>
            <span>{fmt(d.miningPool, '-')} MIC</span>
          </div>
        </div>
        {/* Quick stats: Active MICE + Daily Output */}
        <div className="em-quick-row">
          <div className="em-quick-chip">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="2"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>
            <span className="em-quick-label">Active MICE</span>
            <span className="em-quick-value">{fmt(d.activeMice, '-')}</span>
          </div>
          <div className="em-quick-chip">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--cyan)" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
            <span className="em-quick-label">Daily Output</span>
            <span className="em-quick-value em-quick-cyan">{fmt(d.dailyOutput, '-')}</span>
            <span className="em-quick-unit">MIC/day</span>
          </div>
        </div>
        {/* Emission split, drawn as one ring rather than five bars.
            Five bars invited the eye to compare heights that are not comparable — the
            1% slice was a sliver next to a 49% slice and read as "broken", which is how
            this block was reported. A ring shows shares of one whole, which is what these
            actually are, and matches the same figure on /mining.

            The percentages are LIVE, not the headline 59/25/10/5/1. During the first 90
            days the Early Staking Boost moves up to 10 points from Miners to Staking and
            unwinds linearly, so today's split is not the destination split. The note below
            says so, because two screens showing different numbers with no explanation is
            what sent the Owner looking for a bug that was not there. */}
        <div className="em-ring-row">
          <svg viewBox="0 0 120 120" className="em-ring">
            {(() => {
              const slices = [
                { v: es.miners ?? 0, c: '#C9A34C' },
                { v: es.staking ?? 0, c: '#72ABE8' },
                { v: es.dao ?? 0, c: '#849ED4' },
                { v: es.communityNft ?? 0, c: '#CD9E32' },
                { v: es.mfpReward ?? 0, c: '#E8C168' },
              ];
              const C = 2 * Math.PI * 45;
              let acc = 0;
              return slices.map((sl, i) => {
                const len = (sl.v / 100) * C;
                const off = acc;
                acc += len;
                return (
                  <circle
                    key={i}
                    cx="60" cy="60" r="45" fill="none"
                    stroke={sl.c} strokeWidth="14"
                    strokeDasharray={`${len} ${C - len}`}
                    strokeDashoffset={-off}
                    transform="rotate(-90 60 60)"
                  />
                );
              });
            })()}
            <text x="60" y="58" textAnchor="middle" className="em-ring-c1">5.95B</text>
            <text x="60" y="70" textAnchor="middle" className="em-ring-c2">MIC Pool</text>
          </svg>
          <div className="em-legend">
            {[
              { v: es.miners, c: '#C9A34C', l: 'Miners (MICE)' },
              { v: es.staking, c: '#72ABE8', l: 'Staking Rewards' },
              { v: es.dao, c: '#849ED4', l: 'DAO Treasury' },
              { v: es.communityNft, c: '#CD9E32', l: 'Community NFT Pool' },
              { v: es.mfpReward, c: '#E8C168', l: 'MFP-NFT Pool' },
            ].map((sl) => (
              <div key={sl.l} className="em-legend-row">
                <span className="em-legend-dot" style={{ background: sl.c }} />
                <span className="em-legend-txt">
                  {sl.v === undefined || sl.v === null ? '-' : `${sl.v}%`} {sl.l}
                </span>
              </div>
            ))}
          </div>
        </div>
        <div className="em-ring-note">
          Live split, read from the emission contract. For the first 90 days the Early
          Staking Boost moves up to 10 points from Miners to Staking and unwinds a little
          each day &mdash; Miners rise toward 59% and Staking settles back to 25%. DAO 10%,
          Community NFT 5% and MFP-NFT 1% do not move.
        </div>
      </div>

      {/* ── Wallet Card ── */}
      <div className="dash-wallet-card">
        <div className="wallet-card-shine" />
        <div className="wallet-card-pattern" />
        <div className="wallet-card-header">
          <div className="wallet-card-title-row">
            <svg className="wallet-card-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4h-4z"/></svg>
            <span className="wallet-card-title">My Wallet</span>
          </div>
          <div className="wallet-card-addr">
            {address ? `${address.slice(0, 6)}...${address.slice(-4)}` : 'Not Connected'}
          </div>
        </div>
        {/* MIC Balance — Total (what MetaMask shows) */}
        <div className="wci-mic-total">
          <div className="wci-mic-total-left">
            <span className="wci-mic-total-label">MIC Balance</span>
            <span className="wci-mic-total-value">{fmt(w.micTotal, '-')}</span>
            <span className="wci-mic-total-hint">on your wallet</span>
          </div>
          <div className="wci-mic-total-logo">
            <img src="/images/mission-chain-logo-clear.png?v=brand20260818c" alt="MIC" width="36" height="36" />
          </div>
        </div>

        {/* Hop dong MIC + them token vao vi */}
        <div className="wci-mic-actions">
          <a
            className="wci-act"
            /* /address#code chu khong phai /token: nut ten "Smart Contract" nen mo thang
               tab ma nguon da verify. Trang /token dat "PRICE $0.00" ngay dau trang vi
               BscScan chua co gia MIC — nhin nham thanh token vo gia tri. */
            href={`${ACTIVE_CHAIN.explorerUrl}/address/${CONTRACTS.mic}#code`}
            target="_blank"
            rel="noopener noreferrer"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9 13h6"/><path d="M9 17h4"/></svg>
            <span>Smart Contract</span>
          </a>
          <button className="wci-act wci-act-primary" onClick={addMicToWallet} type="button">
            {micAdded === 'ok' ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4h-4z"/></svg>
            )}
            <span>
              {micAdded === 'ok' ? 'Added to Wallet' : micAdded === 'err' ? 'No wallet detected' : 'Add MIC to Wallet'}
            </span>
          </button>
        </div>

        {/* MIC Breakdown: Available / Vesting / Staked */}
        <div className="wallet-card-grid wallet-card-grid-3">
          <div className="wallet-card-item wci-highlight-gold">
            <div className="wci-top">
              <span className="wci-dot wci-dot-gold" />
              <span className="wci-label">Available</span>
            </div>
            <span className="wci-value wci-gold">{fmt(w.micAvailable, '-')}</span>
            <span className="wci-sub">freely transferable</span>
          </div>
          <div className="wallet-card-item">
            <div className="wci-top">
              <span className="wci-dot wci-dot-purple" />
              <span className="wci-label">Vesting</span>
            </div>
            <span className="wci-value">{fmt(w.micVesting, '-')}</span>
            <span className="wci-sub">auto-unlock</span>
          </div>
          <div className="wallet-card-item wci-highlight-cyan">
            <div className="wci-top">
              <span className="wci-dot wci-dot-cyan" />
              <span className="wci-label">Staked</span>
            </div>
            <span className="wci-value wci-cyan">{fmt(w.micStaked, '-')}</span>
            <span className="wci-sub">earning rewards</span>
          </div>
        </div>

        {/* Other Tokens */}
        <div className="wallet-card-section-label">Other Tokens</div>
        <div className="wallet-card-grid">
          <div className="wallet-card-item">
            <div className="wci-top">
              <span className="wci-dot wci-dot-cyan" />
              <span className="wci-label">USDT</span>
            </div>
            <span className="wci-value">{fmt(w.usdtBalance, '-')}</span>
          </div>
          <div className="wallet-card-item">
            <div className="wci-top">
              <span className="wci-dot wci-dot-cream" />
              <span className="wci-label">BNB</span>
            </div>
            <span className="wci-value">{fmt(w.bnbBalance, '-')}</span>
          </div>
        </div>

        {/* NFT Holdings */}
        <div className="wallet-card-section-label">NFT Holdings</div>
        <div className="wallet-card-grid wallet-card-grid-nft">
          <div className="wallet-card-item wci-nft wci-nft-mfp">
            <div className="wci-top">
              <span className="wci-nft-icon">👑</span>
              <span className="wci-label">MFP</span>
            </div>
            <span className="wci-value wci-gold">{w.mfpNfts || '-'}</span>
          </div>
          <div className="wallet-card-item wci-nft">
            <div className="wci-top">
              <span className="wci-nft-icon">🔨</span>
              <span className="wci-label">Builder</span>
            </div>
            <span className="wci-value">{w.builders || '-'}</span>
          </div>
          <div className="wallet-card-item wci-nft">
            <div className="wci-top">
              <span className="wci-nft-icon">⚙️</span>
              <span className="wci-label">Maker</span>
            </div>
            <span className="wci-value">{w.makers || '-'}</span>
          </div>
          <div className="wallet-card-item wci-nft">
            <div className="wci-top">
              <span className="wci-nft-icon">✨</span>
              <span className="wci-label">Luminary</span>
            </div>
            <span className="wci-value">{w.luminaries || '-'}</span>
          </div>
        </div>
      </div>

      {/* ── Income Cards ── */}
      <div className="dash-income-row">
        <div className="dash-income-card income-card-usdt">
          <div className="income-card-header">
            <div className="income-card-icon-wrap income-icon-gold">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
            </div>
            <div className="income-card-title">USDT Income</div>
          </div>
          <div className="income-card-claimed">
            <span className="income-claimed-label">Claimed</span>
            <span className="income-claimed-value income-gold">{fmtUsd(w.incomeUsdt?.claimed)}</span>
          </div>
          <div className="income-card-unclaimed">
            <div className="income-unclaimed-info">
              <span className="income-unclaimed-label">Unclaimed</span>
              <span className="income-unclaimed-value income-gold">{fmtUsd(w.incomeUsdt?.unclaimed)}</span>
            </div>
            <button className="btn-claim btn-claim-gold" disabled={parseFloat(w.incomeUsdt?.unclaimed || '0') <= 0}>
              Claim
            </button>
          </div>
        </div>
        <div className="dash-income-card income-card-mic">
          <div className="income-card-header">
            <div className="income-card-icon-wrap income-icon-cyan">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v12M8 10h8M8 14h8"/></svg>
            </div>
            <div className="income-card-title">MIC Income</div>
          </div>
          <div className="income-card-claimed">
            <span className="income-claimed-label">Claimed</span>
            <span className="income-claimed-value income-cyan">{fmt(w.incomeMic?.claimed, '-')}</span>
          </div>
          <div className="income-card-unclaimed">
            <div className="income-unclaimed-info">
              <span className="income-unclaimed-label">Unclaimed</span>
              <span className="income-unclaimed-value income-cyan">{fmt(w.incomeMic?.unclaimed, '-')}</span>
            </div>
            <button className="btn-claim btn-claim-cyan" disabled={parseFloat(w.incomeMic?.unclaimed || '0') <= 0}>
              Claim
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
