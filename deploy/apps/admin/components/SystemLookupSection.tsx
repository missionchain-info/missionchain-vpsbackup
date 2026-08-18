'use client';

import { useState, useEffect, useCallback } from 'react';
import { BrowserProvider, parseEther } from 'ethers';
import { fetchSystemLookup, updateSystemLookup, type SystemLookupView } from '@/lib/api';

const BSC_CHAIN_ID = 56;
const BSC_RPC = 'https://bsc-dataseed.binance.org/';

async function findWalletProvider(): Promise<any> {
  if (typeof window === 'undefined') throw new Error('Not in browser');
  const w = window as any;
  if (w.ethereum) return w.ethereum;
  return new Promise((resolve, reject) => {
    let found: any = null;
    const handler = (event: any) => { if (event.detail?.provider && !found) found = event.detail.provider; };
    window.addEventListener('eip6963:announceProvider', handler);
    window.dispatchEvent(new Event('eip6963:requestProvider'));
    setTimeout(() => {
      window.removeEventListener('eip6963:announceProvider', handler);
      found ? resolve(found) : reject(new Error('No wallet detected. Connect MetaMask or Trust Wallet.'));
    }, 500);
  });
}

async function ensureBscMainnet(provider: any) {
  const chainHex = await provider.request({ method: 'eth_chainId' });
  if (parseInt(chainHex, 16) === BSC_CHAIN_ID) return;
  try {
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x38' }] });
  } catch (e: any) {
    if (e.code === 4902) {
      await provider.request({
        method: 'wallet_addEthereumChain',
        params: [{
          chainId: '0x38', chainName: 'BSC Mainnet',
          nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 },
          rpcUrls: [BSC_RPC], blockExplorerUrls: ['https://bscscan.com'],
        }],
      });
    } else throw e;
  }
}

