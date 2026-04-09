'use client';

import SectionHead from '@/components/ui/SectionHead';
import StatCard from '@/components/ui/StatCard';
import DataTable from '@/components/ui/DataTable';
import Badge from '@/components/ui/Badge';

const reports = [
  { name: 'Daily Revenue Summary', type: 'Financial', frequency: 'Daily', lastRun: 'Apr 5, 2026', status: 'Generated' },
  { name: 'SEED Round Progress', type: 'Sales', frequency: 'Weekly', lastRun: 'Apr 1, 2026', status: 'Generated' },
  { name: 'Mining Emission Report', type: 'Protocol', frequency: 'Daily', lastRun: 'Apr 5, 2026', status: 'Generated' },
  { name: 'KYC Compliance', type: 'Compliance', frequency: 'Weekly', lastRun: 'Apr 1, 2026', status: 'Generated' },
  { name: 'Referral Commission Payout', type: 'Financial', frequency: 'Monthly', lastRun: 'Apr 1, 2026', status: 'Generated' },
  { name: 'Token Velocity Analysis', type: 'Analytics', frequency: 'Weekly', lastRun: 'Mar 31, 2026', status: 'Scheduled' },
  { name: 'Treasury Balance Sheet', type: 'Financial', frequency: 'Monthly', lastRun: 'Apr 1, 2026', status: 'Generated' },
];

const columns = [
  { key: 'name', label: 'Report Name' },
  { key: 'type', label: 'Type', render: (v: string) => {
    const map: Record<string, 'gold' | 'purple' | 'teal' | 'active'> = { Financial: 'gold', Sales: 'purple', Protocol: 'teal', Compliance: 'active', Analytics: 'active' };
    return <Badge variant={map[v] || 'active'}>{v}</Badge>;
  }},
  { key: 'frequency', label: 'Frequency' },
  { key: 'lastRun', label: 'Last Run' },
  { key: 'status', label: 'Status', render: (v: string) => <Badge variant={v === 'Generated' ? 'active' : 'pending'}>{v}</Badge> },
  { key: 'action', label: 'Action', render: () => (
    <div style={{ display: 'flex', gap: '4px' }}>
      <button className="btn btn-outline btn-sm">Download</button>
      <button className="btn btn-outline btn-sm">Re-run</button>
    </div>
  )},
];

export default function ReportsPage() {
  return (
    <>
      <SectionHead title="Reports & Analytics" action={<button className="btn btn-primary btn-sm">+ Custom Report</button>} />
      <div className="stat-grid">
        <StatCard label="Total Revenue" value="$8.88M" sub="All sources" color="gold" />
        <StatCard label="MIC Circulating" value="518M" sub="of 7B total" color="green" />
        <StatCard label="Active Users" value="23,267" sub="Across all apps" color="purple" />
        <StatCard label="Reports Generated" value="142" sub="This month" color="cyan" />
      </div>
      <DataTable columns={columns} data={reports} />
    </>
  );
}
