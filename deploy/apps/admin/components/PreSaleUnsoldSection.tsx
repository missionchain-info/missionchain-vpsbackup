'use client';

import { useState, useEffect, useCallback } from 'react';
import { BrowserProvider, Contract, JsonRpcProvider, formatUnits, parseUnits, Interface } from 'ethers';

/**
 * What happens to a PreSale round that does not sell out.
 *
 * The deployer cannot decide this. `PreSale.DAO_ROLE` is held by DAOGovernor, so the
 * only way to move or burn the remainder is a Steward Council proposal that clears the
 * 3-of-5 quorum and its timelock. This screen builds that proposal, tracks approvals,
 * and executes it — it never calls PreSale directly, because it cannot.
 *
 * Both actions are also locked for 180 days from deploy unless the sale has been
 * stopped, so a round cannot have its supply pulled a week after opening.
 */

const BSC_CHAIN_ID = 56;
const BSC_RPC = 'https://bsc-dataseed.binance.org/';
const DAO_GOVERNOR = '0xDCD65DC97b0A147BeCf542E22a5C218C006231cC';

/** BUDGET — treasury transfers and pool allocations, 24-hour timelock. */
const CATEGORY_BUDGET = 1;

const PRESALE_ABI = [
  'function unsoldMIC() view returns (uint256)',
  'function unsoldUnlockAt() view returns (uint256)',
  'function saleStart() view returns (uint256)',
  'function active() view returns (bool)',
  'function everActivated() view returns (bool)',
  'function totalSold() view returns (uint256)',
  'function burnUnsoldMIC(uint256 amount)',
  'function withdrawUnsoldMIC(address to, uint256 amount)',
];
const GOV_ABI = [
  'function propose(address target, bytes callData, uint8 category) returns (uint256)',
  'function approve(uint256 proposalId)',
  'function execute(uint256 proposalId)',
  'function BTC_QUORUM() view returns (uint256)',
];

const ALLOCATION = 315_000_000;

async function findWalletProvider(): Promise<any> {
  if (typeof window === 'undefined') throw new Error('Not in browser');
  const w = window as any;
  if (w.ethereum) return w.ethereum;
  return new Promise((resolve, reject) => {
    let found: any = null;
    const h = (e: any) => { if (e.detail?.provider && !found) found = e.detail.provider; };
    window.addEventListener('eip6963:announceProvider', h);
    window.dispatchEvent(new Event('eip6963:requestProvider'));
    setTimeout(() => {
      window.removeEventListener('eip6963:announceProvider', h);
      found ? resolve(found) : reject(new Error('No wallet detected. Connect MetaMask or Trust Wallet.'));
    }, 500);
  });
}

async function ensureBsc(provider: any) {
  const hex = await provider.request({ method: 'eth_chainId' });
  if (parseInt(hex, 16) === BSC_CHAIN_ID) return;
  await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x38' }] });
}

function Countdown({ target }: { target: number }) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);
  const left = target - now;
  if (left <= 0) return <span style={{ color: 'var(--success)' }}>unlocked</span>;
  const d = Math.floor(left / 86400);
  const h = Math.floor((left % 86400) / 3600);
  return <span style={{ fontFamily: 'var(--font-m)' }}>{d}d {h}h</span>;
}

