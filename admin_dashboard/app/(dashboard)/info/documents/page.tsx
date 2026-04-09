'use client';

import { useState } from 'react';
import SectionHead from '@/components/ui/SectionHead';
import DataTable from '@/components/ui/DataTable';
import Badge from '@/components/ui/Badge';

const subTabs = ['Core Documents', 'Appendices (A–G)', 'Landing Pages'];

const coreDocs = [
  { document: 'White Paper', file: 'whitepaper.html', updated: 'Mar 28, 2026', status: 'Published', translations: '5 languages' },
  { document: 'White Paper (Website Ver.)', file: 'White_Paper.html', updated: 'Mar 25, 2026', status: 'Published', translations: '5 languages' },
  { document: 'Documents Hub', file: 'documents-index.html', updated: 'Mar 20, 2026', status: 'Published', translations: 'EN only' },
  { document: 'Glossary & Brand Terms', file: 'Glossary_Brand_Terms.html', updated: 'Mar 18, 2026', status: 'Published', translations: '5 languages' },
];

const appendices = [
  { appendix: 'A', title: 'SEED Round', file: 'appendix-a.html', updated: 'Mar 28, 2026', status: 'Published' },
  { appendix: 'B', title: 'Pre-Sale', file: 'appendix-b.html', updated: 'Mar 25, 2026', status: 'Published' },
  { appendix: 'C', title: 'MICE License', file: 'appendix-c.html', updated: 'Mar 22, 2026', status: 'Published' },
  { appendix: 'D', title: 'Financial Projections', file: 'appendix-d.html', updated: 'Mar 20, 2026', status: 'Published' },
  { appendix: 'E', title: 'Adaptive Emission Engine', file: 'appendix-e.html', updated: 'Mar 30, 2026', status: 'Published' },
  { appendix: 'F', title: 'Security & Audit', file: 'appendix-f.html', updated: 'Mar 18, 2026', status: 'Published' },
  { appendix: 'G', title: 'AI Operations & Governance', file: 'appendix-g.html', updated: 'Mar 15, 2026', status: 'Published' },
];

const landingPages = [
  { page: 'SEED Round Landing', file: 'mc_seed_round.html', updated: 'Mar 30, 2026', status: 'Published', translations: '5 languages' },
  { page: 'Announcement', file: 'mc_announcement.html', updated: 'Mar 15, 2026', status: 'Published', translations: '5 languages' },
];

const coreColumns = [
  { key: 'document', label: 'Document' },
  { key: 'file', label: 'File', className: 'td-mono' },
  { key: 'updated', label: 'Last Updated' },
  { key: 'status', label: 'Status', render: (v: string) => <Badge variant="active">{v}</Badge> },
  { key: 'translations', label: 'Translations' },
  { key: 'action', label: 'Action', render: () => <button className="btn btn-outline btn-sm">Edit</button> },
];

const appendixColumns = [
  { key: 'appendix', label: 'Appendix', render: (v: string) => <span className="td-gold">{v}</span> },
  { key: 'title', label: 'Title' },
  { key: 'file', label: 'File', className: 'td-mono' },
  { key: 'updated', label: 'Updated' },
  { key: 'status', label: 'Status', render: (v: string) => <Badge variant="active">{v}</Badge> },
  { key: 'action', label: 'Action', render: () => <button className="btn btn-outline btn-sm">Edit</button> },
];

const landingColumns = [
  { key: 'page', label: 'Page' },
  { key: 'file', label: 'File', className: 'td-mono' },
  { key: 'updated', label: 'Updated' },
  { key: 'status', label: 'Status', render: (v: string) => <Badge variant="active">{v}</Badge> },
  { key: 'translations', label: 'Translations' },
  { key: 'action', label: 'Action', render: () => <button className="btn btn-outline btn-sm">Edit</button> },
];

export default function DocumentsPage() {
  const [activeTab, setActiveTab] = useState(0);

  return (
    <>
      <SectionHead title="Document Management" action={<button className="btn btn-primary btn-sm">+ New Document</button>} />
      <div className="sub-tabs" style={{ marginBottom: '20px' }}>
        {subTabs.map((tab, i) => (
          <button key={tab} className={`sub-tab${i === activeTab ? ' active' : ''}`} onClick={() => setActiveTab(i)}>{tab}</button>
        ))}
      </div>

      {activeTab === 0 && <DataTable columns={coreColumns} data={coreDocs} />}
      {activeTab === 1 && <DataTable columns={appendixColumns} data={appendices} />}
      {activeTab === 2 && <DataTable columns={landingColumns} data={landingPages} />}
    </>
  );
}
