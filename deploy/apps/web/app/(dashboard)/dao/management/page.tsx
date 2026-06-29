'use client'

export default function DaoManagementPage() {
  return (
    <div style={{ maxWidth: 920, margin: '0 auto', padding: '40px 20px' }}>
      <div className="page-eyebrow">DAO Governance</div>
      <h1 style={{ margin: '6px 0 4px', fontSize: '1.6rem', color: 'var(--white)' }}>
        DAO Management
      </h1>
      <p style={{ color: 'var(--muted)', fontSize: '0.74rem', marginBottom: 24 }}>
        On-chain DAO governance with proposal lifecycle, MFP-NFT weighted voting, and treasury control.
      </p>

      <div
        style={{
          padding: 40,
          textAlign: 'center',
          background: 'var(--card)',
          border: '1px dashed var(--border)',
          borderRadius: 12,
          opacity: 0.6,
        }}
      >
        <div style={{ fontSize: '2.4rem', marginBottom: 12 }}>🏛</div>
        <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--gold)', marginBottom: 8 }}>
          Coming Soon
        </div>
        <div style={{ fontSize: '0.72rem', color: 'var(--muted)', maxWidth: 480, margin: '0 auto', lineHeight: 1.6 }}>
          DAO Management opens after Steward Council Phase 1 stabilizes and on-chain DAO Governor
          contract is fully aligned with the target governance model (Ban Thường Trực 3/5 + MFP
          eligibility rule).
        </div>
        <div style={{ marginTop: 16, fontSize: '0.6rem', color: 'var(--gray2)' }}>
          Phase 1: 1-vote-per-Steward-Council-member · Phase 2: MFP-NFT weighted voting
        </div>
      </div>
    </div>
  )
}
