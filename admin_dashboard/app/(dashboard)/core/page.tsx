'use client';

import StatCard from '@/components/ui/StatCard';
import DataTable from '@/components/ui/DataTable';
import SectionHead from '@/components/ui/SectionHead';
import HealthCard from '@/components/ui/HealthCard';

const recentActivity = [
  { time: '14:32:01', admin: 'SA (Thani)', action: 'APPROVED', target: '0x8F3a...4c2D', module: 'Apps', details: 'SEED ELITE purchase — $5,000 USDT' },
  { time: '14:28:44', admin: 'KYC (Admin2)', action: 'VERIFIED', target: '0x2A4b...8E1F', module: 'Shared', details: 'KYC approved — Brazil' },
  { time: '14:15:12', admin: 'MOD (Admin3)', action: 'FLAGGED', target: 'content_47', module: 'Info', details: 'Document update flagged for review' },
  { time: '13:58:07', admin: 'CA (Admin4)', action: 'PUBLISHED', target: 'devotional_12', module: 'World', details: 'SOPHIA reflection published' },
];

const activityColumns = [
  { key: 'time', label: 'Timestamp', className: 'td-mono' },
  { key: 'admin', label: 'Admin' },
  { key: 'action', label: 'Action', render: (v: string) => <span className="td-gold">{v}</span> },
  { key: 'target', label: 'Target', className: 'td-mono' },
  { key: 'module', label: 'Module' },
  { key: 'details', label: 'Details' },
];

export default function CoreDashboard() {
  return (
    <>
      <div className="stat-grid">
        <StatCard label="Total Users" value="3,094" sub="Cross-platform" color="gold" />
        <StatCard label="KYC Verified" value="1,247" sub="40.3% rate" color="green" />
        <StatCard label="Active Today" value="412" sub="All platforms" color="purple" />
        <StatCard label="Admin Actions" value="84" sub="Last 24h" color="cyan" />
        <StatCard label="Pending KYC" value="14" sub="Needs review" color="red" />
        <StatCard label="Flagged" value="3" sub="Manual review" color="orange" />
      </div>

      <SectionHead title="Recent Admin Activity" />
      <DataTable columns={activityColumns} data={recentActivity} />

      <div style={{ marginTop: '24px' }}>
        <SectionHead title="Platform Health" />
        <div className="health-grid">
          <HealthCard title="API Gateway" status="green" label="Operational" meta={['Avg latency: 42ms', 'Uptime: 99.98%']} />
          <HealthCard title="BSC Node" status="green" label="Synced" meta={['Block #48,231,044', '2 seconds behind']} />
          <HealthCard title="Database" status="green" label="Connected" meta={['PostgreSQL 16', 'Pool: 18/50 active']} />
        </div>
      </div>
    </>
  );
}
