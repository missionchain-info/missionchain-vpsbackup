'use client';

import { useState, useEffect, useCallback } from 'react';
import { BrowserProvider, Contract, formatUnits as fmtUnits, parseUnits } from 'ethers';
import { fetchStatsOverview } from '@/lib/api';
import { getActiveAddresses, getActiveChain, USDT_DECIMALS } from '@missionchain/sdk';
import { useMcUi } from '@/components/ui/McUi';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

const A = getActiveAddresses() as Record<string, string>;
const CHAIN = getActiveChain();

/**
 * The pool's own read surface. Everything on this page that describes the pool comes from
 * here — the figures used to be `const poolMic = 0` with a note saying they would come
 * from the contract "later", which is why Pool MIC and Pool USDT rendered as dashes long
 * after the pool held fifty million MIC.
 */
const POOL_ABI = [
  'function isSeeded() view returns (bool)',
  'function reserveMic() view returns (uint256)',
  'function reserveUsdt() view returns (uint256)',
  'function virtualReserve() view returns (uint256)',
  'function spotPrice() view returns (uint256)',
  'function poolAgeDays() view returns (uint256)',
  'function startTime() view returns (uint256)',
  'function SELL_OPEN_DAY() view returns (uint256)',
  'function BUY_FEE_BPS() view returns (uint256)',
  'function sellFeeBps() view returns (uint256)',
  'function MAX_TRADE_BPS() view returns (uint256)',
  'function remainingDailyOut() view returns (uint256)',
  'function LISTING_THRESHOLD() view returns (uint256)',
  // V7 gates selling on real reserves, not on a day count. SELL_OPEN_DAY survives in the
  // ABI but no longer decides anything, so the page must read these instead.
  'function sellGateUsdt() view returns (uint256)',
  'function sellsOpen() view returns (bool)',
  'function backingBps() view returns (uint256)',
];

const MIC_BAL_ABI = ['function balanceOf(address) view returns (uint256)'];

/**
 * What each swap pool is asked directly. Both are read with `quoteBuy`, never with
 * `spotPrice` alone: V6 reports a correct spot price and then charges 2.006× it, and a
 * console that showed only the spot figure would repeat the exact defect V7 exists to fix.
 * The effective price below is always what a buyer actually pays.
 */
const V7_ABI = [
  'function isSeeded() view returns (bool)',
  'function reserveMic() view returns (uint256)',
  'function reserveUsdt() view returns (uint256)',
  'function virtualReserve() view returns (uint256)',
  'function spotPrice() view returns (uint256)',
  'function quoteBuy(uint256) view returns (uint256)',
  'function sellGateUsdt() view returns (uint256)',
  'function sellsOpen() view returns (bool)',
  'function backingBps() view returns (uint256)',
  'function sellFeeBps() view returns (uint256)',
  'function maxTradeMic() view returns (uint256)',
  'function BUY_FEE_BPS() view returns (uint256)',
  'function MAX_FEE_BPS() view returns (uint256)',
];

const V6_ABI = [
  'function reserveMic() view returns (uint256)',
  'function reserveUsdt() view returns (uint256)',
  'function virtualReserve() view returns (uint256)',
  'function spotPrice() view returns (uint256)',
  'function quoteBuy(uint256) view returns (uint256)',
  'function phase() view returns (uint8)',
];

/** Effective price a buyer pays, derived from a $100 probe. Never from spotPrice. */
const PROBE = 100;

type PoolCard = {
  live: boolean;
  address: string;
  reserveMic: number;
  reserveUsdt: number;
  virtualReserve: number;
  spotPrice: number;
  effPrice: number;      // what a buyer actually pays, from quoteBuy
  // V7 only
  seeded?: boolean;
  sellGateUsdt?: number;
  sellsOpen?: boolean;
  backingBps?: number;
  sellFeeBps?: number;
  maxTradeMic?: number;
  buyFeeBps?: number;
  maxFeeBps?: number;
  // V6 only
  phase?: number;
  error?: string;
};

/** The effective price V7 must reach before V6 is worth listing for balancing trades. */
const V6_UNLOCK_PRICE = 0.02;

type PoolState = {
  seeded: boolean;
  reserveMic: number;
  reserveUsdt: number;
  virtualReserve: number;
  spotPrice: number;
  ageDays: number;
  startTime: number;
  sellOpenDay: number;
  buyFeeBps: number;
  sellFeeBps: number;
  maxTradeBps: number;
  remainingDailyOut: number;
  listingThreshold: number;
  sellGateUsdt: number;
  sellsOpen: boolean;
  backingBps: number;
  vaultMic: number;   // MIC still held by ListingReserveVault
  error?: string;
};

const fmtN = (n: number) => (!n || isNaN(n)) ? '-' : n.toLocaleString('en-US');
const fmtUsd = (n: number) => (!n || isNaN(n)) ? '-' : '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const SZ = '0.62rem';

