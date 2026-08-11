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
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const [amount, setAmount] = useState('')
  /** Price for ONE MIC. The contract prices the whole lot; the multiply happens on submit. */
  const [price, setPrice] = useState('')
  const [tradable, setTradable] = useState<string | null>(null)
  /** Which side of the book this member is opening. */
  const [side, setSide] = useState<'sell' | 'buy'>('sell')
  const [bids, setBids] = useState<Order[]>([])
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
        const m = await fetch(`${API}/p2p-mic/orders?status=all&seller=${address}`).then((r) =>
          r.ok ? r.json() : null,
        )
        if (m) setMine(m.data)

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

  async function run(key: string, fn: () => Promise<string>, done: string) {
    setBusy(key)
    setMsg(null)
    try {
      const hash = await fn()
      setMsg({ ok: true, text: `${done} — ${hash.slice(0, 12)}…` })
      await load()
    } catch (e: any) {
      setMsg({ ok: false, text: e?.shortMessage || e?.message || 'Transaction failed' })
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
        await tx.wait()
        setAmount('')
        setPrice('')
        return tx.hash
      },
      'Bid posted',
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
        await tx.wait()
        setAmount('')
        setPrice('')
        return tx.hash
      },
      'Order listed',
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

  const total = Number(price || 0) * Number(amount || 0)
  const fee = (total * cfg.feeBps) / 10_000
  const net = total - fee
  const overBalance = tradable !== null && Number(amount || 0) > Number(tradable)
  const overUsdt = usdtBal !== null && total > Number(usdtBal)

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
        <button
          type="button"
          className={side === 'sell' ? 'p2p-side-on' : ''}
          onClick={() => setSide('sell')}
        >
          I want to sell MIC
        </button>
        <button
          type="button"
          className={side === 'buy' ? 'p2p-side-on' : ''}
          onClick={() => setSide('buy')}
        >
          I want to buy MIC
        </button>
      </div>
      <div className="nft-pool-note">
        {side === 'sell'
          ? 'Your MIC is held by the contract until someone buys it. Cancel any time and it comes straight back.'
          : 'Your USDT is held by the contract until someone sells into your bid. Cancel any time and it comes straight back.'}
      </div>

      {cfg.paused ? (
        <div className="nft-pool-note" style={{ color: 'var(--gold)' }}>
          The marketplace is paused. Existing sellers can still withdraw their orders.
        </div>
      ) : null}

      {msg ? (
        <div className="nft-pool-note" style={{ color: msg.ok ? '#7ddc9a' : '#ff8f8f' }}>{msg.text}</div>
      ) : null}

      {/* ── Sell ─────────────────────────────────────────────── */}
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
            value={grouped(price)}
            onChange={(e) => onNumeric(e.target.value, setPrice)}
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

      {/* ── Book ─────────────────────────────────────────────── */}
      <div className="nft-section-header" style={{ marginTop: 20 }}>
        <span className="nft-section-title">Open offers</span>
      </div>
      {orders.length === 0 ? (
        <div className="nft-pool-note">No offers yet. List one above and it appears here for every member.</div>
      ) : (
        <div className="p2p-table">
          <div className="p2p-row p2p-head">
            <span>MIC</span><span>Price</span><span>Per MIC</span><span>Seller</span><span>Time</span><span />
          </div>
          {orders.map((o) => (
            <div className="p2p-row" key={o.id}>
              <span>{num(o.amountMic)}</span>
              <span>${num(o.priceUsdt, 2)}</span>
              <span>${num(o.pricePerMic, 6)}</span>
              <span>{short(o.seller)}</span>
              <span>{timeLeft(o.expiresAt)}</span>
              <span>
                {address && o.seller.toLowerCase() === address.toLowerCase() ? (
                  <em style={{ opacity: 0.6, fontSize: '.7rem' }}>yours</em>
                ) : (
                  <button className="nft-claim-btn" disabled={!address || busy === `buy-${o.id}`} onClick={() => buy(o)}>
                    {busy === `buy-${o.id}` ? 'Buying…' : 'Buy'}
                  </button>
                )}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* ── Bids ─────────────────────────────────────────────── */}
      <div className="nft-section-header" style={{ marginTop: 20 }}>
        <span className="nft-section-title">Open bids</span>
      </div>
      {bids.length === 0 ? (
        <div className="nft-pool-note">No bids yet. Post one above and any holder can sell into it.</div>
      ) : (
        <div className="p2p-table">
          <div className="p2p-row p2p-head">
            <span>MIC wanted</span><span>Pays</span><span>Per MIC</span><span>Buyer</span><span>Time</span><span />
          </div>
          {bids.map((o: any) => (
            <div className="p2p-row" key={o.id}>
              <span>{num(o.amountMic)}</span>
              <span>${num(o.priceUsdt, 2)}</span>
              <span>${num(o.pricePerMic, 6)}</span>
              <span>{short(o.buyer)}</span>
              <span>{timeLeft(o.expiresAt)}</span>
              <span>
                {address && o.buyer.toLowerCase() === address.toLowerCase() ? (
                  <button className="nft-claim-btn" disabled={busy === `cancel-bid-${o.id}`} onClick={() => cancelBid(o)}>
                    {busy === `cancel-bid-${o.id}` ? 'Working…' : 'Cancel'}
                  </button>
                ) : (
                  <button className="nft-claim-btn" disabled={!address || busy === `fill-${o.id}`} onClick={() => sellInto(o)}>
                    {busy === `fill-${o.id}` ? 'Selling…' : 'Sell'}
                  </button>
                )}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* ── Mine ─────────────────────────────────────────────── */}
      {address && mine.length > 0 ? (
        <>
          <div className="nft-section-header" style={{ marginTop: 20 }}>
            <span className="nft-section-title">My orders</span>
          </div>
          <div className="p2p-table">
            {mine.map((o) => (
              <div className="p2p-row" key={o.id}>
                <span>{num(o.amountMic)} MIC</span>
                <span>${num(o.priceUsdt, 2)}</span>
                <span>{o.expiredButOpen ? 'EXPIRED' : o.status}</span>
                <span>{o.status === 'PENDING' ? timeLeft(o.expiresAt) : '—'}</span>
                <span />
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
        </>
      ) : null}
    </div>
  )
}
