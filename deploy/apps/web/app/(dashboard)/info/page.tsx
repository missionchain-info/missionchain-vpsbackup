'use client'

import SubNav, { EXPLORE_TABS } from '@/components/layout/SubNav'

const DOCS = [
  {
    category: 'Tokenomics',
    items: [
      { label: 'White Paper', desc: 'Tokenomics, 3 pillars, governance overview', icon: 'doc', file: 'White_Paper.html' },
      { label: 'SEED Round (A)', desc: 'SEED structure, packages, vesting', icon: 'chart', file: 'appendix-a.html' },
      { label: 'Pre-Sale (B)', desc: 'Pre-Sale pricing, referral, NFT bonus', icon: 'chart', file: 'appendix-b.html' },
      { label: 'MICE License (C)', desc: '5-round pricing, burn mechanism', icon: 'chart', file: 'appendix-c.html' },
      { label: 'Economics (D)', desc: 'Emission engine, staking, projections', icon: 'chart', file: 'appendix-d.html' },
      { label: 'NFT System (E)', desc: 'MFP-NFT, Community tiers, rewards', icon: 'nft', file: 'appendix-e.html' },
      { label: 'Liquidity (F)', desc: 'Liquidity pool, price stabilization', icon: 'drop', file: 'appendix-f.html' },
    ],
  },
  {
    category: 'Governance',
    items: [
      { label: 'DAO (G)', desc: 'DAOGovernor, timelocks, voting', icon: 'gov', file: 'appendix-g.html' },
      { label: 'Security (H)', desc: 'Access control, circuit breakers, KYC', icon: 'shield', file: 'appendix-h.html' },
      { label: 'Legal (J)', desc: 'Jurisdictions, risk factors, IP', icon: 'legal', file: 'appendix-j.html' },
    ],
  },
  {
    category: 'Technical',
    items: [
      { label: 'AI Ops (I)', desc: 'SOPHIA AI, data privacy, governance', icon: 'ai', file: 'appendix-i.html' },
      { label: 'Mission World (K)', desc: 'Community platform, challenges', icon: 'globe', file: 'appendix-k.html' },
    ],
  },
]

const CONTRACTS = [
  { name: 'MIC Token', addr: '0xf27ec0c311728b923b22828002c992c799326182', desc: 'BEP-20 token, total supply 1.05B (LockManager schedules)' },
  { name: 'LockManager', addr: '0x6bE58BCe62f526E7751e121CDBa1eb22873471A0', desc: 'Vesting schedule tracker (cliff + monthly)' },
  { name: 'MFP-NFT', addr: '0xAE6F32A6fdf80F5e54ba85441386dBA6a381f565', desc: 'ERC-721, Founders + SEED bundle, 2,500 cap' },
  { name: 'Community NFT', addr: '0x2828C97397be51FCCa5D8D99a0c5126F11A15149', desc: 'ERC-1155 Builder/Maker/Luminary tiers' },
  { name: 'SEED Sale (V7)', addr: '0xe4C1B4fBE009245eBB6B3a4F76DcAAE445F60905', desc: 'SEED Round purchase, 221.1M MIC, active 2026-06-23 (V6 paused)' },
  { name: 'SeedBudget V5c', addr: '0x33ec0A97029adde1A7e0f78E3B8f414Ec56527ef', desc: 'Centralized SEED revenue vault (4 slots: Distribution 20% / Operational 20% / Management Bonus 10% / Reserved 50%), active 2026-06-23' },
  { name: 'StewardCouncil', addr: '0x87723621D50fcc6f6db25d73031E44Bee4081B19', desc: 'Phase 1 governance ≥75% threshold' },
  { name: 'DAOGovernor', addr: '0xDCD65DC97b0A147BeCf542E22a5C218C006231cC', desc: 'Phase 2 DAO (dormant until phase transition)' },
  { name: 'TreasuryManager', addr: '0x1ed5C848D1244a618Bd95Ff92d4f8C2356d3a42F', desc: 'Treasury hold + distribute (105M MIC)' },
  { name: 'FoundersVault', addr: '0x142167334Ad8da6790353dC54c42651F9F416b67', desc: '280M MIC + 1,250 MFP cap allocation' },
  { name: 'LiquidityPool V5', addr: '0x37091454eB49179D3aFF12402980F63cFC3e050a', desc: '31.5M MIC closed-loop liquidity' },
  { name: 'ListingReserveVault', addr: '0x2EE1b6B7108851BB721cA1c9B8aCEf76e70C8f16', desc: '73.5M MIC listing reserve (7d cooldown)' },
  { name: 'AirdropDistributor', addr: '0x9Bdd75b6aDf5BA674F74C49601AF7D82d3672EF9', desc: '17.5M MIC airdrop pool' },
  { name: 'P2P Escrow MFP', addr: '0xcff25169c783B84eFBa746eF4A51271764f24b8B', desc: 'MFP-NFT secondary market (1.5% platform fee, 5% royalty)' },
  { name: 'OperationalSalaryPool V3', addr: '0xB2f318b07B7501f6A03b53066610032418F66b85', desc: 'Steward Council salary claims (V3 active 2026-06-23)' },
  { name: 'ManagementBonusPool V3', addr: '0x2bfA50146C01d6c4BFA4A2550385988C2619f033', desc: 'DAO-approved bonus payments ≥75% vote (V3 active 2026-06-23)' },
  { name: 'ReservedExpensesPool V3', addr: '0xe04519547F051AE4388FcdE571EA2301dD9e3495', desc: 'Reserved expenses with voting + Phase B (V3 active 2026-06-23)' },
]

