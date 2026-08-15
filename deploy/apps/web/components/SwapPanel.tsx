'use client'

import { useCallback, useEffect, useState } from 'react'
import { ethers } from 'ethers'
import { useAccount } from 'wagmi'
import { getActiveChain } from '@missionchain/sdk'
import { CONTRACTS, USDT_ABI } from '@/lib/contracts'

const ACTIVE_CHAIN = getActiveChain()

/** Highest slippage a trader may set. Above this the protection stops being protection. */
const MAX_SLIPPAGE_PCT = 15

/**
 * Swap USDT ↔ MIC against LiquidityPoolV6.
 *
 * Shared by the `/swap` page and the pop-up on the MICE page, because a buyer who is
 * short of MIC should not have to leave the purchase to fix it.
 *
 * ## Everything here is gated by the pool's own state, not by a flag we keep
 *
 * The pool is deployed but dormant until it is seeded with MIC, and its sell side stays
 * shut for 30 days after that. Both facts are read from the contract on every load, so
 * this panel opens the moment the pool goes live without anyone editing code — and it
 * cannot show an open market that isn't there.
 *
 * ## Why the quote is not a promise
 *
 * The pool is a constant-product curve: the price moves as the trade executes, and other
 * trades can land first. `minOut` is the only real protection a trader has, so it is
 * always sent, always derived from the live quote, and the tolerance is theirs to set.
 * A swap that would return less reverts and costs nothing but gas.
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'https://api.missionchain.io'

const POOL_ABI = [
  'function isSeeded() view returns (bool)',
  'function phase() view returns (uint8)',
  'function poolAgeDays() view returns (uint256)',
  'function spotPrice() view returns (uint256)',
  'function quoteBuy(uint256 usdtIn) view returns (uint256)',
  'function quoteSell(uint256 micIn) view returns (uint256)',
  'function sellFeeBps() view returns (uint256)',
  'function reserveMic() view returns (uint256)',
  'function reserveUsdt() view returns (uint256)',
  'function remainingDailyOut() view returns (uint256)',
  'function swapUsdtToMic(uint256 usdtIn, uint256 minMicOut) returns (uint256)',
  'function swapMicToUsdt(uint256 micIn, uint256 minUsdtOut) returns (uint256)',
  'function BUY_FEE_BPS() view returns (uint256)',
  'function MAX_TRADE_BPS() view returns (uint256)',
  'function SELL_OPEN_DAY() view returns (uint256)',
]

const ZERO = '0x0000000000000000000000000000000000000000'

type Dir = 'buy' | 'sell'

type PoolState = {
  seeded: boolean
  phase: number
  ageDays: number
  spot: number
  sellFeeBps: number
  buyFeeBps: number
  maxTradeMic: number
  remainingOutUsdt: number
  sellOpenDay: number
}

const fmt = (n: number, dp = 4) =>
  n.toLocaleString('en-US', { minimumFractionDigits: dp > 2 ? 2 : dp, maximumFractionDigits: dp })

export default function SwapPanel({ onDone }: { onDone?: () => void }) {
  const { address } = useAccount()

  const [dir, setDir] = useState<Dir>('buy')
  const [amount, setAmount] = useState('')
  const [slippage, setSlippage] = useState(1)          // percent
  /** Free-text box, so a trader is not limited to the three presets. Empty = use a preset. */
  const [slipInput, setSlipInput] = useState('')
  const [pool, setPool] = useState<PoolState | null>(null)
  /** True only when every RPC endpoint failed — never merely because the pool is unseeded. */
  const [readFailed, setReadFailed] = useState(false)
  const [bal, setBal] = useState<{ usdt: number; mic: number; micFree: number } | null>(null)
  const [quote, setQuote] = useState<number | null>(null)
  const [busy, setBusy] = useState('')
  /** `hash` turns the message into a link to the explorer. Absent on plain errors. */
  const [msg, setMsg] = useState<{ ok: boolean; text: string; hash?: string } | null>(null)

  const poolAddr = CONTRACTS.liquidityPoolV6
  const live = !!poolAddr && poolAddr !== ZERO

  /*
   * Read through every endpoint in turn, not just the first.
   *
   * ACTIVE_CHAIN.rpcUrls carries four hosts and its own comment calls the later ones
   * "fallbacks" — but this panel only ever used rpcUrls[0], publicnode, which answers
   * eth_blockNumber promptly and then times out on real eth_calls. One bad response
   * rejected the Promise.all below and the panel reported "Could not read the pool" while
   * every one of those ten calls succeeds against the very next host in the list.
   */
  const readWithFallback = useCallback(async <T,>(fn: (p: ethers.JsonRpcProvider) => Promise<T>): Promise<T> => {
    let lastErr: unknown
    for (const url of ACTIVE_CHAIN.rpcUrls) {
      try {
        return await fn(new ethers.JsonRpcProvider(url))
      } catch (e) {
        lastErr = e
      }
    }
    throw lastErr
  }, [])

  /*
   * Whether to show the pool's remaining daily outflow.
   *
   * The figure is already read from the chain for the sell-side checks; this only decides
   * whether members see it. It defaults to hidden, so a failed config fetch errs towards
   * showing less rather than surfacing a number the Owner has not chosen to publish.
   */
  const [showDailyCap, setShowDailyCap] = useState(false)

  useEffect(() => {
    fetch(`${API_BASE}/rounds/system-info`)
      .then((r) => r.json())
      .then((j) => setShowDailyCap(Boolean(j?.data?.swapShowDailyCap)))
      .catch(() => { /* stays hidden */ })
  }, [])

  /* ── pool state and balances ─────────────────────────────────────────── */
  const load = useCallback(async () => {
    if (!live) return
    try {
      const [seeded, phase, ageDays, spot, sellFee, buyFee, maxBps, reserveMic, remOut, openDay] =
        await readWithFallback((p) => {
          const c = new ethers.Contract(poolAddr, POOL_ABI, p)
          return Promise.all([
            c.isSeeded(), c.phase(), c.poolAgeDays(), c.spotPrice(),
            c.sellFeeBps().catch(() => 30n), c.BUY_FEE_BPS(), c.MAX_TRADE_BPS(),
            c.reserveMic(), c.remainingDailyOut().catch(() => 0n), c.SELL_OPEN_DAY(),
          ])
        })

      setReadFailed(false)
      setPool({
        seeded: Boolean(seeded),
        phase: Number(phase),
        ageDays: Number(ageDays),
        spot: Number(ethers.formatUnits(spot, 18)),
        sellFeeBps: Number(sellFee),
        buyFeeBps: Number(buyFee),
        maxTradeMic: (Number(ethers.formatUnits(reserveMic, 18)) * Number(maxBps)) / 10_000,
        remainingOutUsdt: Number(ethers.formatUnits(remOut, 18)),
        sellOpenDay: Number(openDay),
      })

      if (address) {
        // Balances are their own read. Folding them into the block above meant a hiccup
        // fetching one wallet balance wiped out the pool state that had already arrived.
        const [u, m, l] = await readWithFallback((p) => Promise.all([
          new ethers.Contract(CONTRACTS.usdt, USDT_ABI, p).balanceOf(address),
          new ethers.Contract(CONTRACTS.mic, USDT_ABI, p).balanceOf(address),
          new ethers.Contract(CONTRACTS.lockManager,
            ['function lockedOf(address) view returns (uint256)'], p)
            .lockedOf(address).catch(() => 0n),
        ])).catch(() => [null, null, null] as const)

        if (u !== null && m !== null) {
          const mic = Number(ethers.formatUnits(m, 18))
          const locked = Number(ethers.formatUnits(l ?? 0n, 18))
          setBal({
            usdt: Number(ethers.formatUnits(u, 18)),
            mic,
            // Vesting locks are enforced by MICToken on transfer, so selling MIC you
            // cannot move fails at the transfer rather than at the quote.
            micFree: Math.max(0, mic - locked),
          })
        }
      }
    } catch {
      // Every endpoint refused. Distinguished from "the pool says it is not seeded",
      // because those need opposite things from the reader: one is wait, the other is
      // retry. Reporting them with the same sentence is what put "Try again in a moment"
      // in front of a pool that simply has not been funded yet.
      setReadFailed(true)
      setPool(null)
    }
  }, [live, poolAddr, address, readWithFallback])

  useEffect(() => { load() }, [load])

  /* ── quote, refreshed as the amount changes ──────────────────────────── */
  useEffect(() => {
    let cancelled = false
    const n = parseFloat(amount)
    if (!live || !pool?.seeded || !n || n <= 0) { setQuote(null); return }
    ;(async () => {
      try {
        const wei = ethers.parseUnits(String(n), 18)
        const out: bigint = await readWithFallback((p) => {
          const c = new ethers.Contract(poolAddr, POOL_ABI, p)
          return dir === 'buy' ? c.quoteBuy(wei) : c.quoteSell(wei)
        })
        if (!cancelled) setQuote(Number(ethers.formatUnits(out, 18)))
      } catch {
        if (!cancelled) setQuote(null)
      }
    })()
    return () => { cancelled = true }
  }, [amount, dir, live, pool?.seeded, poolAddr, readWithFallback])

  /* ── the trade ───────────────────────────────────────────────────────── */
  const doSwap = async () => {
    const n = parseFloat(amount)
    if (!n || n <= 0 || quote === null) return
    setBusy('swap'); setMsg(null)
    try {
      const eth = (window as any).ethereum
      if (!eth) throw new Error('No wallet found')
      const chainId = await eth.request({ method: 'eth_chainId' })
      if (chainId !== '0x38') throw new Error('Switch to BSC Mainnet')

      const signer = await new ethers.BrowserProvider(eth).getSigner()
      const tokenIn = dir === 'buy' ? CONTRACTS.usdt : CONTRACTS.mic
      const amountIn = ethers.parseUnits(String(n), 18)

      // Approve only the shortfall in allowance, and only when there is one.
      const token = new ethers.Contract(tokenIn, USDT_ABI, signer)
      const me = await signer.getAddress()
      const allowance: bigint = await token.allowance(me, poolAddr)
      if (allowance < amountIn) {
        setBusy('approve')
        const a = await token.approve(poolAddr, amountIn)
        await a.wait()
        setBusy('swap')
      }

      // minOut is the trader's only defence against the price moving between quoting
      // and mining. Never send zero.
      const minOut = ethers.parseUnits(
        (quote * (1 - slippage / 100)).toFixed(18).slice(0, 30), 18,
      )

      const c = new ethers.Contract(poolAddr, POOL_ABI, signer)
      const tx = dir === 'buy'
        ? await c.swapUsdtToMic(amountIn, minOut)
        : await c.swapMicToUsdt(amountIn, minOut)
      await tx.wait()

      // Carry the whole hash, not a 12-character stub. A truncated hash cannot be pasted
      // into an explorer or quoted in support, so it proved the trade happened and then
      // gave the trader no way to look at it.
      setMsg({ ok: true, text: 'Swapped', hash: tx.hash })
      setAmount('')
      await load()
      onDone?.()
    } catch (e: any) {
      setMsg({ ok: false, text: e?.reason || e?.shortMessage || e?.message || 'Swap failed' })
    }
    setBusy('')
  }

  /* ── what the pool will and will not allow right now ─────────────────── */
  const sellsOpen = !!pool && pool.phase > 0

  /**
   * When selling opens, said as precisely as the chain allows.
   *
   * Before the pool is seeded there is no start date to count from — claiming one would
   * be inventing it. Once it is running, the remaining days are arithmetic.
   */
  const sellNotice = !pool?.seeded
    ? 'MIC → USDT opens 30 days after the liquidity pool is funded. The pool has not been funded yet, so that countdown has not started.'
    : (() => {
        const left = Math.max(0, pool.sellOpenDay - pool.ageDays)
        const when = new Date(Date.now() + left * 86400_000)
          .toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
        return `MIC → USDT opens ${pool.sellOpenDay} days after the pool went live — ${left} day${left === 1 ? '' : 's'} to go, around ${when}. Buying is open now.`
      })()
  const n = parseFloat(amount) || 0
  const haveIn = dir === 'buy' ? (bal?.usdt ?? 0) : (bal?.micFree ?? 0)
  const overBalance = n > haveIn
  const overMaxTrade = dir === 'sell' && !!pool && n > pool.maxTradeMic

  let blocked: string | null = null
  if (!live) blocked = 'The liquidity pool is not deployed on this network.'
  else if (readFailed) blocked = 'Could not reach the network right now. This is a connection problem, not a change to your funds — try again in a moment.'
  else if (!pool) blocked = 'Reading the liquidity pool…'
  else if (!pool.seeded) blocked = 'SWAP opens when the liquidity pool is funded with MIC. Nothing can be traded until then.'
  else if (dir === 'sell' && !sellsOpen) blocked = sellNotice

  const canSwap = !blocked && n > 0 && quote !== null && !overBalance && !overMaxTrade && !busy

  const inSym = dir === 'buy' ? 'USDT' : 'MIC'
  const outSym = dir === 'buy' ? 'MIC' : 'USDT'
  const feeBps = dir === 'buy' ? (pool?.buyFeeBps ?? 30) : (pool?.sellFeeBps ?? 30)

  return (
    <div className="swap-panel">
      {/* No inner heading — the page already says Swap, and repeating it pushed the
          price, which is the one thing worth reading first, down the card. */}
      <div className="swap-head">
        {/* A price is shown from the first visit. Before the pool opens there is no market
            to quote, so the published opening price stands in — and is labelled as such,
            because a placeholder presented as a live price is the kind of number people
            make decisions on. */}
        <span className="swap-price">
          1 MIC ≈ ${fmt(pool?.seeded ? pool.spot : 0.01, 4)}
          {!pool?.seeded && <span className="swap-price-tag"> opening price</span>}
        </span>
      </div>

      <div className="swap-dir">
        <button
          className={'swap-dir-btn' + (dir === 'buy' ? ' active' : '') + (pool?.seeded ? '' : ' dim')}
          onClick={() => { setDir('buy'); setAmount(''); setMsg(null) }}
          title={pool?.seeded ? 'Buy MIC with USDT' : 'Opens when the pool is funded with MIC'}
        >USDT → MIC</button>

        {/* Selling is genuinely shut for the first 30 days, so the button is dimmed
            rather than hidden — a control that vanishes reads as a missing feature,
            one that explains itself reads as a schedule. */}
        <button
          className={'swap-dir-btn' + (dir === 'sell' ? ' active' : '') + (sellsOpen ? '' : ' dim')}
          onClick={() => {
            if (!sellsOpen) { setMsg({ ok: false, text: sellNotice }); return }
            setDir('sell'); setAmount(''); setMsg(null)
          }}
          title={sellsOpen ? 'Sell MIC for USDT' : sellNotice}
        >MIC → USDT</button>
      </div>

      {blocked && <div className="swap-blocked">{blocked}</div>}

      <div className="swap-field">
        <div className="swap-field-top">
          <span>You pay</span>
          {bal && (
            <button
              className="swap-max"
              onClick={() => setAmount(String(dir === 'buy' ? bal.usdt : bal.micFree))}
            >
              Balance {fmt(haveIn, 2)} {inSym} · MAX
            </button>
          )}
        </div>
        <div className="swap-input-row">
          {/* `type="number"` hands iOS a keypad whose decimal key follows the phone's
              locale — a comma on a Vietnamese device, which this field then rejected, so
              no fractional amount could be typed at all. A text field with
              inputMode="decimal" gives the same keypad and lets us accept either mark. */}
          <input
            type="text"
            inputMode="decimal"
            value={amount}
            onChange={(e) => {
              const v = e.target.value.replace(/,/g, '.')
              if (v === '' || /^\d*\.?\d*$/.test(v)) setAmount(v)
            }}
            placeholder="0.00"
            disabled={!!blocked}
          />
          <span className="swap-sym">{inSym}</span>
        </div>
        {overBalance && (
          <div className="swap-warn">
            More than your balance{dir === 'sell' && bal && bal.mic > bal.micFree
              ? ' — some of your MIC is still vesting and cannot be moved'
              : ''}.
          </div>
        )}
        {overMaxTrade && pool && (
          <div className="swap-warn">
            One trade may not exceed {fmt(pool.maxTradeMic, 0)} MIC — the pool caps each
            trade at 1% of its reserve so a single order cannot move the price sharply.
          </div>
        )}
      </div>

      <div className="swap-field">
        <div className="swap-field-top"><span>You receive (estimated)</span></div>
        <div className="swap-input-row swap-out">
          <span className="swap-out-val">{quote === null ? '—' : fmt(quote, 4)}</span>
          <span className="swap-sym">{outSym}</span>
        </div>
      </div>

      {quote !== null && pool && (
        <div className="swap-meta">
          <div><span>Fee</span><strong>{(feeBps / 100).toFixed(2)}%</strong></div>
          <div>
            <span>Slippage tolerance</span>
            <span className="swap-slip">
              {[0.5, 1, 3].map(v => (
                <button key={v}
                  className={'swap-slip-btn' + (slippage === v && slipInput === '' ? ' active' : '')}
                  onClick={() => { setSlippage(v); setSlipInput('') }}>{v}%</button>
              ))}
              {/*
                A typed value, capped at 15%.
                The cap is not decoration: slippage tolerance is the trader's ONLY
                protection against the price moving between quote and mine — it becomes
                `minOut` on the transaction. Setting it high does not make a trade more
                likely to succeed, it makes a bad fill more likely to be accepted, and at
                100% it would accept receiving nothing at all.
              */}
              <input
                className="swap-slip-input"
                value={slipInput}
                onChange={(e) => {
                  const raw = e.target.value.replace(',', '.')
                  if (raw !== '' && !/^\d*\.?\d*$/.test(raw)) return
                  setSlipInput(raw)
                  const n = parseFloat(raw)
                  if (!isNaN(n) && n > 0) setSlippage(Math.min(n, MAX_SLIPPAGE_PCT))
                }}
                onBlur={() => {
                  const n = parseFloat(slipInput)
                  if (isNaN(n) || n <= 0) { setSlipInput(''); return }
                  const capped = Math.min(n, MAX_SLIPPAGE_PCT)
                  setSlipInput(String(capped))
                  setSlippage(capped)
                }}
                placeholder="custom"
                inputMode="decimal"
                aria-label={`Custom slippage, up to ${MAX_SLIPPAGE_PCT}%`}
              />
              <span className="swap-slip-unit">%</span>
            </span>
          </div>
          {parseFloat(slipInput) > MAX_SLIPPAGE_PCT && (
            <div style={{ color: '#ffb400', fontSize: '0.72rem' }}>
              Capped at {MAX_SLIPPAGE_PCT}% — a higher tolerance only accepts a worse fill.
            </div>
          )}
          <div>
            <span>Minimum received</span>
            <strong>{fmt(quote * (1 - slippage / 100), 4)} {outSym}</strong>
          </div>
        </div>
      )}

      {msg && (
        <div className={'swap-msg ' + (msg.ok ? 'ok' : 'err')}>
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
                {/* Break anywhere: a 66-character hash has no spaces, so without this it
                    pushes the panel wider than the phone it is being read on. */}
                <span className="swap-msg-hash">{msg.hash}</span>
                {' ↗'}
              </a>
            </>
          )}
        </div>
      )}

      <button className="swap-go" disabled={!canSwap} onClick={doSwap}>
        {busy === 'approve' ? 'Approving…'
          : busy === 'swap' ? 'Swapping…'
          : blocked ? 'Swap unavailable'
          : n <= 0 ? 'Enter an amount'
          : overBalance ? 'Not enough balance'
          : `Swap ${inSym} → ${outSym}`}
      </button>

      {showDailyCap && pool && (
        <p className="swap-note" style={{ marginBottom: 6 }}>
          The pool will release up to{' '}
          <strong>${fmt(pool.remainingOutUsdt, 2)} USDT</strong> in the next 24 hours. Selling
          draws on this shared allowance; buying does not. It refills as the window rolls forward
          and as the pool takes in more USDT.
        </p>
      )}
      <p className="swap-note">
        Price comes from the pool's own reserves and moves as you trade. The quote is an
        estimate; your transaction reverts rather than settling below the minimum above.
      </p>
    </div>
  )
}
