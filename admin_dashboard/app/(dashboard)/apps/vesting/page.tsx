'use client';

import SectionHead from '@/components/ui/SectionHead';
import StatCard from '@/components/ui/StatCard';
import DataTable from '@/components/ui/DataTable';
import Badge from '@/components/ui/Badge';

const schedules = [
  { wallet: '0x8F3a...4c2D', type: 'SEED', totalMIC: '230,000', unlocked: '15%', next: 'Jun 1, 2026', status: 'Vesting' },
  { wallet: '0x2A4b...8E1F', type: 'Pre-Sale', totalMIC: '110,000', unlocked: '25%', next: 'May 15, 2026', status: 'Vesting' },
  { wallet: 'Founders', type: 'Team', totalMIC: '280,000,000', unlocked: '0%', next: 'Mar 1, 2028', status: 'Locked' },
  { wallet: 'Treasury DAO', type: 'Treasury', totalMIC: '105,000,000', unlocked: '10%', next: 'Apr 1, 2026', status: 'Vesting' },
  { wallet: '0x7D2c...5B3E', type: 'SEED', totalMIC: '460,000', unlocked: '15%', next: 'Jun 1, 2026', status: 'Vesting' },
  { wallet: '0x9C1d...3A7F', type: 'Pre-Sale', totalMIC: '220,000', unlocked: '10%', next: 'May 15, 2026', status: 'Vesting' },
];

const columns = [
  { key: 'wallet', label: 'Wallet', className: 'td-mono' },
  { key: 'type', label: 'Type', render: (v: string) => <Badge variant={v === 'SEED' ? 'gold' : v === 'Pre-Sale' ? 'purple' : v === 'Team' ? 'teal' : 'active'}>{v}</Badge> },
  { key: 'totalMIC', label: 'Total MIC', className: 'td-gold' },
  { key: 'unlocked', label: 'Unlocked %', render: (v: string) => {
    const pct = parseInt(v);
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <div style={{ width: '60px', height: '6px', background: 'rgba(255,255,255,0.05)', borderRadius: '3px', overflow: 'hidden' }}>
          <div style={{ width: v, height: '100%', background: 'var(--gold)', borderRadius: '3px' }} />
        </div>
        <span className="td-gold">{v}</span>
      </div>
    );
  }},
  { key: 'next', label: 'Next Unlock' },
  { key: 'status', label: 'Status', render: (v: string) => <Badge variant={v === 'Vesting' ? 'active' : v === 'Locked' ? 'pending' : 'draft'}>{v}</Badge> },
];

export default function VestingPage() {
  return (
    <>
      <SectionHead title="Vesting Schedule" />
      <div className="stat-grid">
        <StatCard label="Total Locked" value="2.4B" sub="MIC in vesting" color="gold" />
        <StatCard label="Released" value="312M" sub="MIC unlocked" color="green" />
        <StatCard label="Active Schedules" value="847" sub="Participants" color="purple" />
        <StatCard label="Claimable Now" value="284K" sub="MIC ready to claim" color="cyan" />
      </div>

      <div className="banner banner-info">📅 Vesting: 10% unlock after cliff period, then 2.5%/month. SEED/Pre-Sale cliff: 6 months. Founders: 24 months. Treasury DAO: 24 months at 0.25%/month.</div>
      <DataTable columns={columns} data={schedules} searchPlaceholder="Search wallet..." />
    </>
  );
}