export default function SwapPage() {
  // Mission Chain's own modal, not window.confirm. The native one renders as
  // "admin.missionchain.io says" in the browser's chrome — an unbranded box that looks
  // like a phishing prompt, cannot carry the warning's emphasis, and is what a member is
  // taught to distrust. McUi was written to replace it and 13 call sites still had not moved.
  const mcUi = useMcUi();
  const [swapEnabled, setSwapEnabled] = useState(false);
  /* Whether members see the pool's remaining daily outflow on the DApp. Read live here
     either way — an operator should always be able to see it. */
  const [showDailyCap, setShowDailyCap] = useState(false);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // Add to pool inputs
  const [addUsdt, setAddUsdt] = useState('');
  const [addMic, setAddMic] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  const [pool, setPool] = useState<PoolState | null>(null);
  const [v7, setV7] = useState<PoolCard | null>(null);
  const [v6, setV6] = useState<PoolCard | null>(null);

  /** Read the pool itself. Tries each public endpoint in turn — one dead host must not
   *  leave this page reporting an empty pool, which reads as "nothing is there". */
  /** Reads both swap pools. Either may be absent; neither absence blocks the other. */
  const loadPools = useCallback(async () => {
    const { JsonRpcProvider, Contract, formatUnits, parseUnits: pu } = await import('ethers');
    const ZERO = '0x0000000000000000000000000000000000000000';
    const probe = pu(String(PROBE), USDT_DECIMALS);

    for (const url of CHAIN.rpcUrls) {
      let p: any;
      try { p = new JsonRpcProvider(url); await p.getBlockNumber(); } catch { continue; }

      // ── V7 ──
      const a7 = (A as any).LiquidityPoolV7;
      if (!a7 || a7 === ZERO) {
        setV7({ live: false, address: a7 || ZERO } as PoolCard);
      } else {
        try {
          const c = new Contract(a7, V7_ABI, p);
          const [seeded, rMic, rUsdt, vRes, spot, q, gate, sOpen, back, sFee, maxT, bFee, maxF] =
            await Promise.all([
              c.isSeeded(), c.reserveMic(), c.reserveUsdt(), c.virtualReserve(), c.spotPrice(),
              c.quoteBuy(probe), c.sellGateUsdt(), c.sellsOpen(), c.backingBps(),
              c.sellFeeBps(), c.maxTradeMic(), c.BUY_FEE_BPS(), c.MAX_FEE_BPS(),
            ]);
          const out = Number(formatUnits(q, 18));
          setV7({
            live: true, address: a7,
            seeded: Boolean(seeded),
            reserveMic: Number(formatUnits(rMic, 18)),
            reserveUsdt: Number(formatUnits(rUsdt, USDT_DECIMALS)),
            virtualReserve: Number(formatUnits(vRes, USDT_DECIMALS)),
            spotPrice: Number(formatUnits(spot, 18)),
            effPrice: out > 0 ? PROBE / out : 0,
            sellGateUsdt: Number(formatUnits(gate, USDT_DECIMALS)),
            sellsOpen: Boolean(sOpen),
            backingBps: Number(back),
            sellFeeBps: Number(sFee),
            maxTradeMic: Number(formatUnits(maxT, 18)),
            buyFeeBps: Number(bFee),
            maxFeeBps: Number(maxF),
          });
        } catch (e: any) {
          setV7({ live: false, address: a7, error: e?.shortMessage || 'unreadable' } as PoolCard);
        }
      }

      // ── V6 ──
      const a6 = (A as any).LiquidityPoolV6;
      try {
        const c = new Contract(a6, V6_ABI, p);
        const [rMic, rUsdt, vRes, spot, q, ph] = await Promise.all([
          c.reserveMic(), c.reserveUsdt(), c.virtualReserve(), c.spotPrice(),
          c.quoteBuy(probe), c.phase(),
        ]);
        const out = Number(formatUnits(q, 18));
        setV6({
          live: true, address: a6,
          reserveMic: Number(formatUnits(rMic, 18)),
          reserveUsdt: Number(formatUnits(rUsdt, USDT_DECIMALS)),
          virtualReserve: Number(formatUnits(vRes, USDT_DECIMALS)),
          spotPrice: Number(formatUnits(spot, 18)),
          effPrice: out > 0 ? PROBE / out : 0,
          phase: Number(ph),
        });
      } catch (e: any) {
        setV6({ live: false, address: a6, error: e?.shortMessage || 'unreadable' } as PoolCard);
      }
      return;
    }
    setV7({ live: false, address: '', error: 'Could not reach any BSC endpoint' } as PoolCard);
    setV6({ live: false, address: '', error: 'Could not reach any BSC endpoint' } as PoolCard);
  }, []);

  const loadPool = useCallback(async () => {
    const { JsonRpcProvider, Contract, formatUnits } = await import('ethers');
    const addr = (A as any).LiquidityPoolV7;
    if (!addr || addr === '0x0000000000000000000000000000000000000000') {
      setPool({ ...({} as PoolState), error: 'LiquidityPoolV7 is not set in the SDK addresses' });
      return;
    }
    for (const url of CHAIN.rpcUrls) {
      try {
        const p = new JsonRpcProvider(url);
        const c = new Contract(addr, POOL_ABI, p);
        const mic = new Contract(A.MICToken, MIC_BAL_ABI, p);
        const [seeded, rMic, rUsdt, vRes, spot, age, start, sellOpen, buyFee, sellFee, maxTrade, remOut, listThr, vaultMic, gate, sOpen, back] =
          await Promise.all([
            c.isSeeded(), c.reserveMic(), c.reserveUsdt(), c.virtualReserve(), c.spotPrice(),
            c.poolAgeDays(), c.startTime(), c.SELL_OPEN_DAY(), c.BUY_FEE_BPS(), c.sellFeeBps(),
            c.MAX_TRADE_BPS(), c.remainingDailyOut(), c.LISTING_THRESHOLD(),
            mic.balanceOf(A.ListingReserveVault),
            c.sellGateUsdt(), c.sellsOpen(), c.backingBps(),
          ]);
        setPool({
          seeded: Boolean(seeded),
          reserveMic: Number(formatUnits(rMic, 18)),
          reserveUsdt: Number(formatUnits(rUsdt, USDT_DECIMALS)),
          virtualReserve: Number(formatUnits(vRes, USDT_DECIMALS)),
          spotPrice: Number(formatUnits(spot, 18)),
          ageDays: Number(age),
          startTime: Number(start),
          sellOpenDay: Number(sellOpen),
          buyFeeBps: Number(buyFee),
          sellFeeBps: Number(sellFee),
          maxTradeBps: Number(maxTrade),
          remainingDailyOut: Number(formatUnits(remOut, USDT_DECIMALS)),
          listingThreshold: Number(formatUnits(listThr, USDT_DECIMALS)),
          vaultMic: Number(formatUnits(vaultMic, 18)),
          sellGateUsdt: Number(formatUnits(gate, USDT_DECIMALS)),
          sellsOpen: Boolean(sOpen),
          backingBps: Number(back),
        });
        return;
      } catch { /* next endpoint */ }
    }
    setPool({ ...({} as PoolState), error: 'Could not reach any BSC endpoint' });
  }, []);

  useEffect(() => {
    Promise.all([
      fetchStatsOverview().catch(() => null),
      fetch(`${API_BASE}/rounds/system-info`).then(r => r.json()).catch(() => null),
      loadPool(),
      loadPools(),
    ]).then(([statsRes, sysRes]) => {
      if (statsRes?.data) setStats(statsRes.data);
      if (sysRes?.data) {
        setSwapEnabled(sysRes.data.swapEnabled || false);
        setShowDailyCap(sysRes.data.swapShowDailyCap || false);
      }
    }).finally(() => setLoading(false));
  }, [loadPool, loadPools]);

  // Derived values from stats
  const seedUsdt = Number(stats?.seed?.usdtRaised || 0);
  const presaleUsdt = Number(stats?.presale?.usdtRaised || 0);
  const miceUsdt = Number(stats?.mice?.usdtRaised || 0);

  // SEED V5c (deployed 2026-06-23): 0% to liquidity. Funds Reserved 50% instead.
  const seedLiqUsdt = 0;
  // 40% of PreSale+MICE net capital goes to liquidity
  const presaleLiqUsdt = presaleUsdt * 0.40;
  const miceLiqUsdt = miceUsdt * 0.40;
  const totalLiqUsdt = seedLiqUsdt + presaleLiqUsdt + miceLiqUsdt;

  /**
   * The original DEX/CEX listing allocation, and where it actually went.
   *
   * The page used to present all 105,000,000 as sitting in `LiquidityPool.sol` waiting to
   * be added. None of that is true any more:
   *   - 31,500,000 went to LiquidityPool v5, which has no withdrawal path of any kind.
   *     It could only ever leave by being burned, and it was, on 2026-08-05.
   *   - 73,500,000 went to ListingReserveVault, of which 50,000,000 was withdrawn on
   *     2026-08-12 and seeded into this pool.
   * The remainder is read from the vault rather than assumed, so it stays right.
   */
  const LISTING_ALLOCATION_MIC = 105_000_000;
  const BURNED_IN_V5_MIC = 31_500_000;

  const poolMic = pool?.reserveMic ?? 0;
  /** REAL USDT only. The virtual reserve is reported beside it, never folded into it. */
  const poolUsdt = pool?.reserveUsdt ?? 0;
  const virtualUsdt = pool?.virtualReserve ?? 0;

  const handleActivate = async () => {
    const micVal = parseFloat(addMic);
    const usdtVal = parseFloat(addUsdt);
    if (!micVal || !usdtVal || micVal <= 0 || usdtVal <= 0) {
      setMsg('Enter both MIC and USDT amounts to activate SWAP');
      return;
    }
    const ok = await mcUi.confirm({
      title: 'Activate SWAP',
      message: (
        <>
          Seed the pool with <strong>{fmtN(micVal)} MIC</strong> and <strong>${fmtN(usdtVal)} USDT</strong>?
          <br /><br />
          Assets added here can <strong>never be withdrawn</strong> — the contract has no
          withdrawal function for anyone, including the Owner and the DAO. They leave only
          through member trades. This cannot be undone.
        </>
      ),
      confirmLabel: 'Activate',
      variant: 'danger',
    });
    if (!ok) return;

    setSaving(true);
    setMsg('');
    try {
      const jwt = typeof window !== 'undefined' ? localStorage.getItem('mc-admin-jwt') : null;
      await fetch(`${API_BASE}/admin/system-config/swap_enabled`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}) },
        body: JSON.stringify({ value: 'true' }),
      });
      setSwapEnabled(true);
      setAddMic('');
      setAddUsdt('');
      setMsg('SWAP activated successfully');
      setTimeout(() => setMsg(''), 5000);
    } catch {
      setMsg('Error activating SWAP');
    } finally {
      setSaving(false);
    }
  };

  /*
   * Adding liquidity is a real transaction signed by the Owner's own wallet.
   *
   * This handler used to end at `setMsg(...)` under a comment saying the contract call
   * would come "in production" — so the button reported success and moved nothing. The
   * pool's two deposit paths are role-gated and both pull from `msg.sender`, so each needs
   * an ERC-20 approval first:
   *
   *   MIC  -> seedMic(amount)      DEFAULT_ADMIN_ROLE
   *   USDT -> receiveUSDT(amount)  DISTRIBUTOR_ROLE   (the router's role, not the admin's)
   *
   * The role is checked before the wallet is opened. The Owner holds DEFAULT_ADMIN but not
   * DISTRIBUTOR, and without this check the USDT path would prompt, spend gas and revert
   * with `AccessControlUnauthorizedAccount`, which reads like a wallet fault.
   */
  const POOL_WRITE_ABI = [
    'function seedMic(uint256 amount)',
    'function receiveUSDT(uint256 amount)',
    'function DEFAULT_ADMIN_ROLE() view returns (bytes32)',
    'function DISTRIBUTOR_ROLE() view returns (bytes32)',
    'function hasRole(bytes32,address) view returns (bool)',
    'function grantRole(bytes32 role, address account)',
  ];
  /* The revenue USDT does not sit in the admin's wallet — it sits in the legacy
     `LiquidityPool` (0x0F01…), which is where the router delivered the liquidity slice.
     `withdrawUSDT` is its only way out and is gated on DEFAULT_ADMIN_ROLE, which the Owner
     holds. So ADD USDT is two steps: pull it out to the signer, then push it into V6. */
  const LEGACY_POOL_ABI = [
    'function withdrawUSDT(address to, uint256 amount)',
    'function usdtBalance() view returns (uint256)',
    'function DEFAULT_ADMIN_ROLE() view returns (bytes32)',
    'function hasRole(bytes32,address) view returns (bool)',
  ];
  const ERC20_ABI = [
    'function approve(address spender, uint256 amount) returns (bool)',
    'function allowance(address owner, address spender) view returns (uint256)',
    'function balanceOf(address) view returns (uint256)',
  ];

  /** Wallet, on the right chain, ready to sign. */
  const getSigner = async () => {
    const eth = (window as any).ethereum;
    if (!eth) throw new Error('No wallet detected in this browser.');
    await eth.request({ method: 'eth_requestAccounts' });
    const hex = '0x' + CHAIN.chainId.toString(16);
    const current = await eth.request({ method: 'eth_chainId' });
    if (current !== hex) {
      await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hex }] });
    }
    return new BrowserProvider(eth).getSigner();
  };

  /*
   * Whether the connected wallet may call `receiveUSDT`.
   *
   * DISTRIBUTOR_ROLE belongs to the RevenueRouter, which is the pool's normal source of
   * USDT. The Owner wallet holds DEFAULT_ADMIN but not this one, so without the check the
   * button would prompt, spend gas and revert with AccessControlUnauthorizedAccount, which
   * reads like a wallet fault. `null` means not yet known.
   */
  const [canAddUsdt, setCanAddUsdt] = useState<boolean | null>(null);
  /** USDT reachable for a manual top-up: the wallet plus the legacy liquidity contract. */
  const [walletUsdt, setWalletUsdt] = useState<number | null>(null);

  const probeDistributorRole = useCallback(async () => {
    try {
      const eth = (window as any).ethereum;
      const poolAddr = (A as any).LiquidityPoolV7;
      if (!eth || !poolAddr) return;
      const accounts: string[] = await eth.request({ method: 'eth_accounts' });
      if (!accounts?.length) return;               // wallet not connected — leave unknown
      const bp = new BrowserProvider(eth);
      const pool = new Contract(poolAddr, POOL_WRITE_ABI, bp);
      setCanAddUsdt(await pool.hasRole(await pool.DISTRIBUTOR_ROLE(), accounts[0]));

      const usdt = new Contract(A.USDT, ERC20_ABI, bp);
      const inWallet: bigint = await usdt.balanceOf(accounts[0]);
      const legacy = A.LiquidityPool ? new Contract(A.LiquidityPool, LEGACY_POOL_ABI, bp) : null;
      const inLegacy: bigint = legacy ? await legacy.usdtBalance().catch(() => 0n) : 0n;
      setWalletUsdt(Number(fmtUnits(inWallet + inLegacy, 18)));
    } catch {
      // A failed probe must not disable a button that might work.
    }
  }, []);

  useEffect(() => { probeDistributorRole(); }, [probeDistributorRole]);

  /** Owner grants the pool's distributor role to their own wallet. */
  const handleGrantDistributor = async () => {
    const ok = await mcUi.confirm({
      title: 'Grant DISTRIBUTOR_ROLE',
      message: (
        <>
          Give this wallet permission to call <code>receiveUSDT</code> on the liquidity pool?
          <br /><br />
          The role normally belongs to the RevenueRouter. Granting it here lets an admin add USDT by
          hand as well; it does not remove it from the router.
        </>
      ),
      confirmLabel: 'Grant',
      variant: 'danger',
    });
    if (!ok) return;

    setSaving(true);
    setMsg('');
    try {
      const signer = await getSigner();
      const me = await signer.getAddress();
      const pool = new Contract((A as any).LiquidityPoolV7, POOL_WRITE_ABI, signer);
      setMsg('Sign grantRole in your wallet\u2026');
      const tx = await pool.grantRole(await pool.DISTRIBUTOR_ROLE(), me);
      const receipt = await tx.wait(1);
      if (!receipt || receipt.status !== 1) throw new Error('Transaction reverted');
      setCanAddUsdt(true);
      mcUi.toast({ type: 'success', message: 'DISTRIBUTOR_ROLE granted' });
      setMsg(`DISTRIBUTOR_ROLE granted \u2713 ${tx.hash.slice(0, 10)}\u2026`);
      setTimeout(() => setMsg(''), 8000);
    } catch (e: any) {
      const m = e?.code === 4001 || e?.code === 'ACTION_REJECTED'
        ? 'Transaction rejected in wallet'
        : 'Grant failed: ' + (e?.shortMessage || e?.message || 'Unknown error');
      setMsg(m);
      mcUi.toast({ type: 'error', message: m });
    } finally {
      setSaving(false);
    }
  };

  const toggleDailyCapVisibility = async (next: boolean) => {
    setSaving(true);
    try {
      const jwt = typeof window !== 'undefined' ? localStorage.getItem('mc-admin-jwt') : null;
      const res = await fetch(`${API_BASE}/admin/system-config/swap_show_daily_cap`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}) },
        body: JSON.stringify({ value: String(next) }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setShowDailyCap(next);
      mcUi.toast({ type: 'success', message: next ? 'Members will see the daily cap' : 'Hidden from members' });
    } catch (e: any) {
      mcUi.toast({ type: 'error', message: 'Could not save: ' + (e?.message || 'unknown error') });
    } finally {
      setSaving(false);
    }
  };

  const handleAddLiquidity = async (type: 'usdt' | 'mic') => {
    const val = type === 'usdt' ? parseFloat(addUsdt) : parseFloat(addMic);
    if (!val || val <= 0) { setMsg(`Enter a valid ${type.toUpperCase()} amount`); return; }
    const ok = await mcUi.confirm({
      title: `Add ${type.toUpperCase()} to the pool`,
      message: (
        <>
          Add <strong>{type === 'usdt' ? '$' : ''}{fmtN(val)} {type.toUpperCase()}</strong> to the
          liquidity pool?
          <br /><br />
          This cannot be undone — the pool has no withdrawal path.
        </>
      ),
      confirmLabel: 'Add',
      variant: 'danger',
    });
    if (!ok) return;

    setSaving(true);
    setMsg('');
    try {
      const poolAddr = (A as any).LiquidityPoolV7;
      if (!poolAddr) throw new Error('LiquidityPoolV7 address is not configured for this build.');

      const signer = await getSigner();
      const me = await signer.getAddress();
      const pool = new Contract(poolAddr, POOL_WRITE_ABI, signer);

      const isMic = type === 'mic';
      const tokenAddr = isMic ? A.MICToken : A.USDT;
      const role = isMic ? await pool.DEFAULT_ADMIN_ROLE() : await pool.DISTRIBUTOR_ROLE();
      if (!(await pool.hasRole(role, me))) {
        const denied = isMic
          ? 'This wallet does not hold DEFAULT_ADMIN_ROLE on the pool — seedMic would revert.'
          : 'This wallet does not hold DISTRIBUTOR_ROLE on the pool. receiveUSDT is the RevenueRouter\u2019s entry point; grant the role to this wallet first, or let the router deliver the USDT.';
        setMsg(denied);
        mcUi.toast({ type: 'error', message: denied });
        return;
      }

      // Both deposits are 18 decimals on BSC — BSC-USD included.
      const amount = parseUnits(String(val), 18);
      const token = new Contract(tokenAddr, ERC20_ABI, signer);

      let held = await token.balanceOf(me);

      // Top up from the legacy pool when the wallet is short. Without this the button
      // refused while $10 of revenue USDT sat in a contract the Owner can already empty.
      if (!isMic && held < amount) {
        const legacyAddr = A.LiquidityPool;
        const legacy = legacyAddr ? new Contract(legacyAddr, LEGACY_POOL_ABI, signer) : null;
        const inLegacy: bigint = legacy ? await legacy.usdtBalance() : 0n;
        const shortfall = amount - held;

        if (legacy && inLegacy >= shortfall && await legacy.hasRole(await legacy.DEFAULT_ADMIN_ROLE(), me)) {
          setMsg(`Withdrawing ${fmtN(Number(fmtUnits(shortfall, 18)))} USDT from the liquidity contract\u2026`);
          await (await legacy.withdrawUSDT(me, shortfall)).wait();
          held = await token.balanceOf(me);
        }
      }

      if (held < amount) {
        const short =
          `Only ${fmtN(Number(fmtUnits(held, 18)))} ${type.toUpperCase()} is reachable \u2014 not enough to ` +
          `add ${fmtN(val)}. The pool pulls from the signing wallet, topped up from the liquidity ` +
          `contract when that wallet is short.`;
        setMsg(short);
        mcUi.toast({ type: 'error', message: short });
        return;
      }

      if ((await token.allowance(me, poolAddr)) < amount) {
        setMsg(`Approve ${type.toUpperCase()} in your wallet\u2026`);
        await (await token.approve(poolAddr, amount)).wait();
      }

      setMsg(`Sign ${isMic ? 'seedMic' : 'receiveUSDT'} in your wallet\u2026`);
      const tx = isMic ? await pool.seedMic(amount) : await pool.receiveUSDT(amount);
      setMsg(`Confirming ${tx.hash.slice(0, 10)}\u2026`);
      const receipt = await tx.wait(1);
      if (!receipt || receipt.status !== 1) throw new Error('Transaction reverted');

      setMsg(`${fmtN(val)} ${type.toUpperCase()} added to the pool \u2713 ${tx.hash.slice(0, 10)}\u2026`);
      mcUi.toast({ type: 'success', message: `${fmtN(val)} ${type.toUpperCase()} added to the pool` });
      if (isMic) setAddMic(''); else setAddUsdt('');
      await loadPool(); loadPools();
      setTimeout(() => setMsg(''), 8000);
    } catch (e: any) {
      const code = e?.code;
      const failed = code === 4001 || code === 'ACTION_REJECTED'
        ? 'Transaction rejected in wallet'
        : 'Add liquidity failed: ' + (e?.shortMessage || e?.reason || e?.message || 'Unknown error');
      setMsg(failed);
      mcUi.toast({ type: 'error', message: failed });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="page-hd">
        <div>
          <div className="page-eyebrow">Business &amp; Finance</div>
          <div className="page-title">SWAP Control</div>
          <div className="page-sub">Liquidity pool management, SWAP activation &amp; price stabilization</div>
        </div>
      </div>

      {/* STATUS ALERT */}
      {/*
        This section describes LiquidityPoolV7, the public pool. V6 is on the card further
        down, held back and not public.

        V7 does have one asset exit that V6 lacked: `requestMicWithdraw`, announced seven
        days ahead and cancellable. It exists because V5, V6 and TreasuryManager between
        them hold 155,000,000 MIC that can never be sent anywhere, and repeating that a
        fourth time was not acceptable. USDT still has no exit at all — it leaves only when
        a member sells.

        There is no PancakeSwap anywhere in this system; V7 is the protocol's own AMM.
      */}
      {!pool?.seeded ? (
        <div className="alert alert-warn" style={{ marginBottom: 16, fontSize: '0.64rem', lineHeight: 1.75 }}>
          <div>
            {'\u26A0\uFE0F'} SWAP pool is <strong>NOT SEEDED</strong>. It quotes no price and
            refuses every trade until MIC is added with <code>seedMic</code>. It does accept
            revenue while dormant {'\u2014'} RevenueRouter already points here, and the 40%
            liquidity slice is accruing. Seeding{' '}
            <strong>23,500,000 MIC</strong> opens buying at $0.01; the MIC clears its
            ListingReserveVault cooldown on <strong>24 Aug 2026, 06:57 UTC</strong>.
          </div>
        </div>
      ) : (
        <div className="alert alert-ok" style={{ marginBottom: 16, fontSize: '0.64rem', lineHeight: 1.75 }}>
          <div>
            {'\u2705'} SWAP is <strong>LIVE</strong>. Buying is open at{' '}
            <strong>${pool.spotPrice.toFixed(4)}</strong>. Selling opens when the pool
            actually holds <strong>{fmtUsd(pool.sellGateUsdt)}</strong> of real USDT
            {'\u2014'} not on a date. It holds {fmtUsd(pool.reserveUsdt)} now, so{' '}
            {pool.sellsOpen ? 'the sell side is open.' : 'the sell side is shut.'}{' '}
            USDT can never be withdrawn: it leaves only when a member sells.
          </div>
        </div>
      )}

      {/* Save message */}
      {msg && (
        <div style={{
          padding: '6px 12px', marginBottom: 12, borderRadius: 8, fontSize: SZ, fontWeight: 600,
          background: msg.includes('Error') ? 'rgba(255,80,102,.15)' : 'rgba(80,200,120,.15)',
          color: msg.includes('Error') ? '#FF5066' : '#50c878',
        }}>{msg}</div>
      )}

      {/* SWAP STATUS */}
      <div className="sep-lbl">SWAP Status</div>
      <div className="g3" style={{ marginBottom: 16 }}>
        <div className="stat-box">
          <div className="stat-lbl">Status</div>
          <div className="stat-val" style={{ color: swapEnabled ? 'var(--green2)' : 'var(--crimson2)' }}>{swapEnabled ? 'ACTIVE' : 'INACTIVE'}</div>
        </div>
        <div className="stat-box">
          <div className="stat-lbl">Pool MIC</div>
          <div className="stat-val p">{pool ? fmtN(Math.round(poolMic)) : '—'}</div>
          <div className="stat-delta">
            {pool ? `spot $${pool.spotPrice.toFixed(6)}` : 'reading…'}
          </div>
        </div>
        <div className="stat-box">
          <div className="stat-lbl">Pool USDT (real)</div>
          <div className="stat-val gold">{pool ? fmtUsd(poolUsdt) : '—'}</div>
          {/*
            Stated separately, never summed into the figure above. The virtual reserve is
            not money: it exists so a two-sided price is definable on day one and it retires
            as real USDT arrives. Showing $2 alone understates what sets the price; showing
            $500,001 would imply the pool holds half a million dollars it does not have.
          */}
          <div className="stat-delta">
            {pool ? `+ ${fmtUsd(virtualUsdt)} virtual · price basis ${fmtUsd(poolUsdt + virtualUsdt)}` : 'reading…'}
          </div>
        </div>
      </div>

      {pool?.error && (
        <div className="alert alert-warn" style={{ marginBottom: 16, fontSize: '0.64rem', lineHeight: 1.75 }}>
          <div>Could not read the pool: {pool.error}</div>
        </div>
      )}

      {pool && !pool.error && (
        <div className="callout" style={{ fontSize: '0.64rem', lineHeight: 1.75, marginBottom: 16 }}>
          <div>
            <strong>Virtual reserve.</strong> The price basis above is real USDT plus{' '}
            {fmtUsd(virtualUsdt)} of virtual reserve {'\u2014'} an accounting figure, not a
            balance. It lets the pool quote a price from the first day, and every real USDT
            that arrives retires <strong>exactly one</strong> virtual USDT. So the basis
            holds steady while its composition turns real, and the opening price is $0.01
            whether the pool receives nothing before it is seeded or the whole{' '}
            {fmtUsd(pool.virtualReserve + pool.reserveUsdt)}. Backing is{' '}
            <strong>{(pool.backingBps / 100).toFixed(1)}%</strong> real so far. Only the
            real figure can ever be paid out.
          </div>
        </div>
      )}

      {/* ═══ SWAP POOLS ═══ */}
      <div className="sep-lbl">Swap Pools</div>
      <div className="g2" style={{ marginBottom: 16 }}>

        {/* ── V7 — the public pool ────────────────────────────────────────── */}
        <div className="card" style={{ padding: 20, borderColor: 'var(--green2)' }}>
          <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: '1.1rem' }}>{'\uD83D\uDFE2'}</span>
              LiquidityPoolV7 {'\u2014'} Public Swap
            </span>
            <span style={{
              fontSize: '0.52rem', letterSpacing: '0.08em', padding: '2px 8px', borderRadius: 4,
              background: v7?.live && v7?.seeded ? 'var(--green2)' : 'var(--gray2)',
              color: '#091530', fontWeight: 700,
            }}>
              {!v7 ? 'LOADING' : !v7.live ? 'AWAITING DEPLOYMENT' : v7.seeded ? 'LIVE' : 'DORMANT'}
            </span>
          </div>

          {!v7?.live ? (
            <div className="callout" style={{ fontSize: '0.64rem', lineHeight: 1.75 }}>
              Not deployed yet. The 23,500,000 MIC that seeds it is held in
              ListingReserveVault under withdrawal request #2 and becomes available on{' '}
              <strong>24 Aug 2026, 06:57 UTC</strong>. Until then this card reads nothing,
              which is correct rather than broken.
              {v7?.error ? <div style={{ marginTop: 6, color: 'var(--crimson2)' }}>{v7.error}</div> : null}
            </div>
          ) : (
            <>
              <div className="callout" style={{ fontSize: '0.64rem', lineHeight: 1.75, marginBottom: 12 }}>
                Linear price: the whole pool over the whole float, fixed for the duration of
                a trade, so $1 and $50 buy at the same unit price. Every real USDT that
                arrives replaces exactly one virtual USDT, so the backing holds steady while
                its composition turns real.
                <br /><br />
                {/* The two directions are gated on different things, and saying "buy-only
                    until $25,000" read as though buying were restricted too. It is not.
                    A buy hands out MIC, which the pool has. A sell hands out real money,
                    which it does not have yet. */}
                <strong>Buying</strong> is open as soon as the pool holds MIC {'\u2014'} it
                pays out in MIC, which it has. <strong>Selling</strong> waits until the pool
                actually holds <strong>{fmtUsd(v7.sellGateUsdt || 0)}</strong> of real USDT,
                because a seller is paid in real money and until that point the depth on
                offer is mostly virtual reserve.
              </div>

              <div className="info-row">
                <span className="info-key">Effective buy price</span>
                <span className="info-val" style={{ fontFamily: 'var(--font-m)', color: 'var(--gold)', fontWeight: 700 }}>
                  ${(v7.effPrice || 0).toFixed(6)}
                </span>
              </div>
              <div className="info-row">
                <span className="info-key">Spot price</span>
                <span className="info-val" style={{ fontFamily: 'var(--font-m)' }}>${(v7.spotPrice || 0).toFixed(6)}</span>
              </div>
              <div className="info-row"><span className="info-key">Pool MIC</span><span className="info-val" style={{ fontFamily: 'var(--font-m)' }}>{fmtN(Math.round(v7.reserveMic))} MIC</span></div>
              <div className="info-row"><span className="info-key">Real USDT</span><span className="info-val" style={{ fontFamily: 'var(--font-m)', color: 'var(--green2)' }}>{fmtUsd(v7.reserveUsdt)}</span></div>
              <div className="info-row"><span className="info-key">Virtual reserve</span><span className="info-val" style={{ fontFamily: 'var(--font-m)', color: 'var(--gray2)' }}>{fmtUsd(v7.virtualReserve)}</span></div>
              <div className="info-row">
                <span className="info-key">Backing (real / quotable)</span>
                <span className="info-val" style={{ fontFamily: 'var(--font-m)' }}>{((v7.backingBps || 0) / 100).toFixed(1)}%</span>
              </div>

              <div style={{ borderTop: '1px solid var(--border)', marginTop: 8, paddingTop: 8 }}>
                <div className="info-row">
                  <span className="info-key">Sell side</span>
                  <span className="info-val" style={{ fontFamily: 'var(--font-m)', color: v7.sellsOpen ? 'var(--green2)' : 'var(--gray2)' }}>
                    {v7.sellsOpen ? 'OPEN' : 'CLOSED'}
                  </span>
                </div>
                <div className="info-row">
                  <span className="info-key">Opens at</span>
                  <span className="info-val" style={{ fontFamily: 'var(--font-m)' }}>{fmtUsd(v7.sellGateUsdt || 0)} real USDT</span>
                </div>
                <div className="info-row">
                  <span className="info-key">Sell fee (auto)</span>
                  <span className="info-val" style={{ fontFamily: 'var(--font-m)' }}>
                    {((v7.sellFeeBps || 0) / 100).toFixed(2)}% <em style={{ fontSize: 10, color: 'var(--gray2)' }}>
                      (0{'\u2013'}{((v7.maxFeeBps || 1500) / 100).toFixed(0)}%, falls as backing grows)
                    </em>
                  </span>
                </div>
                <div className="info-row"><span className="info-key">Buy fee</span><span className="info-val" style={{ fontFamily: 'var(--font-m)' }}>{((v7.buyFeeBps || 30) / 100).toFixed(2)}%</span></div>
                <div className="info-row"><span className="info-key">Per-trade limit</span><span className="info-val" style={{ fontFamily: 'var(--font-m)' }}>{fmtN(Math.round(v7.maxTradeMic || 0))} MIC</span></div>
              </div>

              {!v7.sellsOpen && (v7.sellGateUsdt || 0) > 0 && (
                <div style={{ marginTop: 10 }}>
                  <div className="prog-bar">
                    <div className="prog-fill p" style={{ width: `${Math.min(100, (v7.reserveUsdt / (v7.sellGateUsdt || 1)) * 100)}%` }} />
                  </div>
                  <div style={{ fontSize: '0.58rem', color: 'var(--gray2)', marginTop: 6 }}>
                    {fmtUsd(v7.reserveUsdt)} of {fmtUsd(v7.sellGateUsdt || 0)} toward opening the sell side.
                    The gate is real money, not a date {'\u2014'} a calendar cannot know whether the
                    money arrived.
                  </div>
                </div>
              )}
            </>
          )}

          <div style={{ fontSize: '0.55rem', color: 'var(--gray2)', marginTop: 10, fontFamily: 'var(--font-m)', wordBreak: 'break-all' }}>
            {v7?.address && v7.address !== '0x0000000000000000000000000000000000000000' ? v7.address : 'address pending deployment'}
          </div>
        </div>

        {/* ── V6 — held back, deliberately dimmed ─────────────────────────── */}
        <div className="card" style={{ padding: 20, opacity: 0.55, filter: 'grayscale(0.5)' }}>
          <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: '1.1rem' }}>{'\u26AB'}</span>
              LiquidityPoolV6 {'\u2014'} Reserve
            </span>
            <span style={{
              fontSize: '0.52rem', letterSpacing: '0.08em', padding: '2px 8px', borderRadius: 4,
              background: 'var(--crimson2)', color: '#091530', fontWeight: 700,
            }}>
              NOT PUBLIC
            </span>
          </div>

          <div className="callout" style={{ fontSize: '0.64rem', lineHeight: 1.75, marginBottom: 12, borderLeftColor: 'var(--crimson2)' }}>
            <strong>Not public. Admin access only.</strong> This pool charges every buyer
            2.006{'\u00D7'} its own quoted spot price {'\u2014'} the defect that V7 replaces. It is not
            upgradeable and no setter reaches the fault, so it is held back rather than fixed.
            <br /><br />
            Its {fmtN(Math.round(v6?.reserveMic || 0))} MIC can never be withdrawn or burned,
            so the pool is a standing offer at roughly $0.02 rather than a write-off. It stays
            unlisted until V7&rsquo;s effective price reaches{' '}
            <strong>${V6_UNLOCK_PRICE.toFixed(2)}</strong>, at which point the two prices meet
            and this pool becomes usable for balancing trades between them.
          </div>

          {v6?.live ? (
            <>
              <div className="info-row">
                <span className="info-key">Effective buy price</span>
                <span className="info-val" style={{ fontFamily: 'var(--font-m)', color: 'var(--crimson2)', fontWeight: 700 }}>
                  ${(v6.effPrice || 0).toFixed(6)}
                </span>
              </div>
              <div className="info-row">
                <span className="info-key">Spot price <em style={{ fontSize: 10 }}>(misleading)</em></span>
                <span className="info-val" style={{ fontFamily: 'var(--font-m)', color: 'var(--gray2)' }}>${(v6.spotPrice || 0).toFixed(6)}</span>
              </div>
              <div className="info-row">
                <span className="info-key">Overcharge</span>
                <span className="info-val" style={{ fontFamily: 'var(--font-m)', color: 'var(--crimson2)' }}>
                  {v6.spotPrice > 0 ? (v6.effPrice / v6.spotPrice).toFixed(3) : '-'}{'\u00D7'}
                </span>
              </div>
              <div className="info-row"><span className="info-key">MIC held <em style={{ fontSize: 10 }}>(unrecoverable)</em></span><span className="info-val" style={{ fontFamily: 'var(--font-m)' }}>{fmtN(Math.round(v6.reserveMic))} MIC</span></div>
              <div className="info-row"><span className="info-key">Real USDT</span><span className="info-val" style={{ fontFamily: 'var(--font-m)' }}>{fmtUsd(v6.reserveUsdt)}</span></div>
              <div className="info-row"><span className="info-key">Virtual reserve</span><span className="info-val" style={{ fontFamily: 'var(--font-m)', color: 'var(--gray2)' }}>{fmtUsd(v6.virtualReserve)}</span></div>

              <div style={{ borderTop: '1px solid var(--border)', marginTop: 8, paddingTop: 8 }}>
                <div className="info-row">
                  <span className="info-key">Unlock condition</span>
                  <span className="info-val" style={{ fontFamily: 'var(--font-m)' }}>
                    V7 effective {'\u2265'} ${V6_UNLOCK_PRICE.toFixed(2)}
                  </span>
                </div>
                <div className="info-row">
                  <span className="info-key">Condition met</span>
                  <span className="info-val" style={{ fontFamily: 'var(--font-m)', color: (v7?.effPrice || 0) >= V6_UNLOCK_PRICE ? 'var(--green2)' : 'var(--gray2)' }}>
                    {(v7?.effPrice || 0) >= V6_UNLOCK_PRICE ? 'YES' : 'NO'}
                  </span>
                </div>
              </div>

              <div style={{ marginTop: 10 }}>
                <div className="prog-bar">
                  <div className="prog-fill p" style={{ width: `${Math.min(100, ((v7?.effPrice || 0) / V6_UNLOCK_PRICE) * 100)}%` }} />
                </div>
                <div style={{ fontSize: '0.58rem', color: 'var(--gray2)', marginTop: 6 }}>
                  V7 is at ${(v7?.effPrice || 0).toFixed(6)} of the ${V6_UNLOCK_PRICE.toFixed(2)} needed.
                </div>
              </div>
            </>
          ) : (
            <div className="callout" style={{ fontSize: '0.62rem' }}>{v6?.error || 'Reading\u2026'}</div>
          )}

          <div style={{ fontSize: '0.55rem', color: 'var(--gray2)', marginTop: 10, fontFamily: 'var(--font-m)', wordBreak: 'break-all' }}>
            {v6?.address || '\u2014'}
          </div>
        </div>
      </div>

      {/* ═══ LIQUIDITY SOURCES ═══ */}
      <div className="sep-lbl">Liquidity Sources</div>
      <div className="g2" style={{ marginBottom: 16 }}>

        {/* SOURCE 1: MIC from Pre-Issued */}
        <div className="card" style={{ padding: 20 }}>
          <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: '1.1rem' }}>{'\uD83E\uDE99'}</span> MIC Source {'\u2014'} Pre-Issued
          </div>
          <div className="callout" style={{ fontSize: '0.64rem', lineHeight: 1.75, marginBottom: 12 }}>
            <div>
              105,000,000 MIC was allocated at deployment for listing liquidity &mdash;{' '}
              <strong>10.3%</strong> of the 1,018,500,000 supply, not the 1.5% this card used
              to claim. It is no longer in one place, and one third of it no longer exists.
            </div>
          </div>
          <div className="info-row"><span className="info-key">Allocated at deploy</span><span className="info-val" style={{ fontFamily: 'var(--font-m)' }}>105,000,000 MIC</span></div>
          <div className="info-row">
            <span className="info-key">Burned in LiquidityPool v5</span>
            <span className="info-val" style={{ fontFamily: 'var(--font-m)', color: 'var(--crimson2)' }}>
              −{fmtN(BURNED_IN_V5_MIC)} MIC
            </span>
          </div>
          <div className="info-row"><span className="info-key">Seeded into this pool</span><span className="info-val" style={{ fontFamily: 'var(--font-m)' }}>{pool ? fmtN(Math.round(poolMic)) + ' MIC' : '—'}</span></div>
          <div className="info-row">
            <span className="info-key">Still in ListingReserveVault</span>
            <span className="info-val" style={{ fontFamily: 'var(--font-m)', color: 'var(--green2)' }}>
              {pool ? fmtN(Math.round(pool.vaultMic)) + ' MIC' : '—'}
            </span>
          </div>
          <div style={{ marginTop: 10 }}>
            <div className="prog-bar"><div className="prog-fill p" style={{ width: `${poolMic > 0 ? Math.min(100, poolMic / LISTING_ALLOCATION_MIC * 100) : 0}%` }} /></div>
          </div>
          <div style={{ fontSize: '0.58rem', color: 'var(--gray2)', marginTop: 8, lineHeight: 1.7 }}>
            The 31,500,000 was burned on 2026-08-05 because LiquidityPool v5 has no
            withdrawal path of any kind &mdash; burning was the only way it could ever leave.
            Withdrawing from the vault takes a 7-day request &rarr; execute; it is not
            instant.
          </div>
        </div>

        {/* SOURCE 2: USDT from Revenue */}
        <div className="card" style={{ padding: 20 }}>
          <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: '1.1rem' }}>{'\uD83D\uDCB5'}</span> USDT Source {'\u2014'} Revenue Allocation
          </div>
          {/* Same type size as the MIC source callout opposite — the two sat side by side at
              different sizes. */}
          <div className="callout" style={{ fontSize: '0.64rem', lineHeight: 1.75, marginBottom: 12 }}>
            <div>
              Pre-Sale &amp; MICE revenue flows 40% straight into the SWAP pool. RevenueRouter holds
              DISTRIBUTOR_ROLE on the pool and calls receiveUSDT in the same transaction as the sale, so no
              admin step is involved. Each real USDT that arrives retires exactly one USDT of virtual
              reserve, so the phantom depth shrinks as the real depth grows.
            </div>
          </div>
          <div className="info-row"><span className="info-key">From SEED</span><span className="info-val" style={{ fontFamily: 'var(--font-m)', color: 'var(--gray2)' }}>$0 <em style={{ fontSize: 10 }}>(V5c: 0% to LP)</em></span></div>
          <div className="info-row"><span className="info-key">From Pre-Sale (40%)</span><span className="info-val" style={{ fontFamily: 'var(--font-m)' }}>{fmtUsd(presaleLiqUsdt)}</span></div>
          <div className="info-row"><span className="info-key">From MICE (40%)</span><span className="info-val" style={{ fontFamily: 'var(--font-m)' }}>{fmtUsd(miceLiqUsdt)}</span></div>
          <div style={{ borderTop: '1px solid var(--border)', marginTop: 8, paddingTop: 8 }}>
            <div className="info-row"><span className="info-key" style={{ fontWeight: 700 }}>Total Available</span><span className="info-val" style={{ fontFamily: 'var(--font-m)', fontWeight: 700, color: 'var(--gold)' }}>{fmtUsd(totalLiqUsdt)}</span></div>
          </div>
          <div className="info-row"><span className="info-key">Added to Pool</span><span className="info-val" style={{ fontFamily: 'var(--font-m)' }}>{poolUsdt > 0 ? fmtUsd(poolUsdt) : '-'}</span></div>
        </div>
      </div>

      {/* ═══ ACTIVATE SWAP (only when inactive) ═══ */}
      {!swapEnabled && (
        <>
          <div className="sep-lbl">Step 1 {'\u2014'} Create Initial Pool &amp; Activate SWAP</div>
          <div className="card" style={{ padding: 20, marginBottom: 16 }}>
            <div className="callout" style={{ marginBottom: 16, borderLeftColor: 'var(--gold)' }}>
              <strong>First-time activation:</strong> seeding MIC starts the pool&rsquo;s clock,
              fixes the opening price and opens buying. There is no PancakeSwap pair &mdash;
              LiquidityPoolV6 is the protocol&rsquo;s own AMM. Assets added here can{' '}
              <strong>never be withdrawn</strong> by anyone: the contract has no withdrawal
              function at all. They leave only when a member trades.
            </div>

            <div className="g2" style={{ marginBottom: 16 }}>
              <div>
                <div className="input-label" style={{ marginBottom: 6 }}>Initial MIC</div>
                <input
                  type="number"
                  value={addMic}
                  onChange={(e) => setAddMic(e.target.value)}
                  placeholder="e.g. 105000000"
                  style={{ width: '100%' }}
                />
                <div style={{ fontSize: '0.58rem', color: 'var(--gray2)', marginTop: 4, fontFamily: 'var(--font-m)' }}>
                  Source: ListingReserveVault ({pool ? fmtN(Math.round(pool.vaultMic)) : '—'} MIC available, 7-day withdrawal cooldown)
                </div>
              </div>
              <div>
                <div className="input-label" style={{ marginBottom: 6 }}>Initial USDT</div>
                <input
                  type="number"
                  value={addUsdt}
                  onChange={(e) => setAddUsdt(e.target.value)}
                  placeholder="e.g. 262500"
                  style={{ width: '100%' }}
                />
                <div style={{ fontSize: '0.58rem', color: 'var(--gray2)', marginTop: 4, fontFamily: 'var(--font-m)' }}>
                  Source: {fmtUsd(totalLiqUsdt)} from PreSale + MICE Revenue (40% Liquidity allocation)
                </div>
              </div>
            </div>

            {/* Price preview */}
            {addMic && addUsdt && parseFloat(addMic) > 0 && parseFloat(addUsdt) > 0 && (
              <div style={{
                background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 8,
                padding: '10px 14px', marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              }}>
                <span style={{ fontSize: SZ, color: 'var(--gray)' }}>Starting price:</span>
                <span style={{ fontFamily: 'var(--font-d)', fontSize: SZ, fontWeight: 700, color: 'var(--gold)' }}>
                  1 MIC = ${(parseFloat(addUsdt) / parseFloat(addMic)).toFixed(6)}
                </span>
              </div>
            )}

            <button
              className="btn btn-gold"
              onClick={handleActivate}
              disabled={saving || !addMic || !addUsdt}
              style={{ width: '100%', padding: '10px 0', fontSize: SZ, fontWeight: 700 }}
            >
              {saving ? 'Activating...' : '\uD83D\uDD12 Activate SWAP & Lock Pool (10 Years)'}
            </button>
          </div>
        </>
      )}

      {/* ═══ ADD LIQUIDITY (always visible) ═══ */}
      <div className="sep-lbl">{swapEnabled ? 'Add Liquidity to SWAP Pool' : 'Step 2 (after activation) \u2014 Add Liquidity to Rebalance'}</div>
      {/*
        External funding only. The 40% revenue share reaches the pool by itself — RevenueRouter
        calls `receiveUSDT` inside the sale transaction — so a button that "adds the 40%" would
        be adding what is already there. What still needs a person is money arriving from
        outside the protocol, and that has one safe route: the legacy contract, which can give
        it back if it lands wrongly. The pool itself cannot.
      */}
      <div className="card" style={{ padding: 20, marginBottom: 16 }}>
        <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          Add USDT from outside
        </div>
        <div style={{ fontSize: SZ, color: 'var(--gray2)', marginBottom: 14, lineHeight: 1.6 }}>
          The 40% revenue share already flows into the pool on its own. Use this only for USDT coming
          from outside the protocol {'\u2014'} it <strong>raises</strong> the MIC price.
        </div>

        <div className="g2" style={{ gap: 16, alignItems: 'start' }}>
          {/* Step 1 — where the money goes first */}
          <div>
            <div className="info-key" style={{ marginBottom: 6 }}>1 {'\u00B7'} Send BSC-USD here</div>
            <div
              style={{
                fontFamily: 'var(--font-m)', fontSize: '0.62rem', color: 'var(--gold)',
                background: 'rgba(0,0,0,.25)', border: '1px solid var(--border)',
                borderRadius: 8, padding: '10px 12px', wordBreak: 'break-all', marginBottom: 8,
              }}
            >
              {A.LiquidityPool}
            </div>
            <div style={{ fontSize: '0.58rem', color: 'var(--gray2)', lineHeight: 1.7 }}>
              Do <strong>not</strong> send USDT to the pool address. The pool counts only what arrives
              through <code>receiveUSDT</code>; it has no sync, skim or rescue function, so a direct
              transfer is lost for good. This contract has <code>withdrawUSDT</code>, so a mistake here
              is recoverable.
            </div>
          </div>

          {/* Step 2 — push it into the pool */}
          <div>
            <div className="info-key" style={{ marginBottom: 6 }}>2 {'\u00B7'} Move it into the pool</div>
            <div className="info-row" style={{ marginBottom: 6 }}>
              <span className="info-key">Waiting in the contract</span>
              <span className="info-val" style={{ fontFamily: 'var(--font-m)', color: walletUsdt ? 'var(--green2)' : 'var(--gray2)' }}>
                {walletUsdt === null ? '-' : fmtUsd(walletUsdt)}
              </span>
            </div>
            <div className="info-row" style={{ marginBottom: 10 }}>
              <span className="info-key">Currently in the pool</span>
              <span className="info-val" style={{ fontFamily: 'var(--font-m)' }}>{poolUsdt > 0 ? fmtUsd(poolUsdt) : '-'}</span>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                type="number"
                value={swapEnabled ? addUsdt : ''}
                onChange={(e) => setAddUsdt(e.target.value)}
                placeholder="USDT amount"
                disabled={!swapEnabled}
                style={{ flex: 1, opacity: swapEnabled ? 1 : 0.5 }}
              />
              <button
                className="btn btn-gold"
                onClick={() => handleAddLiquidity('usdt')}
                disabled={saving || !swapEnabled || !addUsdt}
                style={{ padding: '8px 20px', fontWeight: 700, opacity: swapEnabled ? 1 : 0.5 }}
              >
                {saving ? '...' : 'ADD USDT'}
              </button>
            </div>
            {!swapEnabled && (
              <div style={{ fontSize: '0.58rem', color: 'var(--gray2)', marginTop: 6, fontStyle: 'italic' }}>
                Activate SWAP first to enable adding liquidity
              </div>
            )}
            {canAddUsdt === false && (
              <div style={{ fontSize: '0.58rem', color: 'var(--gray2)', marginTop: 8, lineHeight: 1.7 }}>
                This wallet cannot call <code>receiveUSDT</code> yet.{' '}
                <button className="btn" onClick={handleGrantDistributor} disabled={saving}
                  style={{ padding: '4px 12px', fontSize: '0.58rem', marginLeft: 4 }}>
                  GRANT DISTRIBUTOR_ROLE
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/*
        The listing reserve is operated on the Treasury Vaults page, which already implements
        request -> 7-day cooldown -> execute AND refuses the addresses that would swallow the
        MIC (LiquidityPool v5, TreasuryManager). A second copy here was a duplicate without
        that guard, so this is a pointer instead.
      */}
      <div className="callout" style={{ fontSize: '0.64rem', lineHeight: 1.75, marginBottom: 16 }}>
        <div>
          <strong>Listing reserve.</strong> {pool ? fmtN(Math.round(pool.vaultMic)) + ' MIC' : 'The remaining MIC'} is
          held for exchange listings and other approved destinations {'\u2014'} it is not pool liquidity and is
          never added to SWAP. Move it from <a href="/treasury" style={{ color: 'var(--gold)' }}>Treasury Vaults</a>,
          where a withdrawal is requested, waits 7 days, and can then be executed by anyone.
        </div>
      </div>

      {/* Rebalance hint when active */}
      {swapEnabled && (
        <div className="callout" style={{ fontSize: '0.64rem', lineHeight: 1.75, marginBottom: 16, borderLeftColor: 'var(--green2)' }}>
          <strong>Price stabilization:</strong> Phase 1 (current) {'\u2014'} Manual rebalancing by Admin. If MIC price drops, add USDT to raise it. If MIC price rises too fast, add MIC to lower it. Phase 2 {'\u2014'} AI Stabilizer will auto-rebalance based on TWAP deviation.
        </div>
      )}

      {/* ═══ PRICE ORACLE ═══ */}
      <div className="sep-lbl">Price Source</div>
      <div className="g2" style={{ marginBottom: 16 }}>
        <div className="card" style={{ padding: 20 }}>
          {/* Every row here named a component that does not exist: there is no PancakeSwap
              pair, no Chainlink feed and no 30-minute window. The pool is its own oracle —
              price is reserves, and its TWAP is kept on chain in daily snapshots. */}
          <div className="card-title">Price Source</div>
          <div className="info-row"><span className="info-key">Oracle</span><span className="info-val">LiquidityPoolV6 reserves (own AMM)</span></div>
          <div className="info-row"><span className="info-key">Spot price</span><span className="info-val" style={{ fontFamily: 'var(--font-m)' }}>{pool ? `$${pool.spotPrice.toFixed(6)}` : '—'}</span></div>
          <div className="info-row"><span className="info-key">Buy fee</span><span className="info-val">{pool ? `${(pool.buyFeeBps / 100).toFixed(2)}%` : '—'}</span></div>
          <div className="info-row"><span className="info-key">Sell fee (current)</span><span className="info-val">{pool ? `${(pool.sellFeeBps / 100).toFixed(2)}%` : '—'}</span></div>
          <div className="info-row"><span className="info-key">Max single trade</span><span className="info-val">{pool ? `${(pool.maxTradeBps / 100).toFixed(2)}% of reserve` : '—'}</span></div>
          <div className="info-row"><span className="info-key">Sells open</span><span className="info-val">{pool ? `day ${pool.sellOpenDay} (now day ${pool.ageDays})` : '—'}</span></div>
          <div className="info-row"><span className="info-key">External listing at</span><span className="info-val" style={{ fontFamily: 'var(--font-m)' }}>{pool ? fmtUsd(pool.listingThreshold) : '—'}</span></div>
          {/* remainingDailyOut(): USDT the pool will still release in the current rolling
              24 hours. Sells consume it, buys do not; it is measured against the real USDT
              reserve, so the virtual reserve does not inflate it. */}
          <div className="info-row">
            <span className="info-key">Daily outflow left</span>
            <span className="info-val" style={{ fontFamily: 'var(--font-m)', color: 'var(--gold)' }}>
              {pool ? `${fmtUsd(pool.remainingDailyOut)} of ${fmtUsd(pool.reserveUsdt * 0.05)}` : '—'}
            </span>
          </div>
          <div className="info-row" style={{ alignItems: 'center' }}>
            <span className="info-key">
              Show to members
              <div style={{ color: 'var(--gray2)', fontSize: '0.55rem', marginTop: 2 }}>
                Displays the remaining allowance on the DApp SWAP screen
              </div>
            </span>
            <span style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                className={`btn ${showDailyCap ? 'btn-gold' : ''}`}
                disabled={saving}
                onClick={() => toggleDailyCapVisibility(!showDailyCap)}
                style={{ padding: '4px 14px', fontSize: '0.58rem', fontWeight: 700 }}
              >
                {showDailyCap ? 'VISIBLE' : 'HIDDEN'}
              </button>
            </span>
          </div>
        </div>
        <div className="card" style={{ padding: 20 }}>
          <div className="card-title">Stabilization</div>
          <div className="info-row"><span className="info-key">Phase 1</span><span className="info-val">Manual rebalance by Admin</span></div>
          <div className="info-row"><span className="info-key">Phase 2</span><span className="info-val badge b-gray">AI Stabilizer (auto)</span></div>
          <div className="info-row"><span className="info-key">Slippage Guard</span><span className="info-val badge b-gray">Phase 2</span></div>
          <div className="info-row"><span className="info-key">Auto-rebalance</span><span className="info-val badge b-gray">Phase 2</span></div>
        </div>
      </div>

      {/* ═══ POOL LOCK & FUTURE ═══ */}
      <div className="sep-lbl">Withdrawals &amp; Roadmap</div>
      <div className="card" style={{ padding: 20 }}>
        <div className="g2">
          <div>
            {/* Not a lock with a duration. There is no withdrawal function in the contract
                at all, so there is nothing to expire and nobody it could open for. */}
            <div className="card-title">Withdrawals</div>
            <div className="info-row"><span className="info-key">Withdrawal function</span><span className="info-val" style={{ color: 'var(--crimson2)' }}>None exists</span></div>
            <div className="info-row"><span className="info-key">Owner can withdraw</span><span className="info-val">No</span></div>
            <div className="info-row"><span className="info-key">DAO can withdraw</span><span className="info-val">No</span></div>
            <div className="info-row"><span className="info-key">Assets leave only by</span><span className="info-val">A member&rsquo;s trade</span></div>
            <div className="info-row"><span className="info-key">Additional deposits</span><span className="info-val">Allowed (seedMic / router)</span></div>
            <div style={{ fontSize: '0.58rem', color: 'var(--gray2)', marginTop: 10, lineHeight: 1.7 }}>
              This is deliberate: a pool an admin can drain is not liquidity. The cost is that
              anything sent <strong>directly</strong> to the pool address is stranded for
              good &mdash; the contract has no rescue path for stray tokens either. Only ever
              fund it through <code>seedMic</code> or the revenue router.
            </div>
          </div>
          <div>
            <div className="card-title">Future Roadmap</div>
            <div className="info-row"><span className="info-key">Community Farming</span><span className="info-val badge b-gray">Planned</span></div>
            <div className="info-row"><span className="info-key">LP Token Rewards</span><span className="info-val badge b-gray">Planned</span></div>
            <div className="info-row"><span className="info-key">Multi-pair Support</span><span className="info-val badge b-gray">Planned</span></div>
            <div className="callout" style={{ fontSize: '0.64rem', lineHeight: 1.75, marginTop: 10 }}>
              Community members will be able to provide liquidity and earn farming rewards. LP tokens will be issued as proof of liquidity provision.
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
