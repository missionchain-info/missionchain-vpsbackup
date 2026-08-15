/**
 * MIC ↔ USDT peer-to-peer.
 *
 * Every write is signed by the user's own wallet — the server never holds a key that can
 * move their money. Reads come from /p2p-mic, which reads the contract directly, so the
 * book on screen is the book on chain.
 */
'use client'

import { useCallback, useEffect, useState } from 'react'
import { getActiveChain } from '@missionchain/sdk'

type Order = {
  id: number
  seller: string
  amountMic: string
  priceUsdt: string
  pricePerMic: string
  expiresAt: number
  status: string
  expiredButOpen: boolean
  /** Creation transaction. Null while the log index has not reached it yet. */
  createdTxHash?: string | null
}

type Config = {
  address: string
  feeBps: number
  feePct: number
  paused: boolean
  minPriceUsdt: string
  maxPriceUsdt: string
  minAmountMic: string
  maxAmountMic: string
  minExpirySeconds: number
  maxExpirySeconds: number
}

const ACTIVE_CHAIN = getActiveChain()

/** Where this browser keeps hashes for orders it created, until the server indexes them. */
const LOCAL_TX_KEY = 'mc-p2p-mic-tx'
const API = process.env.NEXT_PUBLIC_API_URL || 'https://api.missionchain.io'
const MIC = '0xf27ec0c311728b923b22828002c992c799326182'
const USDT = '0x55d398326f99059fF775485246999027B3197955'

const ESCROW_ABI = [
  'function createOrder(uint256 amountMic, uint256 priceUsdt, uint64 expirySeconds) returns (uint256)',
  'function createBuyOrder(uint256 amountMic, uint256 priceUsdt, uint64 expirySeconds) returns (uint256)',
  'function fillBuyOrder(uint256 id, uint256 minPriceUsdt)',
  'function cancelBuyOrder(uint256 id)',
  'function expireBuyOrder(uint256 id)',
  'function matchOrder(uint256 id, uint256 maxPriceUsdt)',
  'function cancelOrder(uint256 id)',
  'function expireOrder(uint256 id)',
  // The creation events. Without these in the ABI `parseLog` matches nothing, the new
  // order's id is never learned, and its hash is never recorded — the TXID cell then stays
  // empty until the server backfill catches up, which is exactly the bug this fixes.
  'event OrderCreated(uint256 indexed id, address indexed seller, uint256 amountMic, uint256 priceUsdt, uint64 expiresAt)',
  'event BuyOrderCreated(uint256 indexed id, address indexed buyer, uint256 amountMic, uint256 priceUsdt, uint64 expiresAt)',
]
const ERC20_ABI = [
  'function allowance(address,address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
  'function balanceOf(address) view returns (uint256)',
  'function lockedBalanceOf(address) view returns (uint256)',
]

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`

/**
 * Group the integer part for display: 1234567.89 reads as 1,234,567.89.
 *
 * The value in state stays unformatted. Storing the grouped string and stripping it later
 * is how a stray comma ends up inside parseUnits, and a price that silently loses a digit
 * is exactly the class of mistake this marketplace cannot afford.
 */
function grouped(raw: string) {
  if (!raw) return ''
  const [int, dec] = raw.split('.')
  const g = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return dec !== undefined ? `${g}.${dec}` : g
}

/** Accept only digits and a single dot; ignore the commas the display puts back in. */
function onNumeric(v: string, set: (s: string) => void) {
  const cleaned = v.replace(/,/g, '')
  if (cleaned === '' || /^\d*\.?\d*$/.test(cleaned)) set(cleaned)
}

/**
 * A price field, where a comma means a decimal point.
 *
 * `onNumeric` strips every comma, because `grouped()` puts them in as thousands
 * separators. On a phone whose locale uses a comma for decimals, the iOS numeric keypad
 * offers a comma and no dot at all — so typing 0,008 became 0008 and there was no way to
 * enter a sub-dollar price from a phone. Prices are never large enough to need thousands
 * grouping, so this field takes the raw value and treats a comma as what the member
 * clearly meant by it.
 */
function onDecimal(v: string, set: (s: string) => void) {
  const cleaned = v.replace(/,/g, '.')
  if (cleaned === '' || /^\d*\.?\d*$/.test(cleaned)) set(cleaned)
}
const num = (v: string, dp = 4) =>
  Number(v).toLocaleString('en-US', { maximumFractionDigits: dp })

function timeLeft(ts: number) {
  const s = ts - Math.floor(Date.now() / 1000)
  if (s <= 0) return 'expired'
  const h = Math.floor(s / 3600)
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h left`
  if (h >= 1) return `${h}h ${Math.floor((s % 3600) / 60)}m left`
  return `${Math.floor(s / 60)}m left`
}

