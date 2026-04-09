'use client';

import SectionHead from '@/components/ui/SectionHead';
import StatCard from '@/components/ui/StatCard';
import Badge from '@/components/ui/Badge';

const challenges = [
  { icon: '🎵', title: 'Global Worship', badge: 'MUSIC', badgeColor: 'purple' as const, entries: 247, prize: '$2,500', ends: 'Apr 15, 2026', status: 'ACTIVE' },
  { icon: '🎨', title: 'Bible Art', badge: 'ART', badgeColor: 'gold' as const, entries: 183, prize: '$1,500', ends: 'Apr 22, 2026', status: 'ACTIVE' },
  { icon: '💻', title: 'AI Content', badge: 'DIGITAL', badgeColor: 'teal' as const, entries: 312, prize: '$3,000', ends: 'May 5, 2026', status: 'ACTIVE' },
  { icon: '🎬', title: 'Video Story', badge: 'CLOSED', badgeColor: 'draft' as const, entries: 94, prize: '$1,000', ends: 'Mar 15, 2026', status: 'CLOSED' },
];

export default function ChallengesPage() {
  return (
    <>
      <SectionHead title="Challenge Management" action={<button className="btn btn-primary btn-sm">+ New Challenge</button>} />
      <div className="stat-grid">
        <StatCard label="Active" value="4" sub="In progress" color="green" />
        <StatCard label="Total Entries" value="836" sub="All challenges" color="gold" />
        <StatCard label="Pending Review" value="48" sub="Need judging" color="orange" />
        <StatCard label="Avg Rating" value="4.8" sub="Community score" color="purple" />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px' }}>
        {challenges.map((c, i) => (
          <div key={i} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '8px', padding: '20px', position: 'relative' }}>
            <div style={{ fontSize: '32px', marginBottom: '8px' }}>{c.icon}</div>
            <div style={{ fontWeight: 600, fontSize: '16px', marginBottom: '6px' }}>{c.title}</div>
            <Badge variant={c.badgeColor}>{c.badge}</Badge>
            <div style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '12px' }}>
              Entries: <span className="td-gold">{c.entries}</span> &nbsp;|&nbsp; Prize: <span className="td-gold">{c.prize}</span>
            </div>
            <div style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '4px' }}>
              {c.status === 'CLOSED' ? 'Ended' : 'Ends'}: {c.ends}
            </div>
            <div style={{ marginTop: '12px' }}>
              <button className={`btn btn-sm ${c.status === 'CLOSED' ? 'btn-outline' : 'btn-primary'}`}>
                {c.status === 'CLOSED' ? 'Results' : 'Manage'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
