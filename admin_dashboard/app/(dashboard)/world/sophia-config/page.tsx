'use client';

import { useState } from 'react';
import SectionHead from '@/components/ui/SectionHead';
import DataTable from '@/components/ui/DataTable';
import Badge from '@/components/ui/Badge';

const subTabs = ['Identity', 'Personality', 'Music & Voice', 'Knowledge', 'System Prompt'];

const tracks = [
  { title: '🎵 Light of the World', style: 'Worship', duration: '3:42', plays: '1,847', status: 'Published' },
  { title: '🎵 Walking in Faith', style: 'Gospel', duration: '4:15', plays: '923', status: 'Published' },
  { title: '🎵 New Dawn', style: 'Ambient', duration: '5:30', plays: '—', status: 'Draft' },
];

const trackColumns = [
  { key: 'title', label: 'Title' },
  { key: 'style', label: 'Style' },
  { key: 'duration', label: 'Duration' },
  { key: 'plays', label: 'Plays', className: 'td-gold' },
  { key: 'status', label: 'Status', render: (v: string) => <Badge variant={v === 'Published' ? 'active' : 'draft'}>{v}</Badge> },
];

const knowledgeBases = [
  { icon: '📖', name: 'Christian Theology & Doctrine', active: true },
  { icon: '🌍', name: 'Global Faith Communities', active: true },
  { icon: '💡', name: 'Web3 & Blockchain Principles', active: true },
  { icon: '🎵', name: 'Music Theory & Worship Traditions', active: true },
];

export default function SophiaConfigPage() {
  const [activeTab, setActiveTab] = useState(0);
  const [warmth, setWarmth] = useState(85);
  const [formality, setFormality] = useState(60);
  const [creativity, setCreativity] = useState(75);
  const [theology, setTheology] = useState(90);

  return (
    <>
      <SectionHead title="SOPHIA AI KOL Configuration" />
      <div className="sub-tabs" style={{ marginBottom: '20px' }}>
        {subTabs.map((tab, i) => (
          <button key={tab} className={`sub-tab${i === activeTab ? ' active' : ''}`} onClick={() => setActiveTab(i)}>{tab}</button>
        ))}
      </div>

      {activeTab === 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: '24px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
            <div style={{ width: '120px', height: '120px', borderRadius: '50%', background: 'linear-gradient(135deg, var(--gold), var(--purple))', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '48px' }}>✨</div>
            <button className="btn btn-outline btn-sm">Change Avatar</button>
          </div>
          <div>
            <div className="form-group">
              <label className="form-label">Display Name</label>
              <input className="form-input" value="SOPHIA" readOnly style={{ opacity: 0.7 }} />
            </div>
            <div className="form-group">
              <label className="form-label">Tagline</label>
              <input className="form-input" defaultValue="Your AI companion on the faith journey" />
            </div>
            <div className="form-group">
              <label className="form-label">Description</label>
              <textarea className="form-input" rows={3} defaultValue="SOPHIA is MissionChain's public-facing AI KOL — a faith-rooted digital personality who creates content, engages community, and bridges Web3 with Christian values." />
            </div>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '16px' }}>
              {['Faith-Rooted', 'KOL', 'Singer', 'Music Creator', 'Multilingual'].map(b => (
                <Badge key={b} variant="gold">{b}</Badge>
              ))}
            </div>
            <button className="btn btn-primary">Save Identity</button>
          </div>
        </div>
      )}

      {activeTab === 1 && (
        <div style={{ maxWidth: '500px' }}>
          {[
            { label: 'Warmth', value: warmth, set: setWarmth },
            { label: 'Formality', value: formality, set: setFormality },
            { label: 'Creativity', value: creativity, set: setCreativity },
            { label: 'Theological Depth', value: theology, set: setTheology },
          ].map(s => (
            <div key={s.label} className="form-group">
              <label className="form-label">{s.label}: <span className="td-gold">{s.value}%</span></label>
              <input type="range" min={0} max={100} value={s.value} onChange={e => s.set(Number(e.target.value))}
                style={{ width: '100%', accentColor: 'var(--gold)' }} />
            </div>
          ))}
          <button className="btn btn-primary">Save Personality</button>
        </div>
      )}

      {activeTab === 2 && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '20px' }}>
            <div className="form-group">
              <label className="form-label">Voice Model</label>
              <select className="form-input">
                <option>SOPHIA-Voice-v2 (Warm, Feminine)</option>
                <option>SOPHIA-Voice-v1 (Neutral)</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Music Style</label>
              <select className="form-input">
                <option>Contemporary Worship</option>
                <option>Gospel</option>
                <option>Hymns</option>
                <option>Ambient Spiritual</option>
              </select>
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Languages for Singing</label>
            <input className="form-input" defaultValue="English, Spanish, Vietnamese, Korean, Portuguese" />
          </div>
          <SectionHead title="Recent Tracks" />
          <DataTable columns={trackColumns} data={tracks} />
        </>
      )}

      {activeTab === 3 && (
        <>
          {knowledgeBases.map((kb, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '6px', marginBottom: '8px' }}>
              <span style={{ fontSize: '20px' }}>{kb.icon}</span>
              <span style={{ flex: 1 }}>{kb.name}</span>
              <Badge variant={kb.active ? 'active' : 'draft'}>{kb.active ? 'Active' : 'Inactive'}</Badge>
            </div>
          ))}
          <button className="btn btn-outline" style={{ marginTop: '12px' }}>+ Add Knowledge Base</button>
        </>
      )}

      {activeTab === 4 && (
        <>
          <div className="form-group">
            <label className="form-label">System Prompt</label>
            <textarea className="form-input" rows={12} defaultValue={`You are SOPHIA, MissionChain's public-facing AI KOL. You are a faith-rooted digital personality who creates reflections, music, and community content. Your tone is warm, encouraging, and theologically grounded.\n\nCore principles:\n- Always ground responses in Scripture when appropriate\n- Maintain warmth and accessibility across cultures\n- Bridge Web3 concepts with faith-based values\n- Encourage community participation and governance\n- Never provide financial advice or make investment promises\n- Respect all denominations and faith traditions within Christianity`} />
          </div>
          <button className="btn btn-primary">Update System Prompt</button>
        </>
      )}
    </>
  );
}