export default function PreSaleUnsoldSection({ preSaleAddress }: { preSaleAddress?: string }) {
  const [unsold, setUnsold] = useState<bigint>(0n);
  const [sold, setSold] = useState<bigint>(0n);
  const [unlockAt, setUnlockAt] = useState(0);
  const [active, setActive] = useState(false);
  const [everActivated, setEverActivated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState<'burn' | 'transfer'>('burn');
  const [amount, setAmount] = useState('');
  const [dest, setDest] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const deployed = Boolean(preSaleAddress && !/^0x0+$/.test(preSaleAddress));

  const load = useCallback(async () => {
    if (!deployed) { setLoading(false); return; }
    setLoading(true);
    try {
      const p = new JsonRpcProvider(BSC_RPC);
      const ps = new Contract(preSaleAddress!, PRESALE_ABI, p);
      const [u, ua, a, s, ev] = await Promise.all([
        ps.unsoldMIC(), ps.unsoldUnlockAt(), ps.active(), ps.totalSold(), ps.everActivated(),
      ]);
      setUnsold(u); setUnlockAt(Number(ua)); setActive(a); setSold(s); setEverActivated(ev);
    } catch (e: any) {
      setMsg({ ok: false, text: e?.message || 'Could not read PreSale' });
    }
    setLoading(false);
  }, [preSaleAddress, deployed]);

  useEffect(() => { load(); }, [load]);

  const unlocked = unlockAt > 0 && Math.floor(Date.now() / 1000) >= unlockAt;
  // Must mirror PreSale._requireUnsoldActionAllowed exactly. `!active` alone is not
  // enough: it is also false at deploy, which would show the buttons as live on a
  // round that has never opened.
  const canAct = unlocked || (everActivated && !active);
  const amtOk = Number(amount) > 0 && parseUnits(amount || '0', 18) <= unsold;
  const destOk = action === 'burn' || /^0x[a-fA-F0-9]{40}$/.test(dest.trim());

  const propose = async () => {
    setBusy(true); setMsg(null);
    try {
      const provider = await findWalletProvider();
      await provider.request({ method: 'eth_requestAccounts' });
      await ensureBsc(provider);
      const signer = await new BrowserProvider(provider).getSigner();

      const iface = new Interface(PRESALE_ABI);
      const wei = parseUnits(amount, 18);
      const callData = action === 'burn'
        ? iface.encodeFunctionData('burnUnsoldMIC', [wei])
        : iface.encodeFunctionData('withdrawUnsoldMIC', [dest.trim(), wei]);

      const gov = new Contract(DAO_GOVERNOR, GOV_ABI, signer);
      const tx = await gov.propose(preSaleAddress!, callData, CATEGORY_BUDGET);
      const rc = await tx.wait(1);
      setMsg({
        ok: true,
        text: `Proposal submitted in block ${rc?.blockNumber}. It needs 3 of 5 Council approvals, then a 24-hour timelock before it can be executed.`,
      });
      setAmount(''); setDest('');
      await load();
    } catch (e: any) {
      setMsg({ ok: false, text: e?.shortMessage || e?.message || 'Transaction failed' });
    }
    setBusy(false);
  };

  if (!deployed) {
    return (
      <div className="card card-p" style={{ marginTop: 16 }}>
        <div className="card-title">Unsold Remainder — Steward Council</div>
        <div style={{ fontSize: '0.68rem', color: 'var(--gray2)', lineHeight: 1.7 }}>
          PreSale is not deployed yet. Once it is, this is where the Council decides what
          happens to whatever the round does not sell: burn it, or move part of it to
          another fund. Both are locked for 180 days from deploy unless the sale is stopped.
        </div>
      </div>
    );
  }

  const pctSold = Number(sold) / 1e18 / ALLOCATION * 100;

  return (
    <div className="card card-p" style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div className="card-title" style={{ margin: 0 }}>Unsold Remainder — Steward Council</div>
        <button className="btn btn-outline btn-sm" style={{ marginLeft: 'auto' }} onClick={load} disabled={loading}>↻ Refresh</button>
      </div>

      <p style={{ fontSize: '0.62rem', color: 'var(--gray2)', lineHeight: 1.7, margin: '6px 0 14px' }}>
        The deployer cannot move or burn this. <strong>DAOGovernor holds the role</strong>, so
        the only route is a Council proposal: 3 of 5 approvals, then a 24-hour timelock.
        This screen builds the proposal — it never calls PreSale directly.
      </p>

      <div className="g3" style={{ marginBottom: 14 }}>
        <div>
          <div className="info-key">UNSOLD</div>
          <div className="info-val" style={{ fontSize: '1rem' }}>
            {Number(formatUnits(unsold, 18)).toLocaleString(undefined, { maximumFractionDigits: 0 })} MIC
          </div>
        </div>
        <div>
          <div className="info-key">SOLD</div>
          <div className="info-val" style={{ fontSize: '1rem' }}>{pctSold.toFixed(1)}% of allocation</div>
        </div>
        <div>
          <div className="info-key">COUNCIL WINDOW</div>
          <div className="info-val" style={{ fontSize: '1rem' }}>
            {unlocked ? <span style={{ color: 'var(--success)' }}>open</span>
              : everActivated && !active ? <span style={{ color: 'var(--success)' }}>open — sale stopped</span>
              : <Countdown target={unlockAt} />}
          </div>
        </div>
      </div>

      {!canAct && (
        <div style={{
          fontSize: '0.66rem', padding: '9px 11px', borderRadius: 5, marginBottom: 12,
          background: 'rgba(240,181,74,.1)', color: 'var(--warning)',
        }}>
          Locked until {new Date(unlockAt * 1000).toLocaleDateString()} — 180 days from deploy.
          {everActivated
            ? ' Stopping the sale opens it earlier — the path for a round abandoned after a defect.'
            : ' The sale has never been opened, so the early path is not available: a round that never ran cannot be emptied on day one.'}
        </div>
      )}

      {msg && (
        <div style={{
          fontSize: '0.66rem', padding: '9px 11px', borderRadius: 5, marginBottom: 12,
          color: msg.ok ? 'var(--success)' : 'var(--error)',
          background: msg.ok ? 'rgba(69,217,160,.1)' : 'rgba(242,109,139,.1)',
        }}>{msg.text}</div>
      )}

      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <button className={`btn btn-sm ${action === 'burn' ? 'btn-primary' : 'btn-outline'}`}
          onClick={() => setAction('burn')}>Burn</button>
        <button className={`btn btn-sm ${action === 'transfer' ? 'btn-primary' : 'btn-outline'}`}
          onClick={() => setAction('transfer')}>Transfer to a fund</button>
      </div>

      <div style={{ fontSize: '0.62rem', color: 'var(--gray2)', lineHeight: 1.7, marginBottom: 10 }}>
        {action === 'burn'
          ? 'Burning destroys the MIC and reduces total supply. It needs no ongoing trust from anyone — nothing is left to manage.'
          : 'Transferring moves the MIC to another contract. Send only to a destination that can send it back out again; a contract that cannot is how 105,000,000 MIC was stranded.'}
      </div>

      <div className="g2">
        <div className="input-wrap">
          <div className="input-label">Amount (MIC)</div>
          <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)}
            placeholder={Number(formatUnits(unsold, 18)).toFixed(0)} />
        </div>
        {action === 'transfer' && (
          <div className="input-wrap">
            <div className="input-label">Destination contract</div>
            <input value={dest} onChange={(e) => setDest(e.target.value)} placeholder="0x…" />
          </div>
        )}
      </div>

      {Number(amount) > 0 && !amtOk && (
        <div style={{ fontSize: '0.66rem', color: 'var(--error)', marginBottom: 10 }}>
          More than the unsold remainder.
        </div>
      )}

      <button className="btn btn-primary" disabled={busy || !canAct || !amtOk || !destOk} onClick={propose}>
        {busy ? 'Confirm in wallet…' : `Propose ${action === 'burn' ? 'burn' : 'transfer'} to the Council`}
      </button>
      <div style={{ fontSize: '0.58rem', color: 'var(--gray2)', marginTop: 8, fontFamily: 'var(--font-m)' }}>
        Approvals and execution happen on the DAO Governance page.
      </div>
    </div>
  );
}