/** Push a renewal date forward from today. Used after paying the provider. */
function plus(months: number) {
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

/**
 * System Lookup — the two things that fail silently.
 *
 * A gas wallet that empties stops every signature. A domain, VPS or RPC plan that
 * lapses takes the platform offline. Neither announces itself and both are cheap to
 * watch, so they share one screen with an explicit countdown.
 *
 * Balances come live from chain and TLS certificates are probed on each load.
 * Registrar, host and RPC-plan renewal dates are not exposed by anyone, so those are
 * entered once and counted down from there. A row with no date yet is a visible
 * "Set date" prompt rather than a silent gap.
 */

const KINDS = ['domain', 'vps', 'rpc', 'ssl', 'saas', 'other'];

const TONE: Record<string, { bg: string; fg: string; label: string }> = {
  ok:       { bg: 'rgba(69,217,160,.12)',  fg: 'var(--success)', label: 'OK' },
  warning:  { bg: 'rgba(240,190,74,.14)',  fg: 'var(--warning)', label: 'DUE SOON' },
  critical: { bg: 'rgba(242,109,126,.14)', fg: 'var(--error)',   label: 'URGENT' },
  expired:  { bg: 'rgba(242,109,126,.22)', fg: 'var(--error)',   label: 'EXPIRED' },
  unset:    { bg: 'rgba(240,190,74,.10)',  fg: 'var(--warning)', label: 'NO DATE SET' },
  unknown:  { bg: 'rgba(137,156,194,.14)', fg: 'var(--gray2)',   label: 'UNREADABLE' },
};

function Pill({ status }: { status: string }) {
  const t = TONE[status] ?? TONE.unknown;
  return (
    <span style={{
      background: t.bg, color: t.fg, fontFamily: 'var(--font-m)', fontSize: '0.55rem',
      letterSpacing: '.08em', padding: '3px 8px', borderRadius: 4, whiteSpace: 'nowrap',
    }}>{t.label}</span>
  );
}

function daysText(d: number | null) {
  if (d === null) return '—';
  if (d < 0) return `${Math.abs(d)} days ago`;
  if (d === 0) return 'today';
  return `${d} days`;
}

/**
 * Top-up dialog. Two routes, because they solve different problems:
 * sending from the connected wallet covers funding CREDITOR from the Owner's wallet,
 * while the copyable address covers a withdrawal from an exchange — which is the only
 * way to fund the Owner wallet itself.
 */
function TopUpDialog({ target, label, onClose, onDone }: {
  target: string; label: string; onClose: () => void; onDone: () => void;
}) {
  const [amount, setAmount] = useState('0.1');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [tx, setTx] = useState('');
  const [copied, setCopied] = useState(false);

  const send = async () => {
    setBusy(true); setErr(''); setTx('');
    try {
      const provider = await findWalletProvider();
      await provider.request({ method: 'eth_requestAccounts' });
      await ensureBscMainnet(provider);
      const signer = await new BrowserProvider(provider).getSigner();
      const from = (await signer.getAddress()).toLowerCase();
      if (from === target.toLowerCase()) {
        throw new Error('The connected wallet IS the destination. Withdraw from an exchange to this address instead.');
      }
      const t = await signer.sendTransaction({ to: target, value: parseEther(amount) });
      setTx(t.hash);
      await t.wait(1);
      onDone();
    } catch (e: any) {
      setErr(e?.shortMessage || e?.message || 'Transaction failed');
    }
    setBusy(false);
  };

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', zIndex: 900,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }}>
      <div onClick={(e) => e.stopPropagation()} className="card card-p"
        style={{ maxWidth: 460, width: '100%', background: 'var(--bg2, #0E2148)' }}>
        <div className="card-title">Top up BNB — {label}</div>

        <div style={{ fontSize: '0.6rem', color: 'var(--gray2)', margin: '6px 0 4px', fontFamily: 'var(--font-m)' }}>
          DESTINATION
        </div>
        <div style={{
          fontFamily: 'var(--font-m)', fontSize: '0.62rem', wordBreak: 'break-all',
          background: 'rgba(0,0,0,.25)', border: '1px solid var(--border)', borderRadius: 4, padding: '8px 10px',
        }}>{target}</div>
        <button className="btn btn-outline btn-sm" style={{ marginTop: 6 }}
          onClick={() => { navigator.clipboard?.writeText(target); setCopied(true); setTimeout(() => setCopied(false), 2000); }}>
          {copied ? '✓ Copied' : 'Copy address'}
        </button>
        <div style={{ fontSize: '0.58rem', color: 'var(--gray2)', marginTop: 6, lineHeight: 1.6 }}>
          Withdrawing from an exchange? Copy this address and send <strong>BNB on the BEP-20 (BSC) network</strong>.
          Any other network loses the funds.
        </div>

        <div style={{ borderTop: '1px solid var(--border)', margin: '14px 0' }} />

        <div className="input-wrap">
          <div className="input-label">Or send from the connected wallet (BNB)</div>
          <input type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>

        {err && <div style={{ fontSize: '0.64rem', color: 'var(--error)', marginBottom: 8 }}>{err}</div>}
        {tx && (
          <div style={{ fontSize: '0.62rem', color: 'var(--success)', marginBottom: 8 }}>
            Sent — <a href={`https://bscscan.com/tx/${tx}`} target="_blank" rel="noopener noreferrer"
              style={{ color: 'var(--success)' }}>view on BSCScan</a>
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
          <button className="btn btn-outline btn-sm" onClick={onClose}>Close</button>
          <button className="btn btn-primary btn-sm" onClick={send} disabled={busy || !(Number(amount) > 0)}>
            {busy ? 'Confirm in wallet…' : 'Send BNB'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function SystemLookupSection() {
  const [view, setView] = useState<SystemLookupView | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Local drafts — pushed only on Save, so a half-typed row never reaches the server.
  const [wallets, setWallets] = useState<Array<{ label: string; address: string; minBnb: number; note?: string }>>([]);
  const [services, setServices] = useState<Array<{ label: string; kind: string; expiresAt: string; url?: string; renewUrl?: string; note?: string }>>([]);
  const [warnDays, setWarnDays] = useState(30);
  const [criticalDays, setCriticalDays] = useState(7);
  const [topUp, setTopUp] = useState<{ address: string; label: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetchSystemLookup();
      const d = r.data;
      setView(d);
      setWallets(d.wallets.map((w) => ({ label: w.label, address: w.address, minBnb: w.minBnb, note: w.note })));
      setServices(d.services.map((s) => ({
        label: s.label, kind: s.kind, expiresAt: (s.expiresAt || '').slice(0, 10),
        url: s.url, renewUrl: s.renewUrl, note: s.note,
      })));
      setWarnDays(d.warnDays);
      setCriticalDays(d.criticalDays);
    } catch (e: any) {
      setMsg({ ok: false, text: e?.message || 'Could not load' });
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      await updateSystemLookup({ warnDays, criticalDays, wallets, services });
      setEditing(false);
      await load();
      setMsg({ ok: true, text: 'Saved.' });
    } catch (e: any) {
      setMsg({ ok: false, text: e?.message || 'Save failed' });
    }
    setSaving(false);
  };

  const undated = (view?.services ?? []).filter((s) => !s.expiresAt).length;

  const th: React.CSSProperties = {
    textAlign: 'left', fontFamily: 'var(--font-m)', fontSize: '0.55rem',
    letterSpacing: '.08em', color: 'var(--gray2)', padding: '6px 8px', fontWeight: 400,
  };
  const td: React.CSSProperties = { padding: '8px', fontSize: '0.68rem', verticalAlign: 'middle' };
  const inp: React.CSSProperties = {
    width: '100%', background: 'rgba(0,0,0,.25)', border: '1px solid var(--border)',
    borderRadius: 4, color: 'var(--white)', padding: '5px 7px', fontSize: '0.65rem',
  };

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div className="card-title" style={{ margin: 0 }}>System Lookup — Monitoring &amp; Alerts</div>
        {view && <Pill status={view.alerts > 0 ? view.overall : 'ok'} />}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button className="btn btn-outline btn-sm" onClick={load} disabled={loading}>↻ Re-check</button>
          {!editing
            ? <button className="btn btn-primary btn-sm" onClick={() => setEditing(true)}>Edit</button>
            : <>
                <button className="btn btn-outline btn-sm" onClick={() => { setEditing(false); load(); }}>Cancel</button>
                <button className="btn btn-primary btn-sm" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
              </>}
        </div>
      </div>

      <p style={{ fontSize: '0.62rem', color: 'var(--gray2)', lineHeight: 1.7, margin: '6px 0 12px' }}>
        BNB balances are read from chain and TLS certificates are probed on every load.
        Registrar, host and RPC-plan renewal dates are published nowhere, so enter those
        once and the countdown runs from there. Warning at ≤ <strong>{warnDays}</strong> days,
        urgent at ≤ <strong>{criticalDays}</strong> days.
      </p>

      {/* An undated row is the whole point of the screen — say so before it is missed. */}
      {!editing && undated > 0 && (
        <div style={{
          fontSize: '0.65rem', marginBottom: 12, padding: '9px 11px', borderRadius: 5,
          background: 'rgba(240,190,74,.1)', color: 'var(--warning)',
          display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
        }}>
          <span>{undated} tracked {undated === 1 ? 'item has' : 'items have'} no renewal date yet — nothing will warn you about {undated === 1 ? 'it' : 'them'}.</span>
          <button className="btn btn-primary btn-sm" onClick={() => setEditing(true)}>Set dates</button>
        </div>
      )}

      {msg && (
        <div style={{
          fontSize: '0.65rem', marginBottom: 12, padding: '7px 10px', borderRadius: 5,
          color: msg.ok ? 'var(--success)' : 'var(--error)',
          background: msg.ok ? 'rgba(69,217,160,.1)' : 'rgba(242,109,126,.1)',
        }}>{msg.text}</div>
      )}

      {loading && <div style={{ fontSize: '0.68rem', color: 'var(--gray2)' }}>Reading on-chain…</div>}

      {!loading && view && (
        <>
          {/* ── Gas wallets ─────────────────────────────────────── */}
          <div style={{ fontFamily: 'var(--font-m)', fontSize: '0.58rem', letterSpacing: '.1em', color: 'var(--gray2)', margin: '4px 0 6px' }}>
            NETWORK GAS (BNB)
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
              <thead><tr>
                <th style={th}>WALLET</th><th style={th}>ADDRESS</th>
                <th style={{ ...th, textAlign: 'right' }}>BALANCE</th>
                <th style={{ ...th, textAlign: 'right' }}>MINIMUM</th>
                <th style={th}>STATUS</th>
                <th style={th}></th>
              </tr></thead>
              <tbody>
                {(editing ? wallets : view.wallets).map((w: any, i) => (
                  <tr key={i} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={td}>
                      {editing
                        ? <input style={inp} placeholder="Wallet name" value={w.label}
                            onChange={(e) => { const n = [...wallets]; n[i] = { ...n[i], label: e.target.value }; setWallets(n); }} />
                        : <>
                            <div>{w.label}</div>
                            {w.note && <div style={{ fontSize: '0.58rem', color: 'var(--gray2)', marginTop: 2 }}>{w.note}</div>}
                          </>}
                    </td>
                    <td style={{ ...td, fontFamily: 'var(--font-m)', fontSize: '0.6rem' }}>
                      {editing
                        ? <input style={inp} placeholder="0x…" value={w.address}
                            onChange={(e) => { const n = [...wallets]; n[i] = { ...n[i], address: e.target.value }; setWallets(n); }} />
                        : <a href={`https://bscscan.com/address/${w.address}`} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--gray)' }}>
                            {w.address.slice(0, 10)}…{w.address.slice(-6)}
                          </a>}
                    </td>
                    <td style={{ ...td, textAlign: 'right', fontFamily: 'var(--font-m)' }}>
                      {!editing && (w.bnb === null ? '—' : `${w.bnb.toFixed(4)} BNB`)}
                    </td>
                    <td style={{ ...td, textAlign: 'right', fontFamily: 'var(--font-m)' }}>
                      {editing
                        ? <input style={{ ...inp, textAlign: 'right' }} type="number" step="0.01" value={w.minBnb}
                            onChange={(e) => { const n = [...wallets]; n[i] = { ...n[i], minBnb: Number(e.target.value) }; setWallets(n); }} />
                        : `${w.minBnb} BNB`}
                    </td>
                    <td style={td}>{!editing && <Pill status={w.status} />}</td>
                    <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {editing
                        ? <button className="btn btn-outline btn-sm" onClick={() => setWallets(wallets.filter((_, j) => j !== i))}>Remove</button>
                        : <button className={`btn btn-sm ${w.status === 'ok' ? 'btn-outline' : 'btn-primary'}`}
                            onClick={() => setTopUp({ address: w.address, label: w.label })}>Top up</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {editing && (
            <button className="btn btn-outline btn-sm" style={{ marginTop: 8 }}
              onClick={() => setWallets([...wallets, { label: '', address: '', minBnb: 0.05 }])}>+ Add wallet</button>
          )}

          {/* ── Renewals ────────────────────────────────────────── */}
          <div style={{ fontFamily: 'var(--font-m)', fontSize: '0.58rem', letterSpacing: '.1em', color: 'var(--gray2)', margin: '20px 0 6px' }}>
            SERVICES &amp; RENEWAL DATES
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
              <thead><tr>
                <th style={th}>SERVICE</th><th style={th}>TYPE</th><th style={th}>EXPIRES</th>
                <th style={{ ...th, textAlign: 'right' }}>REMAINING</th>
                <th style={th}>STATUS</th>
                <th style={th}></th>
              </tr></thead>
              <tbody>
                {(editing ? services : view.services).map((s: any, i) => (
                  <tr key={i} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={td}>
                      {editing
                        ? <input style={inp} placeholder="e.g. VPS 187.77.149.158" value={s.label}
                            onChange={(e) => { const n = [...services]; n[i] = { ...n[i], label: e.target.value }; setServices(n); }} />
                        : <>
                            <div>{s.url
                              ? <a href={s.url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--white)' }}>{s.label}</a>
                              : s.label}</div>
                            {s.note && <div style={{ fontSize: '0.58rem', color: 'var(--gray2)', marginTop: 2 }}>{s.note}</div>}
                          </>}
                    </td>
                    <td style={td}>
                      {editing
                        ? <select style={inp} value={s.kind}
                            onChange={(e) => { const n = [...services]; n[i] = { ...n[i], kind: e.target.value }; setServices(n); }}>
                            {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
                          </select>
                        : <span style={{ fontFamily: 'var(--font-m)', fontSize: '0.58rem', color: 'var(--gray2)' }}>{s.kind}</span>}
                    </td>
                    <td style={{ ...td, fontFamily: 'var(--font-m)', fontSize: '0.62rem', minWidth: 150 }}>
                      {/* The date input stays available in read mode for undated rows, so a
                          missing date can be filled in where it is noticed. */}
                      {editing || !s.expiresAt
                        ? <input style={inp} type="date" value={editing ? s.expiresAt : ''}
                            onChange={(e) => {
                              const base = editing ? services : view.services.map((x: any) => ({
                                label: x.label, kind: x.kind, expiresAt: (x.expiresAt || '').slice(0, 10),
                                url: x.url, renewUrl: x.renewUrl, note: x.note,
                              }));
                              const n = [...base];
                              n[i] = { ...n[i], expiresAt: e.target.value };
                              setServices(n);
                              if (!editing) setEditing(true);
                            }} />
                        : <>{String(s.expiresAt).slice(0, 10)}
                            {s.probed && <span style={{ color: 'var(--gray2)', fontSize: '0.52rem', marginLeft: 5 }}>auto</span>}</>}
                    </td>
                    <td style={{ ...td, textAlign: 'right', fontFamily: 'var(--font-m)' }}>
                      {!editing && daysText(s.daysLeft)}
                    </td>
                    <td style={td}>{!editing && <Pill status={s.status} />}</td>
                    <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {editing ? (
                        <div style={{ display: 'flex', gap: 5, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                          <input style={{ ...inp, width: 170 }} placeholder="Renewal / billing URL" value={s.renewUrl || ''}
                            onChange={(e) => { const n = [...services]; n[i] = { ...n[i], renewUrl: e.target.value }; setServices(n); }} />
                          <button className="btn btn-outline btn-sm"
                            onClick={() => setServices(services.filter((_, j) => j !== i))}>Remove</button>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', gap: 5, justifyContent: 'flex-end' }}>
                          {s.renewUrl && (
                            <a className="btn btn-primary btn-sm" href={s.renewUrl} target="_blank" rel="noopener noreferrer">Renew ↗</a>
                          )}
                          {/* Paid already? Push the date out — the provider will not tell us. */}
                          {s.kind !== 'ssl' && (
                            <select
                              defaultValue=""
                              onChange={(e) => {
                                const m = Number(e.target.value);
                                if (!m) return;
                                const base = view.services.map((x: any) => ({
                                  label: x.label, kind: x.kind, expiresAt: (x.expiresAt || '').slice(0, 10),
                                  url: x.url, renewUrl: x.renewUrl, note: x.note,
                                }));
                                base[i] = { ...base[i], expiresAt: plus(m) };
                                setServices(base);
                                setEditing(true);
                                e.target.value = '';
                              }}
                              style={{
                                background: 'rgba(0,0,0,.25)', border: '1px solid var(--border)', borderRadius: 4,
                                color: 'var(--gray)', fontSize: '0.6rem', padding: '4px 6px',
                              }}>
                              <option value="">Renewed…</option>
                              <option value="1">+ 1 month</option>
                              <option value="12">+ 1 year</option>
                              <option value="24">+ 2 years</option>
                            </select>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {editing && (
            <button className="btn btn-outline btn-sm" style={{ marginTop: 8 }}
              onClick={() => setServices([...services, { label: '', kind: 'domain', expiresAt: '' }])}>+ Add service</button>
          )}

          {/* ── Thresholds ──────────────────────────────────────── */}
          {editing && (
            <div className="g2" style={{ marginTop: 18 }}>
              <div className="input-wrap">
                <div className="input-label">Warn when days remaining ≤</div>
                <input type="number" min={1} value={warnDays} onChange={(e) => setWarnDays(Number(e.target.value))} />
              </div>
              <div className="input-wrap">
                <div className="input-label">Urgent when days remaining ≤</div>
                <input type="number" min={1} value={criticalDays} onChange={(e) => setCriticalDays(Number(e.target.value))} />
              </div>
            </div>
          )}

          <div style={{ fontSize: '0.58rem', color: 'var(--gray2)', marginTop: 14, fontFamily: 'var(--font-m)' }}>
            Checked {new Date(view.checkedAt).toLocaleString()}
            {view.updatedBy && ` · last edited by ${view.updatedBy.slice(0, 8)}…`}
          </div>
        </>
      )}

      {topUp && (
        <TopUpDialog
          target={topUp.address}
          label={topUp.label}
          onClose={() => setTopUp(null)}
          onDone={() => { setTopUp(null); load(); }}
        />
      )}
    </div>
  );
}
