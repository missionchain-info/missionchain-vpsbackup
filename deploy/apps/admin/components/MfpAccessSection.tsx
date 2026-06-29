'use client';

import { useEffect, useState, useCallback } from 'react';
import { JsonRpcProvider, Contract, BrowserProvider } from 'ethers';
import {
  fetchMfpStats,
  fetchMfpRecipients,
  fetchMfpRoyalty,
  setMfpRoyaltyReceiver,
  recordMfpGrant,
} from '@/lib/api';
import { getActiveChain, getActiveAddresses } from '@missionchain/sdk';

// Network-aware addresses (testnet: v4 redeploy 2026-04-29 • mainnet: Phase 0 Genesis 2026-05-06)
const ACTIVE_CHAIN = getActiveChain();
const ACTIVE_ADDR = getActiveAddresses();
const MFPNFT_ADDRESS = ACTIVE_ADDR.MFPNFT;
const MFPNFT_VIEW_ABI = [
  'function totalMinted() view returns (uint256)',
  'function totalGranted() view returns (uint256)',
  'function maxSupply() view returns (uint256)',
  'function mintAllowance(address) view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
] as const;
const MFPNFT_WRITE_ABI = [
  'function grantMintAllowance(address to, uint256 amount)',
  'function setRoyaltyReceiver(address newReceiver)',
] as const;

// Find an injected wallet provider (MetaMask / Trust Wallet / EIP-6963)
async function findWalletProvider(): Promise<any> {
  if (typeof window === 'undefined') throw new Error('Not in browser');
  const w = window as any;
  if (w.ethereum) return w.ethereum;
  // EIP-6963 announce wait (500ms)
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
      else reject(new Error('No wallet detected. Please connect MetaMask or Trust Wallet.'));
    }, 500);
  });
}

// Switch wallet to active BSC chain (or add it if missing) before signing.
async function ensureBscChain(provider: any) {
  const chainHex = await provider.request({ method: 'eth_chainId' });
  if (parseInt(chainHex, 16) === ACTIVE_CHAIN.chainId) return;
  try {
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: ACTIVE_CHAIN.chainIdHex }],
    });
  } catch (e: any) {
    if (e.code === 4902) {
      await provider.request({
        method: 'wallet_addEthereumChain',
        params: [{
          chainId: ACTIVE_CHAIN.chainIdHex,
          chainName: ACTIVE_CHAIN.name,
          nativeCurrency: ACTIVE_CHAIN.nativeCurrency,
          rpcUrls: ACTIVE_CHAIN.rpcUrls,
          blockExplorerUrls: [ACTIVE_CHAIN.explorerUrl],
        }],
      });
    } else {
      throw e;
    }
  }
}

interface MfpStats {
  maxSupply: number;
  granted: number;
  minted: number;
  availablePool: number;
  remainingMintable: number;
  uniqueRecipients: number;
}

interface MfpRecipient {
  wallet: string;
  granted: number;
  minted: number;
  remaining: number;
  latestSource: number;
  latestGrantAt: string;
  onchainBalance?: number;
}

const SZ = '0.62rem';

const thSt = {
  padding: '8px 10px',
  textAlign: 'left' as const,
  color: 'var(--gray)',
  fontWeight: 600,
  fontSize: '0.58rem',
  fontFamily: 'var(--font-d)',
  letterSpacing: '0.08em',
  textTransform: 'uppercase' as const,
};

const tdSt = {
  padding: '10px',
  fontFamily: 'var(--font-m)',
  fontSize: SZ,
  color: 'var(--white)',
};

const shortWallet = (w: string) =>
  w.length > 12 ? `${w.slice(0, 6)}...${w.slice(-4)}` : w;

const sourceLabel = (s: number) => (s === 0 ? 'SEED' : 'OWNER');

const Stat = ({ label, value, color }: { label: string; value: number | string; color?: string }) => (
  <div className="stat-box" style={{ flex: 1 }}>
    <div className="stat-lbl">{label}</div>
    <div className="stat-val" style={{ color: color || 'var(--gold)' }}>
      {typeof value === 'number' ? value.toLocaleString() : value}
    </div>
  </div>
);

