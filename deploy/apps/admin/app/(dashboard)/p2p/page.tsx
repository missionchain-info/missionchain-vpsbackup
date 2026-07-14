'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { BrowserProvider, Contract, parseUnits } from 'ethers';
import { useMcUi } from '@/components/ui/McUi';
import { isOwnerWallet } from '@/lib/auth';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

const BSC_CHAIN_ID = 56;
const BSC_RPC = 'https://bsc-dataseed.binance.org/';

/* ── P2PEscrowMFP Contract ── */
const P2P_ESCROW_MFP = '0xD378AeffD194338E1F5E211D9E14287eC862d3b6';
const P2P_ADMIN_ABI = [
  'function pauseTrading(bool _paused) external',
  'function setFee(uint16 newBps) external',
  'function setCancellationFee(uint256 newUsdt) external',
  'function setFeeRecipient(address newRecipient) external',
  'function feeBps() view returns (uint16)',
  'function paused() view returns (bool)',
  'function cancellationFeeUsdt() view returns (uint256)',
  'function feeRecipient() view returns (address)',
] as const;

const SZ = '0.62rem';

const inputStyle: React.CSSProperties = { padding: '5px 10px', borderRadius: 6, background: 'var(--card-bg)', color: 'var(--white)', border: '1px solid var(--border)', fontSize: SZ, fontFamily: 'var(--font-m)', width: '100%' };
const hintStyle: React.CSSProperties = { fontSize: '0.56rem', color: 'var(--gray2)', marginTop: 3, fontFamily: 'var(--font-m)' };

const fmtN = (n: number) => (!n || isNaN(n)) ? '-' : n.toLocaleString('en-US');
const fmtUsd = (n: number) => (!n || isNaN(n)) ? '-' : '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const truncate = (s: string) => s && s.length > 14 ? s.slice(0, 8) + '...' + s.slice(-4) : s;

function ToggleRow({ on, onToggle, label, hint }: { on: boolean; onToggle: () => void; label: string; hint?: string }) {
  return (
    <div className="toggle-row">
      <div className={`toggle ${on ? 'on' : ''}`} onClick={onToggle} />
      <div>
        <span className="toggle-label">{label}</span>
        {hint && <div style={{ fontSize: '0.56rem', color: 'var(--gray2)', marginTop: 2, fontFamily: 'var(--font-m)' }}>{hint}</div>}
      </div>
    </div>
  );
}

/* ── Wallet helpers (same pattern as payment-requests) ── */
async function findWalletProvider(): Promise<any> {
  if (typeof window === 'undefined') throw new Error('Not in browser');
  const w = window as any;
  if (w.ethereum) return w.ethereum;
  return new Promise((resolve, reject) => {
    let found: any = null;
    const handler = (event: any) => {
      if (event.detail?.provider && !found) found = event.detail.provider;
    };
    window.addEventListener('eip6963:announceProvider', handler);
    window.dispatchEvent(new Event('eip6963:requestProvider'));
    setTimeout(() => {
      window.removeEventListener('eip6963:announceProvider', handler);
      if (found) resolve(found);
      else reject(new Error('No wallet detected. Connect MetaMask or Trust Wallet.'));
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
          chainId: '0x38',
          chainName: 'BSC Mainnet',
          nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 },
          rpcUrls: [BSC_RPC],
          blockExplorerUrls: ['https://bscscan.com'],
        }],
      });
    } else {
      throw e;
    }
  }
}

/* ── Supported Assets (matches user DApp) ── */
const SUPPORTED_ASSETS = [
  { id: 'MIC', label: 'MIC Token', standard: 'BEP-20', icon: '💰' },
  { id: 'MFP', label: 'MFP-NFT', standard: 'ERC-721', icon: '👑' },
  { id: 'BUILDER', label: 'Builder NFT', standard: 'ERC-1155', icon: '🛠️' },
  { id: 'MAKER', label: 'Maker NFT', standard: 'ERC-1155', icon: '⭐' },
  { id: 'LUMINARY', label: 'Luminary NFT', standard: 'ERC-1155', icon: '💎' },
];

