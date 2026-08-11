'use client';

import { useState, useEffect, useCallback } from 'react';
import { BrowserProvider, Contract, JsonRpcProvider, formatUnits, parseUnits } from 'ethers';
import { useAuth, isOwnerWallet, OwnerCrown } from '@/lib/auth';

/**
 * Treasury Vaults — where pre-issued MIC actually sits, and what can be done with it.
 *
 * Only the Listing Reserve is operable. Founders is driven from its own page, and the
 * DAO Treasury allocation is immobilised: the deployed TreasuryManager knows only USDT,
 * so the 105,000,000 MIC at that address can never be moved by any call. That is stated
 * here rather than hidden, because a balance shown without that caveat reads as budget.
 */

const BSC_CHAIN_ID = 56;
const BSC_RPC = 'https://bsc-dataseed.binance.org/';

const MIC = '0xf27ec0c311728b923b22828002c992c799326182';
const LISTING_RESERVE_VAULT = '0x2EE1b6B7108851BB721cA1c9B8aCEf76e70C8f16';
const FOUNDERS_VAULT = '0x142167334Ad8da6790353dC54c42651F9F416b67';
const TREASURY_MANAGER = '0x1ed5C848D1244a618Bd95Ff92d4f8C2356d3a42F';

/**
 * Addresses that must never receive a vault withdrawal. LiquidityPoolV6 credits its
 * reserve inside seedMic() via transferFrom — a raw transfer lands MIC that the pool
 * cannot account for and cannot return, exactly how 31.5M was lost in v5.
 */
const NEVER_SEND_TO: Record<string, string> = {
  '0x37091454eb49179d3aff12402980f63cfc3e050a': 'LiquidityPool v5 — no withdrawal path, funds would be unrecoverable',
  '0x1ed5c848d1244a618bd95ff92d4f8c2356d3a42f': 'TreasuryManager — cannot move MIC, funds would be frozen',
  '0x0000000000000000000000000000000000000000': 'Zero address',
};

const VAULT_ABI = [
  'function requestWithdraw(address,uint256,string,string) returns (uint256)',
  'function executeWithdraw(uint256)',
  'function cancelWithdraw(uint256)',
  'function nextRequestId() view returns (uint256)',
  'function totalWithdrawn() view returns (uint256)',
  'function vaultBalance() view returns (uint256)',
  'function COOLDOWN() view returns (uint256)',
  'function hasRole(bytes32,address) view returns (bool)',
  'function getRequest(uint256) view returns (tuple(uint256 id,address recipient,uint256 amount,string exchange,string reason,address requester,uint64 createdAt,uint64 cooldownEnd,uint8 status,uint64 executedAt))',
];
const ERC20_ABI = ['function balanceOf(address) view returns (uint256)'];
const ZERO_ROLE = '0x0000000000000000000000000000000000000000000000000000000000000000';

const STATUS = ['PENDING', 'EXECUTED', 'CANCELLED'];

type Req = {
  id: number; recipient: string; amount: bigint; exchange: string; reason: string;
  requester: string; createdAt: number; cooldownEnd: number; status: number;
};

async function findWalletProvider(): Promise<any> {
  if (typeof window === 'undefined') throw new Error('Not in browser');
  const w = window as any;
  if (w.ethereum) return w.ethereum;
  return new Promise((resolve, reject) => {
    let found: any = null;
    const handler = (e: any) => { if (e.detail?.provider && !found) found = e.detail.provider; };
    window.addEventListener('eip6963:announceProvider', handler);
    window.dispatchEvent(new Event('eip6963:requestProvider'));
    setTimeout(() => {
      window.removeEventListener('eip6963:announceProvider', handler);
      found ? resolve(found) : reject(new Error('No wallet detected. Connect MetaMask or Trust Wallet.'));
    }, 500);
  });
}