export default function MfpAccessSection({
  existingWallets,
  showToast,
}: {
  existingWallets: Array<{ wallet: string; userId: string; role?: string }>;
  showToast: (msg: string) => void;
}) {
  // Gate: only render section if caller passes top-tier identity check.
  // Generic field access — no UI text reveals tier semantics.
  const [accessGranted, setAccessGranted] = useState<boolean | null>(null);
  useEffect(() => {
    const jwt = typeof window !== 'undefined' ? localStorage.getItem('mc-admin-jwt') : null;
    if (!jwt) { setAccessGranted(false); return; }
    fetch(`${process.env.NEXT_PUBLIC_API_URL || 'https://api.missionchain.io'}/admin/me`, {
      headers: { Authorization: `Bearer ${jwt}` },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setAccessGranted(!!data?.isOwner))
      .catch(() => setAccessGranted(false));
  }, []);

  const [stats, setStats] = useState<MfpStats | null>(null);
  const [recipients, setRecipients] = useState<MfpRecipient[]>([]);
  const [royalty, setRoyalty] = useState<{ receiver: string | null; bps: number } | null>(null);
  const [loading, setLoading] = useState(true);

  // Royalty edit
  const [showRoyaltyEdit, setShowRoyaltyEdit] = useState(false);
  const [royaltyInput, setRoyaltyInput] = useState('');
  const [royaltyTxHash, setRoyaltyTxHash] = useState('');
  const [royaltySaving, setRoyaltySaving] = useState(false);

  // Grant form
  const [grantWallet, setGrantWallet] = useState('');
  const [grantWalletMode, setGrantWalletMode] = useState<'dropdown' | 'manual'>('dropdown');
  const [grantAmount, setGrantAmount] = useState('');
  const [grantNote, setGrantNote] = useState('');
  const [grantTxHash, setGrantTxHash] = useState('');
  const [granting, setGranting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, r, ro] = await Promise.all([
        fetchMfpStats().catch(() => null),
        fetchMfpRecipients().catch(() => null),
        fetchMfpRoyalty().catch(() => null),
      ]);

      // ── On-chain fallback for granted/minted (DB indexer can lag) ──
      let onchainGranted = 0;
      let onchainMinted = 0;
      let onchainMaxSupply = 2500;
      const provider = new JsonRpcProvider(ACTIVE_CHAIN.rpcUrls[0]);
      const contract = new Contract(MFPNFT_ADDRESS, MFPNFT_VIEW_ABI, provider);
      try {
        const [g, m, c] = await Promise.all([
          contract.totalGranted().catch(() => 0n),
          contract.totalMinted().catch(() => 0n),
          contract.maxSupply().catch(() => 2500n),
        ]);
        onchainGranted = Number(g);
        onchainMinted = Number(m);
        onchainMaxSupply = Number(c);
      } catch (chainErr) {
        console.warn('[MFP] on-chain read failed, falling back to DB stats only', chainErr);
      }

      // Prefer on-chain numbers when they exceed DB (indexer lag scenario)
      const dbGranted = s?.granted ?? 0;
      const dbMinted = s?.minted ?? 0;
      const finalGranted = Math.max(dbGranted, onchainGranted);
      const finalMinted = Math.max(dbMinted, onchainMinted);
      setStats({
        maxSupply: s?.maxSupply ?? onchainMaxSupply,
        granted: finalGranted,
        minted: finalMinted,
        availablePool: onchainMaxSupply - finalGranted,
        remainingMintable: finalGranted - finalMinted,
        uniqueRecipients: s?.uniqueRecipients ?? 0,
      });

      // ── Per-recipient on-chain authoritative pending + minted ──
      // Source of truth: mintAllowance (cumulative grants) + mintedCount (cumulative mints).
      // mintAllowance is NEVER decremented when mint() is called — only mintedCount increases.
      // So the only correct formula for "remaining mintable" is: mintAllowance - mintedCount.
      if (r?.data) {
        const enriched = await Promise.all(
          r.data.map(async (rec: MfpRecipient) => {
            try {
              const [allowance, mintedOnChain, bal] = await Promise.all([
                contract.mintAllowance(rec.wallet).catch(() => null),
                contract.mintedCount(rec.wallet).catch(() => null),
                contract.balanceOf(rec.wallet).catch(() => null),
              ]);
              if (allowance === null || mintedOnChain === null) return rec;
              const onchainAllowance = Number(allowance);
              const onchainMinted = Number(mintedOnChain);
              const onchainBalance = bal === null ? undefined : Number(bal);
              const remainingMintable = Math.max(0, onchainAllowance - onchainMinted);
              return {
                ...rec,
                minted: onchainMinted,
                remaining: remainingMintable,
                onchainBalance,
              };
            } catch {
              return rec;
            }
          })
        );
        setRecipients(enriched);
      }
      if (ro) setRoyalty({ receiver: ro.royaltyReceiver, bps: ro.royaltyBps });
    } catch (e: any) {
      console.error('MFP section load failed', e);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleSaveRoyalty = async () => {
    if (!/^0x[a-fA-F0-9]{40}$/.test(royaltyInput)) {
      showToast('Invalid wallet address');
      return;
    }
    setRoyaltySaving(true);
    try {
      await setMfpRoyaltyReceiver(royaltyInput, royaltyTxHash || undefined);
      showToast('Royalty receiver updated');
      setShowRoyaltyEdit(false);
      setRoyaltyInput('');
      setRoyaltyTxHash('');
      load();
    } catch (e: any) {
      showToast('Error: ' + (e.message || 'Failed'));
    }
    setRoyaltySaving(false);
  };

  const [grantStep, setGrantStep] = useState<'idle' | 'wallet' | 'mining' | 'saving'>('idle');

  const handleGrant = async () => {
    if (!/^0x[a-fA-F0-9]{40}$/.test(grantWallet)) {
      showToast('Invalid wallet address');
      return;
    }
    const amount = parseInt(grantAmount, 10);
    if (!amount || amount < 1) {
      showToast('Amount must be ≥ 1');
      return;
    }
    if (stats && amount > stats.availablePool) {
      showToast(`Amount exceeds available pool (${stats.availablePool})`);
      return;
    }

    setGranting(true);
    let txHashToRecord = grantTxHash.trim();
    let blockNumber = 0;

    try {
      // If admin pasted a tx hash, just record it (manual override).
      // Otherwise, sign on-chain via the connected wallet.
      if (!txHashToRecord) {
        setGrantStep('wallet');
        const provider = await findWalletProvider();
        await provider.request({ method: 'eth_requestAccounts' });
        await ensureBscChain(provider);

        const browser = new BrowserProvider(provider);
        const signer = await browser.getSigner();
        const mfpnft = new Contract(MFPNFT_ADDRESS, MFPNFT_WRITE_ABI, signer);

        const tx = await mfpnft.grantMintAllowance(grantWallet, amount);
        setGrantStep('mining');
        const receipt = await tx.wait();
        if (!receipt || receipt.status !== 1) throw new Error('Transaction reverted on-chain');
        txHashToRecord = receipt.hash;
        blockNumber = receipt.blockNumber || 0;
      }

      setGrantStep('saving');
      await recordMfpGrant({
        wallet: grantWallet,
        amount,
        note: grantNote || undefined,
        txHash: txHashToRecord,
        blockNumber,
        grantedBy: '0x0000000000000000000000000000000000000000', // overwritten by indexer
      });

      showToast(`Granted ${amount} MFP mint rights to ${shortWallet(grantWallet)}`);
      setGrantWallet('');
      setGrantAmount('');
      setGrantNote('');
      setGrantTxHash('');
      load();
    } catch (e: any) {
      const msg = e?.code === 4001 || e?.code === 'ACTION_REJECTED'
        ? 'Transaction rejected by user'
        : (e?.shortMessage || e?.message || 'Failed');
      showToast('Error: ' + msg);
    } finally {
      setGrantStep('idle');
      setGranting(false);
    }
  };

  // Hide entire section silently for non-privileged callers (no flash, no placeholder).
  if (accessGranted !== true) return null;

  return (
    <>
      {/* ─── MFP-NFT ROYALTY ─── */}
      <div className="card" style={{ marginTop: 24 }}>
        <div
          className="card-title"
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
        >
          <span>MFP-NFT Royalty (EIP-2981)</span>
          <span
            style={{
              fontSize: '0.58rem',
              padding: '4px 10px',
              borderRadius: 12,
              background: 'rgba(212,160,23,0.12)',
              color: 'var(--gold)',
              border: '1px solid rgba(212,160,23,0.3)',
            }}
          >
            5% on secondary sales
          </span>
        </div>
        <p style={{ fontSize: SZ, color: 'var(--gray)', lineHeight: 1.6, marginBottom: 14 }}>
          Authors Pool wallet receives 5% royalty when MFP-NFTs trade on secondary markets
          (OpenSea, LooksRare, etc.). Owner can change the receiver any time on-chain.
        </p>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: 12,
            background: 'var(--bg4)',
            borderRadius: 8,
            border: '1px solid var(--border)',
          }}
        >
          <div style={{ flex: 1 }}>
            <div
              style={{
                fontSize: '0.55rem',
                color: 'var(--gray2)',
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                marginBottom: 4,
              }}
            >
              Current Authors Pool wallet
            </div>
            <div style={{ fontFamily: 'var(--font-m)', fontSize: SZ, color: 'var(--gold)' }}>
              {royalty?.receiver || <em style={{ color: 'var(--gray2)' }}>not set yet</em>}
            </div>
          </div>
          <button
            className="btn btn-outline btn-sm"
            onClick={() => {
              setRoyaltyInput(royalty?.receiver || '');
              setShowRoyaltyEdit(true);
            }}
          >
            Change Author Wallet
          </button>
        </div>

        {showRoyaltyEdit && (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,.6)',
              zIndex: 9998,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            onClick={() => setShowRoyaltyEdit(false)}
          >
            <div className="card" style={{ width: 520 }} onClick={(e) => e.stopPropagation()}>
              <div className="card-title">Change Authors Pool Wallet</div>
              <p style={{ fontSize: SZ, color: 'var(--gray)', lineHeight: 1.5, marginBottom: 16 }}>
                Step 1 — call <code style={{ color: 'var(--gold)' }}>MFPNFT.setRoyaltyReceiver(newWallet)</code>{' '}
                from the authorized wallet on-chain.
                <br />
                Step 2 — paste the new wallet + tx hash below to record in admin DB.
              </p>
              <div style={{ marginBottom: 12 }}>
                <div style={thSt}>New Authors Pool Wallet</div>
                <input
                  type="text"
                  value={royaltyInput}
                  onChange={(e) => setRoyaltyInput(e.target.value)}
                  placeholder="0x..."
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    fontSize: SZ,
                    fontFamily: 'var(--font-m)',
                    background: 'var(--bg3)',
                    border: '1px solid var(--border)',
                    color: 'var(--white)',
                    borderRadius: 6,
                  }}
                />
              </div>
              <div style={{ marginBottom: 16 }}>
                <div style={thSt}>Tx Hash (optional)</div>
                <input
                  type="text"
                  value={royaltyTxHash}
                  onChange={(e) => setRoyaltyTxHash(e.target.value)}
                  placeholder="0x..."
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    fontSize: SZ,
                    fontFamily: 'var(--font-m)',
                    background: 'var(--bg3)',
                    border: '1px solid var(--border)',
                    color: 'var(--white)',
                    borderRadius: 6,
                  }}
                />
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button className="btn btn-outline btn-sm" onClick={() => setShowRoyaltyEdit(false)}>
                  Cancel
                </button>
                <button
                  className="btn btn-gold btn-sm"
                  onClick={handleSaveRoyalty}
                  disabled={royaltySaving}
                >
                  {royaltySaving ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ─── MFP-NFT MINT ALLOCATION ─── */}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-title">MFP-NFT Mint Allocation</div>
        <p style={{ fontSize: SZ, color: 'var(--gray)', lineHeight: 1.6, marginBottom: 14 }}>
          MFP-NFTs are NOT for sale. Mint rights are granted by (1) automatic SEED purchase or (2)
          on-chain grant to founders / strategic partners. Recipients mint on-demand from DApp.
        </p>

        {/* Stats row */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <Stat label="Cap" value={stats?.maxSupply ?? 2500} color="var(--gold)" />
          <Stat label="Granted" value={stats?.granted ?? 0} color="var(--copper)" />
          <Stat label="Minted" value={stats?.minted ?? 0} color="var(--cyan)" />
          <Stat
            label="Available pool"
            value={stats?.availablePool ?? 2500}
            color="var(--green)"
          />
          <Stat
            label="Recipients"
            value={stats?.uniqueRecipients ?? 0}
            color="var(--purple2)"
          />
        </div>

        {/* Grant form */}
        <div
          style={{
            padding: 16,
            background: 'rgba(212,160,23,.04)',
            border: '1px dashed rgba(212,160,23,.3)',
            borderRadius: 10,
            marginBottom: 20,
          }}
        >
          <div
            style={{
              fontFamily: 'var(--font-d)',
              fontSize: '0.7rem',
              fontWeight: 700,
              color: 'var(--gold)',
              marginBottom: 12,
            }}
          >
            Grant Mint Rights
          </div>

          {/* Wallet input — dropdown OR manual */}
          <div style={{ marginBottom: 12 }}>
            <div style={thSt}>Recipient Wallet</div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <label
                style={{
                  fontSize: '0.6rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  cursor: 'pointer',
                }}
              >
                <input
                  type="radio"
                  checked={grantWalletMode === 'dropdown'}
                  onChange={() => setGrantWalletMode('dropdown')}
                />
                Choose from existing
              </label>
              <label
                style={{
                  fontSize: '0.6rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  cursor: 'pointer',
                }}
              >
                <input
                  type="radio"
                  checked={grantWalletMode === 'manual'}
                  onChange={() => setGrantWalletMode('manual')}
                />
                Enter new wallet
              </label>
            </div>
            {grantWalletMode === 'dropdown' ? (
              <select
                value={grantWallet}
                onChange={(e) => setGrantWallet(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  fontSize: SZ,
                  fontFamily: 'var(--font-m)',
                  background: 'var(--bg3)',
                  border: '1px solid var(--border)',
                  color: 'var(--white)',
                  borderRadius: 6,
                }}
              >
                <option value="">— Select wallet —</option>
                {existingWallets.map((w) => (
                  <option key={w.wallet} value={w.wallet}>
                    {shortWallet(w.wallet)} — {w.userId} {w.role ? `(${w.role})` : ''}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={grantWallet}
                onChange={(e) => setGrantWallet(e.target.value)}
                placeholder="0x..."
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  fontSize: SZ,
                  fontFamily: 'var(--font-m)',
                  background: 'var(--bg3)',
                  border: '1px solid var(--border)',
                  color: 'var(--white)',
                  borderRadius: 6,
                }}
              />
            )}
          </div>

          <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={thSt}>Amount (max {stats?.availablePool ?? 2500})</div>
              <input
                type="number"
                min={1}
                max={stats?.availablePool ?? 2500}
                value={grantAmount}
                onChange={(e) => setGrantAmount(e.target.value)}
                placeholder="e.g. 50"
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  fontSize: SZ,
                  fontFamily: 'var(--font-m)',
                  background: 'var(--bg3)',
                  border: '1px solid var(--border)',
                  color: 'var(--white)',
                  borderRadius: 6,
                }}
              />
            </div>
            <div style={{ flex: 2 }}>
              <div style={thSt}>Note (optional)</div>
              <input
                type="text"
                value={grantNote}
                onChange={(e) => setGrantNote(e.target.value)}
                placeholder="e.g. Strategic partner — pre-launch"
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  fontSize: SZ,
                  fontFamily: 'var(--font-m)',
                  background: 'var(--bg3)',
                  border: '1px solid var(--border)',
                  color: 'var(--white)',
                  borderRadius: 6,
                }}
              />
            </div>
          </div>

          <div style={{ marginBottom: 12 }}>
            <div style={thSt}>Override Tx Hash (optional, advanced)</div>
            <input
              type="text"
              value={grantTxHash}
              onChange={(e) => setGrantTxHash(e.target.value)}
              placeholder="Leave empty — wallet will auto-sign and fill"
              style={{
                width: '100%',
                padding: '8px 10px',
                fontSize: SZ,
                fontFamily: 'var(--font-m)',
                background: 'var(--bg3)',
                border: '1px solid var(--border)',
                color: 'var(--white)',
                borderRadius: 6,
              }}
            />
          </div>

          <button
            className="btn btn-gold btn-sm"
            onClick={handleGrant}
            disabled={granting}
            style={{ width: '100%' }}
          >
            {grantStep === 'wallet' && 'Confirm in wallet...'}
            {grantStep === 'mining' && 'Waiting for confirmation...'}
            {grantStep === 'saving' && 'Saving to DB...'}
            {grantStep === 'idle' && '✦ Grant Mint Rights'}
          </button>
          <p style={{ fontSize: '0.55rem', color: 'var(--gray2)', marginTop: 8, lineHeight: 1.5 }}>
            One click: button signs MFPNFT.grantMintAllowance via your connected wallet,
            waits for on-chain confirmation, then records in admin DB automatically. Paste a tx hash
            above only if you signed from a different wallet/tool and want to record that tx instead.
          </p>
        </div>

        {/* ─── Grant Activity Log (6 cols, scrollable) ─── */}
        <div
          className="card-title"
          style={{ fontSize: '0.7rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
        >
          <span>Grant Activity Log ({recipients.length})</span>
          <span style={{ fontSize: '0.55rem', color: 'var(--gray2)', fontWeight: 400 }}>
            Most recent first &middot; scroll to see more
          </span>
        </div>
        <div
          style={{
            maxHeight: 280,
            overflowY: 'auto',
            border: '1px solid var(--border)',
            borderRadius: 8,
            marginBottom: 20,
            background: 'var(--bg4)',
          }}
        >
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead style={{ position: 'sticky', top: 0, background: 'var(--bg3)', zIndex: 1 }}>
              <tr>
                <th style={thSt}>Date-Time</th>
                <th style={thSt}>Account</th>
                <th style={thSt}>Wallet</th>
                <th style={thSt}>Granted</th>
                <th style={thSt}>Minted</th>
                <th style={thSt}>Pending</th>
              </tr>
            </thead>
            <tbody>
              {recipients.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    style={{
                      ...tdSt,
                      textAlign: 'center',
                      color: 'var(--gray2)',
                      fontStyle: 'italic',
                      padding: 20,
                    }}
                  >
                    No grants yet.
                  </td>
                </tr>
              ) : (
                [...recipients]
                  .sort(
                    (a, b) =>
                      new Date(b.latestGrantAt).getTime() - new Date(a.latestGrantAt).getTime()
                  )
                  .map((r) => {
                    const acct = existingWallets.find(
                      (w) => w.wallet.toLowerCase() === r.wallet.toLowerCase()
                    );
                    const userId = acct?.userId || '—';
                    const dt = new Date(r.latestGrantAt);
                    const dtFmt = `${dt.toLocaleDateString()} ${dt.toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}`;
                    return (
                      <tr key={`log-${r.wallet}`} style={{ borderTop: '1px solid var(--border)' }}>
                        <td style={{ ...tdSt, fontSize: '0.58rem', color: 'var(--gray2)' }}>
                          {dtFmt}
                        </td>
                        <td style={tdSt}>{userId}</td>
                        <td style={{ ...tdSt, fontFamily: 'var(--font-m)', color: 'var(--gold)' }}>
                          {shortWallet(r.wallet)}
                        </td>
                        <td style={tdSt}>{r.granted.toLocaleString()}</td>
                        <td style={{ ...tdSt, color: 'var(--copper)' }}>
                          {r.minted.toLocaleString()}
                          {r.onchainBalance !== undefined && r.onchainBalance !== r.minted && (
                            <span
                              style={{
                                marginLeft: 6,
                                fontSize: '0.5rem',
                                color: 'var(--gray2)',
                                fontStyle: 'italic',
                              }}
                              title={`Wallet on-chain balance is ${r.onchainBalance} — extra NFTs came from transfer-in or another contract, not from mint allowance.`}
                            >
                              (bal {r.onchainBalance})
                            </span>
                          )}
                        </td>
                        <td
                          style={{
                            ...tdSt,
                            color: r.remaining > 0 ? 'var(--green)' : 'var(--gray2)',
                          }}
                        >
                          {r.remaining.toLocaleString()}
                        </td>
                      </tr>
                    );
                  })
              )}
            </tbody>
          </table>
        </div>

        {/* Recipients table (aggregated by wallet) */}
        <div className="card-title" style={{ fontSize: '0.7rem' }}>
          Current Grants ({recipients.length})
        </div>
        {loading ? (
          <div style={{ padding: 16, textAlign: 'center', color: 'var(--gray)' }}>Loading...</div>
        ) : recipients.length === 0 ? (
          <div
            style={{
              padding: 24,
              textAlign: 'center',
              color: 'var(--gray2)',
              fontSize: SZ,
              fontStyle: 'italic',
            }}
          >
            No grants yet. SEED purchases and direct grants will appear here.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={thSt}>Wallet</th>
                  <th style={thSt}>Granted</th>
                  <th style={thSt}>Minted</th>
                  <th style={thSt}>Remaining</th>
                  <th style={thSt}>Last Source</th>
                  <th style={thSt}>Last Grant</th>
                </tr>
              </thead>
              <tbody>
                {recipients.map((r) => (
                  <tr key={r.wallet} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={tdSt}>
                      <div style={{ fontFamily: 'var(--font-m)', color: 'var(--gold)' }}>
                        {shortWallet(r.wallet)}
                      </div>
                    </td>
                    <td style={tdSt}>{r.granted.toLocaleString()}</td>
                    <td style={{ ...tdSt, color: 'var(--copper)' }}>{r.minted.toLocaleString()}</td>
                    <td
                      style={{
                        ...tdSt,
                        color: r.remaining > 0 ? 'var(--green)' : 'var(--gray2)',
                      }}
                    >
                      {r.remaining.toLocaleString()}
                      {r.remaining === 0 && r.granted > 0 && ' ✓'}
                    </td>
                    <td style={tdSt}>
                      <span
                        style={{
                          padding: '2px 8px',
                          borderRadius: 10,
                          fontSize: '0.55rem',
                          fontWeight: 600,
                          background:
                            r.latestSource === 0
                              ? 'rgba(0,200,150,.12)'
                              : 'rgba(212,160,23,.12)',
                          color: r.latestSource === 0 ? 'var(--green)' : 'var(--gold)',
                          border: `1px solid ${r.latestSource === 0 ? 'rgba(0,200,150,.3)' : 'rgba(212,160,23,.3)'}`,
                        }}
                      >
                        {sourceLabel(r.latestSource)}
                      </span>
                    </td>
                    <td style={{ ...tdSt, color: 'var(--gray2)', fontSize: '0.58rem' }}>
                      {new Date(r.latestGrantAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
