'use client';

import SectionHead from '@/components/ui/SectionHead';

export default function SystemPage() {
  return (
    <>
      <SectionHead title="System Configuration" />
      <div className="banner banner-warn">⚠ Mainnet deployment is not yet available. All configurations below apply to BSC Testnet.</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
        <div>
          <div className="form-group">
            <label className="form-label">API Gateway URL</label>
            <input className="form-input" value="https://api.missionchain.io/v1" readOnly style={{ opacity: 0.7 }} />
          </div>
          <div className="form-group">
            <label className="form-label">BSC Network</label>
            <select className="form-input">
              <option>BSC Testnet (Chain ID: 97)</option>
              <option disabled>BSC Mainnet (Chain ID: 56)</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Gnosis Safe Address</label>
            <input className="form-input" value="0x1234...5678 (3-of-5 multisig)" readOnly style={{ opacity: 0.7 }} />
          </div>
          <button className="btn btn-danger">Trigger Emergency Pause</button>
        </div>
        <div>
          <div className="form-group">
            <label className="form-label">Database</label>
            <input className="form-input" value="PostgreSQL 16 — mc_production" readOnly style={{ opacity: 0.7 }} />
          </div>
          <div className="form-group">
            <label className="form-label">Cache Layer</label>
            <input className="form-input" value="Redis 7.2 — 18/50 connections" readOnly style={{ opacity: 0.7 }} />
          </div>
          <div className="form-group">
            <label className="form-label">KYC Provider</label>
            <input className="form-input" value="Sumsub (off-chain) + on-chain allowlist" readOnly style={{ opacity: 0.7 }} />
          </div>
          <div className="form-group">
            <label className="form-label">Event Indexer</label>
            <input className="form-input" value="Custom Node.js — Block #48,231,044" readOnly style={{ opacity: 0.7 }} />
          </div>
        </div>
      </div>
    </>
  );
}
