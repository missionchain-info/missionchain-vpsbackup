'use client';

import { useState, useEffect, useCallback } from 'react';
import { BrowserProvider, Contract, JsonRpcProvider, isAddress, getAddress } from 'ethers';
import { getActiveAddresses, getActiveChain } from '@missionchain/sdk';
import SeedWhitelistTable from './SeedWhitelistTable';

/**
 * Who may buy the SEED round.
 *
 * This is not a formality. SEED sells MIC at $0.0025 while the Pre-Sale sells it at
 * $0.005, so the same $1,000 buys 400,000 MIC here against 200,000 there. If SEED were
 * open to anyone, nobody would have a reason to buy the Pre-Sale and the 315,000,000 MIC
 * sitting in that contract would never move. The list is what keeps the two rounds from
 * competing.
 *
 * SeedSaleV7 carried this same mapping and never read it in `buyPackage`. V9 checks it
 * on the second line. Everything on this screen is read from and written to the contract
 * — there is no database copy that could drift out of step with it.
 */

const ADDRESSES = getActiveAddresses();
const CHAIN = getActiveChain();
const ZERO = '0x0000000000000000000000000000000000000000';

const ABI = [
  'function whitelisted(address) view returns (bool)',
  'function whitelistedCount() view returns (uint256)',
  'function whitelistRequired() view returns (bool)',
  'function active() view returns (bool)',
  'function canBuy(address) view returns (bool)',
  'function addToWhitelist(address[] users)',
  'function removeFromWhitelist(address[] users)',
  'function setWhitelistRequired(bool required)',
];

type Row = { address: string; listed: boolean };

async function findWalletProvider(): Promise<any> {
  if (typeof window === 'undefined') throw new Error('Not in browser');
  const w = window as any;
  if (w.ethereum) return w.ethereum;
  throw new Error('No wallet detected. Connect MetaMask or Trust Wallet.');
}

async function ensureChain(provider: any) {
  const hex = await provider.request({ method: 'eth_chainId' });
  if (parseInt(hex, 16) === CHAIN.chainId) return;
  await provider.request({
    method: 'wallet_switchEthereumChain',
    params: [{ chainId: CHAIN.chainIdHex }],
  });
}

