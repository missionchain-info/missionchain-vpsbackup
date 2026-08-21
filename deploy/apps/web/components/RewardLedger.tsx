/**
 * "My NFT Rewards" — what this wallet has earned, taken out, and can still take out,
 * in both currencies, for one NFT type.
 *
 * The two currencies behave differently and the block says so rather than hiding it:
 *
 *   MIC  — Community and MFP are separate contracts, so Claim here affects only this
 *          NFT type.
 *   US$  — one balance per wallet on chain, credited by two separate operator calls.
 *          The per-type figures are exact, but `claim()` withdraws the whole balance,
 *          so the button carries the full amount and says so. Showing a per-type Claim
 *          would promise a partial withdrawal the contract cannot perform.
 */
'use client'

// `accumulated` and `claimed` are history and come from event logs, which no reachable RPC
// currently serves; `unclaimed` is current state and is always available. Null means
// unknown — rendered as an em dash, never as a zero, because zero is a claim of its own.
type Ledger = {
  accumulated: string | null
  claimed: string | null
  unclaimed: string | null
}

const money = (v?: string | null) =>
  Number(v ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const mic = (v?: string | null) =>
  Number(v ?? 0).toLocaleString('en-US', { maximumFractionDigits: 4 })

function Row({
  currency, ledger, format, prefix, suffix, footnote,
}: {
  currency: string
  ledger?: Ledger
  format: (v?: string | null) => string
  prefix?: string
  suffix?: string
  footnote?: string
}) {
  const wrap = (v?: string | null) =>
    v === null || v === undefined ? '\u2014' : `${prefix ?? ''}${format(v)}${suffix ?? ''}`
  const unclaimed = Number(ledger?.unclaimed ?? 0)
  return (
    <div className="nft-ledger-row">
      <div className="nft-ledger-cur">{currency}</div>
      <div className="nft-ledger-cells">
        <div>
          <span>Total accumulated</span>
          <strong>{wrap(ledger?.accumulated)}</strong>
        </div>
        <div>
          <span>Claimed</span>
          <strong>{wrap(ledger?.claimed)}</strong>
        </div>
        <div>
          <span>Unclaimed</span>
          <strong className={unclaimed > 0 ? 'net-stat-gold' : undefined}>{wrap(ledger?.unclaimed)}</strong>
        </div>
      </div>
      {ledger && ledger.accumulated === null && ledger.unclaimed !== null && (
        <div className="nft-ledger-foot">
          Unclaimed is read live from the pool and is exact. Total and claimed need the
          withdrawal history, which is unavailable right now, so they are shown as unknown
          rather than as zero.
        </div>
      )}
      {footnote ? <div className="nft-ledger-foot">{footnote}</div> : null}
    </div>
  )
}

export default function RewardLedger({
  title, usd, micLedger, usdReliable, usdMerged, micPool, usdPools, busy, onClaim,
}: {
  title: string
  usd?: Ledger
  micLedger?: Ledger
  /** False when the per-type US$ split failed its consistency check against the contract. */
  usdReliable?: boolean
  /** The wallet's whole US$ balance — what `claim()` actually pays out. */
  usdMerged: number
  micPool?: string | null
  usdPools: Array<{ address: string | null; label: string; amount: number }>
  busy: string
  onClaim: (address: string, label: string) => void
}) {
  const micUnclaimed = Number(micLedger?.unclaimed ?? 0)

  return (
    <div className="nft-section-card">
      <div className="nft-section-header">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
        <span className="nft-section-title">{title}</span>
      </div>

      <Row
        currency="US$"
        ledger={usd}
        format={money}
        prefix="$"
        footnote={
          usdReliable === false
            ? 'The split between NFT types could not be verified against the contract for this wallet, so these figures are hidden. Your total balance below is correct.'
            : undefined
        }
      />

      <Row currency="MIC" ledger={micLedger} format={mic} suffix=" MIC" />

      <div className="nft-ledger-actions">
        {usdPools
          .filter((p) => p.address)
          .map((p) => (
            <button
              key={p.address!}
              className="nft-claim-btn"
              disabled={p.amount <= 0 || busy === p.address}
              onClick={() => onClaim(p.address!, p.label)}
              style={{
                flex: '1 1 160px', padding: '9px 12px', borderRadius: 8, border: 'none',
                fontSize: '0.72rem', fontWeight: 700,
                cursor: p.amount > 0 ? 'pointer' : 'not-allowed',
                background: p.amount > 0 ? 'var(--gold, #F0BE4A)' : 'rgba(255,255,255,.07)',
                color: p.amount > 0 ? '#091530' : 'var(--gray2, #888F9D)',
              }}
            >
              {busy === p.address ? 'Claiming…' : p.amount > 0 ? `${p.label} $${money(String(p.amount))}` : `${p.label} — nothing to claim`}
            </button>
          ))}

        <button
          className="nft-claim-btn"
          disabled={!micPool || micUnclaimed <= 0 || busy === micPool}
          onClick={() => micPool && onClaim(micPool, 'MIC rewards')}
          style={{
            flex: '1 1 160px', padding: '9px 12px', borderRadius: 8, border: 'none',
            fontSize: '0.72rem', fontWeight: 700,
            cursor: micUnclaimed > 0 ? 'pointer' : 'not-allowed',
            background: micUnclaimed > 0 ? 'var(--gold, #F0BE4A)' : 'rgba(255,255,255,.07)',
            color: micUnclaimed > 0 ? '#091530' : 'var(--gray2, #888F9D)',
          }}
        >
          {busy === micPool ? 'Claiming…' : micUnclaimed > 0 ? `Claim ${mic(micLedger?.unclaimed)} MIC` : 'Claim MIC — nothing to claim'}
        </button>
      </div>

      {/* The US$ pools hold one balance per wallet, so a claim there pays out both NFT
          types at once. Better to say it than to let the numbers imply otherwise. */}
      {usdMerged > 0 ? (
        <div className="nft-pool-note" style={{ marginTop: 10 }}>
          A US$ claim withdraws your full balance in that pool — ${money(String(usdMerged))} across both
          MFP and Community NFTs — because the pool keeps one balance per wallet. The MIC claim
          above affects only this NFT type.
        </div>
      ) : null}
    </div>
  )
}
