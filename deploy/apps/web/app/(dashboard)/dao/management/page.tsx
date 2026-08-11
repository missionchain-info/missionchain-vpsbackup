'use client'

/**
 * DAO Management — placeholder until the proposal UI is built.
 *
 * Everything on this page describes what `DAOGovernor` 0xDCD6…31cC actually enforces,
 * read from the deployed contract. The earlier version promised MFP-NFT weighted voting
 * and an MFP eligibility rule; neither exists in the contract and neither is planned —
 * the Owner settled governance on one vote per member, by head, on 2026-08-07. A page
 * that describes governance the code does not implement is how the White Paper ended up
 * quoting quorums nobody could reach.
 */

const RULES: Array<{ label: string; value: string; note: string }> = [
  {
    label: 'Who votes',
    value: 'Steward Council',
    note: 'Five seats. One vote each, by head — no token weight, no stake weight, no NFT weight.',
  },
  {
    label: 'To pass',
    value: '3 of 5',
    note: 'The same threshold for every proposal. Whoever raises it has already voted, so two more signatures carry it.',
  },
  {
    label: 'Waiting period',
    value: '24h · 24h · 7d · none',
    note: 'Parameter and Budget wait 24 hours, Structural waits 7 days, Emergency executes at once. The clock starts when the proposal is created, not when it reaches three votes.',
  },
  {
    label: 'Management spending',
    value: '3 of 5',
    note: 'Bonus and reserved-expense orders follow the same threshold as everything else.',
  },
]

export default function DaoManagementPage() {
  return (
    <div style={{ maxWidth: 920, margin: '0 auto', padding: '40px 20px' }}>
      <div className="page-eyebrow">DAO Governance</div>
      <h1 style={{ margin: '6px 0 4px', fontSize: '1.6rem', color: 'var(--white)' }}>
        DAO Management
      </h1>
      <p style={{ color: 'var(--muted)', fontSize: '0.74rem', marginBottom: 24 }}>
        Raise a proposal, gather Council approvals, execute after the waiting period.
      </p>

      <div
        style={{
          padding: 40,
          textAlign: 'center',
          background: 'var(--card)',
          border: '1px dashed var(--border)',
          borderRadius: 12,
        }}
      >
        <div style={{ fontSize: '2.4rem', marginBottom: 12 }}>🏛</div>
        <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--gold)', marginBottom: 8 }}>
          Coming Soon
        </div>
        <div style={{ fontSize: '0.72rem', color: 'var(--muted)', maxWidth: 520, margin: '0 auto', lineHeight: 1.7 }}>
          The governance contract is live on-chain and the rules below are already in force.
          This screen opens once the five Council seats are filled and the proposal interface
          is ready. Until then proposals are raised directly against the contract.
        </div>
      </div>

      <div style={{ marginTop: 28 }}>
        <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--white)', marginBottom: 4 }}>
          How decisions are made
        </div>
        <p style={{ fontSize: '0.66rem', color: 'var(--gray2)', marginBottom: 14, lineHeight: 1.6 }}>
          These are the rules the deployed contract enforces — not a target to reach later.
        </p>

        <div style={{ display: 'grid', gap: 10 }}>
          {RULES.map((r) => (
            <div
              key={r.label}
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(120px, 1fr) minmax(90px, auto) minmax(0, 3fr)',
                gap: 14,
                alignItems: 'baseline',
                padding: '13px 16px',
                background: 'var(--card)',
                border: '1px solid var(--border)',
                borderRadius: 10,
              }}
            >
              <div style={{ fontSize: '0.68rem', color: 'var(--muted)' }}>{r.label}</div>
              <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--gold)' }}>{r.value}</div>
              <div style={{ fontSize: '0.66rem', color: 'var(--gray2)', lineHeight: 1.6 }}>{r.note}</div>
            </div>
          ))}
        </div>

        <p style={{ fontSize: '0.62rem', color: 'var(--gray2)', marginTop: 16, lineHeight: 1.7 }}>
          Holding an MFP-NFT is not required to vote and does not add weight. Council seats are
          appointed, and every seat counts once.
        </p>
      </div>
    </div>
  )
}