export default function P2pAdminPage() {
  const mcUi = useMcUi();

  /* ── State ── */
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState('');

  /* Read wallet from JWT to gate owner-only controls */
  const [userWallet, setUserWallet] = useState<string>('');
  const isSuperAdmin = isOwnerWallet(userWallet);

  useEffect(() => {
    try {
      const t = typeof window !== 'undefined' ? localStorage.getItem('mc-admin-jwt') : null;
      if (!t) return;
      const payload = JSON.parse(atob(t.split('.')[1]));
      setUserWallet(payload.wallet || '');
    } catch {}
  }, []);

  // P2P Status toggles
  const [p2pEnabled, setP2pEnabled] = useState(false);
  const [kycRequired, setKycRequired] = useState(true);

  // Trading Parameters
  const [platformFee, setPlatformFee] = useState('1.5');
  const [feeRecipient, setFeeRecipient] = useState('treasury');
  const [minOrderUsdt, setMinOrderUsdt] = useState('10');
  const [maxOrderUsdt, setMaxOrderUsdt] = useState('50000');
  const [defaultExpiry, setDefaultExpiry] = useState('7');
  const [minExpiry, setMinExpiry] = useState('1');
  const [maxExpiry, setMaxExpiry] = useState('15');
  const [maxOpenOrders, setMaxOpenOrders] = useState('10');
  const [escrowTimeout, setEscrowTimeout] = useState('60');
  const [priceRangePercent, setPriceRangePercent] = useState('30');

  // Asset toggles
  const [assetMIC, setAssetMIC] = useState(true);
  const [assetMFP, setAssetMFP] = useState(true);
  const [assetBuilder, setAssetBuilder] = useState(true);
  const [assetMaker, setAssetMaker] = useState(true);
  const [assetLuminary, setAssetLuminary] = useState(true);

  // On-chain read-back state
  const [chainPaused, setChainPaused] = useState<boolean | null>(null);
  const [chainFeeBps, setChainFeeBps] = useState<number | null>(null);
  const [chainCancelFee, setChainCancelFee] = useState<string | null>(null);
  const [chainFeeRecipient, setChainFeeRecipient] = useState<string | null>(null);
  const [chainLoading, setChainLoading] = useState(false);

  // On-chain controls input state (separate from display)
  const [feeInput, setFeeInput] = useState('1.5');
  const [cancelFeeInput, setCancelFeeInput] = useState('5');
  const [feeRecipientInput, setFeeRecipientInput] = useState('');
  const [contractBusy, setContractBusy] = useState(false);

  // Orders Overview (read-only)
  const [stats] = useState({
    openOrders: 0, completedToday: 0, disputes: 0,
    volume24h: 0, totalVolume: 0, totalTrades: 0,
    escrowBalance: 0, feesCollected: 0,
  });

  /* ── Load on-chain state ── */
  const loadChainState = useCallback(async () => {
    setChainLoading(true);
    try {
      const { JsonRpcProvider } = await import('ethers');
      const provider = new JsonRpcProvider(BSC_RPC);
      const p2p = new Contract(P2P_ESCROW_MFP, P2P_ADMIN_ABI, provider);
      const [paused, feeBps, cancelFee, recipient] = await Promise.all([
        p2p.paused(),
        p2p.feeBps(),
        p2p.cancellationFeeUsdt(),
        p2p.feeRecipient(),
      ]);
      setChainPaused(paused as boolean);
      const bps = Number(feeBps);
      setChainFeeBps(bps);
      setFeeInput((bps / 100).toFixed(2));
      // cancellationFeeUsdt is stored in 6-decimal USDT
      const cancelUsd = Number(cancelFee) / 1_000_000;
      setChainCancelFee(cancelUsd.toFixed(2));
      setCancelFeeInput(cancelUsd.toFixed(2));
      const addr = recipient as string;
      setChainFeeRecipient(addr);
      setFeeRecipientInput(addr);
    } catch (err: any) {
      console.warn('Could not load on-chain P2P state:', err?.message);
    } finally {
      setChainLoading(false);
    }
  }, []);

  useEffect(() => {
    // Load backend config
    setLoading(false);
    // Load on-chain state in parallel
    loadChainState();
  }, [loadChainState]);

  const markDirty = () => setDirty(true);

  const handleSave = async () => {
    setSaving(true);
    setMsg('');
    try {
      const jwt = typeof window !== 'undefined' ? localStorage.getItem('mc-admin-jwt') : null;
      const config = {
        p2pEnabled,
        kycRequired,
        platformFee: parseFloat(platformFee),
        feeRecipient,
        minOrderUsdt: parseFloat(minOrderUsdt),
        maxOrderUsdt: parseFloat(maxOrderUsdt),
        defaultExpiry: parseInt(defaultExpiry),
        minExpiry: parseInt(minExpiry),
        maxExpiry: parseInt(maxExpiry),
        maxOpenOrders: parseInt(maxOpenOrders),
        escrowTimeout: parseInt(escrowTimeout),
        priceRangePercent: parseInt(priceRangePercent),
        supportedAssets: {
          MIC: assetMIC, MFP: assetMFP, BUILDER: assetBuilder,
          MAKER: assetMaker, LUMINARY: assetLuminary,
        },
      };

      // Save p2p_enabled toggle separately (used by user DApp)
      await fetch(`${API_BASE}/admin/system-config/p2p_enabled`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}) },
        body: JSON.stringify({ value: String(p2pEnabled) }),
      });

      // Save full P2P config
      await fetch(`${API_BASE}/admin/system-config/p2p-config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}) },
        body: JSON.stringify({ value: JSON.stringify(config) }),
      });

      setDirty(false);
      setMsg('P2P configuration saved successfully');
      setTimeout(() => setMsg(''), 5000);
    } catch {
      setMsg('Error saving P2P configuration');
    } finally {
      setSaving(false);
    }
  };

  /* ════════════════════════════════════════════════════
     On-chain handlers — wallet-sign via MetaMask
  ════════════════════════════════════════════════════ */

  async function getP2pContract() {
    const provider = await findWalletProvider();
    const accounts = provider.request({ method: 'eth_requestAccounts' });
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('MetaMask did not respond within 60s')), 60_000),
    );
    await Promise.race([accounts, timeout]);
    await ensureBscMainnet(provider);
    const browser = new BrowserProvider(provider);
    const signer = await browser.getSigner();
    return new Contract(P2P_ESCROW_MFP, P2P_ADMIN_ABI, signer);
  }

  const handleTogglePause = async (newPaused: boolean) => {
    if (contractBusy) return;
    setContractBusy(true);
    try {
      mcUi.toast({ type: 'info', message: `Sign pauseTrading(${newPaused}) in wallet...` });
      const p2p = await getP2pContract();
      const tx = await p2p.pauseTrading(newPaused);
      mcUi.toast({ type: 'info', message: 'Waiting for confirmation...' });
      const receipt = await tx.wait(1);
      if (!receipt || receipt.status !== 1) throw new Error('pauseTrading() reverted');
      mcUi.toast({ type: 'success', message: `P2P trading ${newPaused ? 'PAUSED' : 'RESUMED'} on-chain ✓` });
      await loadChainState();
    } catch (err: any) {
      const code = err?.code;
      const msg = code === 4001 || code === 'ACTION_REJECTED'
        ? 'Transaction rejected in wallet'
        : err?.shortMessage || err?.message || 'Unknown error';
      mcUi.toast({ type: 'error', message: 'pauseTrading failed: ' + msg });
    } finally {
      setContractBusy(false);
    }
  };

  const handleSaveFee = async () => {
    const feePct = parseFloat(feeInput);
    if (isNaN(feePct) || feePct < 0.5 || feePct > 10) {
      mcUi.toast({ type: 'error', message: 'Fee must be 0.5% – 10%' });
      return;
    }
    const bps = Math.round(feePct * 100);
    if (contractBusy) return;
    setContractBusy(true);
    try {
      mcUi.toast({ type: 'info', message: `Sign setFee(${bps} bps) in wallet...` });
      const p2p = await getP2pContract();
      const tx = await p2p.setFee(bps);
      mcUi.toast({ type: 'info', message: 'Waiting for confirmation...' });
      const receipt = await tx.wait(1);
      if (!receipt || receipt.status !== 1) throw new Error('setFee() reverted');
      mcUi.toast({ type: 'success', message: `Platform fee updated to ${feePct}% (${bps} bps) ✓` });
      await loadChainState();
    } catch (err: any) {
      const code = err?.code;
      const msg = code === 4001 || code === 'ACTION_REJECTED'
        ? 'Transaction rejected in wallet'
        : err?.shortMessage || err?.message || 'Unknown error';
      mcUi.toast({ type: 'error', message: 'setFee failed: ' + msg });
    } finally {
      setContractBusy(false);
    }
  };

  const handleSaveCancellationFee = async () => {
    const usdt = parseFloat(cancelFeeInput);
    if (isNaN(usdt) || usdt < 0 || usdt > 1000) {
      mcUi.toast({ type: 'error', message: 'Cancellation fee must be $0 – $1000' });
      return;
    }
    if (contractBusy) return;
    setContractBusy(true);
    try {
      mcUi.toast({ type: 'info', message: `Sign setCancellationFee($${usdt}) in wallet...` });
      const p2p = await getP2pContract();
      const tx = await p2p.setCancellationFee(parseUnits(usdt.toFixed(6), 6));
      mcUi.toast({ type: 'info', message: 'Waiting for confirmation...' });
      const receipt = await tx.wait(1);
      if (!receipt || receipt.status !== 1) throw new Error('setCancellationFee() reverted');
      mcUi.toast({ type: 'success', message: `Cancellation fee set to $${usdt} ✓` });
      await loadChainState();
    } catch (err: any) {
      const code = err?.code;
      const msg = code === 4001 || code === 'ACTION_REJECTED'
        ? 'Transaction rejected in wallet'
        : err?.shortMessage || err?.message || 'Unknown error';
      mcUi.toast({ type: 'error', message: 'setCancellationFee failed: ' + msg });
    } finally {
      setContractBusy(false);
    }
  };

  const handleSaveFeeRecipient = async () => {
    const addr = feeRecipientInput.trim();
    if (!/^0x[a-fA-F0-9]{40}$/.test(addr)) {
      mcUi.toast({ type: 'error', message: 'Invalid address format (must be 0x...)' });
      return;
    }
    if (contractBusy) return;
    setContractBusy(true);
    try {
      mcUi.toast({ type: 'info', message: 'Sign setFeeRecipient() in wallet...' });
      const p2p = await getP2pContract();
      const tx = await p2p.setFeeRecipient(addr);
      mcUi.toast({ type: 'info', message: 'Waiting for confirmation...' });
      const receipt = await tx.wait(1);
      if (!receipt || receipt.status !== 1) throw new Error('setFeeRecipient() reverted');
      mcUi.toast({ type: 'success', message: 'Fee recipient updated on-chain ✓' });
      await loadChainState();
    } catch (err: any) {
      const code = err?.code;
      const msg = code === 4001 || code === 'ACTION_REJECTED'
        ? 'Transaction rejected in wallet'
        : err?.shortMessage || err?.message || 'Unknown error';
      mcUi.toast({ type: 'error', message: 'setFeeRecipient failed: ' + msg });
    } finally {
      setContractBusy(false);
    }
  };

  return (
    <>
      {/* ═══ PAGE HEADER ═══ */}
      <div className="page-hd">
        <div>
          <div className="page-eyebrow">Business &amp; Finance</div>
          <div className="page-title">P2P Exchange</div>
          <div className="page-sub">Escrow-based peer-to-peer trading for MIC &amp; NFTs</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          {dirty && (
            <button className="btn btn-outline btn-sm" style={{ fontSize: SZ, fontFamily: 'var(--font-m)', padding: '5px 12px' }} onClick={() => { setDirty(false); setMsg(''); }}>
              RESET
            </button>
          )}
          <button className="btn btn-outline btn-sm" style={{ fontSize: SZ, fontFamily: 'var(--font-m)', padding: '5px 12px' }} onClick={handleSave} disabled={!dirty || saving}>
            {saving ? 'Saving...' : 'SAVE CHANGES'}
          </button>
        </div>
      </div>

      {/* STATUS ALERT */}
      {!p2pEnabled ? (
        <div className="alert alert-warn" style={{ marginBottom: 16 }}>
          {'⚠️'} P2P Exchange is currently <strong>INACTIVE</strong>. Enable it to allow members to trade MIC and NFTs directly through on-chain escrow.
        </div>
      ) : (
        <div className="alert alert-ok" style={{ marginBottom: 16 }}>
          {'✅'} P2P Exchange is <strong>ACTIVE</strong>. Members can create and match orders. All trades settled via P2PEscrowMFP.
        </div>
      )}

      {/* Save message */}
      {msg && (
        <div style={{
          padding: '8px 14px', marginBottom: 12, borderRadius: 8, fontSize: SZ, fontWeight: 600, fontFamily: 'var(--font-m)',
          background: msg.includes('Error') ? 'rgba(255,80,80,.15)' : 'rgba(80,200,120,.15)',
          color: msg.includes('Error') ? '#ff5050' : '#50c878',
        }}>{msg}</div>
      )}

      {/* ═══ P2P STATUS ═══ */}
      <div className="sep-lbl">P2P Status</div>
      <div className="card" style={{ padding: 22, marginBottom: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <ToggleRow
            on={p2pEnabled}
            onToggle={() => { setP2pEnabled(!p2pEnabled); markDirty(); }}
            label="Enable P2P Exchange (UI / API)"
            hint="When enabled, P2P section is visible to users and orders can be created"
          />
          <ToggleRow
            on={kycRequired}
            onToggle={() => { setKycRequired(!kycRequired); markDirty(); }}
            label="Require KYC to Trade"
            hint="Only KYC-verified members can create or match orders (recommended for AML compliance)"
          />
        </div>
      </div>

      {/* ═══ ON-CHAIN CONTRACT CONTROLS (owner wallet only) ═══ */}
      {isSuperAdmin && (
        <>
          <div className="sep-lbl">On-Chain Contract Controls</div>
          <div className="card" style={{ padding: 22, marginBottom: 16 }}>
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: SZ, fontWeight: 700, color: 'var(--gold)', fontFamily: 'var(--font-d)', letterSpacing: '0.06em', marginBottom: 4 }}>
                P2PESCROWMFP — {P2P_ESCROW_MFP}
              </div>
              <div style={{ fontSize: '0.56rem', color: 'var(--gray2)', fontFamily: 'var(--font-m)', fontStyle: 'italic' }}>
                Each action signs 1 on-chain tx. Owner wallet only. State auto-refreshes after each tx.
              </div>
            </div>

            {/* Chain state summary */}
            {chainLoading ? (
              <div style={{ fontSize: SZ, color: 'var(--gray2)', marginBottom: 14 }}>Loading on-chain state...</div>
            ) : (
              <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginBottom: 18, padding: '10px 14px', background: 'var(--bg3)', borderRadius: 8 }}>
                <div>
                  <div style={{ fontSize: '0.55rem', color: 'var(--gray2)', fontFamily: 'var(--font-m)', marginBottom: 2 }}>CONTRACT PAUSED</div>
                  <div style={{ fontSize: SZ, fontWeight: 700, color: chainPaused ? '#ff5050' : '#50c878', fontFamily: 'var(--font-m)' }}>
                    {chainPaused === null ? '—' : chainPaused ? 'YES' : 'NO'}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: '0.55rem', color: 'var(--gray2)', fontFamily: 'var(--font-m)', marginBottom: 2 }}>PLATFORM FEE</div>
                  <div style={{ fontSize: SZ, fontWeight: 700, color: 'var(--gold)', fontFamily: 'var(--font-m)' }}>
                    {chainFeeBps === null ? '—' : `${(chainFeeBps / 100).toFixed(2)}% (${chainFeeBps} bps)`}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: '0.55rem', color: 'var(--gray2)', fontFamily: 'var(--font-m)', marginBottom: 2 }}>CANCELLATION FEE</div>
                  <div style={{ fontSize: SZ, fontWeight: 700, color: 'var(--white)', fontFamily: 'var(--font-m)' }}>
                    {chainCancelFee === null ? '—' : `$${chainCancelFee}`}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: '0.55rem', color: 'var(--gray2)', fontFamily: 'var(--font-m)', marginBottom: 2 }}>FEE RECIPIENT</div>
                  <div style={{ fontSize: SZ, fontWeight: 700, color: 'var(--white)', fontFamily: 'var(--font-m)' }}>
                    {chainFeeRecipient === null ? '—' : truncate(chainFeeRecipient)}
                  </div>
                </div>
                <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center' }}>
                  <button
                    onClick={loadChainState}
                    disabled={chainLoading || contractBusy}
                    style={{ padding: '4px 10px', fontSize: '0.56rem', fontFamily: 'var(--font-d)', background: 'transparent', color: 'var(--gold)', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer' }}>
                    {'↻'} Refresh
                  </button>
                </div>
              </div>
            )}

            {/* Pause Toggle */}
            <div style={{ marginBottom: 18 }}>
              <div className="input-label" style={{ marginBottom: 8 }}>Emergency Pause</div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  onClick={() => handleTogglePause(false)}
                  disabled={contractBusy || chainPaused === false}
                  style={{
                    padding: '7px 18px', fontSize: SZ, fontFamily: 'var(--font-d)',
                    background: chainPaused === false ? 'rgba(80,200,120,.08)' : 'transparent',
                    color: '#50c878', border: `1px solid ${chainPaused === false ? '#50c878' : 'var(--border)'}`,
                    borderRadius: 6, cursor: contractBusy || chainPaused === false ? 'default' : 'pointer',
                    fontWeight: 700, opacity: contractBusy ? 0.6 : 1,
                  }}>
                  {'▶'} RESUME Trading
                </button>
                <button
                  onClick={() => handleTogglePause(true)}
                  disabled={contractBusy || chainPaused === true}
                  style={{
                    padding: '7px 18px', fontSize: SZ, fontFamily: 'var(--font-d)',
                    background: chainPaused === true ? 'rgba(255,80,80,.08)' : 'transparent',
                    color: '#ff5050', border: `1px solid ${chainPaused === true ? '#ff5050' : 'var(--border)'}`,
                    borderRadius: 6, cursor: contractBusy || chainPaused === true ? 'default' : 'pointer',
                    fontWeight: 700, opacity: contractBusy ? 0.6 : 1,
                  }}>
                  {'⏸'} PAUSE Trading
                </button>
              </div>
              <div style={hintStyle}>Calls <code>pauseTrading(bool)</code> on P2PEscrowMFP. Active orders unaffected; new orders/fills blocked while paused.</div>
            </div>

            {/* Fee % */}
            <div className="g3" style={{ marginBottom: 18 }}>
              <div>
                <div className="input-label" style={{ marginBottom: 6 }}>Platform Fee (%)</div>
                <input
                  type="number"
                  step="0.01"
                  min="0.5"
                  max="10"
                  value={feeInput}
                  onChange={e => setFeeInput(e.target.value)}
                  style={inputStyle}
                />
                <div style={hintStyle}>0.5% – 10%. Converted to BPS ({Math.round(parseFloat(feeInput || '0') * 100)} bps).</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: 1 }}>
                <button
                  onClick={handleSaveFee}
                  disabled={contractBusy}
                  style={{
                    padding: '7px 18px', fontSize: SZ, fontFamily: 'var(--font-d)',
                    background: 'var(--gold)', color: '#000', border: 'none',
                    borderRadius: 6, cursor: contractBusy ? 'wait' : 'pointer',
                    fontWeight: 700, opacity: contractBusy ? 0.6 : 1,
                  }}>
                  {contractBusy ? '...' : 'SET FEE'}
                </button>
              </div>
            </div>

            {/* Cancellation Fee */}
            <div className="g3" style={{ marginBottom: 18 }}>
              <div>
                <div className="input-label" style={{ marginBottom: 6 }}>Cancellation Fee (USDT)</div>
                <input
                  type="number"
                  step="0.5"
                  min="0"
                  max="1000"
                  value={cancelFeeInput}
                  onChange={e => setCancelFeeInput(e.target.value)}
                  style={inputStyle}
                />
                <div style={hintStyle}>Flat fee in USDT charged when seller cancels an active order. $0 – $1000.</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: 1 }}>
                <button
                  onClick={handleSaveCancellationFee}
                  disabled={contractBusy}
                  style={{
                    padding: '7px 18px', fontSize: SZ, fontFamily: 'var(--font-d)',
                    background: 'var(--gold)', color: '#000', border: 'none',
                    borderRadius: 6, cursor: contractBusy ? 'wait' : 'pointer',
                    fontWeight: 700, opacity: contractBusy ? 0.6 : 1,
                  }}>
                  {contractBusy ? '...' : 'SET FEE'}
                </button>
              </div>
            </div>

            {/* Fee Recipient */}
            <div>
              <div className="input-label" style={{ marginBottom: 6 }}>Fee Recipient Address</div>
              <div style={{ display: 'flex', gap: 10 }}>
                <input
                  type="text"
                  value={feeRecipientInput}
                  onChange={e => setFeeRecipientInput(e.target.value)}
                  placeholder="0x..."
                  style={{ ...inputStyle, flex: 1 }}
                />
                <button
                  onClick={handleSaveFeeRecipient}
                  disabled={contractBusy}
                  style={{
                    padding: '7px 18px', fontSize: SZ, fontFamily: 'var(--font-d)', whiteSpace: 'nowrap',
                    background: 'var(--gold)', color: '#000', border: 'none',
                    borderRadius: 6, cursor: contractBusy ? 'wait' : 'pointer',
                    fontWeight: 700, opacity: contractBusy ? 0.6 : 1,
                    flexShrink: 0,
                  }}>
                  {contractBusy ? '...' : 'SET RECIPIENT'}
                </button>
              </div>
              <div style={hintStyle}>Address that receives platform fees from P2P trades. Typically TreasuryManager.</div>
            </div>
          </div>
        </>
      )}

      {/* ═══ FEE CONFIGURATION ═══ */}
      <div className="sep-lbl">Fee Configuration (UI)</div>
      <div className="g2" style={{ marginBottom: 16 }}>
        <div className="card" style={{ padding: 22 }}>
          <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <span style={{ fontSize: '1.1rem' }}>{'💸'}</span> Platform Fee
          </div>
          <div className="callout" style={{ marginBottom: 14 }}>
            Fee is deducted from USDT at settlement. Seller receives (Total USDT - Fee). Use On-Chain Contract Controls above to update the contract value.
          </div>
          <div style={{ marginBottom: 12 }}>
            <div className="input-label" style={{ marginBottom: 6 }}>Display Fee Rate (%)</div>
            <input
              type="number"
              step="0.1"
              min="0"
              max="10"
              value={platformFee}
              onChange={e => { setPlatformFee(e.target.value); markDirty(); }}
              style={inputStyle}
            />
            <div style={hintStyle}>
              Recommended: 1% – 2%. Current: <strong style={{ color: 'var(--gold)' }}>{platformFee}%</strong>
            </div>
          </div>
          <div style={{ background: 'var(--bg3)', borderRadius: 8, padding: '10px 14px' }}>
            <div className="info-row">
              <span className="info-key">Example: $1,000 trade</span>
              <span className="info-val" style={{ fontFamily: 'var(--font-m)', color: 'var(--gold)' }}>
                Fee: {((parseFloat(platformFee) || 0) > 0 ? '$' + (1000 * parseFloat(platformFee) / 100).toFixed(2) : '-')}
              </span>
            </div>
          </div>
        </div>

        <div className="card" style={{ padding: 22 }}>
          <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <span style={{ fontSize: '1.1rem' }}>{'🏦'}</span> Fee Destination
          </div>
          <div className="callout" style={{ marginBottom: 14 }}>
            All collected fees flow to TreasuryManager.sol (DAO Treasury). The DAO governs how these funds are used.
          </div>
          <div className="info-row"><span className="info-key">Recipient</span><span className="info-val"><span className="badge b-ok">TreasuryManager</span></span></div>
          <div className="info-row"><span className="info-key">Contract</span><span className="info-val" style={{ fontFamily: 'var(--font-m)', fontSize: '0.56rem' }}>TreasuryManager.sol</span></div>
          <div className="info-row"><span className="info-key">Governance</span><span className="info-val">DAO Controlled</span></div>
          <div className="info-row"><span className="info-key">Settlement</span><span className="info-val">Atomic (single tx)</span></div>
        </div>
      </div>

      {/* ═══ TRADING PARAMETERS ═══ */}
      <div className="sep-lbl">Trading Parameters</div>
      <div className="card" style={{ padding: 22, marginBottom: 16 }}>
        <div className="g3" style={{ marginBottom: 16 }}>
          <div>
            <div className="input-label" style={{ marginBottom: 6 }}>Min Order (USDT)</div>
            <input
              type="text"
              value={minOrderUsdt ? Number(minOrderUsdt).toLocaleString() : ''}
              onChange={e => { setMinOrderUsdt(e.target.value.replace(/,/g, '')); markDirty(); }}
              style={inputStyle}
            />
            <div style={hintStyle}>Minimum value per trade</div>
          </div>
          <div>
            <div className="input-label" style={{ marginBottom: 6 }}>Max Order (USDT)</div>
            <input
              type="text"
              value={maxOrderUsdt ? Number(maxOrderUsdt).toLocaleString() : ''}
              onChange={e => { setMaxOrderUsdt(e.target.value.replace(/,/g, '')); markDirty(); }}
              style={inputStyle}
            />
            <div style={hintStyle}>Maximum value per trade</div>
          </div>
          <div>
            <div className="input-label" style={{ marginBottom: 6 }}>Max Open Orders / User</div>
            <input
              type="number"
              value={maxOpenOrders}
              onChange={e => { setMaxOpenOrders(e.target.value); markDirty(); }}
              style={inputStyle}
            />
            <div style={hintStyle}>Prevent order spam</div>
          </div>
        </div>

        <div className="g3" style={{ marginBottom: 16 }}>
          <div>
            <div className="input-label" style={{ marginBottom: 6 }}>Default Expiry (days)</div>
            <input
              type="number"
              value={defaultExpiry}
              onChange={e => { setDefaultExpiry(e.target.value); markDirty(); }}
              style={inputStyle}
            />
            <div style={hintStyle}>Pre-selected for users</div>
          </div>
          <div>
            <div className="input-label" style={{ marginBottom: 6 }}>Min Expiry (days)</div>
            <input
              type="number"
              value={minExpiry}
              onChange={e => { setMinExpiry(e.target.value); markDirty(); }}
              style={inputStyle}
            />
            <div style={hintStyle}>Shortest allowed order</div>
          </div>
          <div>
            <div className="input-label" style={{ marginBottom: 6 }}>Max Expiry (days)</div>
            <input
              type="number"
              value={maxExpiry}
              onChange={e => { setMaxExpiry(e.target.value); markDirty(); }}
              style={inputStyle}
            />
            <div style={hintStyle}>Longest allowed order</div>
          </div>
        </div>

        <div className="g2">
          <div>
            <div className="input-label" style={{ marginBottom: 6 }}>Escrow Timeout (minutes)</div>
            <input
              type="number"
              value={escrowTimeout}
              onChange={e => { setEscrowTimeout(e.target.value); markDirty(); }}
              style={inputStyle}
            />
            <div style={hintStyle}>Time for buyer to complete payment after matching</div>
          </div>
          <div>
            <div className="input-label" style={{ marginBottom: 6 }}>Price Range (% from Pool Price)</div>
            <input
              type="number"
              value={priceRangePercent}
              onChange={e => { setPriceRangePercent(e.target.value); markDirty(); }}
              style={inputStyle}
            />
            <div style={hintStyle}>Max deviation from oracle price ({'±'}{priceRangePercent}%)</div>
          </div>
        </div>
      </div>

      {/* ═══ SUPPORTED ASSETS ═══ */}
      <div className="sep-lbl">Supported Assets</div>
      <div className="card" style={{ padding: 22, marginBottom: 16 }}>
        <div className="callout" style={{ marginBottom: 16 }}>
          Enable or disable specific asset types for P2P trading. Disabled assets will be hidden from the user interface. All settlements go through P2PEscrowMFP.
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
          {[
            { ...SUPPORTED_ASSETS[0], on: assetMIC, set: setAssetMIC },
            { ...SUPPORTED_ASSETS[1], on: assetMFP, set: setAssetMFP },
            { ...SUPPORTED_ASSETS[2], on: assetBuilder, set: setAssetBuilder },
            { ...SUPPORTED_ASSETS[3], on: assetMaker, set: setAssetMaker },
            { ...SUPPORTED_ASSETS[4], on: assetLuminary, set: setAssetLuminary },
          ].map(asset => (
            <div
              key={asset.id}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                background: asset.on ? 'rgba(80,200,120,.06)' : 'var(--bg3)',
                border: `1px solid ${asset.on ? 'rgba(80,200,120,.15)' : 'var(--border)'}`,
                borderRadius: 10, padding: '10px 14px', cursor: 'pointer',
                transition: 'all .2s',
              }}
              onClick={() => { asset.set(!asset.on); markDirty(); }}
            >
              <div className={`toggle ${asset.on ? 'on' : ''}`} style={{ flexShrink: 0 }} />
              <div>
                <div style={{ fontSize: SZ, fontWeight: 700, fontFamily: 'var(--font-d)', color: asset.on ? 'var(--white)' : 'var(--gray2)' }}>
                  {asset.icon} {asset.label}
                </div>
                <div style={{ fontSize: '0.52rem', color: 'var(--gray2)', fontFamily: 'var(--font-m)' }}>{asset.standard}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ═══ ESCROW ARCHITECTURE ═══ */}
      <div className="sep-lbl">Escrow Architecture</div>
      <div className="g2" style={{ marginBottom: 16 }}>
        <div className="card" style={{ padding: 22 }}>
          <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <span style={{ fontSize: '1.1rem' }}>{'🔒'}</span> Settlement Flow
          </div>
          <div className="info-row"><span className="info-key">Contract</span><span className="info-val" style={{ fontFamily: 'var(--font-m)', fontSize: '0.56rem' }}>P2PEscrowMFP.sol</span></div>
          <div className="info-row"><span className="info-key">Settlement</span><span className="info-val">Atomic (1 transaction)</span></div>
          <div className="info-row"><span className="info-key">Partial Fill</span><span className="info-val"><span className="badge b-ok">Enabled</span></span></div>
          <div className="info-row"><span className="info-key">Auto-refund</span><span className="info-val">On expiry / cancel</span></div>
          <div className="info-row"><span className="info-key">Safety</span><span className="info-val">ReentrancyGuard + Pausable</span></div>
          <div style={{ marginTop: 12, padding: '10px 12px', background: 'var(--bg3)', borderRadius: 8, fontSize: '0.56rem', color: 'var(--gray)', lineHeight: 1.7, fontFamily: 'var(--font-m)' }}>
            Seller {'→'} Deposit Asset {'→'} Escrow<br/>
            Buyer  {'→'} Send USDT   {'→'} Escrow<br/>
            Escrow {'→'} Asset {'→'} Buyer<br/>
            Escrow {'→'} USDT (- fee) {'→'} Seller<br/>
            Escrow {'→'} Fee {'→'} feeRecipient
          </div>
        </div>

        <div className="card" style={{ padding: 22 }}>
          <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <span style={{ fontSize: '1.1rem' }}>{'⚠️'}</span> Safety Rules
          </div>
          <div className="info-row"><span className="info-key">Locked MIC</span><span className="info-val" style={{ color: '#ff5050' }}>Cannot sell (vesting)</span></div>
          <div className="info-row"><span className="info-key">Expired NFT</span><span className="info-val" style={{ color: '#ff5050' }}>Cannot list</span></div>
          <div className="info-row"><span className="info-key">Staked MFP</span><span className="info-val" style={{ color: '#ff5050' }}>Must unstake first</span></div>
          <div className="info-row"><span className="info-key">KYC Check</span><span className="info-val">{kycRequired ? <span className="badge b-ok">Required</span> : <span className="badge b-gray">Optional</span>}</span></div>
          <div className="info-row"><span className="info-key">Emergency</span><span className="info-val">Admin can pause contract</span></div>
          <div className="callout" style={{ marginTop: 12 }}>
            <strong>Asset validation:</strong> Contract checks lockedOf() for MIC, isActive() for Community NFTs, and staking status for MFP before allowing listing.
          </div>
        </div>
      </div>

      {/* ═══ ORDERS OVERVIEW ═══ */}
      <div className="sep-lbl">Orders Overview</div>
      <div className="g4" style={{ marginBottom: 16 }}>
        <div className="stat-box">
          <div className="stat-lbl">Open Orders</div>
          <div className="stat-val">{fmtN(stats.openOrders)}</div>
        </div>
        <div className="stat-box">
          <div className="stat-lbl">Completed Today</div>
          <div className="stat-val" style={{ color: 'var(--green2)' }}>{fmtN(stats.completedToday)}</div>
        </div>
        <div className="stat-box">
          <div className="stat-lbl">Volume (24h)</div>
          <div className="stat-val gold">{stats.volume24h > 0 ? fmtUsd(stats.volume24h) : '-'}</div>
        </div>
        <div className="stat-box">
          <div className="stat-lbl">Fees Collected</div>
          <div className="stat-val gold">{stats.feesCollected > 0 ? fmtUsd(stats.feesCollected) : '-'}</div>
        </div>
      </div>

      <div className="g3" style={{ marginBottom: 16 }}>
        <div className="stat-box">
          <div className="stat-lbl">Total Trades</div>
          <div className="stat-val">{fmtN(stats.totalTrades)}</div>
        </div>
        <div className="stat-box">
          <div className="stat-lbl">Total Volume</div>
          <div className="stat-val gold">{stats.totalVolume > 0 ? fmtUsd(stats.totalVolume) : '-'}</div>
        </div>
        <div className="stat-box">
          <div className="stat-lbl">Disputes</div>
          <div className="stat-val" style={{ color: stats.disputes > 0 ? '#ff5050' : undefined }}>
            {fmtN(stats.disputes)}
          </div>
        </div>
      </div>

      {/* ═══ ESCROW BALANCE ═══ */}
      <div className="sep-lbl">Escrow Contract Balance</div>
      <div className="card" style={{ padding: 22, marginBottom: 16 }}>
        <div className="callout" style={{ marginBottom: 12 }}>
          Assets currently held in escrow awaiting settlement. These are locked by open orders and will be released on fill, cancel, or expiry.
        </div>
        <div className="g2">
          <div>
            <div className="info-row"><span className="info-key">MIC in Escrow</span><span className="info-val" style={{ fontFamily: 'var(--font-m)' }}>{'-'}</span></div>
            <div className="info-row"><span className="info-key">USDT in Escrow</span><span className="info-val" style={{ fontFamily: 'var(--font-m)' }}>{'-'}</span></div>
          </div>
          <div>
            <div className="info-row"><span className="info-key">MFP-NFTs in Escrow</span><span className="info-val" style={{ fontFamily: 'var(--font-m)' }}>{'-'}</span></div>
            <div className="info-row"><span className="info-key">Community NFTs in Escrow</span><span className="info-val" style={{ fontFamily: 'var(--font-m)' }}>{'-'}</span></div>
          </div>
        </div>
      </div>
    </>
  );
}
