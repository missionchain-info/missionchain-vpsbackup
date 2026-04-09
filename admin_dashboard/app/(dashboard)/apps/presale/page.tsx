'use client';

import SectionHead from '@/components/ui/SectionHead';
import StatCard from '@/components/ui/StatCard';
import DataTable from '@/components/ui/DataTable';
import Badge from '@/components/ui/Badge';

const participants = [
  { wallet: '0x3B1c...7D4E', package: 'Diamond', usdt: '$5,000', mic: '1.1M', bonus: '10%', referrer: '0x8F3a...4c2D', status: 'Active', date: 'Mar 30, 2026' },
  { wallet: '0x6E2d...9A1B', package: 'Elite', usdt: '$1,000', mic: '220K', bonus: '10%', referrer: '—', status: 'Active', date: 'Mar 29, 2026' },
  { wallet: '0x1F4e...5C8D', package: 'Pro', usdt: '$500', mic: '110K', bonus: '10%', referrer: '0x2A4b...8E1F', status: 'Pending', date: 'Mar 28, 2026' },
  { wallet: '0x8A5f...2E6G', package: 'Standard', usdt: '$100', mic: '22K', bonus: '10%', referrer: '—', status: 'Active', date: 'Mar 27, 2026' },
];

const columns = [
  { key: 'wallet', label: 'Wallet', className: 'td-mono' },
  { key: 'package', label: 'Package', render: (v: string) => <Badge variant="purple">{v}</Badge> },
  { key: 'usdt', label: 'USDT', className: 'td-gold' },
  { key: 'mic', label: 'MIC Allocated', className: 'td-gold' },
  { key: 'bonus', label: 'Bonus' },
  { key: 'referrer', label: 'Referrer', className: 'td-mono' },
  { key: 'status', label: 'Status', render: (v: string) => <Badge variant={v === 'Active' ? 'active' : 'pending'}>{v}</Badge> },
  { key: 'date', label: 'Date' },
];

export default function PreSalePage() {
  return (
    <>
      <SectionHead title="Pre-Sale Management" action={<Badge variant="pending">UPCOMING</Badge>} />

      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '8px', padding: '16px', marginBottom: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '13px' }}>
          <span>Hard Cap Progress</span>
          <span className="td-gold">$0 / $1.575M</span>
        </div>
        <div style={{ height: '8px', background: 'rgba(255,255,255,0.05)', borderRadius: '4px', overflow: 'hidden' }}>
          <div style={{ width: '0%', height: '100%', background: 'linear-gradient(90deg, var(--purple), #7b4dc9)', borderRadius: '4px' }} />
        </div>
      </div>

      <div className="stat-grid">
        <StatCard label="Participants" value="0" sub="Pre-Sale not started" color="purple" />
        <StatCard label="MIC Allocated" value="0" sub="of 315M cap" color="gold" />
        <StatCard label="Referral F1" value="5%" sub="USDT commission" color="green" />
        <StatCard label="Referral F2" value="2%" sub="USDT commission" color="cyan" />
      </div>

      <div className="banner banner-info">🚀 Pre-Sale has not started yet. Price: $0.005/MIC with 10% bonus. Referral program: F1 5% / F2 2% USDT.</div>
      <DataTable columns={columns} data={participants} searchPlaceholder="Search wallet..." />
    </>
  );
}
