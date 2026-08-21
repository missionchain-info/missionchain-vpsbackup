'use client'

/**
 * "Start earning" — enrolling an NFT into its reward pool.
 *
 * Holding the NFT is not enough. NftRewardPoolV2 pays by `weightOf[holder]`, and that stays
 * zero until `enroll(tokenId)` is called: the pool cannot observe a mint or a transfer on
 * its own. So a wallet can sit on NFTs while the pool streams MIC to someone else, see zero
 * everywhere, and reasonably conclude the site is broken. That is what this panel exists to
 * prevent — it names the gap and gives the one transaction that closes it.
 */

import { useState, useEffect, useCallback } from 'react'

interface PoolInfo {
  pool: string | null
  nft: string | null
  wired: boolean
  reason: string | null
  owned: number
  enrolled: number
  enrollable: number[]
  needsResync: number[]
}

export default function EnrollPanel({
  wallet,
  kind,
  onDone,
}: {
  wallet?: string
  kind: 'community' | 'mfp'
  onDone?: () => void
}) {
  const [info, setInfo] = useState<PoolInfo | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const label = kind === 'mfp' ? 'MFP-NFT' : 'Community NFT'
  const base = process.env.NEXT_PUBLIC_API_URL || 'https://api.missionchain.io'

  const load = useCallback(async () => {
    if (!wallet) return
    try {
      const r = await fetch(`${base}/nft/enrollable?wallet=${wallet}`)
      if (!r.ok) return
      const d = (await r.json()).data
      setInfo(d?.[kind] ?? null)
    } catch { /* leave the panel hidden rather than guess */ }
  }, [wallet, kind, base])

  useEffect(() => { load() }, [load])

  const send = async (fn: 'enrollBatch' | 'resync', ids: number[]) => {
    if (!info?.pool) return
    setBusy(true); setMsg(null)
    try {
      const eth = (window as any).ethereum
      if (!eth) throw new Error('No wallet found')
      if ((await eth.request({ method: 'eth_chainId' })) !== '0x38') throw new Error('Switch to BSC Mainnet')

      const { BrowserProvider, Contract } = await import('ethers')
      const signer = await new BrowserProvider(eth).getSigner()
      const c = new Contract(info.pool, [
        'function enrollBatch(uint256[] tokenIds)',
        'function resyncBatch(uint256[] tokenIds)',
      ], signer)

      const tx = fn === 'enrollBatch' ? await c.enrollBatch(ids) : await c.resyncBatch(ids)
      await tx.wait()

      setMsg({
        ok: true,
        text: fn === 'enrollBatch'
          ? `${ids.length} ${label}${ids.length > 1 ? 's' : ''} now earning — ${tx.hash.slice(0, 12)}…`
          : `Weight moved to this wallet — ${tx.hash.slice(0, 12)}…`,
      })
      await load()
      onDone?.()
    } catch (e: any) {
      setMsg({ ok: false, text: e?.shortMessage || e?.message || 'Transaction failed' })
    } finally {
      setBusy(false)
    }
  }

  if (!wallet || !info) return null
  // Nothing owned, nothing to say.
  if (info.owned === 0 && info.wired) return null

  const nothingPending = info.enrollable.length === 0 && info.needsResync.length === 0

  return (
    <div className="mine-licenses-card" style={{ marginBottom: 20, padding: '16px 18px' }}>
      <div className="mine-section-header" style={{ marginBottom: 10 }}>
        <span className="mine-section-icon">{'⚡'}</span>
        <span className="mine-section-title">Start earning — {label}</span>
      </div>

      {!info.wired ? (
        <p style={{ fontSize: '0.72rem', color: 'var(--gray2)', lineHeight: 1.6 }}>
          {label}s are not enrolled by their holder. A Mission Founding Pass never expires,
          so its pool is a flat-weight pool: the operator registers each holder&rsquo;s pass
          count directly, and there is nothing for you to sign. MIC accrues to the pool in
          the meantime and is not lost.
        </p>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginBottom: 12 }}>
            <Stat k="You hold" v={String(info.owned)} />
            <Stat k="Earning" v={String(info.enrolled)} tone={info.enrolled > 0 ? 'good' : undefined} />
            <Stat k="Not yet earning" v={String(info.enrollable.length)} tone={info.enrollable.length > 0 ? 'warn' : undefined} />
          </div>

          {nothingPending ? (
            <p style={{ fontSize: '0.72rem', color: 'var(--gray2)' }}>
              Every {label} in this wallet is enrolled and earning.
            </p>
          ) : (
            <p style={{ fontSize: '0.72rem', color: 'var(--gray2)', lineHeight: 1.6, marginBottom: 12 }}>
              Holding an NFT does not by itself earn MIC — the pool has to be told which
              tokens are yours. This is a one-time transaction per token.
            </p>
          )}

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {info.enrollable.length > 0 && (
              <button
                onClick={() => send('enrollBatch', info.enrollable)}
                disabled={busy}
                style={btn(busy)}
              >
                {busy ? 'Confirming…' : `Enroll ${info.enrollable.length} ${label}${info.enrollable.length > 1 ? 's' : ''}`}
              </button>
            )}
            {info.needsResync.length > 0 && (
              <button
                onClick={() => send('resync', info.needsResync)}
                disabled={busy}
                style={btn(busy)}
                title="These tokens are enrolled to a previous owner and still credit them until this is called."
              >
                {busy ? 'Confirming…' : `Claim weight for ${info.needsResync.length} transferred`}
              </button>
            )}
          </div>
        </>
      )}

      {msg && (
        <div style={{
          marginTop: 12, padding: '10px 12px', borderRadius: 8, fontSize: '0.7rem',
          background: msg.ok ? 'rgba(76,175,80,.12)' : 'rgba(244,54,78,.12)',
          color: msg.ok ? '#66BB6A' : '#EF5064',
        }}>{msg.text}</div>
      )}
    </div>
  )
}

function Stat({ k, v, tone }: { k: string; v: string; tone?: 'good' | 'warn' }) {
  return (
    <div>
      <div style={{ fontSize: '0.62rem', color: 'var(--gray2)', letterSpacing: '.04em' }}>{k.toUpperCase()}</div>
      <div style={{
        fontSize: '1.2rem', fontWeight: 700,
        color: tone === 'good' ? '#66BB6A' : tone === 'warn' ? 'var(--gold)' : undefined,
      }}>{v}</div>
    </div>
  )
}

const btn = (busy: boolean): React.CSSProperties => ({
  padding: '9px 16px', borderRadius: 9, border: '1px solid var(--border)',
  background: busy ? 'rgba(255,255,255,.06)' : 'var(--bg3)',
  color: busy ? 'var(--gray2)' : 'var(--white)',
  fontSize: '0.72rem', fontWeight: 700, cursor: busy ? 'default' : 'pointer',
})