export default function SeedWhitelistSection() {
  const seedAddress = (ADDRESSES as any).SeedSaleV9 as string;
  const deployed = Boolean(seedAddress) && seedAddress !== ZERO;

  const [count, setCount] = useState<bigint>(0n);
  const [required, setRequired] = useState<boolean | null>(null);
  const [saleActive, setSaleActive] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [raw, setRaw] = useState('');
  const [checked, setChecked] = useState<Row[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [writes, setWrites] = useState(0);

  const load = useCallback(async () => {
    if (!deployed) { setLoading(false); return; }
    setLoading(true);
    try {
      const c = new Contract(seedAddress, ABI, new JsonRpcProvider(CHAIN.rpcUrls[0]));
      const [n, r, a] = await Promise.all([c.whitelistedCount(), c.whitelistRequired(), c.active()]);
      setCount(n); setRequired(r); setSaleActive(a);
    } catch (e: any) {
      setMsg({ ok: false, text: e?.shortMessage || e?.message || 'Could not read the SEED contract' });
    }
    setLoading(false);
  }, [seedAddress, deployed]);

  useEffect(() => { load(); }, [load]);

  /** Accepts addresses separated by commas, spaces or newlines — paste a column and go. */
  const parsed = (() => {
    const seen = new Set<string>();
    const good: string[] = [];
    const bad: string[] = [];
    for (const t of raw.split(/[\s,;]+/).map(x => x.trim()).filter(Boolean)) {
      if (!isAddress(t)) { bad.push(t); continue; }
      const a = getAddress(t);
      if (seen.has(a)) continue;   // a pasted column often repeats
      seen.add(a); good.push(a);
    }
    return { good, bad };
  })();

  const lookup = async () => {
    if (!parsed.good.length) return;
    setBusy(true); setMsg(null);
    try {
      const c = new Contract(seedAddress, ABI, new JsonRpcProvider(CHAIN.rpcUrls[0]));
      const rows = await Promise.all(
        parsed.good.map(async (a) => ({ address: a, listed: (await c.whitelisted(a)) as boolean })),
      );
      setChecked(rows);
    } catch (e: any) {
      setMsg({ ok: false, text: e?.shortMessage || e?.message || 'Lookup failed' });
    }
    setBusy(false);
  };

  const write = async (fn: 'addToWhitelist' | 'removeFromWhitelist') => {
    setBusy(true); setMsg(null);
    try {
      const provider = await findWalletProvider();
      await provider.request({ method: 'eth_requestAccounts' });
      await ensureChain(provider);
      const signer = await new BrowserProvider(provider).getSigner();
      const c = new Contract(seedAddress, ABI, signer);
      const tx = await c[fn](parsed.good);
      const rc = await tx.wait(1);
      setMsg({
        ok: true,
        text: `${parsed.good.length} wallet${parsed.good.length === 1 ? '' : 's'} ${
          fn === 'addToWhitelist' ? 'added to' : 'removed from'
        } the list. Block ${rc?.blockNumber}.`,
      });
      setChecked([]); setRaw('');
      setWrites((n) => n + 1);
      await load();
    } catch (e: any) {
      setMsg({ ok: false, text: e?.shortMessage || e?.message || 'Transaction failed' });
    }
    setBusy(false);
  };

  const toggleRequirement = async () => {
    const turningOff = required === true;
    if (turningOff && !window.confirm(
      'Open SEED to everyone?\n\n' +
      'SEED sells MIC at $0.0025 and the Pre-Sale at $0.005. With the list switched off, ' +
      'anyone can buy MIC here for half the Pre-Sale price — including by calling the ' +
      'contract directly, without this console.\n\nContinue?',
    )) return;

    setBusy(true); setMsg(null);
    try {
      const provider = await findWalletProvider();
      await provider.request({ method: 'eth_requestAccounts' });
      await ensureChain(provider);
      const signer = await new BrowserProvider(provider).getSigner();
      const c = new Contract(seedAddress, ABI, signer);
      const tx = await c.setWhitelistRequired(!required);
      await tx.wait(1);
      setMsg({ ok: true, text: turningOff ? 'SEED is now open to everyone.' : 'SEED is restricted to the list again.' });
      await load();
    } catch (e: any) {
      setMsg({ ok: false, text: e?.shortMessage || e?.message || 'Transaction failed' });
    }
    setBusy(false);
  };

  if (!deployed) {
    return (
      <div className="card card-p" style={{ marginTop: 16 }}>
        <div className="card-title">SEED Whitelist</div>
        <div style={{ fontSize: '0.68rem', color: 'var(--gray2)', lineHeight: 1.7 }}>
          The SEED contract is not published yet. Once it is, this is where wallets are cleared to
          buy the SEED round. The round stays closed to everyone until wallets are added.
        </div>
      </div>
    );
  }

  return (
    <div className="card card-p" style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div className="card-title" style={{ margin: 0 }}>SEED Whitelist</div>
        <button className="btn btn-outline btn-sm" style={{ marginLeft: 'auto' }} onClick={load} disabled={loading || busy}>
          ↻ Refresh
        </button>
      </div>

      <p style={{ fontSize: '0.62rem', color: 'var(--gray2)', lineHeight: 1.7, margin: '6px 0 14px' }}>
        SEED sells MIC at <strong>$0.0025</strong>; the Pre-Sale sells it at <strong>$0.005</strong>.
        The list is what stops the cheaper round from absorbing demand meant for the Pre-Sale.
        Everything here is read from and written to the contract — no database copy.
      </p>

      <div className="g3" style={{ marginBottom: 14 }}>
        <div>
          <div className="info-key">WALLETS CLEARED</div>
          <div className="info-val" style={{ fontSize: '1rem' }}>{count.toString()}</div>
        </div>
        <div>
          <div className="info-key">LIST ENFORCED</div>
          <div className="info-val" style={{ fontSize: '1rem' }}>
            {required === null ? '—' : required
              ? <span style={{ color: 'var(--success)' }}>yes</span>
              : <span style={{ color: 'var(--error)' }}>NO — open to all</span>}
          </div>
        </div>
        <div>
          <div className="info-key">ROUND</div>
          <div className="info-val" style={{ fontSize: '1rem' }}>
            {saleActive === null ? '—' : saleActive
              ? <span style={{ color: 'var(--success)' }}>selling</span>
              : <span style={{ color: 'var(--warning)' }}>closed</span>}
          </div>
        </div>
      </div>

      {msg && (
        <div style={{
          fontSize: '0.66rem', padding: '9px 11px', borderRadius: 5, marginBottom: 12,
          color: msg.ok ? 'var(--success)' : 'var(--error)',
          background: msg.ok ? 'rgba(69,217,160,.1)' : 'rgba(242,109,139,.1)',
        }}>{msg.text}</div>
      )}

      <div className="input-wrap">
        <div className="input-label">Wallet addresses — one per line, or separated by commas</div>
        <textarea
          rows={5}
          value={raw}
          onChange={(e) => { setRaw(e.target.value); setChecked([]); }}
          placeholder={'0x1234…\n0xabcd…'}
          style={{ width: '100%', fontFamily: 'var(--font-m)', fontSize: '0.7rem', resize: 'vertical' }}
        />
      </div>

      <div style={{ fontSize: '0.62rem', color: 'var(--gray2)', margin: '6px 0 12px' }}>
        {parsed.good.length} valid address{parsed.good.length === 1 ? '' : 'es'}
        {parsed.bad.length > 0 && (
          <span style={{ color: 'var(--error)' }}>
            {' · '}{parsed.bad.length} unreadable and will be skipped: {parsed.bad.slice(0, 3).join(', ')}
            {parsed.bad.length > 3 ? '…' : ''}
          </span>
        )}
      </div>

      {checked.length > 0 && (
        <div style={{ marginBottom: 12, maxHeight: 190, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 6 }}>
          {checked.map((r) => (
            <div key={r.address} style={{
              display: 'flex', justifyContent: 'space-between', gap: 10,
              padding: '7px 11px', fontSize: '0.64rem', fontFamily: 'var(--font-m)',
              borderBottom: '1px solid var(--border)',
            }}>
              <span>{r.address}</span>
              <span style={{ color: r.listed ? 'var(--success)' : 'var(--gray2)', whiteSpace: 'nowrap' }}>
                {r.listed ? 'cleared' : 'not on list'}
              </span>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="btn btn-outline btn-sm" disabled={busy || !parsed.good.length} onClick={lookup}>
          Check status
        </button>
        <button className="btn btn-primary btn-sm" disabled={busy || !parsed.good.length} onClick={() => write('addToWhitelist')}>
          {busy ? 'Confirm in wallet…' : `Add ${parsed.good.length || ''} to list`}
        </button>
        <button className="btn btn-outline btn-sm" disabled={busy || !parsed.good.length} onClick={() => write('removeFromWhitelist')}>
          Remove from list
        </button>
      </div>

      <SeedWhitelistTable reloadKey={writes} />

      <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
        <div style={{ fontSize: '0.66rem', color: 'var(--gray2)', lineHeight: 1.7, marginBottom: 8 }}>
          {required
            ? 'Only wallets on the list can buy. This is the intended setting while the Pre-Sale is running.'
            : 'The list is switched off — anyone can buy SEED at half the Pre-Sale price.'}
        </div>
        <button
          className={`btn btn-sm ${required ? 'btn-outline' : 'btn-primary'}`}
          disabled={busy || required === null}
          onClick={toggleRequirement}
        >
          {required ? 'Open SEED to everyone' : 'Restrict SEED to the list'}
        </button>
      </div>
    </div>
  );
}
