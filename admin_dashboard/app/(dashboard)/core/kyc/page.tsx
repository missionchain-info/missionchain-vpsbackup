'use client';
import { useState } from 'react';
import SectionHead from '@/components/ui/SectionHead';
import DataTable from '@/components/ui/DataTable';
import Badge from '@/components/ui/Badge';

const pending = [
  { name: 'John Doe', wallet: '0x8F3a...4c2D', country: 'Vietnam', submitted: 'Mar 28', docs: '3/3', status: 'Under Review' },
  { name: 'Maria Silva', wallet: '0x2A4b...8E1F', country: 'Brazil', submitted: 'Mar 27', docs: '3/3', status: 'Under Review' },
];

const columns = [
  { key: 'name', label: 'Name' },
  { key: 'wallet', label: 'Wallet', className: 'td-mono' },
  { key: 'country', label: 'Country' },
  { key: 'submitted', label: 'Submitted' },
  { key: 'docs', label: 'Documents' },
  { key: 'status', label: 'Status', render: () => <Badge variant="pending">Under Review</Badge> },
  { key: 'action', label: 'Action', render: () => (
    <div style={{ display: 'flex', gap: '6px' }}>
      <button className="btn btn-success btn-sm">Approve</button>
      <button className="btn btn-danger btn-sm">Reject</button>
    </div>
  )},
];

const TABS = ['Pending', 'Approved', 'Rejected', 'Flagged'];

export default function KYCPage() {
  const [tab, setTab] = useState(0);

  return (
    <>
      <SectionHead title="KYC Review" />
      <div className="sub-tabs">
        {TABS.map((t, i) => (
          <button key={t} className={`sub-tab${i === tab ? ' active' : ''}`} onClick={() => setTab(i)}>
            {t} {i === 0 && <span className="nav-badge" style={{ marginLeft: '6px' }}>14</span>}
          </button>
        ))}
      </div>
      {tab === 0 && <DataTable columns={columns} data={pending} searchPlaceholder="Search KYC submissions..." />}
      {tab === 1 && <div style={{ padding: '40px', textAlign: 'center', color: 'var(--muted)' }}>1,108 users approved</div>}
      {tab === 2 && <div style={{ padding: '40px', textAlign: 'center', color: 'var(--muted)' }}>42 users rejected</div>}
      {tab === 3 && <div style={{ padding: '40px', textAlign: 'center', color: 'var(--muted)' }}>3 users flagged for manual review</div>}
    </>
  );
}
