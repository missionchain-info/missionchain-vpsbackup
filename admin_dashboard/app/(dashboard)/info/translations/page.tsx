'use client';

import SectionHead from '@/components/ui/SectionHead';
import StatCard from '@/components/ui/StatCard';
import DataTable from '@/components/ui/DataTable';
import Badge from '@/components/ui/Badge';

const stats = [
  { label: 'Español (ES)', value: '5/5', sub: '100% complete', color: 'green' as const },
  { label: 'Vietnamese (VI)', value: '5/5', sub: '100% complete', color: 'green' as const },
  { label: '한국어 (KO)', value: '5/5', sub: '100% complete', color: 'green' as const },
  { label: 'Português (PT)', value: '5/5', sub: '100% complete', color: 'green' as const },
];

const langStatus = (v: string) => {
  if (v === 'OK') return <Badge variant="active">OK</Badge>;
  if (v === 'Stale') return <Badge variant="pending">Stale</Badge>;
  return <Badge variant="draft">{v}</Badge>;
};

const translations = [
  { file: 'index.html', es: 'OK', vi: 'OK', ko: 'OK', pt: 'OK', synced: 'Mar 30, 2026' },
  { file: 'White_Paper.html', es: 'OK', vi: 'OK', ko: 'OK', pt: 'OK', synced: 'Mar 28, 2026' },
  { file: 'Glossary_Brand_Terms.html', es: 'OK', vi: 'OK', ko: 'Stale', pt: 'OK', synced: 'Mar 20, 2026' },
  { file: 'mc_seed_round.html', es: 'OK', vi: 'OK', ko: 'OK', pt: 'OK', synced: 'Mar 30, 2026' },
  { file: 'mc_announcement.html', es: 'OK', vi: 'OK', ko: 'OK', pt: 'OK', synced: 'Mar 15, 2026' },
];

const columns = [
  { key: 'file', label: 'Source File', className: 'td-mono' },
  { key: 'es', label: '🇪🇸 ES', render: langStatus },
  { key: 'vi', label: '🇻🇳 VI', render: langStatus },
  { key: 'ko', label: '🇰🇷 KO', render: langStatus },
  { key: 'pt', label: '🇧🇷 PT', render: langStatus },
  { key: 'synced', label: 'Last Synced' },
  { key: 'action', label: 'Action', render: () => <button className="btn btn-outline btn-sm">Sync</button> },
];

export default function TranslationsPage() {
  return (
    <>
      <SectionHead title="Translation Management" action={
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="btn btn-primary btn-sm">Run DeepL Sync</button>
          <button className="btn btn-outline btn-sm">Run Post-Process</button>
        </div>
      } />
      <div className="stat-grid">
        {stats.map(s => <StatCard key={s.label} {...s} />)}
      </div>
      <div style={{ background: 'rgba(201,168,76,0.05)', border: '1px solid rgba(201,168,76,0.15)', borderRadius: '8px', padding: '16px', margin: '20px 0', textAlign: 'center' }}>
        <div style={{ color: 'var(--muted)', fontSize: '12px', marginBottom: '8px' }}>TRANSLATION PIPELINE</div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', fontSize: '13px' }}>
          <span style={{ color: 'var(--gold)' }}>Edit EN source</span>
          <span style={{ color: 'var(--muted)' }}>→</span>
          <span className="td-mono" style={{ fontSize: '11px' }}>deepl_translate_site.py</span>
          <span style={{ color: 'var(--muted)' }}>→</span>
          <span className="td-mono" style={{ fontSize: '11px' }}>postprocess_public.py</span>
          <span style={{ color: 'var(--muted)' }}>→</span>
          <span style={{ color: 'var(--green)' }}>Review & Publish</span>
        </div>
      </div>
      <DataTable columns={columns} data={translations} />
    </>
  );
}
