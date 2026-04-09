'use client';

import SectionHead from '@/components/ui/SectionHead';
import StatCard from '@/components/ui/StatCard';
import DataTable from '@/components/ui/DataTable';
import Badge from '@/components/ui/Badge';

const participants = [
  { wallet: '0x8F3a...4c2D', package: 'FOUNDING PARTNER II', usdt: '$5,000', mic: '2.0M', nfts: '150', status: 'Active', date: 'Mar 28, 2026' },
  { wallet: '0x2A4b...8E1F', package: 'FOUNDING PARTNER I', usdt: '$2,500', mic: '1.0M', nfts: '60', status: 'Active', date: 'Mar 27, 2026' },
  { wallet: '0x7D2c...5B3E', package: 'EARLY BIRD', usdt: '$1,000', mic: '400K', nfts: '20', status: 'Pending', date: 'Mar 26, 2026' },
  { wallet: '0x9C1d...3A7F', package: 'FOUNDING PARTNER III', usdt: '$10,000', mic: '4.0M', nfts: '350', status: 'Active', date: 'Mar 25, 2026' },
  { wallet: '0x5E4f...2B9A', package: 'EARLY BIRD', usdt: '$1,000', mic: '400K', nfts: '20', status: 'Active', date: 'Mar 24, 2026' },
];

const columns = [
  { key: 'wallet', label: 'Wallet', className: 'td-mono' },
  { key: 'package', label: 'Package', render: (v: string) => <Badge variant="gold">{v}</Badge> },
  { key: 'usdt', label: 'USDT', className: 'td-gold' },
  { key: 'mic', label: 'MIC Allocated', className: 'td-gold' },
  { key: 'nfts', label: 'MFP-NFTs' },
  { key: 'status', label: 'Status', render: (v: string) => <Badge variant={v === 'Active' ? 'active' : 'pending'}>{v}</Badge> },
  { key: 'date', label: 'Date' },
];

export default function SeedPage() {
  return (
    <>
      <SectionHead title="SEED Round Management" action={<Badge variant="active">ACTIVE</Badge>} />

      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '8px', padding: '16px', marginBottom: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '13px' }}>
          <span>Hard Cap Progress</span>
          <span className="td-gold">$425K / $500K</span>
        </div>
        <div style={{ height: '8px', background: 'rgba(255,255,255,0.05)', borderRadius: '4px', overflow: 'hidden' }}>
          <div style={{ width: '85%', height: '100%', background: 'linear-gradient(90deg, var(--gold), #e8c34a)', borderRadius: '4px' }} />
        </div>
      </div>

      <div className="stat-grid">
        <StatCard label="Participants" value="847" sub="Verified wallets" color="gold" />
        <StatCard label="MIC Allocated" value="82.3M" sub="of 227.5M cap" color="green" />
        <StatCard label="Avg Ticket" value="$502" sub="Per participant" color="purple" />
        <StatCard label="Whitelisted" value="1,200" sub="KYC approved" color="cyan" />
      </div>

      <DataTable columns={columns} data={participants} searchPlaceholder="Search wallet..." />
    </>
  );
}