async function ensureBscMainnet(provider: any) {
  const hex = await provider.request({ method: 'eth_chainId' });
  if (parseInt(hex, 16) === BSC_CHAIN_ID) return;
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

async function vaultWithSigner() {
  const provider = await findWalletProvider();
  await provider.request({ method: 'eth_requestAccounts' });
  await ensureBscMainnet(provider);
  const signer = await new BrowserProvider(provider).getSigner();
  return { contract: new Contract(LISTING_RESERVE_VAULT, VAULT_ABI, signer), signer };
}

const fmt = (v: bigint) => Number(formatUnits(v, 18)).toLocaleString(undefined, { maximumFractionDigits: 0 });

/**
 * A clock that ticks, shared by the countdown column and the Execute button.
 *
 * Both used to read `Date.now()` on their own. The column re-rendered every second and
 * the button did not, so the moment a cooldown expired with the page open the column
 * said "ready to execute" while the button stayed greyed out until someone reloaded.
 * One source of time, one truth.
 */
function useNow() {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

/** `3d 2h 51m 07s`, or `2h 51m` when `compact` — for the button, which is narrow. */
function formatLeft(left: number, compact = false) {
  const d = Math.floor(left / 86400);
  const h = Math.floor((left % 86400) / 3600);
  const m = Math.floor((left % 3600) / 60);
  const s = left % 60;
  if (compact) return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m ${s}s`;
  return `${d}d ${h}h ${m}m ${String(s).padStart(2, '0')}s`;
}

function Countdown({ target, now }: { target: number; now: number }) {
  const left = target - now;
  if (left <= 0) return <span style={{ color: 'var(--success)' }}>ready to execute</span>;
  return <span style={{ fontFamily: 'var(--font-m)' }}>{formatLeft(left)}</span>;
}

export default function TreasuryPage() {
  const { user } = useAuth() as any;
  const isOwner = isOwnerWallet(user?.wallet);

  const now = useNow();
  const [balance, setBalance] = useState<bigint>(0n);
  const [withdrawn, setWithdrawn] = useState<bigint>(0n);
  const [requests, setRequests] = useState<Req[]>([]);
  const [foundersMic, setFoundersMic] = useState<bigint>(0n);
  const [treasuryMic, setTreasuryMic] = useState<bigint>(0n);
  const [lp5Mic, setLp5Mic] = useState<bigint>(0n);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [recipient, setRecipient] = useState(user?.wallet || '');
  const [amount, setAmount] = useState('');
  const [exchange, setExchange] = useState('');
  const [reason, setReason] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new JsonRpcProvider(BSC_RPC);
      const vault = new Contract(LISTING_RESERVE_VAULT, VAULT_ABI, p);
      const mic = new Contract(MIC, ERC20_ABI, p);

      const [bal, tw, n, fv, tm, lp5] = await Promise.all([
        vault.vaultBalance(), vault.totalWithdrawn(), vault.nextRequestId(),
        mic.balanceOf(FOUNDERS_VAULT), mic.balanceOf(TREASURY_MANAGER),
        mic.balanceOf('0x37091454eB49179D3aFF12402980F63cFC3e050a'),
      ]);
      setBalance(bal); setWithdrawn(tw); setFoundersMic(fv); setTreasuryMic(tm); setLp5Mic(lp5);

      const list: Req[] = [];
      for (let i = 1n; i <= n; i++) {
        const r = await vault.getRequest(i);
        list.push({
          id: Number(r.id), recipient: r.recipient, amount: r.amount, exchange: r.exchange,
          reason: r.reason, requester: r.requester, createdAt: Number(r.createdAt),
          cooldownEnd: Number(r.cooldownEnd), status: Number(r.status),
        });
      }
      setRequests(list.reverse());
    } catch (e: any) {
      setMsg({ ok: false, text: e?.message || 'Could not read chain' });
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const danger = NEVER_SEND_TO[recipient.trim().toLowerCase()];
  const amountOk = Number(amount) > 0 && parseUnits(amount || '0', 18) <= balance;
  const addressOk = /^0x[a-fA-F0-9]{40}$/.test(recipient.trim());

  const submitRequest = async () => {
    setBusy('request'); setMsg(null);
    try {
      const { contract } = await vaultWithSigner();
      const tx = await contract.requestWithdraw(
        recipient.trim(), parseUnits(amount, 18), exchange.trim() || 'unspecified', reason.trim() || '',
      );
      await tx.wait(1);
      setMsg({ ok: true, text: `Request submitted — 7-day cooldown started. tx ${tx.hash.slice(0, 12)}…` });
      setAmount(''); setExchange(''); setReason('');
      await load();
    } catch (e: any) {
      setMsg({ ok: false, text: e?.shortMessage || e?.message || 'Transaction failed' });
    }
    setBusy('');
  };

  const act = async (kind: 'execute' | 'cancel', id: number) => {
    setBusy(`${kind}-${id}`); setMsg(null);
    try {
      const { contract } = await vaultWithSigner();
      const tx = kind === 'execute' ? await contract.executeWithdraw(id) : await contract.cancelWithdraw(id);
      await tx.wait(1);
      setMsg({ ok: true, text: `Request #${id} ${kind === 'execute' ? 'executed' : 'cancelled'}. tx ${tx.hash.slice(0, 12)}…` });
      await load();
    } catch (e: any) {
      setMsg({ ok: false, text: e?.shortMessage || e?.message || 'Transaction failed' });
    }
    setBusy('');
  };

  const th: React.CSSProperties = {
    textAlign: 'left', fontFamily: 'var(--font-m)', fontSize: '0.55rem',
    letterSpacing: '.08em', color: 'var(--gray2)', padding: '6px 8px', fontWeight: 400,
  };
  const td: React.CSSProperties = { padding: '9px 8px', fontSize: '0.68rem', verticalAlign: 'top' };

  return (
    <>
      <div className="page-hd">
        <div>
          <div className="page-eyebrow">Business &amp; Finance</div>
          <div className="page-title">Treasury Vaults <OwnerCrown wallet={user?.wallet} /></div>
          <div className="page-sub">Pre-issued MIC held on-chain — balances, withdrawals and timelocks</div>
        </div>
        <button className="btn btn-outline btn-sm" onClick={load} disabled={loading}>↻ Refresh</button>
      </div>

      {msg && (
        <div style={{
          fontSize: '0.68rem', marginBottom: 14, padding: '9px 12px', borderRadius: 5,
          color: msg.ok ? 'var(--success)' : 'var(--error)',
          background: msg.ok ? 'rgba(69,217,160,.1)' : 'rgba(242,109,139,.1)',
        }}>{msg.text}</div>
      )}

      {/* ═══ Listing Reserve — the only operable vault ═══ */}
      <div className="card card-p">
        <div className="card-title">Listing Reserve Vault</div>
        <div style={{ fontSize: '0.62rem', color: 'var(--gray2)', lineHeight: 1.7, marginBottom: 12 }}>
          Holds what remains of the 105,000,000 MIC DEX/CEX Listing allocation. Withdrawals are
          two-step: request, then a <strong>7-day cooldown</strong>, then anyone may execute.
          A pending request can be cancelled at any time before it executes.
          <span style={{ display: 'block', marginTop: 4, fontFamily: 'var(--font-m)', fontSize: '0.58rem' }}>
            {LISTING_RESERVE_VAULT}
          </span>
        </div>

        <div className="g3" style={{ marginBottom: 14 }}>
          <div><div className="info-key">IN VAULT</div><div className="info-val" style={{ fontSize: '1rem' }}>{fmt(balance)} MIC</div></div>
          <div><div className="info-key">WITHDRAWN TO DATE</div><div className="info-val" style={{ fontSize: '1rem' }}>{fmt(withdrawn)} MIC</div></div>
          <div><div className="info-key">BURNED FROM ALLOCATION</div><div className="info-val" style={{ fontSize: '1rem' }}>31,500,000 MIC</div></div>
        </div>

        {/* ── New request ── */}
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14 }}>
          <div style={{ fontFamily: 'var(--font-m)', fontSize: '0.58rem', letterSpacing: '.1em', color: 'var(--gray2)', marginBottom: 8 }}>
            NEW WITHDRAWAL REQUEST
          </div>
          <div className="g2">
            <div className="input-wrap">
              <div className="input-label">Recipient address</div>
              <input value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder="0x…" />
            </div>
            <div className="input-wrap">
              <div className="input-label">Amount (MIC)</div>
              <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="23500000" />
            </div>
            <div className="input-wrap">
              <div className="input-label">Exchange / destination label</div>
              <input value={exchange} onChange={(e) => setExchange(e.target.value)} placeholder="PancakeSwap" />
            </div>
            <div className="input-wrap">
              <div className="input-label">Reason (stored on-chain)</div>
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Seed external MIC/USDT pair" />
            </div>
          </div>

          {/* The one mistake that cannot be undone gets its own warning. */}
          {danger && (
            <div style={{
              fontSize: '0.66rem', padding: '10px 12px', borderRadius: 5, marginBottom: 10,
              background: 'rgba(242,109,139,.14)', color: 'var(--error)',
            }}>
              <strong>Do not send here.</strong> {danger}. MIC sent to this address can never be recovered.
            </div>
          )}
          {!danger && addressOk && (
            <div style={{ fontSize: '0.62rem', color: 'var(--gray2)', marginBottom: 10, lineHeight: 1.6 }}>
              To fund the protocol swap pool, send to the wallet that will run the deploy — never to the
              pool contract itself. The pool credits its reserve inside <span style={{ fontFamily: 'var(--font-m)' }}>seedMic()</span>;
              a raw transfer is not counted and cannot be returned.
            </div>
          )}
          {Number(amount) > 0 && !amountOk && (
            <div style={{ fontSize: '0.66rem', color: 'var(--error)', marginBottom: 10 }}>
              Amount exceeds the vault balance ({fmt(balance)} MIC).
            </div>
          )}

          <button className="btn btn-primary" disabled={!isOwner || !addressOk || !amountOk || !!danger || busy === 'request'}
            onClick={submitRequest}>
            {busy === 'request' ? 'Confirm in wallet…' : 'Submit request'}
          </button>
          {!isOwner && (
            <span style={{ fontSize: '0.62rem', color: 'var(--gray2)', marginLeft: 10 }}>
              Requires the vault admin wallet.
            </span>
          )}
        </div>

        {/* ── Request history ── */}
        <div style={{ borderTop: '1px solid var(--border)', marginTop: 18, paddingTop: 14 }}>
          <div style={{ fontFamily: 'var(--font-m)', fontSize: '0.58rem', letterSpacing: '.1em', color: 'var(--gray2)', marginBottom: 6 }}>
            REQUESTS
          </div>
          {loading && <div style={{ fontSize: '0.68rem', color: 'var(--gray2)' }}>Reading chain…</div>}
          {!loading && requests.length === 0 && (
            <div style={{ fontSize: '0.68rem', color: 'var(--gray2)', padding: '8px 0' }}>No requests yet.</div>
          )}
          {!loading && requests.length > 0 && (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
                <thead><tr>
                  <th style={th}>#</th><th style={th}>AMOUNT</th><th style={th}>RECIPIENT</th>
                  <th style={th}>DESTINATION</th><th style={th}>UNLOCKS IN</th><th style={th}>STATUS</th><th style={th}></th>
                </tr></thead>
                <tbody>
                  {requests.map((r) => {
                    const left = r.cooldownEnd - now;
                    const ready = r.status === 0 && left <= 0;
                    return (
                      <tr key={r.id} style={{ borderTop: '1px solid var(--border)' }}>
                        <td style={{ ...td, fontFamily: 'var(--font-m)' }}>{r.id}</td>
                        <td style={{ ...td, fontFamily: 'var(--font-m)' }}>{fmt(r.amount)}</td>
                        <td style={{ ...td, fontFamily: 'var(--font-m)', fontSize: '0.6rem' }}>
                          <a href={`https://bscscan.com/address/${r.recipient}`} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--gray)' }}>
                            {r.recipient.slice(0, 10)}…{r.recipient.slice(-6)}
                          </a>
                        </td>
                        <td style={td}>
                          <div>{r.exchange}</div>
                          {r.reason && <div style={{ fontSize: '0.58rem', color: 'var(--gray2)', marginTop: 2 }}>{r.reason}</div>}
                        </td>
                        <td style={td}>{r.status === 0 ? <Countdown target={r.cooldownEnd} now={now} /> : '—'}</td>
                        <td style={td}>
                          <span style={{
                            fontFamily: 'var(--font-m)', fontSize: '0.55rem', padding: '3px 8px', borderRadius: 4,
                            background: r.status === 0 ? 'rgba(240,181,74,.14)' : r.status === 1 ? 'rgba(69,217,160,.12)' : 'rgba(150,137,194,.14)',
                            color: r.status === 0 ? 'var(--warning)' : r.status === 1 ? 'var(--success)' : 'var(--gray2)',
                          }}>{STATUS[r.status]}</span>
                        </td>
                        <td style={{ ...td, whiteSpace: 'nowrap' }}>
                          {r.status === 0 && (
                            <div style={{ display: 'flex', gap: 6 }}>
                              {/*
                                A disabled button with the word "Execute" on it looks broken:
                                the contract's 7-day cooldown is invisible from here, so a
                                click that does nothing reads as a bug rather than a rule.
                                The remaining time goes on the button itself.
                              */}
                              <button
                                className="btn btn-primary btn-sm"
                                disabled={!ready || busy === `execute-${r.id}`}
                                title={
                                  ready
                                    ? 'Send the MIC to the recipient now'
                                    : `Locked by the vault's 7-day cooldown until ${new Date(r.cooldownEnd * 1000).toLocaleString()} — ${formatLeft(left)} left. There is no way to shorten it: COOLDOWN is a compile-time constant, so not even the Owner can change it.`
                                }
                                onClick={() => act('execute', r.id)}
                              >
                                {busy === `execute-${r.id}`
                                  ? '…'
                                  : ready
                                    ? 'Execute'
                                    : `🔒 ${formatLeft(left, true)}`}
                              </button>
                              <button className="btn btn-outline btn-sm" disabled={!isOwner || busy === `cancel-${r.id}`}
                                onClick={() => act('cancel', r.id)}>
                                {busy === `cancel-${r.id}` ? '…' : 'Cancel'}
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ═══ Founders ═══ */}
      <div className="card card-p" style={{ marginTop: 16 }}>
        <div className="card-title">Founders Vault</div>
        <div className="info-row">
          <span className="info-key">MIC held</span>
          <span className="info-val">{fmt(foundersMic)} MIC</span>
        </div>
        <div style={{ fontSize: '0.62rem', color: 'var(--gray2)', lineHeight: 1.7, marginTop: 8 }}>
          Distributions run from <strong>Members → Founders Allocation</strong>, not here.
          <span style={{ fontFamily: 'var(--font-m)' }}> distributeFounder()</span> transfers MIC and creates
          the recipient&apos;s LockManager schedule in the same transaction, so the 24-month cliff is
          enforced on-chain rather than by policy.
          <span style={{ display: 'block', marginTop: 4, fontFamily: 'var(--font-m)', fontSize: '0.58rem' }}>{FOUNDERS_VAULT}</span>
        </div>
      </div>

      {/* ═══ Immobilised balances ═══ */}
      <div className="card card-p" style={{ marginTop: 16, borderColor: 'rgba(242,109,139,.35)' }}>
        <div className="card-title" style={{ color: 'var(--error)' }}>Immobilised — no withdrawal path exists</div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}>
            <thead><tr><th style={th}>CONTRACT</th><th style={th}>MIC HELD</th><th style={th}>WHY</th></tr></thead>
            <tbody>
              <tr style={{ borderTop: '1px solid var(--border)' }}>
                <td style={td}>
                  <div>TreasuryManager</div>
                  <div style={{ fontFamily: 'var(--font-m)', fontSize: '0.56rem', color: 'var(--gray2)' }}>{TREASURY_MANAGER}</div>
                </td>
                <td style={{ ...td, fontFamily: 'var(--font-m)' }}>{fmt(treasuryMic)}</td>
                <td style={td}>
                  The deployed contract declares only USDT. All three write functions move USDT, and it
                  holds no code that could ever approve a spender — so this MIC cannot be transferred or
                  burned by any caller. It is not a proxy, so it cannot be upgraded.
                </td>
              </tr>
              <tr style={{ borderTop: '1px solid var(--border)' }}>
                <td style={td}>
                  <div>LiquidityPool v5</div>
                  <div style={{ fontFamily: 'var(--font-m)', fontSize: '0.56rem', color: 'var(--gray2)' }}>0x37091454…3e050a</div>
                </td>
                <td style={{ ...td, fontFamily: 'var(--font-m)' }}>{fmt(lp5Mic)}</td>
                <td style={td}>
                  Had no withdrawal path either, but did expose a burn. Its entire 31,500,000 MIC was
                  destroyed on 5 August 2026, which is why the balance now reads zero.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
