'use client';

import SectionHead from '@/components/ui/SectionHead';
import DataTable from '@/components/ui/DataTable';
import Badge from '@/components/ui/Badge';

const contracts = [
  { contract: 'MICToken.sol', address: '0x1234...5678', network: 'BSC Testnet', status: 'Deployed', verified: 'BSCScan ✓' },
  { contract: 'SeedSale.sol', address: '0x2345...6789', network: 'BSC Testnet', status: 'Deployed', verified: 'BSCScan ✓' },
  { contract: 'PreSale.sol', address: '0x3456...7890', network: 'BSC Testnet', status: 'Staging', verified: 'Pending' },
  { contract: 'VestingManager.sol', address: '0x4567...8901', network: 'BSC Testnet', status: 'Deployed', verified: 'BSCScan ✓' },
  { contract: 'MICELicense.sol', address: '0x5678...9012', network: 'BSC Testnet', status: 'Deployed', verified: 'BSCScan ✓' },
  { contract: 'MFPNft.sol', address: '0x6789...0123', network: 'BSC Testnet', status: 'Deployed', verified: 'BSCScan ✓' },
  { contract: 'ReferralRegistry.sol', address: '0x7890...1234', network: 'BSC Testnet', status: 'Deployed', verified: 'BSCScan ✓' },
];

const columns = [
  { key: 'contract', label: 'Contract', className: 'td-mono' },
  { key: 'address', label: 'Address', className: 'td-mono' },
  { key: 'network', label: 'Network' },
  { key: 'status', label: 'Status', render: (v: string) => <Badge variant={v === 'Deployed' ? 'active' : 'pending'}>{v}</Badge> },
  { key: 'verified', label: 'Verified', render: (v: string) => (
    <span style={{ color: v.includes('✓') ? 'var(--green)' : 'var(--muted)' }}>{v}</span>
  )},
  { key: 'action', label: 'Action', render: () => <button className="btn btn-outline btn-sm">View on BSCScan</button> },
];

export default function ContractsPage() {
  return (
    <>
      <SectionHead title="Smart Contract Management" />
      <div className="banner banner-warn">⚠ All contracts are deployed on BSC Testnet (Chain ID: 97). Mainnet deployment pending security audit completion.</div>
      <DataTable columns={columns} data={contracts} />

      <div style={{ marginTop: '20px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '8px', padding: '16px' }}>
          <div style={{ fontWeight: 600, marginBottom: '12px' }}>Security</div>
          <div style={{ fontSize: '13px', color: 'var(--muted)', lineHeight: 1.6 }}>
            <div>🔐 Admin: Gnosis Safe 3-of-5 multisig</div>
            <div>🛑 Emergency pause: All contracts pausable</div>
            <div>📋 Audit: Pending (Certik / Hacken)</div>
            <div>🔄 Upgradeable: Proxy pattern (UUPS)</div>
          </div>
        </div>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '8px', padding: '16px' }}>
          <div style={{ fontWeight: 600, marginBottom: '12px' }}>Circuit Breakers</div>
          <div style={{ fontSize: '13px', color: 'var(--muted)', lineHeight: 1.6 }}>
            <div>📊 Cumulative cap: ≤ 5,950,000,000 MIC</div>
            <div>📅 Daily cap: 2× E_base(t)</div>
            <div>💰 Price floor: $0.001 MIC</div>
            <div>🔓 Unstake limit: 10%/day</div>
          </div>
        </div>
      </div>
    </>
  );
}
