'use client';

import SectionHead from '@/components/ui/SectionHead';
import DataTable from '@/components/ui/DataTable';

const logs = [
  { timestamp: '2026-03-31 14:32:01', admin: 'Thani (SA)', action: 'APPROVED', target: '0x8F3a...4c2D', module: 'Apps', details: 'SEED ELITE purchase approved' },
  { timestamp: '2026-03-31 14:28:44', admin: 'Admin2 (KYC)', action: 'VERIFIED', target: '0x2A4b...8E1F', module: 'Shared', details: 'KYC document verified' },
  { timestamp: '2026-03-31 14:15:12', admin: 'Admin3 (MOD)', action: 'FLAGGED', target: 'content_47', module: 'Info', details: 'Content flagged for review' },
  { timestamp: '2026-03-31 13:44:33', admin: 'Admin4 (CA)', action: 'PUBLISHED', target: 'sophia_12', module: 'World', details: 'SOPHIA reflection published' },
];

const columns = [
  { key: 'timestamp', label: 'Timestamp', className: 'td-mono' },
  { key: 'admin', label: 'Admin' },
  { key: 'action', label: 'Action', render: (v: string) => <span className="td-gold">{v}</span> },
  { key: 'target', label: 'Target', className: 'td-mono' },
  { key: 'module', label: 'Module' },
  { key: 'details', label: 'Details' },
];

export default function AuditPage() {
  return (
    <>
      <SectionHead title="Activity Log & Audit Trail" action={<button className="btn btn-outline btn-sm">Export CSV</button>} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', marginBottom: '16px' }}>
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label className="form-label">Date Range</label>
          <input type="date" className="form-input" />
        </div>
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label className="form-label">Admin</label>
          <select className="form-input"><option>All Admins</option></select>
        </div>
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label className="form-label">Module</label>
          <select className="form-input"><option>All Modules</option><option>Shared</option><option>Info</option><option>World</option><option>Apps</option></select>
        </div>
      </div>
      <DataTable columns={columns} data={logs} />
    </>
  );
}
