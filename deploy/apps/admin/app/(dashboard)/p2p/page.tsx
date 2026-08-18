'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { BrowserProvider, Contract, parseUnits, formatUnits } from 'ethers';
import { useMcUi } from '@/components/ui/McUi';
import { isOwnerWallet } from '@/lib/auth';
import { USDT_DECIMALS, getActiveAddresses, getActiveChain } from '@missionchain/sdk';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

const BSC_CHAIN_ID = 56;
const BSC_RPC = 'https://bsc-dataseed.binance.org/';

/* ── Contracts, resolved for whichever network this build points at ──
   The address here used to be a literal, and it was the TESTNET one. On mainnet every
   on-chain read hit an address with no code, which is why the four state fields showed
   a dash and no error: the calls did not fail loudly, they returned nothing. */
const _A = getActiveAddresses() as Record<string, string>;
const P2P_ESCROW_MFP = _A.P2PEscrowNFT_MFP || '';
const P2P_ESCROW_COMMUNITY = _A.P2PEscrowNFT_Community || '';
const P2P_ESCROW_MIC = _A.P2PEscrowMIC || '';

/* Three escrows, two shapes.
   Both NFT escrows are the same contract (P2PEscrowNFT) pointed at a different ERC-721,
   so they share one ABI. P2PEscrowMIC is a different contract and keeps its own — it has
   amount bounds in MIC, which an NFT escrow has no use for.
   The dead P2PEscrowMFP was different again: it paused with `pauseTrading(bool)` and
   charged a cancellation fee. Neither exists here. Sharing one ABI across all of them is
   how this page ended up only ever talking to the one contract nobody could trade on. */
const NFT_ADMIN_ABI = [
  'function setPaused(bool p) external',
  'function setFee(uint16 newBps) external',
  'function setFeeRecipient(address newRecipient) external',
  'function setPriceBounds(uint256 newMin, uint256 newMax) external',
  'function feeBps() view returns (uint16)',
  'function paused() view returns (bool)',
  'function feeRecipient() view returns (address)',
  'function minPriceUsdt() view returns (uint256)',
  'function maxPriceUsdt() view returns (uint256)',
  'function royaltyAware() view returns (bool)',
  'function nextOrderId() view returns (uint256)',
  'function nextBuyOrderId() view returns (uint256)',
  'function totalEscrowedUsdt() view returns (uint256)',
  'function totalEscrowedTokens() view returns (uint256)',
] as const;

const MIC_ADMIN_ABI = [
  'function setPaused(bool p) external',
  'function setFee(uint16 newBps) external',
  'function setFeeRecipient(address newRecipient) external',
  'function setPriceBounds(uint256 newMin, uint256 newMax) external',
  'function setAmountBounds(uint256 newMin, uint256 newMax) external',
  'function feeBps() view returns (uint16)',
  'function paused() view returns (bool)',
  'function feeRecipient() view returns (address)',
  'function minPriceUsdt() view returns (uint256)',
  'function maxPriceUsdt() view returns (uint256)',
  'function minAmountMic() view returns (uint256)',
  'function maxAmountMic() view returns (uint256)',
  'function totalEscrowedMic() view returns (uint256)',
  'function totalEscrowedUsdt() view returns (uint256)',
  'function nextOrderId() view returns (uint256)',
  'function nextBuyOrderId() view returns (uint256)',
] as const;

type EscrowId = 'mic' | 'mfp' | 'community';

const ESCROW_ADDRESS: Record<EscrowId, string> = {
  mic: P2P_ESCROW_MIC,
  mfp: P2P_ESCROW_MFP,
  community: P2P_ESCROW_COMMUNITY,
};

const ESCROW_LABEL: Record<EscrowId, string> = {
  mic: 'P2PEscrowMIC',
  mfp: 'P2PEscrowNFT (MFP-NFT)',
  community: 'P2PEscrowNFT (Community NFT)',
};

/** BSCScan, from the SDK rather than a literal — the same helper the rest of the console uses. */
const CHAIN_EXPLORER = getActiveChain().explorerUrl;

const ESCROW_TITLE: Record<EscrowId, string> = {
  mic: 'MIC ⇄ USDT',
  mfp: 'MFP-NFT ⇄ USDT',
  community: 'Community NFT ⇄ USDT',
};

/** State read off one escrow. `null` on a field means the call did not answer. */
type ChainState = {
  paused: boolean | null;
  feeBps: number | null;
  feeRecipient: string | null;
  minPriceUsdt: string | null;      // MIC only
  maxPriceUsdt: string | null;      // MIC only
  minAmountMic: string | null;      // MIC only
  maxAmountMic: string | null;      // MIC only
  escrowedMic: string | null;       // MIC only
  escrowedUsdt: string | null;
  escrowedTokens: number | null;    // NFT escrows only — how many NFTs are held
  orderCount: number | null;
  buyOrderCount: number | null;
  error: string | null;
};

const EMPTY_CHAIN: ChainState = {
  paused: null, feeBps: null, feeRecipient: null,
  minPriceUsdt: null, maxPriceUsdt: null, minAmountMic: null, maxAmountMic: null,
  escrowedMic: null, escrowedUsdt: null, escrowedTokens: null,
  orderCount: null, buyOrderCount: null, error: null,
};

/**
 * Parse a number the user typed, accepting a comma as the decimal mark.
 *
 * `<input type="number">` renders and parses according to the *browser's* locale. On a
 * Vietnamese profile it shows 1.5 as "1,5", and anything the user types with a comma comes
 * back from `.value` as the empty string. The fee box read "1,5" for exactly this reason.
 * Every field that feeds an on-chain write is plain text now, parsed here, so what the box
 * shows and what the transaction carries are the same number in any locale.
 */
function parseDecimal(raw: string): number {
  const cleaned = String(raw).trim().replace(/\s/g, '').replace(',', '.');
  // A second separator means grouping, not a decimal mark — reject rather than guess.
  if ((cleaned.match(/\./g) || []).length > 1) return NaN;
  return parseFloat(cleaned);
}

/** Group digits the same way in every locale. `toLocaleString()` with no argument follows
 *  the browser and turns 50000 into "50.000" on a Vietnamese profile — which the old
 *  comma-stripping onChange then read back as 50. */
const groupInt = (v: string | number) => {
  const n = Number(v);
  return isNaN(n) ? '' : n.toLocaleString('en-US');
};

/**
 * A dollar figure that stays true below one dollar.
 *
 * `groupInt(Math.round(x))` rendered the MIC floor price of $0.005 as "$0" — a price
 * bound displayed as zero reads as "no floor", which is the opposite of what it means.
 * Anything under a dollar keeps enough decimals to be itself; above it, whole dollars
 * with separators are easier to scan than cents nobody set.
 */
