'use client';

const SZ = '0.62rem';

const DOCS = [
  {
    category: 'White Paper & Appendices',
    items: [
      { title: 'White Paper', desc: 'Tokenomics, 3 pillars, governance overview', url: 'https://missionchain.io/documents/whitepaper.html', icon: '📄' },
      { title: 'Appendix A — SEED Round', desc: 'SEED structure, packages, vesting', url: 'https://missionchain.io/documents/appendix-a.html', icon: '🌱' },
      { title: 'Appendix B — Pre-Sale', desc: 'Pre-Sale structure, referral, NFT bonus', url: 'https://missionchain.io/documents/appendix-b.html', icon: '💰' },
      { title: 'Appendix C — MICE License', desc: '5-round pricing, burn mechanics', url: 'https://missionchain.io/documents/appendix-c.html', icon: '🪪' },
      { title: 'Appendix D — Economic Spec', desc: 'Emission engine, staking, projections', url: 'https://missionchain.io/documents/appendix-d.html', icon: '📊' },
      { title: 'Appendix E — NFT System', desc: 'MFP-NFT, Community NFTs, reward pools', url: 'https://missionchain.io/documents/appendix-e.html', icon: '🎨' },
      { title: 'Appendix F — Liquidity Pool', desc: 'Price stabilization, buffer mechanics', url: 'https://missionchain.io/documents/appendix-f.html', icon: '💧' },
      { title: 'Appendix G — DAO Management', desc: 'Governor, timelock, emergency powers', url: 'https://missionchain.io/documents/appendix-g.html', icon: '🏛' },
      { title: 'Appendix H — Security & Audit', desc: 'Access control, circuit breakers, KYC/AML', url: 'https://missionchain.io/documents/appendix-h.html', icon: '🔒' },
      { title: 'Appendix I — AI Operations', desc: 'NIRA AI assistant, data privacy', url: 'https://missionchain.io/documents/appendix-i.html', icon: '🤖' },
      { title: 'Appendix J — Legal', desc: 'Jurisdictions, risk factors, disclaimers', url: 'https://missionchain.io/documents/appendix-j.html', icon: '⚖️' },
      { title: 'Appendix K — Mission World', desc: 'Community platform, SOPHIA, challenges', url: 'https://missionchain.io/documents/appendix-k.html', icon: '🌍' },
    ],
  },
  {
    category: 'Public Pages',
    items: [
      { title: 'Landing Page', desc: 'missionchain.info — public website', url: 'https://missionchain.io', icon: '🏠' },
      { title: 'SEED Round Page', desc: 'SEED sale landing page', url: 'https://missionchain.io/seed', icon: '🌱' },
      { title: 'Announcement', desc: 'Smart Contract Migration notice', url: 'https://missionchain.io/info', icon: '📢' },
      { title: 'Documents Hub', desc: 'Index of all public documents', url: 'https://missionchain.io/documents/documents-index.html', icon: '📚' },
      { title: 'Glossary & Brand Terms', desc: 'Official terminology and formulas', url: 'https://missionchain.io/Glossary_Brand_Terms.html', icon: '📖' },
    ],
  },
  {
    category: 'Platform Links',
    items: [
      { title: 'Membership DApp', desc: 'missionchain.io — user-facing DApp', url: 'https://missionchain.io', icon: '🔗' },
      { title: 'Mission World', desc: 'missionchain.world — community platform', url: 'https://missionchain.world', icon: '🌐' },
      { title: 'Admin Console', desc: 'admin.missionchain.io — this panel', url: 'https://admin.missionchain.io', icon: '🔐' },
      { title: 'API Documentation', desc: 'api.missionchain.io — backend API', url: 'https://api.missionchain.io/health', icon: '⚡' },
    ],
  },
  {
    category: 'Blockchain',
    items: [
      { title: 'BSCScan', desc: 'BNB Smart Chain explorer', url: 'https://bscscan.com', icon: '⛓️' },
      { title: 'BSC Testnet', desc: 'Testnet explorer', url: 'https://testnet.bscscan.com', icon: '🧪' },
      { title: 'PancakeSwap', desc: 'DEX — future MIC/USDT pair', url: 'https://pancakeswap.finance', icon: '🥞' },
    ],
  },
];

export default function ResourcesPage() {
  return (
    <>
      <div className="page-hd">
        <div>
          <div className="page-eyebrow">Resources</div>
          <div className="page-title">Documents &amp; Links</div>
          <div className="page-sub">Reference documentation, public pages, and platform links</div>
        </div>
      </div>

      {DOCS.map((cat) => (
        <div key={cat.category}>
          <div className="sep-lbl">{cat.category}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12, marginBottom: 8 }}>
            {cat.items.map((doc) => (
              <a
                key={doc.title}
                href={doc.url}
                target="_blank"
                rel="noopener noreferrer"
                className="card"
                style={{
                  padding: '14px 18px', display: 'flex', gap: 12, alignItems: 'flex-start',
                  textDecoration: 'none', cursor: 'pointer',
                }}
              >
                <span style={{ fontSize: '1.4rem', flexShrink: 0 }}>{doc.icon}</span>
                <div>
                  <div style={{
                    fontFamily: 'var(--font-d)', fontSize: SZ, fontWeight: 700,
                    color: 'var(--white)', marginBottom: 2,
                  }}>
                    {doc.title}
                    <span style={{ marginLeft: 6, fontSize: SZ, color: 'var(--gray2)' }}>{'\u2197'}</span>
                  </div>
                  <div style={{ fontSize: SZ, color: 'var(--gray)', lineHeight: 1.4 }}>{doc.desc}</div>
                </div>
              </a>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}
