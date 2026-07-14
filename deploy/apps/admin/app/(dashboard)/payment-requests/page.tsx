'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { BrowserProvider, Contract, parseUnits } from 'ethers';
import {
  fetchAllPayoutRequests,
  fetchPayoutConfig,
  savePayoutConfig,
  approveAndPayPayout,
  rejectPayoutRequest,
} from '@/lib/api';
import { useMcUi } from '@/components/ui/McUi';
import { isOwnerWallet } from '@/lib/auth';

const BSC_CHAIN_ID = 56;
const BSC_RPC = 'https://bsc-dataseed.binance.org/';

// BEP-20 USDT on BSC Mainnet (real token)
const USDT_ADDRESS = '0x55d398326f99059fF775485246999027B3197955';
const USDT_ABI = [
  'function transfer(address to, uint256 amount) external returns (bool)',
  'function balanceOf(address account) external view returns (uint256)',
  'function decimals() external view returns (uint8)',
];

// SeedBudgetV5c — centralized vault (active 2026-06-23, replaces V5b 0xf7a839A271d8F5A7b19a42eCD7f7E604A3dcEC1a).
// Slot[0] (Distribution Program 20%) is the funding source for distributor
// commission payouts. Owner is slotController[0] and calls release(0, distributor, gross).
// Contract auto-deducts feeBps and transfers net to distributor + fee to feeReceiver.
const SEED_BUDGET_V5C = '0x33ec0A97029adde1A7e0f78E3B8f414Ec56527ef';
const SEED_BUDGET_ABI = [
  'function release(uint8 slot, address recipient, uint256 amount) external',
  'function setFee(uint16 bps, address receiver) external',
  'function feeBps() view returns (uint16)',
  'function feeReceiver() view returns (address)',
  'function slotBalance(uint8) view returns (uint256)',
];
const SLOT_DISTRIBUTION = 0;

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
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: '0x38' }],
    });
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

interface PayoutRequest {
  id: string;
  distributorWallet: string;
  status: 'PENDING' | 'APPROVED' | 'PAID' | 'REJECTED';
  grossAmount: string;
  feeBps: number;
  feeAmount?: string;
  netAmount: string;
  earningCount: number;
  requestedAt: string;
  approvedAt?: string | null;
  approvedBy?: string | null;
  paidAt?: string | null;
  paidBy?: string | null;
  paidTxHash?: string | null;
  rejectedAt?: string | null;
  rejectedBy?: string | null;
  rejectedReason?: string | null;
}

const SZ = '0.62rem';
const thStyle: React.CSSProperties = {
  padding: '8px 10px', textAlign: 'left',
  color: 'var(--gray)', fontWeight: 600, fontSize: '0.58rem',
  fontFamily: 'var(--font-d)', letterSpacing: '0.08em',
  textTransform: 'uppercase',
};
const tdStyle: React.CSSProperties = {
  padding: '10px', fontFamily: 'var(--font-m)', fontSize: SZ, color: 'var(--white)',
};
const btnSmall: React.CSSProperties = {
  padding: '6px 10px', fontSize: '0.62rem', fontFamily: 'var(--font-d)',
  background: 'transparent', color: 'var(--gold)', border: '1px solid var(--border)',
  borderRadius: 6, cursor: 'pointer', whiteSpace: 'nowrap',
};

