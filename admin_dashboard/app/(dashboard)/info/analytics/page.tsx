'use client';

import SectionHead from '@/components/ui/SectionHead';
import StatCard from '@/components/ui/StatCard';
import DataTable from '@/components/ui/DataTable';

const topPages = [
  { page: '/ (Landing)', views: '8,420', avgTime: '4m 12s', bounce: '28%', conversions: '342' },
  { page: '/mc_seed_round.html', views: '3,847', avgTime: '5m 30s', bounce: '22%', conversions: '128' },
  { page: '/documents/whitepaper.html', views: '2,103', avgTime: '8m 15s', bounce: '18%', conversions: '—' },
  { page: '/White_Paper.html', views: '1,842', avgTime: '6m 45s', bounce: '25%', conversions: '—' },
];

const columns = [
  { key: 'page', label: 'Page', className: 'td-mono' },
  { key: 'views', label: 'Views', className: 'td-gold' },
  { key: 'avgTime', label: 'Avg. Time' },
  { key: 'bounce', label: 'Bounce' },
  { key: 'conversions', label: 'Conversions' },
];

export default function AnalyticsPage() {
  return (
    <>
      <SectionHead title="SEO & Analytics — missionchain.info" />
      <div className="stat-grid">
        <StatCard label="Monthly Visitors" value="12.4K" sub="+18% vs last month" color="teal" />
        <StatCard label="Avg. Session" value="3m 42s" sub="Above industry avg" color="gold" />
        <StatCard label="Bounce Rate" value="34%" sub="Good" color="green" />
        <StatCard label="Top Country" value="Vietnam" sub="32% of traffic" color="purple" />
      </div>
      <div style={{ background: 'rgba(201,168,76,0.05)', border: '1px solid rgba(201,168,76,0.15)', borderRadius: '8px', height: '200px', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '20px' }}>
        <span style={{ color: 'var(--muted)', fontSize: '13px' }}>📈 Traffic Chart — Connect Google Analytics to enable</span>
      </div>
      <SectionHead title="Top Pages" />
      <DataTable columns={columns} data={topPages} />
    </>
  );
}
