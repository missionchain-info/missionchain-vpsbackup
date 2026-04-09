'use client';

import { useState } from 'react';
import SectionHead from '@/components/ui/SectionHead';

const subTabs = ['Hero Section', 'Tokenomics', 'Pillars', 'CTA & Links', 'SEO / Meta'];

export default function LandingPage() {
  const [activeTab, setActiveTab] = useState(0);

  return (
    <>
      <SectionHead title="Landing Page — missionchain.info" />
      <div className="sub-tabs" style={{ marginBottom: '20px' }}>
        {subTabs.map((tab, i) => (
          <button key={tab} className={`sub-tab${i === activeTab ? ' active' : ''}`} onClick={() => setActiveTab(i)}>{tab}</button>
        ))}
      </div>

      {activeTab === 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
          <div>
            <div className="form-group">
              <label className="form-label">Hero Title</label>
              <input className="form-input" defaultValue="MISSION CHAIN" />
            </div>
            <div className="form-group">
              <label className="form-label">Hero Subtitle</label>
              <input className="form-input" defaultValue="Faith-Powered Web3 Ecosystem" />
            </div>
            <div className="form-group">
              <label className="form-label">Hero Description</label>
              <textarea className="form-input" rows={4} defaultValue="MissionChain connects 2.6 billion Christians worldwide through blockchain technology, creating a faith-powered ecosystem for community, governance, and digital empowerment." />
            </div>
            <div className="form-group">
              <label className="form-label">Primary CTA Text</label>
              <input className="form-input" defaultValue="JOIN SEED ROUND" />
            </div>
            <div className="form-group">
              <label className="form-label">Primary CTA Link</label>
              <input className="form-input" defaultValue="/mc_seed_round.html" />
            </div>
            <button className="btn btn-primary">Save Hero</button>
          </div>
          <div>
            <div className="form-label" style={{ marginBottom: '8px' }}>Live Preview</div>
            <div style={{ background: 'rgba(201,168,76,0.05)', border: '1px solid rgba(201,168,76,0.15)', borderRadius: '8px', padding: '32px', textAlign: 'center' }}>
              <div style={{ fontFamily: 'var(--font-heading)', fontSize: '28px', color: 'var(--gold)', marginBottom: '8px' }}>MISSION CHAIN</div>
              <div style={{ color: 'var(--muted)', fontSize: '14px', marginBottom: '12px' }}>Faith-Powered Web3 Ecosystem</div>
              <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                <button className="btn btn-primary btn-sm">Join Seed Round</button>
                <button className="btn btn-outline btn-sm">Read White Paper</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 1 && (
        <div className="banner banner-info">📊 Tokenomics section editor — manage token distribution charts, supply breakdown, and allocation visuals displayed on the landing page.</div>
      )}
      {activeTab === 2 && (
        <div className="banner banner-info">⛪ Pillars section editor — manage the 3 pillars content (Faith Community, Digital Governance, Economic Empowerment) on the landing page.</div>
      )}
      {activeTab === 3 && (
        <div className="banner banner-info">🔗 CTA & Links editor — manage call-to-action buttons, navigation links, and external URLs across the landing page.</div>
      )}
      {activeTab === 4 && (
        <>
          <div className="form-group">
            <label className="form-label">Page Title (SEO)</label>
            <input className="form-input" defaultValue="MissionChain — Faith-Powered Web3 Ecosystem on BSC" />
          </div>
          <div className="form-group">
            <label className="form-label">Meta Description</label>
            <textarea className="form-input" rows={3} defaultValue="Join 2.6B Christians in building a decentralized faith community. MIC token, MICE mining, SOPHIA AI KOL, and MFP-NFT governance on Binance Smart Chain." />
          </div>
          <div className="form-group">
            <label className="form-label">OG Image URL</label>
            <input className="form-input" defaultValue="/images/og-missionchain.png" />
          </div>
          <button className="btn btn-primary">Save SEO</button>
        </>
      )}
    </>
  );
}
