'use client';

import SectionHead from '@/components/ui/SectionHead';
import DataTable from '@/components/ui/DataTable';
import Badge from '@/components/ui/Badge';

const reviewQueue = [
  { user: 'john.eth', title: 'Faith in Digital Age', scripture: 'John 3:16', confidence: '94%', preview: 'In an era of rapid technological change, the words of John 3:16 remind us that divine love transcends all boundaries — even digital ones...' },
  { user: 'maria.sol', title: 'Love in Community', scripture: '1 John 4:8', confidence: '87%', preview: 'The essence of our blockchain community mirrors the love described in 1 John 4:8 — "Whoever does not love does not know God, because God is love..."' },
  { user: 'paul.bnb', title: 'Stewardship of Resources', scripture: 'Matthew 25:14-30', confidence: '91%', preview: 'The parable of the talents speaks directly to our responsibility as token holders and community members...' },
];

const published = [
  { scripture: 'Romans 12:2', title: 'Transformation Through Faith', author: 'SOPHIA', published: 'Mar 20, 2026', views: '1,247' },
  { scripture: 'Psalms 23', title: "The Shepherd's Guide", author: 'SOPHIA', published: 'Mar 15, 2026', views: '892' },
  { scripture: 'Proverbs 3:5-6', title: 'Trust in the Lord', author: 'SOPHIA', published: 'Mar 10, 2026', views: '756' },
  { scripture: 'Philippians 4:13', title: 'Strength Through Christ', author: 'SOPHIA', published: 'Mar 5, 2026', views: '634' },
];

const publishedColumns = [
  { key: 'scripture', label: 'Scripture', className: 'td-gold' },
  { key: 'title', label: 'Title' },
  { key: 'author', label: 'Author' },
  { key: 'published', label: 'Published' },
  { key: 'views', label: 'Views', className: 'td-gold' },
];

export default function SophiaWordPage() {
  return (
    <>
      <SectionHead title="SOPHIA WORD Review Queue" />
      <div className="banner banner-warn">✨ {reviewQueue.length} reflections awaiting review</div>

      {reviewQueue.map((item, i) => (
        <div key={i} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '8px', padding: '16px', marginBottom: '12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
            <div>
              <span style={{ color: 'var(--gold)', fontWeight: 600 }}>{item.user}</span>
              <span style={{ color: 'var(--muted)', margin: '0 8px' }}>—</span>
              <span style={{ fontWeight: 500 }}>{item.title}</span>
              <div style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '4px' }}>
                📖 {item.scripture} &nbsp;|&nbsp; AI Confidence: <span className="td-gold">{item.confidence}</span>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '6px' }}>
              <button className="btn btn-primary btn-sm">Approve</button>
              <button className="btn btn-outline btn-sm">Edit</button>
              <button className="btn btn-danger btn-sm">Reject</button>
            </div>
          </div>
          <div style={{ background: 'rgba(201,168,76,0.05)', borderLeft: '3px solid var(--gold)', padding: '10px 14px', fontSize: '13px', color: 'var(--muted)', borderRadius: '0 4px 4px 0' }}>
            {item.preview}
          </div>
        </div>
      ))}

      <SectionHead title="Published Reflections" />
      <DataTable columns={publishedColumns} data={published} />
    </>
  );
}