const fmtUsd = (n: number | string) => {
  const v = typeof n === 'string' ? parseFloat(n) : n;
  if (!v || isNaN(v)) return '-';
  return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const truncate = (s: string) =>
  s && s.length > 14 ? s.slice(0, 8) + '...' + s.slice(-4) : s;

export default function PaymentRequestsPage() {
  const mcUi = useMcUi();
  const [requests, setRequests] = useState<PayoutRequest[]>([]);
  // Closed orders: APPROVED + PAID + REJECTED, listed below pending for history
  const [closedRequests, setClosedRequests] = useState<PayoutRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Fee config
  const [feeBps, setFeeBps] = useState(0);
  const [feeReceiver, setFeeReceiver] = useState('');
  const [savingConfig, setSavingConfig] = useState(false);
  const [feeBpsInput, setFeeBpsInput] = useState('0');
  const [feeReceiverInput, setFeeReceiverInput] = useState('');

  // Read wallet from JWT to gate owner-only controls
  const [userWallet, setUserWallet] = useState<string>('');

  // Confirm modal (replaces native window.confirm — Mission Chain themed)
  const [confirmModal, setConfirmModal] = useState<{
    request: PayoutRequest;
    gross: number;
    feeAmt: number;
    net: number;
  } | null>(null);
  const [executing, setExecuting] = useState(false);

  // Toast now provided by global McUiProvider (mcUi.toast(...))
  useEffect(() => {
    try {
      const t = typeof window !== 'undefined' ? localStorage.getItem('mc-admin-jwt') : null;
      if (!t) return;
      const payload = JSON.parse(atob(t.split('.')[1]));
      setUserWallet(payload.wallet || '');
    } catch {}
  }, []);

  const isSuperAdmin = isOwnerWallet(userWallet);

  const loadAll = useCallback(async () => {
    try {
      const [cfg, reqRes, allRes] = await Promise.all([
        fetchPayoutConfig(),
        fetchAllPayoutRequests({ status: 'PENDING', limit: 100 }),
        fetchAllPayoutRequests({ limit: 100 }), // all statuses, for history filtering
      ]);
      const cfgFee = cfg.data?.feeBps ?? 0;
      const cfgReceiver = cfg.data?.feeReceiver ?? '';
      setFeeBps(cfgFee);
      setFeeReceiver(cfgReceiver);
      setFeeBpsInput(String(cfgFee));
      setFeeReceiverInput(cfgReceiver);
      setRequests(reqRes.data || []);
      // Filter closed rows for the history section (PAID + REJECTED only).
      // APPROVED is a transient state — workflow simplified Apr 29 to atomic
      // PENDING → PAID via /approve-and-pay, so APPROVED rows shouldn't appear.
      const allRows: PayoutRequest[] = (allRes as any)?.data || [];
      setClosedRequests(allRows.filter((r) => r.status === 'PAID' || r.status === 'REJECTED'));
    } catch (err) {
      console.error('Failed to load payment requests', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  const handleSaveConfig = async () => {
    const fee = parseFloat(feeBpsInput);
    if (isNaN(fee) || fee < 0 || fee > 1000) {
      mcUi.toast({ type: 'error', message: 'Fee must be 0–1000 BPS (0%–10%)' });
      return;
    }
    // Fall back to current value if user didn't change the receiver field — we
    // need a non-zero address for on-chain setFee even when fee = 0%.
    const finalReceiver = (feeReceiverInput.trim() || feeReceiver).toLowerCase();
    const validReceiver = /^0x[a-fA-F0-9]{40}$/.test(finalReceiver);
    if (fee > 0 && !validReceiver) {
      mcUi.toast({ type: 'error', message: 'Valid fee receiver address required when fee > 0' });
      return;
    }
    setSavingConfig(true);
    try {
      // Step 1 — sync on-chain SeedBudgetV5c.feeBps + feeReceiver so that
      // `release(slot, recipient, gross)` deducts exactly the fee shown in UI.
      // Owner signs setFee() in MetaMask; on rejection or revert, DB save is
      // aborted to keep DB ↔ contract in lockstep.
      if (validReceiver) {
        const provider = await findWalletProvider();
        await ensureBscMainnet(provider);
        const browser = new BrowserProvider(provider);
        const signer = await browser.getSigner();
        const sb = new Contract(SEED_BUDGET_V5C, SEED_BUDGET_ABI, signer);
        const tx = await sb.setFee(Math.round(fee), finalReceiver);
        const r = await tx.wait(1);
        if (!r || r.status !== 1) throw new Error('setFee tx reverted');
      }
      // Step 2 — persist DB SystemConfig (matches contract state)
      await savePayoutConfig(Math.round(fee), feeReceiverInput.trim());
      await loadAll();
      mcUi.toast({ type: 'success', message: validReceiver
        ? 'Payout config saved (synced on-chain)'
        : 'Payout config saved (DB only — on-chain skipped, no valid receiver)' });
    } catch (err: any) {
      const code = err?.code;
      const friendly = code === 4001 || code === 'ACTION_REJECTED'
        ? 'Transaction rejected in wallet'
        : err?.shortMessage || err?.message || 'Unknown error';
      mcUi.toast({ type: 'error', message: 'Save failed: ' + friendly });
    } finally {
      setSavingConfig(false);
    }
  };

  const handleReject = async (request: PayoutRequest) => {
    const reason = await mcUi.prompt({
      title: 'Reject Payout Request',
      message: 'Provide a reason (min 3 characters) for the audit log. The distributor will see this rejection reason.',
      label: 'Rejection reason',
      placeholder: 'e.g. Invalid earnings, dispute under review…',
      multiline: true,
      validator: (v) => (v.trim().length < 3 ? 'Reason must be at least 3 characters' : null),
      confirmLabel: 'Reject',
      cancelLabel: 'Cancel',
    });
    if (reason === null) return;
    setActionLoading(request.id);
    try {
      await rejectPayoutRequest(request.id, reason.trim());
      mcUi.toast({ type: 'success', message: 'Request rejected' });
      await loadAll();
    } catch (err: any) {
      mcUi.toast({ type: 'error', message: 'Reject failed: ' + (err?.message || 'Unknown error') });
    } finally {
      setActionLoading(null);
    }
  };

  // Step 1 — open confirm modal (called by table button)
  const handleApproveAndPay = (request: PayoutRequest) => {
    const gross = Number(request.grossAmount);
    const feeAmt = (gross * feeBps) / 10000;
    const net = gross - feeAmt;
    setConfirmModal({ request, gross, feeAmt, net });
  };

  // Step 2 — actually execute (called by modal Confirm button)
  // Single tx: SeedBudgetV5c.release(SLOT_DISTRIBUTION, distributor, gross).
  // Contract auto-deducts feeBps (synced via setFee) and transfers net to
  // distributor + fee to feeReceiver. Funds source = slot[0] of V5c vault,
  // NOT admin wallet — closed-loop with SEED revenue.
  const executeApproveAndPay = async () => {
    if (!confirmModal) return;
    const { request, gross, net } = confirmModal;
    setExecuting(true);
    setActionLoading(request.id);

    let stage = 'init';
    try {
      stage = 'finding wallet';
      console.log('[ApprovePay] step:', stage);
      const provider = await findWalletProvider();

      stage = 'requesting accounts (check MetaMask popup)';
      console.log('[ApprovePay] step:', stage);
      const accountsP = provider.request({ method: 'eth_requestAccounts' });
      const timeoutP = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('MetaMask did not respond within 60s — popup may be blocked or wallet locked')), 60_000),
      );
      await Promise.race([accountsP, timeoutP]);

      stage = 'switching to BSC Mainnet';
      console.log('[ApprovePay] step:', stage);
      await ensureBscMainnet(provider);

      stage = 'loading signer';
      console.log('[ApprovePay] step:', stage);
      const browser = new BrowserProvider(provider);
      const signer = await browser.getSigner();
      const signerAddr = await signer.getAddress();
      console.log('[ApprovePay] signer:', signerAddr);

      stage = 'reading USDT decimals';
      const usdtRead = new Contract(USDT_ADDRESS, USDT_ABI, signer);
      const decimals: bigint = await usdtRead.decimals();
      const dec = Number(decimals);

      stage = 'calling SeedBudgetV5c.release(0, distributor, gross) — sign in MetaMask';
      console.log('[ApprovePay] step:', stage, '— gross:', gross, 'to', request.distributorWallet);
      const sb = new Contract(SEED_BUDGET_V5C, SEED_BUDGET_ABI, signer);
      const grossWei = parseUnits(gross.toFixed(dec), dec);
      const tx = await sb.release(SLOT_DISTRIBUTION, request.distributorWallet, grossWei);
      console.log('[ApprovePay] release tx submitted:', tx.hash);

      stage = 'waiting for release confirmation';
      const receipt = await tx.wait(1);
      if (!receipt || receipt.status !== 1) throw new Error('release() reverted');
      console.log('[ApprovePay] release tx confirmed:', receipt.hash);

      stage = 'recording payout on backend';
      console.log('[ApprovePay] step:', stage);
      await approveAndPayPayout(request.id, feeBps, receipt.hash);

      setConfirmModal(null);
      mcUi.toast({
        type: 'success',
        message: `Payout completed — net ${fmtUsd(net)} from slot[0]. Tx: ${receipt.hash.slice(0, 10)}...${receipt.hash.slice(-6)}`,
      });
      await loadAll();
    } catch (err: any) {
      console.error('[ApprovePay] FAILED at stage:', stage, err);
      const code = err?.code;
      const reason = err?.reason || err?.shortMessage || '';
      // Map common contract reverts to friendly messages
      let friendly: string;
      if (code === 4001 || code === 'ACTION_REJECTED') {
        friendly = 'Transaction rejected in wallet';
      } else if (reason.includes('insufficient slot balance')) {
        friendly = 'Slot[0] V5c balance insufficient — wait for more SEED purchases or contact OWNER';
      } else if (reason.includes('not controller')) {
        friendly = 'This wallet is not authorized as slot[0] controller — must use deployer wallet';
      } else {
        friendly = reason || err?.message || 'Unknown error';
      }
      mcUi.toast({
        type: 'error',
        message: `Approve & Pay failed (${stage}): ${friendly}`,
      });
    } finally {
      setActionLoading(null);
      setExecuting(false);
    }
  };

  if (loading) {
    return <div style={{ padding: 32, color: 'var(--muted)' }}>Loading payment requests...</div>;
  }

  return (
    <div style={{ padding: '24px 32px' }}>
      <div style={{ marginBottom: 8, fontSize: '0.6rem', color: 'var(--gray)', letterSpacing: 0.5 }}>
        — MANAGEMENT
      </div>
      <h1 style={{ margin: '0 0 4px 0', fontSize: '1.6rem', color: 'var(--white)' }}>
        Payment Requests
      </h1>
      <p style={{ color: 'var(--muted)', fontSize: '0.74rem', marginBottom: 20 }}>
        Review pending distributor payouts. Approve &amp; Pay executes on-chain USDT transfer in one click.
      </p>

      {/* ── Fee Config Card (owner-wallet only) ── */}
      {isSuperAdmin && (
        <div style={{
          background: 'var(--card)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          padding: '20px 24px',
          marginBottom: 24,
        }}>
          <div style={{ marginBottom: 14 }}>
            <h3 style={{ margin: 0, color: 'var(--gold)', fontSize: '0.85rem', letterSpacing: 0.5, fontFamily: 'var(--font-d)' }}>
              WITHDRAWAL FEE CONFIG
            </h3>
            <div style={{ marginTop: 4, fontSize: '0.6rem', color: 'var(--muted)', fontStyle: 'italic' }}>
              Saved value is mirrored on-chain via <code>SeedBudgetV5c.setFee()</code> — Owner signs 1 tx on save.
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr auto', gap: 12, alignItems: 'end' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.6rem', color: 'var(--muted)', marginBottom: 4, letterSpacing: 0.5 }}>
                FEE % (0-10)
              </label>
              <input
                type="number" min="0" max="10" step="0.1"
                value={(parseFloat(feeBpsInput || '0') / 100).toFixed(1)}
                onChange={(e) => setFeeBpsInput(String(Math.round(parseFloat(e.target.value || '0') * 100)))}
                style={{
                  width: '100%', padding: '8px 10px',
                  background: 'var(--card-2)',
                  border: '1px solid var(--border)',
                  borderRadius: 6, color: 'var(--white)',
                  fontSize: '0.78rem', fontFamily: 'var(--font-m)',
                }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.6rem', color: 'var(--muted)', marginBottom: 4, letterSpacing: 0.5 }}>
                FEE RECEIVER ADDRESS
              </label>
              <input
                type="text"
                value={feeReceiverInput}
                onChange={(e) => setFeeReceiverInput(e.target.value)}
                placeholder="0x..."
                style={{
                  width: '100%', padding: '8px 10px',
                  background: 'var(--card-2)',
                  border: '1px solid var(--border)',
                  borderRadius: 6, color: 'var(--white)',
                  fontSize: '0.74rem', fontFamily: 'var(--font-m)',
                }}
              />
            </div>
            <button
              onClick={handleSaveConfig}
              disabled={savingConfig}
              style={{
                padding: '8px 18px',
                background: 'var(--gold)', color: '#000',
                border: 'none', borderRadius: 6,
                fontWeight: 700, fontSize: '0.74rem', fontFamily: 'var(--font-d)',
                cursor: 'pointer', letterSpacing: 0.5,
              }}>
              {savingConfig ? '...' : 'SAVE'}
            </button>
          </div>

          <div style={{ marginTop: 10, fontSize: '0.66rem', color: 'var(--muted)' }}>
            Current: <strong style={{ color: 'var(--gold)' }}>{(feeBps / 100).toFixed(1)}%</strong>
            {feeBps > 0 && feeReceiver && (
              <> &middot; Fee receiver: <code style={{ color: 'var(--white)' }}>{truncate(feeReceiver)}</code></>
            )}
            {feeBps === 0 && <> &middot; <em>No fee applied</em></>}
          </div>
        </div>
      )}

      {/* ── Pending Requests Table ── */}
      <div style={{
        background: 'var(--card)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        padding: 16,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ margin: 0, color: 'var(--gold)', fontSize: '0.85rem', letterSpacing: 0.5, fontFamily: 'var(--font-d)' }}>
            PENDING REQUESTS ({requests.length})
          </h3>
          <button onClick={loadAll} style={btnSmall}>↻ Refresh</button>
        </div>

        {requests.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--muted)', fontSize: '0.74rem' }}>
            No pending payment requests. All caught up.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: SZ }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  <th style={thStyle}>Requested</th>
                  <th style={thStyle}>Distributor</th>
                  <th style={thStyle}>Gross</th>
                  <th style={thStyle}>Fee ({(feeBps / 100).toFixed(1)}%)</th>
                  <th style={thStyle}>Net</th>
                  <th style={thStyle}>Orders</th>
                  <th style={thStyle}>Status</th>
                  <th style={thStyle}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((r) => {
                  const gross = Number(r.grossAmount);
                  const feeAmt = (gross * feeBps) / 10000;
                  const net = gross - feeAmt;
                  return (
                    <tr key={r.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                      <td style={tdStyle}>{new Date(r.requestedAt).toLocaleString()}</td>
                      <td style={tdStyle}><code>{truncate(r.distributorWallet)}</code></td>
                      <td style={tdStyle}>{fmtUsd(gross)}</td>
                      <td style={tdStyle}>{feeBps > 0 ? fmtUsd(feeAmt) : '-'}</td>
                      <td style={{ ...tdStyle, color: 'var(--gold)', fontWeight: 700 }}>{fmtUsd(net)}</td>
                      <td style={tdStyle}>{r.earningCount}</td>
                      <td style={{ ...tdStyle, color: 'var(--gold)', fontWeight: 700 }}>PENDING</td>
                      <td style={tdStyle}>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          <button
                            onClick={() => handleApproveAndPay(r)}
                            disabled={actionLoading === r.id}
                            style={{
                              ...btnSmall,
                              background: '#66BB6A', color: '#fff', borderColor: '#66BB6A',
                              fontWeight: 700,
                            }}>
                            {actionLoading === r.id ? '...' : 'Approve & Pay'}
                          </button>
                          <button
                            onClick={() => handleReject(r)}
                            disabled={actionLoading === r.id}
                            style={{
                              ...btnSmall,
                              background: '#EF5350', color: '#fff', borderColor: '#EF5350',
                            }}>
                            Reject
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Closed Orders (APPROVED / PAID / REJECTED) ──────────────────── */}
      <div className="card" style={{ marginTop: 16 }}>
        <div
          className="card-title"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            fontSize: '0.78rem', letterSpacing: '0.06em',
          }}>
          <span style={{ textTransform: 'uppercase' }}>
            Closed Orders ({closedRequests.length})
          </span>
          <span style={{ fontSize: '0.55rem', color: 'var(--gray2)', fontWeight: 400 }}>
            PAID / REJECTED — most recent first
          </span>
        </div>

        {closedRequests.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--muted)', fontStyle: 'italic', fontSize: '0.78rem' }}>
            No closed orders yet. Paid or rejected payout requests appear here.
          </div>
        ) : (
          <div style={{
            maxHeight: 420, overflowY: 'auto',
            border: '1px solid var(--border)',
            borderRadius: 8,
            background: 'var(--bg4)',
          }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead style={{ position: 'sticky', top: 0, background: 'var(--bg3)', zIndex: 1 }}>
                <tr>
                  <th style={thStyle}>Date</th>
                  <th style={thStyle}>Distributor</th>
                  <th style={thStyle}>Gross</th>
                  <th style={thStyle}>Fee</th>
                  <th style={thStyle}>Net</th>
                  <th style={thStyle}>Status</th>
                  <th style={thStyle}>Tx / Reason</th>
                </tr>
              </thead>
              <tbody>
                {closedRequests.map((r) => {
                  // PAID → use paidAt, REJECTED → use rejectedAt
                  const finalAt =
                    r.status === 'PAID' && r.paidAt ? r.paidAt :
                    r.status === 'REJECTED' && r.rejectedAt ? r.rejectedAt :
                    r.requestedAt;
                  const dt = new Date(finalAt);
                  const dtFmt = `${dt.toLocaleDateString()} ${dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
                  const statusColor = r.status === 'PAID' ? '#66BB6A' : '#EF5350';
                  const statusBg = r.status === 'PAID' ? 'rgba(102,187,106,0.12)' : 'rgba(239,83,80,0.12)';
                  const feePct = r.feeBps > 0 ? `${(r.feeBps / 100).toFixed(1)}%` : '—';
                  return (
                    <tr key={r.id} style={{ borderTop: '1px solid var(--border)' }}>
                      <td style={{ ...tdStyle, fontSize: '0.58rem', color: 'var(--gray2)' }}>{dtFmt}</td>
                      <td style={{ ...tdStyle, fontFamily: 'var(--font-m)', color: 'var(--gold)' }}>
                        {r.distributorWallet.slice(0, 8)}...{r.distributorWallet.slice(-6)}
                      </td>
                      <td style={tdStyle}>{fmtUsd(r.grossAmount)}</td>
                      <td style={{ ...tdStyle, color: r.feeBps > 0 ? '#EF5350' : 'var(--gray2)' }}>
                        {feePct}
                        {r.feeBps > 0 && r.feeAmount && (
                          <span style={{ fontSize: '0.55rem', color: 'var(--gray2)', marginLeft: 4 }}>
                            (−{fmtUsd(r.feeAmount)})
                          </span>
                        )}
                      </td>
                      <td style={{ ...tdStyle, color: 'var(--gold)', fontWeight: 600 }}>
                        {fmtUsd(r.netAmount)}
                      </td>
                      <td style={tdStyle}>
                        <span style={{
                          padding: '3px 10px', borderRadius: 10,
                          fontSize: '0.55rem', fontWeight: 600,
                          background: statusBg, color: statusColor,
                          border: `1px solid ${statusColor}40`,
                        }}>{r.status}</span>
                      </td>
                      <td style={{ ...tdStyle, fontSize: '0.58rem' }}>
                        {r.status === 'PAID' && r.paidTxHash ? (
                          <a
                            href={`https://bscscan.com/tx/${r.paidTxHash}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ color: 'var(--gold)', textDecoration: 'none', fontFamily: 'var(--font-m)' }}>
                            {r.paidTxHash.slice(0, 8)}... {'↗'}
                          </a>
                        ) : r.status === 'REJECTED' && r.rejectedReason ? (
                          <span style={{ color: 'var(--gray2)', fontStyle: 'italic' }}>
                            {r.rejectedReason}
                          </span>
                        ) : (
                          <span style={{ color: 'var(--gray2)' }}>—</span>
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

      {/* ── Mission Chain Confirm Modal (Approve & Pay) ─────────────────── */}
      {confirmModal && (
        <div
          onClick={() => !executing && setConfirmModal(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 9999,
            background: 'rgba(0,0,0,0.7)',
            backdropFilter: 'blur(6px)',
            WebkitBackdropFilter: 'blur(6px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 16,
            animation: 'fadeIn 0.2s ease-out',
          }}>
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 'min(480px, 100%)',
              background: 'linear-gradient(135deg, #1a0b2e 0%, #050210 100%)',
              border: '1px solid rgba(212,160,23,0.35)',
              borderRadius: 16,
              padding: 28,
              boxShadow: '0 20px 60px rgba(0,0,0,0.6), 0 0 0 1px rgba(212,160,23,0.1) inset',
              color: '#E8D8B8',
            }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
              <div style={{
                width: 40, height: 40, borderRadius: '50%',
                background: 'linear-gradient(135deg, rgba(212,160,23,0.2), rgba(212,160,23,0.05))',
                border: '1px solid rgba(212,160,23,0.3)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 20,
              }}>{'\u{1F4B0}'}</div>
              <div>
                <h2 style={{
                  margin: 0, fontSize: '1rem', fontWeight: 700,
                  color: 'var(--gold)', fontFamily: 'var(--font-d)',
                  letterSpacing: '0.02em',
                }}>Approve & Pay Payout</h2>
                <p style={{
                  margin: '2px 0 0 0', fontSize: '0.7rem',
                  color: '#A89878', fontStyle: 'italic',
                }}>Review the transfer details before signing</p>
              </div>
            </div>

            {/* Detail rows */}
            <div style={{
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.06)',
              borderRadius: 10,
              padding: '14px 16px',
              marginBottom: 16,
              fontSize: '0.78rem',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                <span style={{ color: '#A89878' }}>Distributor</span>
                <span style={{ fontFamily: 'var(--font-m)', color: '#D4C098' }}>
                  {confirmModal.request.distributorWallet.slice(0, 10)}...{confirmModal.request.distributorWallet.slice(-6)}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                <span style={{ color: '#A89878' }}>Gross</span>
                <span style={{ fontWeight: 600 }}>{fmtUsd(confirmModal.gross)}</span>
              </div>
              {feeBps > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                  <span style={{ color: '#A89878' }}>
                    Fee {(feeBps / 100).toFixed(1)}%
                  </span>
                  <span style={{ color: '#EF5350' }}>
                    −{fmtUsd(confirmModal.feeAmt)}
                  </span>
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0 4px', alignItems: 'baseline' }}>
                <span style={{ color: 'var(--gold)', fontWeight: 700 }}>Net to Distributor</span>
                <span style={{ color: 'var(--gold)', fontWeight: 800, fontSize: '1.05rem' }}>
                  {fmtUsd(confirmModal.net)}
                </span>
              </div>
            </div>

            {/* MetaMask hint */}
            <div style={{
              padding: '10px 12px',
              background: 'rgba(91,45,158,0.12)',
              border: '1px dashed rgba(155,114,207,0.3)',
              borderRadius: 8,
              fontSize: '0.7rem',
              color: '#C8B4E8',
              lineHeight: 1.5,
              marginBottom: 20,
            }}>
              {'\u{1F98A}'} MetaMask will prompt <b>1</b> tx — calls{' '}
              <code>SeedBudgetV5c.release(0,…)</code> which auto-deducts the
              fee and pays the distributor from slot[0] (Distribution Program).
            </div>

            {/* Buttons */}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                onClick={() => {
                  // Always cancellable — even during Processing — so the user
                  // is never trapped if MetaMask popup is blocked.
                  // (Any tx already broadcast will still settle on-chain.)
                  setConfirmModal(null);
                  setExecuting(false);
                  setActionLoading(null);
                }}
                style={{
                  padding: '10px 24px',
                  background: 'transparent',
                  border: '1px solid rgba(255,255,255,0.15)',
                  color: '#D4C098',
                  borderRadius: 8,
                  fontWeight: 600, fontSize: '0.8rem',
                  cursor: 'pointer',
                  fontFamily: 'var(--font-d)',
                  transition: 'all 0.15s',
                }}>
                {executing ? 'Close' : 'Cancel'}
              </button>
              <button
                onClick={executeApproveAndPay}
                disabled={executing}
                style={{
                  padding: '10px 28px',
                  background: executing
                    ? 'rgba(212,160,23,0.4)'
                    : 'linear-gradient(135deg, var(--gold), #b8942f)',
                  border: 'none',
                  color: '#000',
                  borderRadius: 8,
                  fontWeight: 700, fontSize: '0.8rem',
                  cursor: executing ? 'wait' : 'pointer',
                  fontFamily: 'var(--font-d)',
                  letterSpacing: '0.04em',
                  boxShadow: executing ? 'none' : '0 4px 14px rgba(212,160,23,0.3)',
                  transition: 'all 0.15s',
                }}>
                {executing ? 'Processing...' : '✦ Confirm & Pay'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast now rendered globally by McUiProvider — no inline JSX needed */}
    </div>
  );
}
