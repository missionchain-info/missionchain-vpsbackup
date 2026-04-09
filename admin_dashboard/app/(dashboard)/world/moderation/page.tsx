'use client';

import SectionHead from '@/components/ui/SectionHead';
import Badge from '@/components/ui/Badge';

const queue = [
  { type: 'COMMENT', user: 'alice.eth', confidence: '78%', flag: 'Possible spam', content: 'Check out this amazing opportunity! Click link in bio for guaranteed 100x returns on your investment...' },
  { type: 'CONTENT', user: 'bob.sol', confidence: '65%', flag: 'Potential policy violation', content: 'Art submission with imagery that may not align with community guidelines. Contains references to non-Christian spiritual practices.' },
  { type: 'COMMENT', user: 'carol.bnb', confidence: '82%', flag: 'Harassment', content: 'This project is a complete scam and anyone who buys in is a fool. The devs should be ashamed...' },
  { type: 'CONTENT', user: 'dave.eth', confidence: '55%', flag: 'Low-quality content', content: 'Random text post with no meaningful content related to faith or community. Appears to be a test post.' },
  { type: 'COMMENT', user: 'eve.sol', confidence: '71%', flag: 'Self-promotion', content: 'Hey everyone! Join my new Telegram group for exclusive MIC token tips and signals. Link: t.me/...' },
  { type: 'CONTENT', user: 'frank.bnb', confidence: '88%', flag: 'Copyright concern', content: 'Shared what appears to be copyrighted worship music without attribution or permission from the original artist.' },
  { type: 'COMMENT', user: 'grace.eth', confidence: '60%', flag: 'Off-topic', content: 'Has anyone tried the new restaurant downtown? Their pasta is amazing!' },
];

const badgeVariant = (type: string) => type === 'COMMENT' ? 'teal' : 'purple';

export default function ModerationPage() {
  return (
    <>
      <SectionHead title="Moderation Queue" />
      <div className="banner banner-warn">🚨 {queue.length} items need review</div>

      {queue.map((item, i) => (
        <div key={i} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '8px', padding: '16px', marginBottom: '12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
            <div>
              <Badge variant={badgeVariant(item.type) as any}>{item.type}</Badge>
              <span style={{ color: 'var(--gold)', fontWeight: 600, marginLeft: '8px' }}>{item.user}</span>
              <div style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '4px' }}>
                AI Confidence: <span className="td-gold">{item.confidence}</span> &nbsp;|&nbsp; Flag: {item.flag}
              </div>
            </div>
            <div style={{ display: 'flex', gap: '6px' }}>
              <button className="btn btn-primary btn-sm">Allow</button>
              <button className="btn btn-danger btn-sm">Remove</button>
              <button className="btn btn-outline btn-sm">Ban</button>
            </div>
          </div>
          <div style={{ background: 'rgba(255,100,100,0.05)', borderLeft: '3px solid rgba(255,100,100,0.4)', padding: '10px 14px', fontSize: '13px', color: 'var(--muted)', borderRadius: '0 4px 4px 0' }}>
            {item.content}
          </div>
        </div>
      ))}
    </>
  );
}
