'use client';

import { useState, useEffect } from 'react';
import { fetchSystemConfig, updateSystemConfig, fetchTwilioKyc, updateTwilioKyc, type TwilioKycView } from '@/lib/api';
import SystemLookupSection from '@/components/SystemLookupSection';
import PlatformContracts from '@/components/PlatformContracts';

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

function TwilioKycCard() {
  const [cfg, setCfg] = useState<TwilioKycView | null>(null);
  const [accountSid, setAccountSid] = useState('');
  const [verifyServiceSid, setVerifyServiceSid] = useState('');
  const [authToken, setAuthToken] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    fetchTwilioKyc()
      .then((r) => {
        const d = r.data;
        setCfg(d);
        setAccountSid(d.accountSid || '');
        setVerifyServiceSid(d.verifyServiceSid || '');
        setEnabled(!!d.enabled);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const r = await updateTwilioKyc({
        enabled,
        accountSid,
        verifyServiceSid,
        authToken: authToken || undefined,
      });
      setCfg(r.data);
      setAuthToken(''); // clear the secret input after a successful save
      setMsg({ ok: true, text: 'Saved.' });
    } catch (e: any) {
      setMsg({ ok: false, text: e?.message || 'Save failed' });
    }
    setSaving(false);
  };

  return (
    <div className="card card-p" style={{ marginTop: 16 }}>
      <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span>📱 Twilio Server KYC (SMS fallback)</span>
        {cfg?.enabled
          ? <span className="badge b-active">ENABLED</span>
          : <span className="badge">Disabled</span>}
      </div>
      <div style={{ fontSize: SZ, color: 'var(--muted)', margin: '2px 0 14px', lineHeight: 1.6 }}>
        Server-side SMS one-time-code for phone verification. Works inside wallet in-app browsers where
        Firebase reCAPTCHA is blocked. When enabled, members in a wallet browser receive an SMS code instead of
        being told to open Safari/Chrome. Fill in your Twilio Verify credentials and toggle Enable.
      </div>

      {loading ? (
        <div style={{ fontSize: SZ, color: 'var(--muted)' }}>Loading…</div>
      ) : (
        <>
          <div className="input-wrap">
            <div className="input-label">Account SID</div>
            <input type="text" value={accountSid} onChange={(e) => setAccountSid(e.target.value)} placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" />
          </div>
          <div className="input-wrap">
            <div className="input-label">Verify Service SID</div>
            <input type="text" value={verifyServiceSid} onChange={(e) => setVerifyServiceSid(e.target.value)} placeholder="VAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" />
          </div>
          <div className="input-wrap">
            <div className="input-label">
              Auth Token {cfg?.authTokenSet && <span style={{ color: 'var(--muted)' }}>· stored (leave blank to keep)</span>}
            </div>
            <input
              type="password"
              value={authToken}
              onChange={(e) => setAuthToken(e.target.value)}
              placeholder={cfg?.authTokenSet ? '•••••••••• (unchanged)' : 'your Twilio auth token'}
              autoComplete="new-password"
            />
          </div>

          <div className="toggle-row" style={{ margin: '6px 0 12px' }}>
            <div className={`toggle ${enabled ? 'on' : ''}`} onClick={() => setEnabled((v) => !v)} />
            <span className="toggle-label">Enable SMS verification (Twilio)</span>
          </div>

          <button className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save Twilio Settings'}
          </button>
          {msg && (
            <span style={{ marginLeft: 12, fontSize: SZ, color: msg.ok ? 'var(--success, #48c78e)' : 'var(--error, #F1465C)' }}>
              {msg.text}
            </span>
          )}
          {cfg?.updatedAt && (
            <div style={{ fontSize: SZ, color: 'var(--muted)', marginTop: 8 }}>
              Last updated {new Date(cfg.updatedAt).toLocaleString()}
              {cfg.updatedBy ? ` by ${cfg.updatedBy.slice(0, 6)}…${cfg.updatedBy.slice(-4)}` : ''}
            </div>
          )}
        </>
      )}
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
        <PlatformContracts version={config?.version} />
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

      <SystemLookupSection />

      <TwilioKycCard />
    </>
  );
}