export default function MicP2PPanel({ address }: { address?: string }) {
  const [cfg, setCfg] = useState<Config | null>(null)
  const [orders, setOrders] = useState<Order[]>([])
  const [mine, setMine] = useState<Order[]>([])
  const [busy, setBusy] = useState<string>('')
  /** `sell:12` / `bid:3` → hash, for orders this browser created. */
  const [localTx, setLocalTx] = useState<Record<string, string>>({})
  /** `hash` turns the message into a link to the explorer. Absent on plain errors. */
  const [msg, setMsg] = useState<{ ok: boolean; text: string; hash?: string } | null>(null)

  const [amount, setAmount] = useState('')
  /** Price for ONE MIC. The contract prices the whole lot; the multiply happens on submit. */
  const [price, setPrice] = useState('')
  const [tradable, setTradable] = useState<string | null>(null)
  /**
   * Which tab is open. `side` follows from it: the form only appears on the two trading
   * tabs, and each tab shows one book instead of stacking all four on top of each other.
   */
  const [tab, setTab] = useState<'sell' | 'buy' | 'myOrders' | 'myBids'>('sell')
  const side: 'sell' | 'buy' = tab === 'buy' ? 'buy' : 'sell'

  const [bids, setBids] = useState<Order[]>([])
  /*
   * The public books, without this wallet's own entries.
   *
   * Your own order is not something you can trade against — it rendered as an inert
   * "yours" row taking up a line in a list of things to act on. It has a home already:
   * My orders and My bids.
   */
  const meLower = (address || '').toLowerCase()
  const othersOffers = orders.filter((o) => o.seller.toLowerCase() !== meLower)
  const othersBids = (bids as any[]).filter((o) => String(o.buyer).toLowerCase() !== meLower)
  const [myBids, setMyBids] = useState<any[]>([])
  const [locked, setLocked] = useState<string | null>(null)
  const [usdtBal, setUsdtBal] = useState<string | null>(null)
  const [days, setDays] = useState('7')

  const load = useCallback(async () => {
    try {
      const [c, o, bd] = await Promise.all([
        fetch(`${API}/p2p-mic/config`).then((r) => (r.ok ? r.json() : null)),
        fetch(`${API}/p2p-mic/orders?status=open`).then((r) => (r.ok ? r.json() : null)),
        fetch(`${API}/p2p-mic/bids?status=open`).then((r) => (r.ok ? r.json() : null)),
      ])
      if (c) setCfg(c.data)
      if (o) setOrders(o.data)
      if (bd) setBids(bd.data)
      if (address) {
        const [m, mb] = await Promise.all([
          fetch(`${API}/p2p-mic/orders?status=all&seller=${address}`).then((r) => (r.ok ? r.json() : null)),
          fetch(`${API}/p2p-mic/bids?status=all&buyer=${address}`).then((r) => (r.ok ? r.json() : null)),
        ])
        if (m) setMine(m.data)
        if (mb) setMyBids(mb.data)

        // Read server-side: a balance is public, and routing it through the browser wallet
        // meant any wallet hiccup blanked the one figure the seller needs.
        const b = await fetch(`${API}/p2p-mic/balance/${address}`).then((r) => (r.ok ? r.json() : null))
        setTradable(b ? b.data.tradable : null)
        setLocked(b ? b.data.locked : null)
        setUsdtBal(b ? b.data.usdt : null)
      }
    } catch {
      setMsg({ ok: false, text: 'Could not reach the marketplace. Check your connection and retry.' })
    }
  }, [address])

  useEffect(() => {
    try { setLocalTx(JSON.parse(localStorage.getItem(LOCAL_TX_KEY) || '{}')) } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, 30_000)
    return () => clearInterval(t)
  }, [load])

  /**
   * A wallet, on the active chain, with a signer.
   *
   * The first version compared a raw eth_chainId against a hard-coded '0x38' and threw. It
   * told a member on the correct network to switch to it, and never said which network the
   * wallet was actually on, so there was nothing to act on. This asks the wallet to switch
   * (adding the chain if it does not know it), the way the rest of this page already does,
   * and if it still will not move it reports the chain id it found.
   */
  async function signer() {
    const eth = (window as any).ethereum
    if (!eth) throw new Error('No wallet detected. Install MetaMask or another BSC wallet.')

    const { BrowserProvider } = await import('ethers')
    let provider = new BrowserProvider(eth)
    let network = await provider.getNetwork()

    if (Number(network.chainId) !== ACTIVE_CHAIN.chainId) {
      try {
        await eth.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: ACTIVE_CHAIN.chainIdHex }],
        })
      } catch (e: any) {
        // 4902: the wallet has never heard of this chain. Offer to add it rather than
        // leaving the member to type an RPC URL by hand.
        if (e?.code === 4902) {
          await eth.request({
            method: 'wallet_addEthereumChain',
            params: [{
              chainId: ACTIVE_CHAIN.chainIdHex,
              chainName: ACTIVE_CHAIN.name,
              nativeCurrency: ACTIVE_CHAIN.nativeCurrency,
              rpcUrls: ACTIVE_CHAIN.rpcUrls,
              blockExplorerUrls: [ACTIVE_CHAIN.explorerUrl],
            }],
          })
        } else {
          throw e
        }
      }

      provider = new BrowserProvider(eth)
      network = await provider.getNetwork()
      if (Number(network.chainId) !== ACTIVE_CHAIN.chainId) {
        throw new Error(
          `Your wallet is on chain ${Number(network.chainId)}; ${ACTIVE_CHAIN.name} is ` +
          `${ACTIVE_CHAIN.chainId}. If you have more than one wallet extension enabled, the ` +
          `page may be talking to a different one than you think.`,
        )
      }
    }

    return provider.getSigner()
  }

  /** Approve only when the current allowance is short — a needless approval is a needless fee. */
  async function ensureAllowance(token: string, need: bigint) {
    const { Contract, MaxUint256 } = await import('ethers')
    const s = await signer()
    const t = new Contract(token, ERC20_ABI, s)
    const have: bigint = await t.allowance(await s.getAddress(), cfg!.address)
    if (have >= need) return
    const tx = await t.approve(cfg!.address, MaxUint256)
    await tx.wait()
  }

  /**
   * The reason the contract actually gave.
   *
   * `e.shortMessage` is often "missing revert data", which is ethers describing its own
   * decoding, not the contract. `P2P: amount out of range` was sitting one level down the
   * whole time — the member was told nothing while the chain had told us exactly why.
   */
  function revertReason(e: any): string {
    const nested =
      e?.reason ||
      e?.revert?.args?.[0] ||
      e?.info?.error?.message ||
      e?.error?.message ||
      e?.data?.message
    const raw = String(nested || e?.shortMessage || e?.message || 'Transaction failed')
    // Strip the wrapper ethers adds so the member reads the contract's sentence, not ours.
    return raw.replace(/^execution reverted:?\s*/i, '').replace(/^"|"$/g, '')
  }

  /*
   * Hashes for orders this browser created.
   *
   * The server backfills these from logs, which takes a while and needs an endpoint that
   * will serve `eth_getLogs`. But for an order the member just placed, the hash was in
   * hand the moment the transaction confirmed — so it is recorded here and shown at once.
   * Kept in localStorage so a reload does not lose it while the backfill catches up.
   */
  function rememberTx(kind: 'sell' | 'bid', id: string, hash: string) {
    try {
      const m = JSON.parse(localStorage.getItem(LOCAL_TX_KEY) || '{}')
      m[`${kind}:${id}`] = hash
      localStorage.setItem(LOCAL_TX_KEY, JSON.stringify(m))
      setLocalTx({ ...m })
    } catch { /* a full or blocked store must not break a trade */ }
  }

  /** Shortest useful form of a hash, with a link out. Blank when not yet indexed. */
  function TxCell({ hash, kind, id }: { hash?: string | null; kind: 'sell' | 'bid'; id: number | string }) {
    const h = hash || localTx[`${kind}:${id}`]
    if (!h) return <span style={{ opacity: 0.45 }}>—</span>
    return (
      <a
        href={`${ACTIVE_CHAIN.explorerUrl}/tx/${h}`}
        target="_blank"
        rel="noopener noreferrer"
        className="swap-msg-link"
        title={h}
      >
        {h.slice(0, 4)}…{h.slice(-4)}{' ↗'}
      </a>
    )
  }

  /**
   * @param inColumn  true when the action creates a row that will carry its own TXID cell.
   *                  Those confirmations leave the hash out: a 66-character string across
   *                  the top of the panel does not say WHICH order it belongs to, and the
   *                  same hash on the row does. Buy, cancel and fill keep it — the row they
   *                  refer to is gone by the time the message appears, so the banner is the
   *                  only place left to put it.
   */
  async function run(key: string, fn: () => Promise<string>, done: string, inColumn = false) {
    setBusy(key)
    setMsg(null)
    try {
      const hash = await fn()
      setMsg(inColumn ? { ok: true, text: done } : { ok: true, text: done, hash })
      await load()
    } catch (e: any) {
      setMsg({ ok: false, text: revertReason(e) })
    }
    setBusy('')
  }

  const createBid = () =>
    run(
      'create',
      async () => {
        const { Contract, parseUnits } = await import('ethers')
        const amt = parseUnits(amount || '0', 18)
        const px = (parseUnits(price || '0', 18) * amt) / 10n ** 18n
        // The buyer's USDT is escrowed, so that is what needs the allowance.
        await ensureAllowance(USDT, px)
        const c = new Contract(cfg!.address, ESCROW_ABI, await signer())
        const tx = await c.createBuyOrder(amt, px, BigInt(Number(days) * 86400))
        const receipt = await tx.wait()
        // The id is in the receipt we already have. Waiting for the server's log backfill
        // to tell us the hash of an order we just created would be slower and can fail;
        // this cannot.
        try {
          const parsed = receipt.logs
            .map((l: any) => { try { return c.interface.parseLog(l) } catch { return null } })
            .find((x: any) => x?.name === 'BuyOrderCreated')
          // Fall back to the raw topic. The id is the first indexed argument, so it is
          // topics[1] of the escrow's own log whether or not the fragment decodes.
          const topicId = parsed ? null : receipt.logs
            .filter((l: any) => String(l.address).toLowerCase() === cfg!.address.toLowerCase())
            .map((l: any) => l.topics?.[1])
            .find(Boolean)
          const newId = parsed ? String(parsed.args[0]) : (topicId ? String(BigInt(topicId)) : null)
          if (newId) rememberTx('bid', newId, tx.hash)
        } catch { /* the trade succeeded; the bookkeeping is best-effort */ }
        setAmount('')
        setPrice('')
        return tx.hash
      },
      'Bid posted',
      true,
    )

  /** Deliver MIC into someone's standing bid. */
  const sellInto = (o: Order) =>
    run(
      `fill-${o.id}`,
      async () => {
        const { Contract, parseUnits } = await import('ethers')
        await ensureAllowance(MIC, parseUnits(o.amountMic, 18))
        const c = new Contract(cfg!.address, ESCROW_ABI, await signer())
        // Floor at exactly the posted bid: a stale screen fails instead of selling for less.
        const tx = await c.fillBuyOrder(o.id, parseUnits(o.priceUsdt, 18))
        await tx.wait()
        return tx.hash
      },
      'Sold',
    )

  const cancelBid = (o: Order) =>
    run(
      `cancel-bid-${o.id}`,
      async () => {
        const { Contract } = await import('ethers')
        const c = new Contract(cfg!.address, ESCROW_ABI, await signer())
        const tx = await (o.expiredButOpen ? c.expireBuyOrder(o.id) : c.cancelBuyOrder(o.id))
        await tx.wait()
        return tx.hash
      },
      'USDT returned to your wallet',
    )

  const createOrder = () =>
    run(
      'create',
      async () => {
        const { Contract, parseUnits } = await import('ethers')
        const amt = parseUnits(amount || '0', 18)
        // The contract takes one total for the lot; the seller thinks in price per MIC.
        // Multiply in 18-decimal fixed point rather than in JS floats, which would round
        // a long price and quietly list at a figure the seller never typed.
        const px = (parseUnits(price || '0', 18) * amt) / 10n ** 18n
        await ensureAllowance(MIC, amt)
        const c = new Contract(cfg!.address, ESCROW_ABI, await signer())
        const tx = await c.createOrder(amt, px, BigInt(Number(days) * 86400))
        const receipt = await tx.wait()
        try {
          const parsed = receipt.logs
            .map((l: any) => { try { return c.interface.parseLog(l) } catch { return null } })
            .find((x: any) => x?.name === 'OrderCreated')
          // Fall back to the raw topic. The id is the first indexed argument, so it is
          // topics[1] of the escrow's own log whether or not the fragment decodes.
          const topicId = parsed ? null : receipt.logs
            .filter((l: any) => String(l.address).toLowerCase() === cfg!.address.toLowerCase())
            .map((l: any) => l.topics?.[1])
            .find(Boolean)
          const newId = parsed ? String(parsed.args[0]) : (topicId ? String(BigInt(topicId)) : null)
          if (newId) rememberTx('sell', newId, tx.hash)
        } catch { /* the trade succeeded; the bookkeeping is best-effort */ }
        setAmount('')
        setPrice('')
        return tx.hash
      },
      'Order listed',
      true,
    )

  const buy = (o: Order) =>
    run(
      `buy-${o.id}`,
      async () => {
        const { Contract, parseUnits } = await import('ethers')
        const px = parseUnits(o.priceUsdt, 18)
        await ensureAllowance(USDT, px)
        const c = new Contract(cfg!.address, ESCROW_ABI, await signer())
        // Cap at exactly the asking price: if the screen were stale the trade fails
        // instead of quietly costing more.
        const tx = await c.matchOrder(o.id, px)
        await tx.wait()
        return tx.hash
      },
      'Purchased',
    )

  const cancel = (o: Order) =>
    run(
      `cancel-${o.id}`,
      async () => {
        const { Contract } = await import('ethers')
        const c = new Contract(cfg!.address, ESCROW_ABI, await signer())
        const tx = await (o.expiredButOpen ? c.expireOrder(o.id) : c.cancelOrder(o.id))
        await tx.wait()
        return tx.hash
      },
      'MIC returned to your wallet',
    )

  if (!cfg) {
    return <div className="nft-pool-note">Loading the MIC marketplace…</div>
  }

  const amountNum = Number(amount || 0)
  /** True when the amount is outside what the contract will accept. */
  const amountOutOfRange = cfg
    ? amountNum > 0 && (amountNum < Number(cfg.minAmountMic) || amountNum > Number(cfg.maxAmountMic))
    : false
  const total = Number(price || 0) * Number(amount || 0)
  const fee = (total * cfg.feeBps) / 10_000
  const net = total - fee
  const overBalance = tradable !== null && Number(amount || 0) > Number(tradable)
  const overUsdt = usdtBal !== null && total > Number(usdtBal)
  const myOrders = mine.filter((o) => o.status === 'PENDING')
  const myOpenBids = myBids.filter((o: any) => o.status === 'PENDING')
  const myPastOrders = mine.filter((o) => o.status !== 'PENDING')
  const myPastBids = myBids.filter((o: any) => o.status !== 'PENDING')

  return (
    <div className="nft-section-card">
      <div className="nft-section-header">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 16V4m0 0L3 8m4-4l4 4M17 8v12m0 0l4-4m-4 4l-4-4"/></svg>
        <span className="nft-section-title">MIC ↔ USDT — Peer to Peer</span>
      </div>
      <div className="nft-pool-note">
        Trade MIC directly with another member at a price you both agree. The contract holds the
        seller&apos;s MIC and settles both sides in one transaction, so neither side has to go first.
        Fee {cfg.feePct}%, paid by the seller out of the sale.
      </div>
      <div className="p2p-side">
        {([
          ['sell', 'I want to sell MIC'],
          ['buy', 'I want to buy MIC'],
          ['myOrders', `My Offers${myOrders.length ? ` (${myOrders.length})` : ''}`],
          ['myBids', `My Bids${myOpenBids.length ? ` (${myOpenBids.length})` : ''}`],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={tab === key ? 'p2p-side-on' : ''}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'sell' || tab === 'buy' ? (
        <div className="nft-pool-note">
          {side === 'sell'
            ? 'Your MIC is held by the contract until someone buys it. Cancel any time and it comes straight back.'
            : 'Your USDT is held by the contract until someone sells into your bid. Cancel any time and it comes straight back.'}
        </div>
      ) : null}

      {cfg.paused ? (
        <div className="nft-pool-note" style={{ color: 'var(--gold)' }}>
          The marketplace is paused. Existing sellers can still withdraw their orders.
        </div>
      ) : null}

      {msg ? (
        <div className="nft-pool-note" style={{ color: msg.ok ? '#7ddc9a' : '#ff8f8f' }}>
          {msg.text}
          {msg.hash && (
            <>
              {' — '}
              <a
                href={`${ACTIVE_CHAIN.explorerUrl}/tx/${msg.hash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="swap-msg-link"
                title={msg.hash}
              >
                <span className="swap-msg-hash">{msg.hash}</span>
                {' ↗'}
              </a>
            </>
          )}
        </div>
      ) : null}

      {/* ── Sell ─────────────────────────────────────────────── */}
      {tab === 'sell' || tab === 'buy' ? (
      <div className="p2p-form">
        <label>
          <span>{side === 'sell' ? 'MIC to sell' : 'MIC to buy'}</span>
          <input
            value={grouped(amount)}
            onChange={(e) => onNumeric(e.target.value, setAmount)}
            placeholder="1,000"
            inputMode="decimal"
          />
        </label>
        <label>
          <span>Price per MIC (USDT)</span>
          <input
            value={price}
            onChange={(e) => onDecimal(e.target.value, setPrice)}
            placeholder="0.008"
            inputMode="decimal"
          />
        </label>
        <label>
          <span>Expires in</span>
          <select value={days} onChange={(e) => setDays(e.target.value)}>
            <option value="1">1 day</option>
            <option value="7">7 days</option>
            <option value="14">14 days</option>
            <option value="30">30 days</option>
          </select>
        </label>
        <button
          className="nft-claim-btn"
          disabled={
            !address || cfg.paused || busy === 'create' || !amount || !price ||
            // Stop it at the button rather than at a revert the member pays gas to reach.
            amountOutOfRange || total < Number(cfg.minPriceUsdt) ||
            (side === 'sell' && overBalance) || (side === 'buy' && overUsdt)
          }
          onClick={side === 'sell' ? createOrder : createBid}
        >
          {busy === 'create'
            ? side === 'sell' ? 'Listing…' : 'Posting…'
            : !address ? 'Connect wallet'
            : side === 'sell' ? 'List for Sale' : 'Post Bid'}
        </button>
      </div>
      ) : null}

      {tab === 'sell' || tab === 'buy' ? (
      <>
      {/* Below the row, not inside a cell: a hint tucked into one label stretched that
          column and knocked the four fields out of alignment. */}
      <div className="p2p-hint">
        {!address ? (
          side === 'sell'
            ? 'Connect your wallet to see how much MIC you can sell'
            : 'Connect your wallet to see how much USDT you can commit'
        ) : side === 'sell' ? (
          tradable === null ? (
            'Could not read your MIC balance — check that your wallet is connected to BSC'
          ) : (
            <>
              Available to sell:{' '}
              <button type="button" className="p2p-max" onClick={() => setAmount(tradable)}>
                {num(tradable)} MIC
              </button>
              {Number(tradable) === 0
                ? ' — nothing spendable in this wallet'
                : Number(locked || 0) > 0
                  ? ` (${num(locked!)} MIC is locked by vesting and cannot be sold)`
                  : ''}
            </>
          )
        ) : usdtBal === null ? (
          'Could not read your USDT balance — check that your wallet is connected to BSC'
        ) : (
          <>
            Available to buy: <strong>{num(usdtBal, 2)} USDT</strong>
            {Number(usdtBal) === 0 ? ' — nothing spendable in this wallet' : ' in this wallet'}
          </>
        )}
      </div>

      {total > 0 ? (
        <div className="nft-pool-note">
          Total <strong>${num(String(total), 4)}</strong> for {num(amount)} MIC ·{' '}
          {side === 'sell' ? (
            <>you receive <strong>${num(String(net), 4)}</strong> after the {cfg.feePct}% fee (${num(String(fee), 4)}).</>
          ) : (
            <>you escrow the full <strong>${num(String(total), 4)}</strong>; the seller nets ${num(String(net), 4)} after the {cfg.feePct}% fee.</>
          )}
          {total < Number(cfg.minPriceUsdt) ? (
            <> <span style={{ color: '#ff8f8f' }}>Below the ${cfg.minPriceUsdt} minimum for a listing.</span></>
          ) : null}
          {/*
            The amount bound was read from the contract and never checked against. A 5 MIC
            bid reverted with "P2P: amount out of range" and the screen showed
            "missing revert data", so there was no way to learn that the floor is
            {cfg.minAmountMic} MIC except by guessing.
          */}
          {amountNum > 0 && amountNum < Number(cfg.minAmountMic) ? (
            <> <span style={{ color: '#ff8f8f' }}>
              Minimum is {num(cfg.minAmountMic, 0)} MIC per order.
            </span></>
          ) : null}
          {amountNum > Number(cfg.maxAmountMic) ? (
            <> <span style={{ color: '#ff8f8f' }}>
              Maximum is {num(cfg.maxAmountMic, 0)} MIC per order.
            </span></>
          ) : null}
          {side === 'buy' && overUsdt ? (
            <> <span style={{ color: '#ff8f8f' }}>
              That is more than the {num(usdtBal!, 2)} USDT in your wallet.
            </span></>
          ) : null}
          {side === 'sell' && overBalance ? (
            <> <span style={{ color: '#ff8f8f' }}>
              You only have {num(tradable!)} MIC available — the rest is locked by vesting and cannot be sold.
            </span></>
          ) : null}
        </div>
      ) : null}

      </>
      ) : null}

      {/*
        The books were attached to the wrong tabs.
        Someone who wants to SELL has no use for a list of other sellers — they need the
        BIDS they can sell into. Someone who wants to BUY needs the OFFERS. Each tab now
        shows the other side of the trade, which is the side you can actually act on.
      */}
      {tab === 'buy' ? (
      <>
      {/* ── Offers: what a buyer can buy ─────────────────────── */}
      <div className="nft-section-header" style={{ marginTop: 20 }}>
        <span className="nft-section-title">Open offers — sellers you can buy from</span>
      </div>
      {othersOffers.length === 0 ? (
        <div className="nft-pool-note">No offers from other members right now.</div>
      ) : (
        <div className="p2p-table">
          <div className="p2p-row p2p-head">
            <span>MIC</span><span>TXID</span><span>Price</span><span>Per MIC</span><span>Seller</span><span>Time</span><span />
          </div>
          {othersOffers.map((o) => (
            <div className="p2p-row" key={o.id}>
              <span>{num(o.amountMic)}</span>
              <span><TxCell hash={o.createdTxHash} kind="sell" id={o.id} /></span>
              <span>${num(o.priceUsdt, 2)}</span>
              <span>${num(o.pricePerMic, 6)}</span>
              <span>{short(o.seller)}</span>
              <span>{timeLeft(o.expiresAt)}</span>
              <span>
                {/* No "yours" branch: this book excludes your own offers by construction. */}
                <button className="nft-claim-btn" disabled={!address || busy === `buy-${o.id}`} onClick={() => buy(o)}>
                  {busy === `buy-${o.id}` ? 'Buying…' : 'Buy'}
                </button>
              </span>
            </div>
          ))}
        </div>
      )}

      </>
      ) : null}

      {tab === 'sell' ? (
      <>
      {/* ── Bids: what a seller can sell into ────────────────── */}
      <div className="nft-section-header" style={{ marginTop: 20 }}>
        <span className="nft-section-title">Open bids — buyers you can sell to</span>
      </div>
      {othersBids.length === 0 ? (
        <div className="nft-pool-note">No bids from other members right now.</div>
      ) : (
        <div className="p2p-table">
          <div className="p2p-row p2p-head">
            <span>MIC wanted</span><span>TXID</span><span>Pays</span><span>Per MIC</span><span>Buyer</span><span>Time</span><span />
          </div>
          {othersBids.map((o: any) => (
            <div className="p2p-row" key={o.id}>
              <span>{num(o.amountMic)}</span>
              <span><TxCell hash={o.createdTxHash} kind="bid" id={o.id} /></span>
              <span>${num(o.priceUsdt, 2)}</span>
              <span>${num(o.pricePerMic, 6)}</span>
              <span>{short(o.buyer)}</span>
              <span>{timeLeft(o.expiresAt)}</span>
              <span>
                {/* Cancelling your own bid belongs on the My bids tab, not here. */}
                <button className="nft-claim-btn" disabled={!address || busy === `fill-${o.id}`} onClick={() => sellInto(o)}>
                  {busy === `fill-${o.id}` ? 'Selling…' : 'Sell'}
                </button>
              </span>
            </div>
          ))}
        </div>
      )}

      </>
      ) : null}

      {/* ── My orders ────────────────────────────────────────── */}
      {/* Everything this wallet has sold or tried to sell, filled and cancelled included:
          a member looking for their own history should not have to hunt on a block explorer. */}
      {tab === 'myOrders' ? (
        <>
          <div className="nft-section-header p2p-section">
            <span className="nft-section-title">My active offers</span>
          </div>
          {!address ? (
            <div className="nft-pool-note">Connect your wallet to see your orders.</div>
          ) : myOrders.length === 0 ? (
            <div className="nft-pool-note">
              No orders open right now. Open <strong>I want to sell MIC</strong> to place one.
            </div>
          ) : (
            <div className="p2p-table">
              <div className="p2p-row p2p-head">
                <span>MIC</span><span>TXID</span><span>Price</span><span>Per MIC</span><span>Status</span><span>Time</span><span />
              </div>
              {myOrders.map((o) => (
                <div className="p2p-row" key={o.id}>
                  <span>{num(o.amountMic)}</span>
                  <span><TxCell hash={o.createdTxHash} kind="sell" id={o.id} /></span>
                  <span>${num(o.priceUsdt, 2)}</span>
                  <span>${num(o.pricePerMic, 6)}</span>
                  <span>{o.expiredButOpen ? 'EXPIRED' : o.status}</span>
                  <span>{o.status === 'PENDING' && !o.expiredButOpen ? timeLeft(o.expiresAt) : '—'}</span>
                  <span>
                    {o.status === 'PENDING' ? (
                      <button className="nft-claim-btn" disabled={busy === `cancel-${o.id}`} onClick={() => cancel(o)}>
                        {busy === `cancel-${o.id}` ? 'Working…' : o.expiredButOpen ? 'Take back' : 'Cancel'}
                      </button>
                    ) : null}
                  </span>
                </div>
              ))}
            </div>
          )}

          {myPastOrders.length > 0 ? (
            <>
              <div className="nft-section-header p2p-section">
                <span className="nft-section-title">Past offers</span>
              </div>
              <div className="p2p-table">
                {myPastOrders.map((o) => (
                  <div className="p2p-row" key={o.id}>
                    <span>{num(o.amountMic)}</span>
                    <span><TxCell hash={o.createdTxHash} kind="sell" id={o.id} /></span>
                    <span>${num(o.priceUsdt, 2)}</span>
                    <span>${num(o.pricePerMic, 6)}</span>
                    <span>{o.status}</span>
                    <span>—</span>
                    <span />
                  </div>
                ))}
              </div>
            </>
          ) : null}
        </>
      ) : null}

      {/* ── My bids ──────────────────────────────────────────── */}
      {tab === 'myBids' ? (
        <>
          <div className="nft-section-header p2p-section">
            <span className="nft-section-title">My active bids</span>
          </div>
          {!address ? (
            <div className="nft-pool-note">Connect your wallet to see your bids.</div>
          ) : myOpenBids.length === 0 ? (
            <div className="nft-pool-note">
              No bids open right now. Open <strong>I want to buy MIC</strong> to place one.
            </div>
          ) : (
            <div className="p2p-table">
              <div className="p2p-row p2p-head">
                <span>MIC wanted</span><span>TXID</span><span>Escrowed</span><span>Per MIC</span><span>Status</span><span>Time</span><span />
              </div>
              {myOpenBids.map((o: any) => (
                <div className="p2p-row" key={o.id}>
                  <span>{num(o.amountMic)}</span>
                  <span><TxCell hash={o.createdTxHash} kind="bid" id={o.id} /></span>
                  <span>${num(o.priceUsdt, 2)}</span>
                  <span>${num(o.pricePerMic, 6)}</span>
                  <span>{o.expiredButOpen ? 'EXPIRED' : o.status}</span>
                  <span>{o.status === 'PENDING' && !o.expiredButOpen ? timeLeft(o.expiresAt) : '—'}</span>
                  <span>
                    {o.status === 'PENDING' ? (
                      <button
                        className="nft-claim-btn"
                        disabled={busy === `cancel-bid-${o.id}`}
                        onClick={() => cancelBid(o)}
                      >
                        {busy === `cancel-bid-${o.id}` ? 'Working…' : o.expiredButOpen ? 'Take back' : 'Cancel'}
                      </button>
                    ) : null}
                  </span>
                </div>
              ))}
            </div>
          )}

          {myPastBids.length > 0 ? (
            <>
              <div className="nft-section-header p2p-section">
                <span className="nft-section-title">Past bids</span>
              </div>
              <div className="p2p-table">
                {myPastBids.map((o: any) => (
                  <div className="p2p-row" key={o.id}>
                    <span>{num(o.amountMic)}</span>
                    <span><TxCell hash={o.createdTxHash} kind="bid" id={o.id} /></span>
                    <span>${num(o.priceUsdt, 2)}</span>
                    <span>${num(o.pricePerMic, 6)}</span>
                    <span>{o.status}</span>
                    <span>—</span>
                    <span />
                  </div>
                ))}
              </div>
            </>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
