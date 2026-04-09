'use client';

import SectionHead from '@/components/ui/SectionHead';
import StatCard from '@/components/ui/StatCard';
import DataTable from '@/components/ui/DataTable';
import Badge from '@/components/ui/Badge';

const licenses = [
  { wallet: '0x8F3a...4c2D', licenseId: '#MICE-00142', price: '$450', purchased: 'Mar 28, 2026', expires: 'Mar 24, 2027', dailyMIC: '1,247', status: 'Active' },
  { wallet: '0x2A4b...8E1F', licenseId: '#MICE-00891', price: '$380', purchased: 'Mar 20, 2026', expires: 'Mar 16, 2027', dailyMIC: '1,102', status: 'Active' },
  { wallet: '0x7D2c...5B3E', licenseId: '#MICE-01204', price: '$520', purchased: 'Mar 15, 2026', expires: 'Mar 11, 2027', dailyMIC: '1,384', status: 'Active' },
  { wallet: '0x9C1d...3A7F', licenseId: '#MICE-00033', price: '$300', purchased: 'Jan 10, 2026', expires: 'Jan 6, 2027', dailyMIC: '892', status: 'Active' },
  { wallet: '0x5E4f...2B9A', licenseId: '#MICE-00567', price: '$1,000', purchased: 'Feb 14, 2026', expires: 'Feb 10, 2027', dailyMIC: '2,841', status: 'Expiring Soon' },
];

const columns = [
  { key: 'wallet', label: 'Wallet', className: 'td-mono' },
  { key: 'licenseId', label: 'License ID', className: 'td-mono' },
  { key: 'price', label: 'Price', className: 'td-gold' },
  { key: 'purchased', label: 'Purchased' },
  { key: 'expires', label: 'Expires' },
  { key: 'dailyMIC', label: 'Daily MIC', className: 'td-gold' },
  { key: 'status', label: 'Status', render: (v: string) => <Badge variant={v === 'Active' ? 'active' : 'pending'}>{v}</Badge> },
];

export default function MicePage() {
  return (
    <>
      <SectionHead title="MICE License Management" action={<Badge variant="active">OPEN</Badge>} />

      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '8px', padding: '16px', marginBottom: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '13px' }}>
          <span>Slots Used</span>
          <span className="td-gold">18,420 / 100,000</span>
        </div>
        <div style={{ height: '8px', background: 'rgba(255,255,255,0.05)', borderRadius: '4px', overflow: 'hidden' }}>
          <div style={{ width: '18.4%', height: '100%', background: 'linear-gradient(90deg, var(--gold), #e8c34a)', borderRadius: '4px' }} />
        </div>
      </div>

      <div className="stat-grid">
        <StatCard label="Active Licenses" value="18,420" sub="of 100K max" color="gold" />
        <StatCard label="Revenue" value="$6.8M" sub="USDT collected" color="green" />
        <StatCard label="Avg Price" value="$372" sub="Dynamic $300–$1,000" color="purple" />
        <StatCard label="Expiring (30d)" value="247" sub="Need renewal" color="orange" />
      </div>

      <div className="banner banner-info">⚡ MICE License: ERC-1155 NFT, 360-day duration. Revenue split: 50% Treasury / 30% Liquidity / 20% Buyback & Burn.</div>
      <DataTable columns={columns} data={licenses} searchPlaceholder="Search wallet or license ID..." />
    </>
  );
}