const usd = (v: string | number | null) => {
  const n = Number(v);
  if (v === null || isNaN(n)) return '—';
  if (n === 0) return '$0';
  if (n < 1) return `$${n.toFixed(6).replace(/0+$/, '').replace(/\.$/, '')}`;
  return `$${Math.round(n).toLocaleString('en-US')}`;
};

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

  /* Backend-stored settings.
     Only two survive, and each has a reader outside this page:
       p2p_enabled  — the DApp's gate on whether the P2P section is visible at all
       platformFee  — echoed by GET /system-info purely so the DApp can print a number

     Everything else that used to live here (kycRequired, min/maxOrderUsdt, the three
     expiry fields, maxOpenOrders, escrowTimeout, priceRangePercent, and five asset
     toggles) was written to `p2p-config` and read back by this page and nothing else.
     They are gone rather than merely relabelled: an operator who sees a box assumes it
     does something. */
  const [p2pEnabled, setP2pEnabled] = useState(false);
  const [platformFee, setPlatformFee] = useState('1.5');

  // On-chain read-back state — one record per escrow, because they are different contracts
  const [chain, setChain] = useState<Record<EscrowId, ChainState>>({
    mic: EMPTY_CHAIN, mfp: EMPTY_CHAIN, community: EMPTY_CHAIN,
  });
  const [chainLoading, setChainLoading] = useState(false);

  // On-chain controls input state (separate from display), per escrow
  const [feeInput, setFeeInput] = useState<Record<EscrowId, string>>({ mic: '', mfp: '', community: '' });
  const [feeRecipientInput, setFeeRecipientInput] = useState<Record<EscrowId, string>>({ mic: '', mfp: '', community: '' });
  const [minPriceInput, setMinPriceInput] = useState('');      // MIC only
  const [maxPriceInput, setMaxPriceInput] = useState('');      // MIC only
  const [minAmountInput, setMinAmountInput] = useState('');    // MIC only
  const [maxAmountInput, setMaxAmountInput] = useState('');    // MIC only
  const [contractBusy, setContractBusy] = useState(false);

  /*
   * Which markets the DApp offers — system config `p2p_assets`.
   *
   * This is the switch that used to be five toggles writing to `p2p-config` that nothing
   * read. The DApp now reads this through GET /rounds/system-info, so turning one off here
   * actually removes the tab.
   *
   * It gates the interface, not the contracts. Closing a market here does not pause its
   * escrow — use the on-chain controls above for that — and opening one does not make a
   * broken escrow work.
   */
  const [assetOpen, setAssetOpen] = useState<Record<string, boolean>>({
    MIC: true, MFP: false, BUILDER: false, MAKER: false, LUMINARY: false,
  });
  const [assetsBusy, setAssetsBusy] = useState(false);

  /* ── Load on-chain state, for BOTH escrows ──
     This used to read P2PEscrowMFP alone. MFP is the broken one — its MAX_PRICE_USDT is a
     `constant` set to $0.000001, so no order has ever been placed on it — while every real
     trade settles through P2PEscrowMIC, which this page could not see at all. */
  const loadChainState = useCallback(async () => {
    setChainLoading(true);
    const { JsonRpcProvider } = await import('ethers');
    const provider = new JsonRpcProvider(BSC_RPC);

    const readMic = async (): Promise<ChainState> => {
      if (!P2P_ESCROW_MIC) return { ...EMPTY_CHAIN, error: 'P2PEscrowMIC is not set in the SDK addresses' };
      try {
        const c = new Contract(P2P_ESCROW_MIC, MIC_ADMIN_ABI, provider);
        const [paused, feeBps, recipient, minP, maxP, minA, maxA, escMic, escUsdt, nOrder, nBuy] =
          await Promise.all([
            c.paused(), c.feeBps(), c.feeRecipient(),
            c.minPriceUsdt(), c.maxPriceUsdt(), c.minAmountMic(), c.maxAmountMic(),
            c.totalEscrowedMic(), c.totalEscrowedUsdt(), c.nextOrderId(), c.nextBuyOrderId(),
          ]);
        return {
          ...EMPTY_CHAIN,
          paused: paused as boolean,
          feeBps: Number(feeBps),
          feeRecipient: recipient as string,
          minPriceUsdt: formatUnits(minP as bigint, USDT_DECIMALS),
          maxPriceUsdt: formatUnits(maxP as bigint, USDT_DECIMALS),
          minAmountMic: formatUnits(minA as bigint, 18),
          maxAmountMic: formatUnits(maxA as bigint, 18),
          escrowedMic: formatUnits(escMic as bigint, 18),
          escrowedUsdt: formatUnits(escUsdt as bigint, USDT_DECIMALS),
          orderCount: Number(nOrder),
          buyOrderCount: Number(nBuy),
        };
      } catch (e: any) {
        return { ...EMPTY_CHAIN, error: e?.shortMessage || e?.message || 'read failed' };
      }
    };

    // Both NFT escrows are the same contract, so one reader serves both.
    const readNft = async (which: 'mfp' | 'community'): Promise<ChainState> => {
      const addr = ESCROW_ADDRESS[which];
      if (!addr) return { ...EMPTY_CHAIN, error: `${ESCROW_LABEL[which]} is not set in the SDK addresses` };
      try {
        const c = new Contract(addr, NFT_ADMIN_ABI, provider);
        const [paused, feeBps, recipient, nOrder, nBid, minP, maxP, escUsdt, escTok] = await Promise.all([
          c.paused(), c.feeBps(), c.feeRecipient(), c.nextOrderId(), c.nextBuyOrderId(),
          c.minPriceUsdt(), c.maxPriceUsdt(), c.totalEscrowedUsdt(), c.totalEscrowedTokens(),
        ]);
        return {
          ...EMPTY_CHAIN,
          paused: paused as boolean,
          feeBps: Number(feeBps),
          feeRecipient: recipient as string,
          orderCount: Number(nOrder),
          buyOrderCount: Number(nBid),
          // 18 decimals, read through USDT_DECIMALS rather than a written digit.
          minPriceUsdt: formatUnits(minP as bigint, USDT_DECIMALS),
          maxPriceUsdt: formatUnits(maxP as bigint, USDT_DECIMALS),
          escrowedUsdt: formatUnits(escUsdt as bigint, USDT_DECIMALS),
          escrowedTokens: Number(escTok),
        };
      } catch (e: any) {
        return { ...EMPTY_CHAIN, error: e?.shortMessage || e?.message || 'read failed' };
      }
    };

    const [mic, mfp, community] = await Promise.all([readMic(), readNft('mfp'), readNft('community')]);
    setChain({ mic, mfp, community });

    // Seed the edit boxes from chain, so an untouched field re-sends what is already set
    // rather than a hard-coded default.
    setFeeInput({
      mic: mic.feeBps === null ? '' : (mic.feeBps / 100).toFixed(2),
      mfp: mfp.feeBps === null ? '' : (mfp.feeBps / 100).toFixed(2),
      community: community.feeBps === null ? '' : (community.feeBps / 100).toFixed(2),
    });
    setFeeRecipientInput({
      mic: mic.feeRecipient ?? '',
      mfp: mfp.feeRecipient ?? '',
      community: community.feeRecipient ?? '',
    });
    if (mic.minPriceUsdt !== null) setMinPriceInput(mic.minPriceUsdt);
    if (mic.maxPriceUsdt !== null) setMaxPriceInput(mic.maxPriceUsdt);
    if (mic.minAmountMic !== null) setMinAmountInput(mic.minAmountMic);
    if (mic.maxAmountMic !== null) setMaxAmountInput(mic.maxAmountMic);

    setChainLoading(false);
  }, []);

  /**
   * Read back what was saved.
   *
   * The line that used to be here was the comment "Load backend config" followed by
   * setLoading(false) and nothing else. So every toggle on this page rendered its
   * useState default rather than its stored value: the Owner enabled P2P, the write
   * succeeded, and the next page load showed the switch off. The page was not reporting
   * state, it was reporting its own initial values.
   */
  const loadConfig = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/admin/system-config`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('mc-admin-jwt') || ''}` },
      });
      if (!res.ok) throw new Error(`config ${res.status}`);
      const body = await res.json();
      const rows: Array<{ key: string; value: string }> = body.data ?? body ?? [];
      const byKey = new Map(rows.map((r) => [r.key, r.value]));

      const rawAssets = byKey.get('p2p_assets');
      if (rawAssets) {
        try {
          const parsed = typeof rawAssets === 'string' ? JSON.parse(rawAssets) : rawAssets;
          setAssetOpen((prev) => {
            const next = { ...prev };
            for (const k of Object.keys(prev)) {
              if (typeof parsed?.[k] === 'boolean') next[k] = parsed[k];
            }
            return next;
          });
        } catch { /* leave the defaults rather than opening a market on bad JSON */ }
      }

      const flag = byKey.get('p2p_enabled');
      if (flag !== undefined) setP2pEnabled(flag === 'true' || flag === '1');

      const raw = byKey.get('p2p-config');
      if (raw) {
        const c = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (c.platformFee !== undefined) setPlatformFee(String(c.platformFee));
      }
      // Loading finished with real values, so nothing the user sees now is a default.
      setDirty(false);
    } catch (e) {
      // Say so rather than presenting defaults as if they were the saved state.
      setMsg('Could not load the saved P2P settings — the switches below may not reflect what is stored.');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadConfig();
    loadChainState();
  }, [loadConfig, loadChainState]);

  const markDirty = () => setDirty(true);

  /** Write the per-market switches. Kept off the page-wide Save so a market cannot be
   *  opened or closed as a side effect of editing something unrelated. */
  const saveAssets = async (next: Record<string, boolean>) => {
    setAssetsBusy(true);
    try {
      const jwt = typeof window !== 'undefined' ? localStorage.getItem('mc-admin-jwt') : null;
      const res = await fetch(`${API_BASE}/admin/system-config/p2p_assets`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}) },
        body: JSON.stringify({ value: JSON.stringify(next) }),
      });
      if (!res.ok) throw new Error(`save failed (${res.status})`);
      setAssetOpen(next);
      mcUi.toast({ type: 'success', message: 'Market visibility saved \u2713' });
    } catch (e: any) {
      // Reload rather than keep an optimistic value the server rejected.
      mcUi.toast({ type: 'error', message: e?.message || 'Could not save' });
      loadConfig();
    } finally {
      setAssetsBusy(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setMsg('');
    try {
      const jwt = typeof window !== 'undefined' ? localStorage.getItem('mc-admin-jwt') : null;
      const fee = parseDecimal(platformFee);
      if (isNaN(fee) || fee < 0 || fee > 100) {
        setMsg('Error: display fee must be a number between 0 and 100');
        setSaving(false);
        return;
      }
      // Only the two keys with a reader outside this page. The rest of the old blob is
      // deliberately not carried forward — leaving it in place would let a later reader
      // pick up settings that were never enforced and treat them as policy.
      const config = { p2pEnabled, platformFee: fee };

      // Save p2p_enabled toggle separately (used by user DApp)
      const r1 = await fetch(`${API_BASE}/admin/system-config/p2p_enabled`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}) },
        body: JSON.stringify({ value: String(p2pEnabled) }),
      });

      const r2 = await fetch(`${API_BASE}/admin/system-config/p2p-config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}) },
        body: JSON.stringify({ value: JSON.stringify(config) }),
      });

      // These used to be fired and forgotten, so a 403 from the capability gate reported
      // "saved successfully" and the next reload silently showed the old value.
      if (!r1.ok || !r2.ok) {
        const bad = !r1.ok ? r1 : r2;
        const body = await bad.json().catch(() => ({} as any));
        throw new Error(body.message || `${bad.status} ${bad.statusText}`);
      }

      setDirty(false);
      setMsg('P2P configuration saved successfully');
      setTimeout(() => setMsg(''), 5000);
    } catch (e: any) {
      setMsg(`Error saving P2P configuration: ${e?.message || 'unknown'}`);
    } finally {
      setSaving(false);
    }
  };

  /* ════════════════════════════════════════════════════
     On-chain handlers — wallet-sign via MetaMask
  ════════════════════════════════════════════════════ */

  async function getP2pContract(which: EscrowId) {
    const address = ESCROW_ADDRESS[which];
    if (!address) throw new Error(`No address configured for ${ESCROW_LABEL[which]}`);
    const provider = await findWalletProvider();
    const accounts = provider.request({ method: 'eth_requestAccounts' });
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('MetaMask did not respond within 60s')), 60_000),
    );
    await Promise.race([accounts, timeout]);
    await ensureBscMainnet(provider);
    const browser = new BrowserProvider(provider);
    const signer = await browser.getSigner();
    return new Contract(address, which === 'mic' ? MIC_ADMIN_ABI : NFT_ADMIN_ABI, signer);
  }

  /**
   * One place where a transaction is signed, waited on, and reported.
   *
   * `label` names the function being called and appears verbatim in every toast, so a
   * failure says which call failed on which contract instead of the generic wording each
   * of these handlers used to carry separately.
   */
  const runTx = async (
    which: EscrowId,
    label: string,
    send: (c: Contract) => Promise<any>,
    onOk: string,
  ) => {
    if (contractBusy) return;
    setContractBusy(true);
    const where = which === 'mic' ? 'P2PEscrowMIC' : 'P2PEscrowMFP';
    try {
      mcUi.toast({ type: 'info', message: `Sign ${label} on ${where} in wallet...` });
      const c = await getP2pContract(which);
      const tx = await send(c);
      mcUi.toast({ type: 'info', message: 'Waiting for confirmation...' });
      const receipt = await tx.wait(1);
      if (!receipt || receipt.status !== 1) throw new Error(`${label} reverted`);
      mcUi.toast({ type: 'success', message: onOk });
      await loadChainState();
    } catch (err: any) {
      const code = err?.code;
      const msg = code === 4001 || code === 'ACTION_REJECTED'
        ? 'Transaction rejected in wallet'
        : err?.shortMessage || err?.message || 'Unknown error';
      mcUi.toast({ type: 'error', message: `${label} on ${where} failed: ${msg}` });
    } finally {
      setContractBusy(false);
    }
  };

  const handleTogglePause = (which: EscrowId, newPaused: boolean) =>
    runTx(
      which,
      `setPaused(${newPaused})`,
      (c) => c.setPaused(newPaused),
      `P2P trading ${newPaused ? 'PAUSED' : 'RESUMED'} on ${which === 'mic' ? 'MIC' : 'MFP'} escrow ✓`,
    );

  const handleSaveFee = (which: EscrowId) => {
    const feePct = parseDecimal(feeInput[which]);
    // MAX_FEE_BPS is 1000 on both contracts — a hard constant, so 10% is the real ceiling.
    if (isNaN(feePct) || feePct < 0 || feePct > 10) {
      mcUi.toast({ type: 'error', message: 'Fee must be between 0% and 10%' });
      return;
    }
    const bps = Math.round(feePct * 100);
    return runTx(which, `setFee(${bps} bps)`, (c) => c.setFee(bps),
      `Platform fee set to ${feePct}% (${bps} bps) ✓`);
  };

  const handleSaveFeeRecipient = (which: EscrowId) => {
    const addr = feeRecipientInput[which].trim();
    if (!/^0x[a-fA-F0-9]{40}$/.test(addr)) {
      mcUi.toast({ type: 'error', message: 'Invalid address format (must be 0x...)' });
      return;
    }
    return runTx(which, 'setFeeRecipient()', (c) => c.setFeeRecipient(addr),
      'Fee recipient updated on-chain ✓');
  };

  /* ── The two bound setters, MIC only.
     These are the real Min/Max Order controls. The boxes that used to sit under "Trading
     Parameters" wrote to a JSON blob in SystemConfig that no contract and no other page
     ever read. */
  const handleSavePriceBounds = () => {
    const lo = parseDecimal(minPriceInput);
    const hi = parseDecimal(maxPriceInput);
    if (isNaN(lo) || isNaN(hi) || lo <= 0 || hi <= lo) {
      mcUi.toast({ type: 'error', message: 'Need 0 < min price < max price' });
      return;
    }
    // FLOOR_PRICE_USDT / CEILING_PRICE_USDT are constants on the contract; it will revert
    // outside them. Saying so here beats letting the wallet show a bare revert.
    if (lo < 0.001 || hi > 100_000_000) {
      mcUi.toast({ type: 'error', message: 'Contract hard limits: min ≥ $0.001, max ≤ $100,000,000' });
      return;
    }
    return runTx('mic', `setPriceBounds($${lo}, $${hi})`,
      (c) => c.setPriceBounds(parseUnits(String(lo), USDT_DECIMALS), parseUnits(String(hi), USDT_DECIMALS)),
      `Price bounds set to $${lo} – $${hi} per MIC ✓`);
  };

  const handleSaveAmountBounds = () => {
    const lo = parseDecimal(minAmountInput);
    const hi = parseDecimal(maxAmountInput);
    if (isNaN(lo) || isNaN(hi) || lo <= 0 || hi <= lo) {
      mcUi.toast({ type: 'error', message: 'Need 0 < min amount < max amount' });
      return;
    }
    return runTx('mic', `setAmountBounds(${lo}, ${hi} MIC)`,
      (c) => c.setAmountBounds(parseUnits(String(lo), 18), parseUnits(String(hi), 18)),
      `Order size bounds set to ${groupInt(lo)} – ${groupInt(hi)} MIC ✓`);
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
          {'✅'} P2P Exchange is <strong>ACTIVE</strong> in the DApp. MIC trades settle
          through P2PEscrowMIC. MFP-NFT trading is not available — its escrow must be
          redeployed first.
        </div>
      )}

      {/* Save message */}
      {msg && (
        <div style={{
          padding: '8px 14px', marginBottom: 12, borderRadius: 8, fontSize: SZ, fontWeight: 600, fontFamily: 'var(--font-m)',
          background: msg.includes('Error') ? 'rgba(255,80,102,.15)' : 'rgba(80,200,120,.15)',
          color: msg.includes('Error') ? '#FF5066' : '#50c878',
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
        </div>
        <div style={{ marginTop: 12, fontSize: '0.6rem', color: 'var(--gray2)', lineHeight: 1.7 }}>
          This switch controls visibility in the DApp only. Whether trading is actually
          possible is decided on chain by each escrow&apos;s <code>paused</code> flag — see
          On-Chain Contract Controls below. Turning this off hides the section; it does not
          stop anyone calling the contract directly.
        </div>
      </div>

      {/* ═══ ON-CHAIN CONTRACT CONTROLS (owner wallet only) ═══

          Rendered once per escrow. The page used to show a single card wired to
          P2PEscrowMFP — the contract nobody can trade on, because its MAX_PRICE_USDT is a
          `constant` of $0.000001 — while every real MIC trade settled through
          P2PEscrowMIC, which had no controls here at all. */}
      {isSuperAdmin && (
        <>
          <div className="sep-lbl">On-Chain Contract Controls</div>

          {(['mic', 'mfp', 'community'] as EscrowId[]).map((which) => {
            const st = chain[which];
            const isMic = which === 'mic';
            const address = ESCROW_ADDRESS[which];

            return (
              <div key={which} className="card" style={{ padding: 22, marginBottom: 16 }}>
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: SZ, fontWeight: 700, color: 'var(--gold)', fontFamily: 'var(--font-d)', letterSpacing: '0.06em', marginBottom: 4 }}>
                    {ESCROW_LABEL[which].toUpperCase()} — {address || 'not configured'}
                    <span style={{ marginLeft: 8, color: st.paused === true ? '#FF5066' : '#50c878' }}>
                      {st.paused === null ? '—' : st.paused ? 'PAUSED' : 'LIVE'}
                    </span>
                  </div>
                  <div style={{ fontSize: '0.56rem', color: 'var(--gray2)', fontFamily: 'var(--font-m)', fontStyle: 'italic' }}>
                    {ESCROW_TITLE[which]}. Each action signs 1 on-chain tx; owner wallet only.
                    {which === 'community' && ' CommunityNFTv2 does not implement ERC-2981, so no royalty is taken here.'}
                    {which === 'mfp' && ' MFPNFT pays a 5% ERC-2981 royalty, deducted at settlement.'}
                  </div>
                </div>

                {st.error && (
                  <div className="alert alert-warn" style={{ marginBottom: 14, fontSize: '0.6rem' }}>
                    Could not read this contract: {st.error}
                  </div>
                )}

                {/* Chain state summary */}
                {chainLoading ? (
                  <div style={{ fontSize: SZ, color: 'var(--gray2)', marginBottom: 14 }}>Loading on-chain state...</div>
                ) : (
                  <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginBottom: 18, padding: '10px 14px', background: 'var(--bg3)', borderRadius: 8 }}>
                    <div>
                      <div style={{ fontSize: '0.55rem', color: 'var(--gray2)', fontFamily: 'var(--font-m)', marginBottom: 2 }}>CONTRACT PAUSED</div>
                      <div style={{ fontSize: SZ, fontWeight: 700, color: st.paused ? '#FF5066' : '#50c878', fontFamily: 'var(--font-m)' }}>
                        {st.paused === null ? '—' : st.paused ? 'YES' : 'NO'}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: '0.55rem', color: 'var(--gray2)', fontFamily: 'var(--font-m)', marginBottom: 2 }}>PLATFORM FEE</div>
                      <div style={{ fontSize: SZ, fontWeight: 700, color: 'var(--gold)', fontFamily: 'var(--font-m)' }}>
                        {st.feeBps === null ? '—' : `${(st.feeBps / 100).toFixed(2)}% (${st.feeBps} bps)`}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: '0.55rem', color: 'var(--gray2)', fontFamily: 'var(--font-m)', marginBottom: 2 }}>FEE RECIPIENT</div>
                      <div style={{ fontSize: SZ, fontWeight: 700, color: 'var(--white)', fontFamily: 'var(--font-m)' }}>
                        {st.feeRecipient === null ? '—' : truncate(st.feeRecipient)}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: '0.55rem', color: 'var(--gray2)', fontFamily: 'var(--font-m)', marginBottom: 2 }}>ORDERS CREATED</div>
                      <div style={{ fontSize: SZ, fontWeight: 700, color: 'var(--white)', fontFamily: 'var(--font-m)' }}>
                        {st.orderCount === null ? '—' : `${st.orderCount} sell / ${st.buyOrderCount ?? '—'} buy`}
                      </div>
                    </div>
                    {isMic && (
                      <div>
                        <div style={{ fontSize: '0.55rem', color: 'var(--gray2)', fontFamily: 'var(--font-m)', marginBottom: 2 }}>IN ESCROW NOW</div>
                        <div style={{ fontSize: SZ, fontWeight: 700, color: 'var(--white)', fontFamily: 'var(--font-m)' }}>
                          {st.escrowedMic === null ? '—' : `${groupInt(Math.round(Number(st.escrowedMic)))} MIC`}
                          {st.escrowedUsdt === null ? '' : ` · $${Number(st.escrowedUsdt).toFixed(2)}`}
                        </div>
                      </div>
                    )}
                    {!isMic && (
                      <div>
                        <div style={{ fontSize: '0.55rem', color: 'var(--gray2)', fontFamily: 'var(--font-m)', marginBottom: 2 }}>PRICE RANGE</div>
                        <div style={{ fontSize: SZ, fontWeight: 700, color: 'var(--white)', fontFamily: 'var(--font-m)' }}>
                          {st.minPriceUsdt === null ? '—' : `${usd(st.minPriceUsdt)} – ${usd(st.maxPriceUsdt)}`}
                        </div>
                      </div>
                    )}
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
                      onClick={() => handleTogglePause(which, false)}
                      disabled={contractBusy || st.paused === false}
                      style={{
                        padding: '7px 18px', fontSize: SZ, fontFamily: 'var(--font-d)',
                        background: st.paused === false ? 'rgba(80,200,120,.08)' : 'transparent',
                        color: '#50c878', border: `1px solid ${st.paused === false ? '#50c878' : 'var(--border)'}`,
                        borderRadius: 6, cursor: contractBusy || st.paused === false ? 'default' : 'pointer',
                        fontWeight: 700, opacity: contractBusy ? 0.5 : 1,
                      }}>
                      {'▶'} RESUME Trading
                    </button>
                    <button
                      onClick={() => handleTogglePause(which, true)}
                      disabled={contractBusy || st.paused === true}
                      style={{
                        padding: '7px 18px', fontSize: SZ, fontFamily: 'var(--font-d)',
                        background: st.paused === true ? 'rgba(255,80,102,.08)' : 'transparent',
                        color: '#FF5066', border: `1px solid ${st.paused === true ? '#FF5066' : 'var(--border)'}`,
                        borderRadius: 6, cursor: contractBusy || st.paused === true ? 'default' : 'pointer',
                        fontWeight: 700, opacity: contractBusy ? 0.5 : 1,
                      }}>
                      {'⏸'} PAUSE Trading
                    </button>
                  </div>
                  <div style={hintStyle}>
                    Calls <code>setPaused(bool)</code>. Active orders
                    unaffected; new orders and fills are blocked while paused.
                  </div>
                </div>

                {/* Fee % */}
                <div className="g3" style={{ marginBottom: 18 }}>
                  <div>
                    <div className="input-label" style={{ marginBottom: 6 }}>Platform Fee (%)</div>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={feeInput[which]}
                      onChange={e => setFeeInput({ ...feeInput, [which]: e.target.value })}
                      placeholder="1.5"
                      style={inputStyle}
                    />
                    <div style={hintStyle}>
                      0% – 10% (<code>MAX_FEE_BPS</code> is 1000, a hard constant).
                      Sends {isNaN(parseDecimal(feeInput[which] || '')) ? '—' : Math.round(parseDecimal(feeInput[which]) * 100)} bps.
                      A comma is accepted as the decimal mark.
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: 1 }}>
                    <button
                      onClick={() => handleSaveFee(which)}
                      disabled={contractBusy}
                      style={{
                        padding: '7px 18px', fontSize: SZ, fontFamily: 'var(--font-d)',
                        background: 'var(--gold)', color: '#000', border: 'none',
                        borderRadius: 6, cursor: contractBusy ? 'default' : 'pointer',
                        fontWeight: 700, opacity: contractBusy ? 0.5 : 1,
                      }}>
                      {contractBusy ? '...' : 'SET FEE'}
                    </button>
                  </div>
                </div>

                {/* No cancellation-fee control any more. P2PEscrowNFT charges nothing to
                    cancel — withdrawing an offer nobody accepted is not a wrong — so there
                    is no setCancellationFee to call. The dead escrow had one. */}

                {/* Price and size bounds — MIC only. These are the genuine Min/Max Order
                    controls: on chain, enforced on every createOrder, and adjustable. */}
                {isMic && (
                  <>
                    <div className="g3" style={{ marginBottom: 18 }}>
                      <div>
                        <div className="input-label" style={{ marginBottom: 6 }}>Min Price (USDT per MIC)</div>
                        <input type="text" inputMode="decimal" value={minPriceInput}
                          onChange={e => setMinPriceInput(e.target.value)} style={inputStyle} />
                        <div style={hintStyle}>Contract floor: $0.001. Currently ${st.minPriceUsdt ?? '—'}.</div>
                      </div>
                      <div>
                        <div className="input-label" style={{ marginBottom: 6 }}>Max Price (USDT per MIC)</div>
                        <input type="text" inputMode="decimal" value={maxPriceInput}
                          onChange={e => setMaxPriceInput(e.target.value)} style={inputStyle} />
                        <div style={hintStyle}>Contract ceiling: $100,000,000. Currently ${st.maxPriceUsdt ?? '—'}.</div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: 1 }}>
                        <button
                          onClick={handleSavePriceBounds}
                          disabled={contractBusy}
                          style={{
                            padding: '7px 18px', fontSize: SZ, fontFamily: 'var(--font-d)', whiteSpace: 'nowrap',
                            background: 'var(--gold)', color: '#000', border: 'none',
                            borderRadius: 6, cursor: contractBusy ? 'wait' : 'pointer',
                            fontWeight: 700, opacity: contractBusy ? 0.6 : 1,
                          }}>
                          {contractBusy ? '...' : 'SET PRICE BOUNDS'}
                        </button>
                      </div>
                    </div>

                    <div className="g3" style={{ marginBottom: 18 }}>
                      <div>
                        <div className="input-label" style={{ marginBottom: 6 }}>Min Order Size (MIC)</div>
                        <input type="text" inputMode="decimal" value={minAmountInput}
                          onChange={e => setMinAmountInput(e.target.value)} style={inputStyle} />
                        <div style={hintStyle}>Currently {st.minAmountMic === null ? '—' : groupInt(Math.round(Number(st.minAmountMic)))} MIC.</div>
                      </div>
                      <div>
                        <div className="input-label" style={{ marginBottom: 6 }}>Max Order Size (MIC)</div>
                        <input type="text" inputMode="decimal" value={maxAmountInput}
                          onChange={e => setMaxAmountInput(e.target.value)} style={inputStyle} />
                        <div style={hintStyle}>Currently {st.maxAmountMic === null ? '—' : groupInt(Math.round(Number(st.maxAmountMic)))} MIC.</div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: 1 }}>
                        <button
                          onClick={handleSaveAmountBounds}
                          disabled={contractBusy}
                          style={{
                            padding: '7px 18px', fontSize: SZ, fontFamily: 'var(--font-d)', whiteSpace: 'nowrap',
                            background: 'var(--gold)', color: '#000', border: 'none',
                            borderRadius: 6, cursor: contractBusy ? 'wait' : 'pointer',
                            fontWeight: 700, opacity: contractBusy ? 0.6 : 1,
                          }}>
                          {contractBusy ? '...' : 'SET SIZE BOUNDS'}
                        </button>
                      </div>
                    </div>
                  </>
                )}

                {/* Fee Recipient */}
                <div>
                  <div className="input-label" style={{ marginBottom: 6 }}>Fee Recipient Address</div>
                  <div style={{ display: 'flex', gap: 10 }}>
                    <input
                      type="text"
                      value={feeRecipientInput[which]}
                      onChange={e => setFeeRecipientInput({ ...feeRecipientInput, [which]: e.target.value })}
                      placeholder="0x..."
                      style={{ ...inputStyle, flex: 1 }}
                    />
                    <button
                      onClick={() => handleSaveFeeRecipient(which)}
                      disabled={contractBusy}
                      style={{
                        padding: '7px 18px', fontSize: SZ, fontFamily: 'var(--font-d)', whiteSpace: 'nowrap',
                        background: 'var(--gold)', color: '#000', border: 'none',
                        borderRadius: 6, cursor: contractBusy ? 'default' : 'pointer',
                        fontWeight: 700, opacity: contractBusy ? 0.5 : 1,
                        flexShrink: 0,
                      }}>
                      {contractBusy ? '...' : 'SET RECIPIENT'}
                    </button>
                  </div>
                  <div style={hintStyle}>Address that receives platform fees from P2P trades. Typically TreasuryManager.</div>
                </div>
              </div>
            );
          })}
        </>
      )}

      {/* ═══ FEE CONFIGURATION ═══ */}
      <div className="sep-lbl">Fee Configuration (UI)</div>
      <div className="g2" style={{ marginBottom: 16 }}>
        <div className="card" style={{ padding: 22 }}>
          <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <span style={{ fontSize: '1.1rem' }}>{'💸'}</span> Platform Fee
          </div>
          <div className="alert alert-warn" style={{ marginBottom: 14, fontSize: '0.6rem', lineHeight: 1.6 }}>
            <div>
              <strong>This number is a label, not the fee.</strong> It is echoed by{' '}
              <code>GET /system-info</code> so the DApp can print a percentage next to a trade.
              The fee that is actually charged lives on the escrow contract and is set in{' '}
              <strong>On-Chain Contract Controls</strong> above. Keep the two in step by hand —
              nothing checks that they agree.
            </div>
          </div>
          <div style={{ marginBottom: 12 }}>
            <div className="input-label" style={{ marginBottom: 6 }}>Display Fee Rate (%)</div>
            {/*
              Plain text, not type="number". On a Vietnamese browser profile a number input
              renders 1.5 as "1,5" and hands back "" for anything typed with a comma — which
              is why this box read "1,5". parseDecimal accepts either mark.
            */}
            <input
              type="text"
              inputMode="decimal"
              value={platformFee}
              onChange={e => { setPlatformFee(e.target.value); markDirty(); }}
              placeholder="1.5"
              style={inputStyle}
            />
            <div style={hintStyle}>
              Displayed to members as{' '}
              <strong style={{ color: 'var(--gold)' }}>
                {isNaN(parseDecimal(platformFee)) ? '—' : `${parseDecimal(platformFee)}%`}
              </strong>. A comma is accepted as the decimal mark.
            </div>
          </div>
          <div style={{ background: 'var(--bg3)', borderRadius: 8, padding: '10px 14px' }}>
            <div className="info-row">
              <span className="info-key">On chain now (MIC escrow)</span>
              <span className="info-val" style={{ fontFamily: 'var(--font-m)', color: 'var(--gold)' }}>
                {chain.mic.feeBps === null ? '—' : `${(chain.mic.feeBps / 100).toFixed(2)}%`}
              </span>
            </div>
            <div className="info-row">
              <span className="info-key">Example: $1,000 trade</span>
              <span className="info-val" style={{ fontFamily: 'var(--font-m)', color: 'var(--gold)' }}>
                {chain.mic.feeBps === null ? '—' : `$${(1000 * chain.mic.feeBps / 10000).toFixed(2)}`}
              </span>
            </div>
            {chain.mic.feeBps !== null && !isNaN(parseDecimal(platformFee))
              && Math.round(parseDecimal(platformFee) * 100) !== chain.mic.feeBps && (
              <div style={{ fontSize: '0.58rem', color: '#FF5066', marginTop: 8, lineHeight: 1.6 }}>
                Mismatch: members are shown {parseDecimal(platformFee)}% while the contract
                charges {(chain.mic.feeBps / 100).toFixed(2)}%.
              </div>
            )}
          </div>
        </div>

        <div className="card" style={{ padding: 22 }}>
          <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <span style={{ fontSize: '1.1rem' }}>{'🏦'}</span> Fee Destination
          </div>
          <div className="callout" style={{ fontSize: '0.64rem', lineHeight: 1.75, marginBottom: 14 }}>
            All collected fees flow to TreasuryManager.sol (DAO Treasury). The DAO governs how these funds are used.
          </div>
          <div className="info-row"><span className="info-key">Recipient</span><span className="info-val"><span className="badge b-ok">TreasuryManager</span></span></div>
          <div className="info-row"><span className="info-key">Contract</span><span className="info-val" style={{ fontFamily: 'var(--font-m)', fontSize: '0.56rem' }}>TreasuryManager.sol</span></div>
          <div className="info-row"><span className="info-key">Governance</span><span className="info-val">DAO Controlled</span></div>
          <div className="info-row"><span className="info-key">Settlement</span><span className="info-val">Atomic (single tx)</span></div>
        </div>
      </div>

      {/* ═══ WHAT THE CONTRACT ACTUALLY ENFORCES ═══

          This replaces a "Trading Parameters" card of eight input boxes — Min/Max Order,
          Max Open Orders, three expiry fields, Escrow Timeout, Price Range. Every one of
          them wrote into the `p2p-config` JSON blob in SystemConfig, and a repo-wide search
          for each key found exactly one reader: this page, loading back what it had saved.
          No contract, no API route and no DApp screen consulted any of them.

          A box that accepts a number and enforces nothing is worse than no box: it tells
          the operator a limit is in force. The real limits live on the contract and are set
          above, in On-Chain Contract Controls. */}
      <div className="sep-lbl">Trading Rules — enforced on chain</div>
      <div className="card" style={{ padding: 22, marginBottom: 16 }}>
        <div className="callout" style={{ fontSize: '0.64rem', lineHeight: 1.75, marginBottom: 14 }}>
          These are read from <code>P2PEscrowMIC</code>, not stored here. The ones marked
          adjustable are changed in <strong>On-Chain Contract Controls</strong> above; the
          rest are <code>constant</code> in the contract and can only change by redeploying.
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', fontSize: '0.56rem', lineHeight: 1.6, borderCollapse: 'collapse', fontFamily: 'var(--font-m)' }}>
            <thead>
              <tr style={{ color: 'var(--gray2)', textAlign: 'left' }}>
                <th style={{ padding: '6px 8px' }}>Rule</th>
                <th style={{ padding: '6px 8px' }}>Current value</th>
                <th style={{ padding: '6px 8px' }}>Changeable?</th>
              </tr>
            </thead>
            <tbody>
              <tr style={{ borderTop: '1px solid var(--border)' }}>
                <td style={{ padding: '6px 8px' }}>Order size</td>
                <td style={{ padding: '6px 8px' }}>
                  {chain.mic.minAmountMic === null ? '—' : groupInt(Math.round(Number(chain.mic.minAmountMic)))}
                  {' – '}
                  {chain.mic.maxAmountMic === null ? '—' : groupInt(Math.round(Number(chain.mic.maxAmountMic)))} MIC
                </td>
                <td style={{ padding: '6px 8px', color: '#50c878' }}>yes — setAmountBounds</td>
              </tr>
              <tr style={{ borderTop: '1px solid var(--border)' }}>
                <td style={{ padding: '6px 8px' }}>Price per MIC</td>
                <td style={{ padding: '6px 8px' }}>
                  ${chain.mic.minPriceUsdt ?? '—'} – ${chain.mic.maxPriceUsdt ?? '—'}
                </td>
                <td style={{ padding: '6px 8px', color: '#50c878' }}>yes — setPriceBounds</td>
              </tr>
              <tr style={{ borderTop: '1px solid var(--border)' }}>
                <td style={{ padding: '6px 8px' }}>Platform fee</td>
                <td style={{ padding: '6px 8px' }}>
                  {chain.mic.feeBps === null ? '—' : `${(chain.mic.feeBps / 100).toFixed(2)}%`}
                </td>
                <td style={{ padding: '6px 8px', color: '#50c878' }}>yes — setFee, capped at 10%</td>
              </tr>
              <tr style={{ borderTop: '1px solid var(--border)' }}>
                <td style={{ padding: '6px 8px' }}>Order expiry</td>
                <td style={{ padding: '6px 8px' }}>1 hour – 30 days, chosen per order by the seller</td>
                <td style={{ padding: '6px 8px', color: 'var(--gray2)' }}>no — constant</td>
              </tr>
              <tr style={{ borderTop: '1px solid var(--border)' }}>
                <td style={{ padding: '6px 8px' }}>Absolute price floor / ceiling</td>
                <td style={{ padding: '6px 8px' }}>$0.001 – $100,000,000</td>
                <td style={{ padding: '6px 8px', color: 'var(--gray2)' }}>no — constant</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div style={{ marginTop: 16, padding: '10px 14px', borderRadius: 8, background: 'var(--bg3)', fontSize: '0.6rem', color: 'var(--gray2)', lineHeight: 1.7 }}>
          <strong style={{ color: 'var(--white)' }}>Removed from this page, because nothing read them:</strong>{' '}
          Min/Max Order (USDT), Max Open Orders per User, Default/Min/Max Expiry, Escrow
          Timeout, Price Range vs pool price, Require KYC to Trade, and the five asset
          on/off switches. Each was saved into <code>p2p-config</code> and loaded back by this
          page alone — no contract, API route or DApp screen consulted any of them, so
          setting one changed nothing about how the market behaved.
          <br /><br />
          <strong style={{ color: 'var(--white)' }}>Note on escrow timeout in particular:</strong>{' '}
          there is no payment window to configure. A P2P trade here settles atomically in a
          single transaction — MIC and USDT move together or neither moves — so there is no
          interval during which a buyer could fail to pay.
          <br /><br />
          <strong style={{ color: 'var(--white)' }}>Note on KYC:</strong> the escrow checks
          roles and balances only. If P2P must be gated on KYC, that gate has to be built —
          it is not something this switch was ever turning on.
        </div>
      </div>

      {/* ═══ SUPPORTED ASSETS ═══ */}
      <div className="sep-lbl">Tradable Assets</div>
      <div className="card" style={{ padding: 22, marginBottom: 16 }}>
        <div className="callout" style={{ fontSize: '0.64rem', lineHeight: 1.75, marginBottom: 16 }}>
          <div>
            {/* "P2P" reads as the product name here, so it is capitalised. The exact key
                is deliberately not quoted: `p2p-config` is a real SystemConfig row, and
                spelling an identifier in title case in prose is how someone later searches
                the database for a key that does not exist. The name lives in the code. */}
            These switches decide what the DApp offers members. They are saved immediately and
            read by the app on its next load &mdash; unlike the five toggles that used to sit
            here, which wrote to a P2P config entry that nothing read.
            <br /><br />
            <strong>This gates the interface, not the contracts.</strong> Closing a market
            hides its tab; it does not pause the escrow &mdash; use{' '}
            <strong>On-Chain Contract Controls</strong> above for that. Opening a market here
            only makes the tab appear: what the escrow will actually accept is the{' '}
            <strong>Status on chain</strong> column, which is read live and not written here.
          </div>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', fontSize: '0.56rem', lineHeight: 1.6, borderCollapse: 'collapse', fontFamily: 'var(--font-m)' }}>
            <thead>
              <tr style={{ color: 'var(--gray2)', textAlign: 'left' }}>
                <th style={{ padding: '6px 8px' }}>Asset</th>
                <th style={{ padding: '6px 8px' }}>Standard</th>
                <th style={{ padding: '6px 8px' }}>Escrow</th>
                <th style={{ padding: '6px 8px' }}>Status on chain</th>
                <th style={{ padding: '6px 8px' }}>Show in DApp</th>
              </tr>
            </thead>
            {/*
              Every cell below is derived, not typed.

              The MFP and Community rows used to carry their status as literal text —
              "unusable — price cap $0.000001, needs redeploy" and "no escrow deployed".
              Both were true when written and both were false within the day, on the one
              screen an operator consults before deciding anything. A status that is typed
              goes stale silently; a status that is read cannot.
            */}
            <tbody>
              {([
                { id: 'mic' as EscrowId, icon: '💰', name: 'MIC Token', standard: 'BEP-20', ids: ['MIC'] },
                { id: 'mfp' as EscrowId, icon: '👑', name: 'MFP-NFT', standard: 'ERC-721', ids: ['MFP'] },
                { id: 'community' as EscrowId, icon: '🛠️', name: 'Community NFT (Builder / Maker / Luminary)', standard: 'ERC-721', ids: ['BUILDER', 'MAKER', 'LUMINARY'] },
              ]).map((row) => {
                const st = chain[row.id];
                const addr = ESCROW_ADDRESS[row.id];

                // Three distinct states, and they need different words. "Not deployed" and
                // "deployed but unreadable" look identical if both render as a dash.
                let status: string;
                let colour: string;
                if (!addr) {
                  status = 'no escrow deployed — cannot be traded';
                  colour = 'var(--gray2)';
                } else if (st.error) {
                  status = `could not read the contract — ${st.error}`;
                  colour = '#FFB200';
                } else if (st.paused === null) {
                  status = 'reading…';
                  colour = 'var(--gray2)';
                } else if (st.paused) {
                  status = 'paused on chain';
                  colour = '#FF5066';
                } else {
                  status = st.minPriceUsdt === null
                    ? 'trading'
                    : `trading · ${usd(st.minPriceUsdt)}–${usd(st.maxPriceUsdt)}`;
                  colour = '#50c878';
                }

                return (
                  <tr key={row.id} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ padding: '6px 8px' }}>{row.icon} {row.name}</td>
                    <td style={{ padding: '6px 8px' }}>{row.standard}</td>
                    <td style={{ padding: '6px 8px', color: addr ? undefined : 'var(--gray2)' }}>
                      {addr
                        ? <a href={`${CHAIN_EXPLORER}/address/${addr}`} target="_blank" rel="noopener noreferrer"
                             style={{ color: 'var(--gold)', textDecoration: 'none' }} title={addr}>
                            {ESCROW_LABEL[row.id]} ↗
                          </a>
                        : 'none'}
                    </td>
                    <td style={{ padding: '6px 8px', color: colour }}>{status}</td>
                    <td style={{ padding: '6px 8px' }}>
                      <AssetSwitch
                        ids={row.ids}
                        open={assetOpen}
                        busy={assetsBusy}
                        onChange={(next) => saveAssets(next)}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div style={{ marginTop: 14, fontSize: '0.6rem', color: 'var(--gray2)', lineHeight: 1.7 }}>
          Community NFTs were listed here as three separate ERC-1155 assets. They are one
          ERC-721 collection: <code>CommunityNFT</code> (ERC-1155) was superseded by{' '}
          <code>CommunityNFTv2</code>, which mints a unique serial per token. Builder, Maker
          and Luminary are tiers within it, not three contracts.
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
          <div className="info-row"><span className="info-key">Locked MIC</span><span className="info-val" style={{ color: '#FF5066' }}>Cannot sell (vesting)</span></div>
          <div className="info-row"><span className="info-key">Expired NFT</span><span className="info-val" style={{ color: '#FF5066' }}>Cannot list</span></div>
          <div className="info-row"><span className="info-key">Staked MFP</span><span className="info-val" style={{ color: '#FF5066' }}>Must unstake first</span></div>
          <div className="info-row"><span className="info-key">KYC Check</span><span className="info-val"><span className="badge b-gray">Not enforced</span></span></div>
          <div className="info-row"><span className="info-key">Emergency</span><span className="info-val">Admin can pause contract</span></div>
          <div className="callout" style={{ fontSize: '0.64rem', lineHeight: 1.75, marginTop: 12 }}>
            <strong>Asset validation:</strong> Contract checks lockedOf() for MIC, isActive() for Community NFTs, and staking status for MFP before allowing listing.
          </div>
        </div>
      </div>

      {/* ═══ ORDERS OVERVIEW ═══ */}
      {/*
        Read from the three escrows, not from a state object.

        This block used to render `const [stats] = useState({ ... zeros })` — declared with
        no setter, fetched by nothing, so every tile showed a dash forever. It looked like
        a dashboard that had no data; it was a dashboard that had no wiring.

        The tiles that survive are the ones chain can answer in one call each. Volume,
        fees taken and "completed today" need the event history, and the indexer only
        follows the MFP escrow while every live order today sits on the MIC one — so they
        are named as missing rather than shown as a dash that reads like zero.

        There is no Disputes tile any more: none of these contracts has a dispute path.
        Settlement is atomic, cancel returns the escrow, expiry returns it permissionlessly.
        A counter that can only ever read zero is not information.
      */}
      <div className="sep-lbl">Orders Overview</div>
      <div className="g4" style={{ marginBottom: 16 }}>
        {(['mic', 'mfp', 'community'] as EscrowId[]).map((which) => {
          const st = chain[which];
          return (
            <div className="stat-box" key={which}>
              <div className="stat-lbl">{ESCROW_TITLE[which]} — orders created</div>
              <div className="stat-val">
                {st.orderCount === null ? '—' : st.orderCount}
                <span style={{ fontSize: '0.6rem', color: 'var(--gray2)' }}> sell</span>
                {' / '}
                {st.buyOrderCount === null ? '—' : st.buyOrderCount}
                <span style={{ fontSize: '0.6rem', color: 'var(--gray2)' }}> buy</span>
              </div>
            </div>
          );
        })}
        <div className="stat-box">
          <div className="stat-lbl">Fee charged</div>
          <div className="stat-val gold">
            {chain.mic.feeBps === null ? '—' : `${(chain.mic.feeBps / 100).toFixed(2)}%`}
          </div>
        </div>
      </div>

      <div className="callout" style={{ fontSize: '0.64rem', lineHeight: 1.75, marginBottom: 16 }}>
        <div>
          <strong>Volume, fees taken and completed-today are not shown here.</strong> Those
          need the trade history, and the event indexer currently follows the MFP escrow
          only &mdash; every order placed so far is on the MIC escrow, which it does not
          watch. Showing them as &ldquo;0&rdquo; or &ldquo;&mdash;&rdquo; would read as
          &ldquo;no trades&rdquo; rather than &ldquo;not measured&rdquo;. The counters above
          come straight from each contract and are exact.
        </div>
      </div>

      {/* ═══ ESCROW BALANCE ═══ */}
      <div className="sep-lbl">Escrow Contract Balance</div>
      <div className="card" style={{ padding: 22, marginBottom: 16 }}>
        <div className="callout" style={{ fontSize: '0.64rem', lineHeight: 1.75, marginBottom: 12 }}>
          Assets currently held in escrow awaiting settlement, read live from each contract&rsquo;s
          own counter. These are locked by open orders and are released on fill, cancel, or expiry.
        </div>
        <div className="g2">
          <div>
            <div className="info-row"><span className="info-key">MIC in Escrow</span><span className="info-val" style={{ fontFamily: 'var(--font-m)' }}>
              {chain.mic.escrowedMic === null ? '—' : `${groupInt(Math.round(Number(chain.mic.escrowedMic)))} MIC`}
            </span></div>
            <div className="info-row"><span className="info-key">USDT in Escrow</span><span className="info-val" style={{ fontFamily: 'var(--font-m)' }}>
              {/* Bids escrow USDT on all three contracts, so this is their sum. */}
              {[chain.mic, chain.mfp, chain.community].every((c) => c.escrowedUsdt === null)
                ? '—'
                : `$${[chain.mic, chain.mfp, chain.community].reduce((t, c) => t + Number(c.escrowedUsdt ?? 0), 0).toFixed(2)}`}
            </span></div>
          </div>
          <div>
            <div className="info-row"><span className="info-key">MFP-NFTs in Escrow</span><span className="info-val" style={{ fontFamily: 'var(--font-m)' }}>
              {chain.mfp.escrowedTokens === null ? '—' : chain.mfp.escrowedTokens}
            </span></div>
            <div className="info-row"><span className="info-key">Community NFTs in Escrow</span><span className="info-val" style={{ fontFamily: 'var(--font-m)' }}>
              {chain.community.escrowedTokens === null ? '—' : chain.community.escrowedTokens}
            </span></div>
          </div>
        </div>
      </div>
    </>
  );
}

/**
 * One switch per market row.
 *
 * Community NFT is a single ERC-721 collection but the DApp shows Builder, Maker and
 * Luminary as separate tabs, so that row drives three keys at once. Passing the ids in
 * keeps the row and the config keys in one place instead of spread across the table.
 */
function AssetSwitch({ ids, open, busy, onChange }: {
  ids: string[];
  open: Record<string, boolean>;
  busy: boolean;
  onChange: (next: Record<string, boolean>) => void;
}) {
  const on = ids.every((k) => open[k]);
  return (
    <button
      onClick={() => {
        const next = { ...open };
        for (const k of ids) next[k] = !on;
        onChange(next);
      }}
      disabled={busy}
      style={{
        padding: '4px 12px', fontSize: '0.56rem', fontFamily: 'var(--font-d)', fontWeight: 700,
        borderRadius: 6, cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.6 : 1,
        background: on ? 'rgba(80,200,120,.10)' : 'transparent',
        color: on ? '#50c878' : 'var(--gray2)',
        border: `1px solid ${on ? '#50c878' : 'var(--border)'}`,
      }}
    >
      {on ? 'SHOWN' : 'HIDDEN'}
    </button>
  );
}
