'use client';

import { useState, useEffect } from 'react';
import { fetchSystemConfig, updateSystemConfig } from '@/lib/api';

const SZ = '0.62rem';

function ToggleRow({ defaultOn = false, label }: { defaultOn?: boolean; label: string }) {
  const [on, setOn] = useState(defaultOn);
  return (
    <div className="toggle-row">
      <div className={`toggle ${on ? 'on' : ''}`} onClick={() => setOn(!on)} />
      <span className="toggle-label">{label}</span>
    </div>
  );
}

export default function SystemPage() {
  const [config, setConfig] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchSystemConfig()
      .then(setConfig)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <>
      <div className="page-hd">
        <div>
          <div className="page-eyebrow">Settings</div>
          <div className="page-title">System Configuration</div>
          <div className="page-sub">Platform settings, integrations, and notifications</div>
        </div>
      </div>

      <div style={{ marginBottom: 16 }}>
        <div className="card card-p">
          <div className="card-title">Platform Information</div>
          <div className="info-row"><span className="info-key">Version</span><span className="info-val">{config?.version || 'v1.0.0-alpha'}</span></div>
          <div className="info-row"><span className="info-key">MIC Contract</span><span className="info-val mono">{config?.micContract || '0x9B7f...4E2A (BSC)'}</span></div>
          <div className="info-row"><span className="info-key">MICE Contract</span><span className="info-val mono">{config?.miceContract || '0x3C1a...B72D (BSC)'}</span></div>
          <div className="info-row"><span className="info-key">NFT Registry</span><span className="info-val mono">{config?.nftRegistry || '0x8F2b...C14E (BSC)'}</span></div>
          <div className="info-row"><span className="info-key">DAO Governance</span><span className="info-val mono">{config?.daoGovernance || '0x4A9c...F83B (BSC)'}</span></div>
          <div className="info-row"><span className="info-key">Network</span><span className="info-val"><span className="badge b-active">BSC Mainnet</span></span></div>
        </div>
        {/* NIRA-CHAT block moved → /nira (NIRA AI page) per Thomas request */}
      </div>

      <div className="card">
        <div className="card-title">Notifications &amp; Reporting</div>
        <div className="g2">
          <div>
            <div className="input-wrap"><div className="input-label">Admin Telegram Bot Token</div><input type="text" placeholder="bot:xxxxxxxxxx:..." /></div>
            <div className="input-wrap"><div className="input-label">Alert Chat ID</div><input type="text" placeholder="-100xxxxxxxxx" /></div>
            <div className="input-wrap"><div className="input-label">Critical Alert Threshold (MIC swing %)</div><input type="text" defaultValue="15" /></div>
          </div>
          <div>
            <ToggleRow defaultOn label="New member registration alerts" />
            <ToggleRow defaultOn label="Large MICE purchase alerts (>10 licenses)" />
            <ToggleRow defaultOn label="Governance proposal submitted alerts" />
            <ToggleRow defaultOn label="Weekly auto-report to all board members" />
            <ToggleRow label="Public dashboard status page" />
          </div>
        </div>
        <button className="btn btn-primary">Save All Settings</button>
      </div>
    </>
  );
}