const COMMUNITY = [
  { name: 'Website', url: 'https://missionchain.io', icon: 'globe' },
  { name: 'Telegram', url: 'https://t.me/missionchain', icon: 'tg' },
  { name: 'Discord', url: '#', icon: 'discord' },
  { name: 'Twitter / X', url: '#', icon: 'x' },
]

function DocIcon({ type }: { type: string }) {
  switch (type) {
    case 'doc':
      return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
    case 'chart':
      return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/></svg>
    case 'nft':
      return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/></svg>
    case 'drop':
      return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/></svg>
    case 'gov':
      return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 21h18"/><path d="M5 21V7l8-4v18"/><path d="M19 21V11l-6-4"/></svg>
    case 'shield':
      return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
    case 'legal':
      return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="3" x2="12" y2="15"/><path d="M5 12l7-9 7 9"/><line x1="3" y1="21" x2="21" y2="21"/></svg>
    case 'ai':
      return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="4" width="16" height="16" rx="2"/><circle cx="9" cy="10" r="1.5"/><circle cx="15" cy="10" r="1.5"/><path d="M8 16s1.5 2 4 2 4-2 4-2"/></svg>
    case 'globe':
      return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
    default:
      return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
  }
}

function CommunityIcon({ type }: { type: string }) {
  switch (type) {
    case 'globe':
      return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
    case 'tg':
      return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.2 4.4L2.4 10.8c-.6.2-.6 1.1 0 1.3l4.5 1.7 1.7 5.5c.1.5.8.6 1.1.2l2.5-2.8 4.8 3.5c.5.3 1.1 0 1.2-.5L21.8 5.2c.1-.5-.3-.9-.6-.8z"/></svg>
    case 'discord':
      return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 12a1 1 0 1 0 0 2 1 1 0 0 0 0-2zm6 0a1 1 0 1 0 0 2 1 1 0 0 0 0-2z"/><path d="M7.5 7.5c2-1 4.5-1.5 4.5-1.5s2.5.5 4.5 1.5"/><path d="M7 16.5c2 1 5 1.5 5 1.5s3-.5 5-1.5"/><path d="M15.5 17c0 1 1.5 3 2 3 1 0 2.4-2 3-4 .5-2 .5-4 0-6-.5-1.5-1.5-2.5-3-4A15 15 0 0 0 12 4a15 15 0 0 0-5.5 2C5 7.5 4 8.5 3.5 10c-.5 2-.5 4 0 6 .6 2 2 4 3 4 .5 0 2-2 2-3"/></svg>
    case 'x':
      return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4l6.5 8L4 20h2l5.5-6.5L16 20h4l-7-8.5L20 4h-2l-5 6-4.5-6H4z"/></svg>
    default:
      return null
  }
}

function copyAddress(addr: string) {
  navigator.clipboard.writeText(addr)
}

export default function InfoPage() {
  return (
    <>
    <SubNav items={EXPLORE_TABS} />
    <div className="info-page">
      {/* ── Documentation Grid ── */}
      {DOCS.map((cat) => (
        <div key={cat.category} className="info-section-card">
          <div className="info-section-header">
            <span className="info-section-title">{cat.category}</span>
          </div>
          <div className="info-doc-grid">
            {cat.items.map((doc) => (
              <a
                key={doc.label}
                href={`/documents/${doc.file}`}
                target="_blank"
                rel="noopener noreferrer"
                className="info-doc-card"
              >
                <div className="info-doc-icon"><DocIcon type={doc.icon} /></div>
                <div className="info-doc-info">
                  <div className="info-doc-label">{doc.label}</div>
                  <div className="info-doc-desc">{doc.desc}</div>
                </div>
                <div className="info-doc-arrow">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="7" y1="17" x2="17" y2="7"/><polyline points="7 7 17 7 17 17"/></svg>
                </div>
              </a>
            ))}
          </div>
        </div>
      ))}

      {/* ── Smart Contracts ── */}
      <div className="info-section-card">
        <div className="info-section-header">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>
          <span className="info-section-title">Smart Contracts (BSC)</span>
        </div>
        <div className="info-contract-list">
          {CONTRACTS.map((c) => (
            <div key={c.name} className="info-contract-row">
              <div className="info-contract-left">
                <div className="info-contract-name">{c.name}</div>
                <div className="info-contract-desc">{c.desc}</div>
              </div>
              <div className="info-contract-right">
                <span className="info-contract-addr">{c.addr}</span>
                <button className="info-contract-copy" onClick={() => copyAddress(c.addr)} title="Copy address">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                </button>
                <a href={`https://bscscan.com/address/${c.addr}`} target="_blank" rel="noopener noreferrer" className="info-contract-link" title="View on BSCScan">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="7" y1="17" x2="17" y2="7"/><polyline points="7 7 17 7 17 17"/></svg>
                </a>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Community Links ── */}
      <div className="info-section-card">
        <div className="info-section-header">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
          <span className="info-section-title">Community</span>
        </div>
        <div className="info-community-row">
          {COMMUNITY.map((link) => (
            <a key={link.name} href={link.url} target="_blank" rel="noopener noreferrer" className="info-community-card">
              <div className="info-community-icon"><CommunityIcon type={link.icon} /></div>
              <span className="info-community-name">{link.name}</span>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="7" y1="17" x2="17" y2="7"/><polyline points="7 7 17 7 17 17"/></svg>
            </a>
          ))}
        </div>
      </div>
    </div>
    </>
  )
}
