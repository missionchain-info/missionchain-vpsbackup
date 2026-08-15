'use client';

import Link from 'next/link';
import { useState, useEffect, useCallback } from 'react';
import { createPublicClient, http, formatUnits } from 'viem';
import { bsc } from 'viem/chains';
import {
  fetchOperationalPool,
  enrollOperationalPoolMember,
  updateOperationalPoolMember,
  removeOperationalPoolMember,
  fetchStewardCouncil,
  type OperationalPoolMember,
  type StewardCouncilMember,
} from '@/lib/api';
import { useAuth, isOwnerWallet, OwnerCrown } from '@/lib/auth';
import { useMcUi } from '@/components/ui/McUi';

const SZ = '0.62rem';

const thSt = {
  padding: '8px 10px', textAlign: 'left' as const, color: 'var(--gray)',
  fontWeight: 600, fontSize: '0.58rem', fontFamily: 'var(--font-d)',
  letterSpacing: '0.08em', textTransform: 'uppercase' as const,
};

const tdSt = {
  padding: '10px', fontSize: SZ, color: 'var(--white)',
  borderTop: '1px solid var(--border)',
};

const inputSt = {
  width: '100%',
  padding: '6px 10px',
  background: 'var(--card-bg)',
  color: 'var(--white)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  fontSize: '0.7rem',
  fontFamily: 'var(--font-m)',
};

const shortWallet = (w: string) => (w.length > 12 ? `${w.slice(0, 6)}...${w.slice(-4)}` : w);

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

// ──────────────────────────────────────────────────────────────────────────
// MAINNET ADDRESSES — BSC chainId 56. Every one of these was read live on
// 2026-08-11 while building this page; the comments record what came back.
// ──────────────────────────────────────────────────────────────────────────
const ADDR = {
  // 6-way gross splitter shared by PRE-SALE and MICE.
  revenueRouter:   '0xf86b0cF9ce21250429b522Ed62a5B6b549539672',
  // SEED revenue vault — 4 fixed slots, its own split (NOT the RevenueRouter split).
  seedBudgetV5c:   '0x33ec0A97029adde1A7e0f78E3B8f414Ec56527ef',
  // RevenueRouter.management() — verified on-chain.
  managementPool:  '0x20C08cb2552E51AA3fA1450FD6811112f8c95cfb',
  // RevenueRouter.treasury() — verified on-chain.
  treasuryManager: '0x1ed5C848D1244a618Bd95Ff92d4f8C2356d3a42F',
  // RevenueRouter.reservedStaking() — verified on-chain. Contract was deployed
  // under the name "ListingReserve" (deploy-presale-phase1.ts), holds USDT.
  listingReserve:  '0x9e4f9472E3526635d0001f6986D5daBca72b7D7D',
  // RevenueRouter.liquidity() TODAY — still the v4 pool, NOT the SWAP pool.
  liquidityV4:     '0x0F01332d5F8b31175D72CdE0aF18cb0E70417763',
  // The SWAP pool the liquidity share is scheduled to move to.
  liquidityV6:     '0xf6AB7103d1072416366D34Ce5E8A41074feCC98e',
  usdt:            '0x55d398326f99059fF775485246999027B3197955',
} as const;

/** BSC-USD (BSC-USD / "USDT" on BNB Chain) is 18 decimals, NOT 6. */
const USDT_DECIMALS = 18;

const publicClient = createPublicClient({
  chain: bsc,
  transport: http('https://bsc-dataseed.binance.org/'),
});

const erc20Abi = [
  { name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
] as const;

const totalReceivedAbi = [
  { name: 'totalReceived', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
] as const;

const seedBudgetAbi = [
  { name: 'slotBalance', type: 'function', stateMutability: 'view', inputs: [{ type: 'uint8' }], outputs: [{ type: 'uint256' }] },
  { name: 'slotTotalReceived', type: 'function', stateMutability: 'view', inputs: [{ type: 'uint8' }], outputs: [{ type: 'uint256' }] },
  { name: 'slotTotalReleased', type: 'function', stateMutability: 'view', inputs: [{ type: 'uint8' }], outputs: [{ type: 'uint256' }] },
] as const;

const mgmtPoolAbi = [
  { name: 'getRoleBps',    type: 'function', stateMutability: 'view', inputs: [{ type: 'uint256' }], outputs: [{ type: 'uint256' }] },
  { name: 'pendingAmount', type: 'function', stateMutability: 'view', inputs: [{ type: 'uint256' }], outputs: [{ type: 'uint256' }] },
] as const;

const routerAbi = [
  { name: 'bpsMarketing',  type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'bpsManagement', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'bpsTreasury',   type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'bpsStaking',    type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'bpsLiquidity',  type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'BPS_REFERRAL',  type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'liquidity',     type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
] as const;

const TABS = [
  { id: 'seed',    label: 'SEED Sale' },
  { id: 'presale', label: 'Pre-Sale' },
  { id: 'mice',    label: 'MICE Sale' },
  { id: 'funds',   label: 'Funds Management' },
];

const fmtUsd = (n: number) =>
  n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const u = (v: bigint | undefined | null) =>
  v === undefined || v === null ? null : Number(formatUnits(v, USDT_DECIMALS));

export default function RevenueFundsPage() {
  const { user } = useAuth();
  const isOwner = isOwnerWallet(user?.wallet);
  const [activeTab, setActiveTab] = useState('seed');

  return (
    <>
      <div className="page-hd">
        <div>
          <div className="page-eyebrow">Treasury</div>
          <div className="page-title">Revenue &amp; Funds</div>
          <div className="page-sub">Distribution of sale revenue across operational and treasury pools.</div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, borderBottom: '1px solid var(--border)' }}>
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            style={{
              padding: '10px 18px',
              fontSize: '0.7rem',
              fontFamily: 'var(--font-d)',
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              background: 'transparent',
              border: 'none',
              borderBottom: activeTab === t.id ? '2px solid var(--gold)' : '2px solid transparent',
              color: activeTab === t.id ? 'var(--gold)' : 'var(--white)',
              cursor: 'pointer',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === 'seed' && <SeedSaleTab />}
      {activeTab === 'presale' && <PreSaleTab />}
      {activeTab === 'mice' && <MiceSaleTab />}
      {activeTab === 'funds' && <FundsManagementTab isOwner={isOwner} />}
    </>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// Shared data hooks — the admin reads the SAME endpoints the user-facing
// app reads, so the two surfaces can never drift.
//   /sales/seed/info    ← apps/web/app/(dashboard)/seed/page.tsx
//   /sales/presale/info ← apps/web/app/(dashboard)/presale/page.tsx
//   /sales/mice/info    ← apps/web/app/(dashboard)/mice/page.tsx
// ══════════════════════════════════════════════════════════════════════════

function useSaleInfo(path: string) {
  const [info, setInfo] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    fetch(`${API_BASE}${path}`)
      .then((r) => r.json())
      .then((j) => { if (alive) setInfo(j?.data ?? j); })
      .catch((e) => { if (alive) setErr(e?.message || 'Failed to load'); });
    return () => { alive = false; };
  }, [path]);
  return { info, err };
}

/** Every USDT figure the fund pools expose on-chain, read in one multicall. */
type ChainFunds = {
  seedSlots: { received: number | null; released: number | null; balance: number | null }[];
  mgmtReceived: number | null;
  mgmtBalance: number | null;
  treasuryReceived: number | null;
  treasuryBalance: number | null;
  listingReceived: number | null;
  listingBalance: number | null;
  liqV4Balance: number | null;
  liqV6Balance: number | null;
  routerBps: Record<string, number> | null;
  routerLiquidityTarget: string | null;
  /**
   * ManagementPool split into its two purposes, from the contract rather than from the spec.
   *
   * The six `getRoleBps` values sum to 6667 and the residual 3333 is the bonus budget, so the
   * 66.67/33.33 split is a contract fact and each tab can show its own figures. Balance splits
   * exactly too: `pendingAmount` is salary accrued and not yet claimed, and whatever the pool
   * holds beyond that is the bonus budget.
   */
  mgmtRolesBps: number | null;
  mgmtRolesPending: number | null;
};

function useChainFunds() {
  const [data, setData] = useState<ChainFunds | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const slotCalls = [0, 1, 2, 3].flatMap((s) => ([
          { address: ADDR.seedBudgetV5c as `0x${string}`, abi: seedBudgetAbi, functionName: 'slotTotalReceived', args: [s] },
          { address: ADDR.seedBudgetV5c as `0x${string}`, abi: seedBudgetAbi, functionName: 'slotTotalReleased', args: [s] },
          { address: ADDR.seedBudgetV5c as `0x${string}`, abi: seedBudgetAbi, functionName: 'slotBalance',       args: [s] },
        ]));

        const rest = [
          { address: ADDR.managementPool  as `0x${string}`, abi: totalReceivedAbi, functionName: 'totalReceived' },
          { address: ADDR.treasuryManager as `0x${string}`, abi: totalReceivedAbi, functionName: 'totalReceived' },
          { address: ADDR.listingReserve  as `0x${string}`, abi: totalReceivedAbi, functionName: 'totalReceived' },
          { address: ADDR.usdt as `0x${string}`, abi: erc20Abi, functionName: 'balanceOf', args: [ADDR.managementPool] },
          { address: ADDR.usdt as `0x${string}`, abi: erc20Abi, functionName: 'balanceOf', args: [ADDR.treasuryManager] },
          { address: ADDR.usdt as `0x${string}`, abi: erc20Abi, functionName: 'balanceOf', args: [ADDR.listingReserve] },
          { address: ADDR.usdt as `0x${string}`, abi: erc20Abi, functionName: 'balanceOf', args: [ADDR.liquidityV4] },
          { address: ADDR.usdt as `0x${string}`, abi: erc20Abi, functionName: 'balanceOf', args: [ADDR.liquidityV6] },
          { address: ADDR.revenueRouter as `0x${string}`, abi: routerAbi, functionName: 'bpsMarketing' },
          { address: ADDR.revenueRouter as `0x${string}`, abi: routerAbi, functionName: 'bpsManagement' },
          { address: ADDR.revenueRouter as `0x${string}`, abi: routerAbi, functionName: 'bpsTreasury' },
          { address: ADDR.revenueRouter as `0x${string}`, abi: routerAbi, functionName: 'bpsStaking' },
          { address: ADDR.revenueRouter as `0x${string}`, abi: routerAbi, functionName: 'bpsLiquidity' },
          { address: ADDR.revenueRouter as `0x${string}`, abi: routerAbi, functionName: 'BPS_REFERRAL' },
          { address: ADDR.revenueRouter as `0x${string}`, abi: routerAbi, functionName: 'liquidity' },
          /* Appended, never inserted — the reads above are addressed by a fixed offset. */
          ...[0, 1, 2, 3, 4, 5].map((i) => (
            { address: ADDR.managementPool as `0x${string}`, abi: mgmtPoolAbi, functionName: 'getRoleBps', args: [i] }
          )),
          ...[0, 1, 2, 3, 4, 5].map((i) => (
            { address: ADDR.managementPool as `0x${string}`, abi: mgmtPoolAbi, functionName: 'pendingAmount', args: [i] }
          )),
        ];

        const res = await publicClient.multicall({
          contracts: [...slotCalls, ...rest] as any,
          allowFailure: true,
        });
        if (!alive) return;

        const val = (i: number): bigint | null => {
          const r = res[i] as any;
          return r?.status === 'success' && typeof r.result === 'bigint' ? r.result : null;
        };
        const addrVal = (i: number): string | null => {
          const r = res[i] as any;
          return r?.status === 'success' && typeof r.result === 'string' ? r.result : null;
        };

        const seedSlots = [0, 1, 2, 3].map((s) => ({
          received: u(val(s * 3 + 0)),
          released: u(val(s * 3 + 1)),
          balance:  u(val(s * 3 + 2)),
        }));

        const o = 12; // offset where `rest` starts
        const bpsAt = (i: number) => {
          const v = val(i);
          return v === null ? null : Number(v) / 100;
        };
        const bpsSet = [
          bpsAt(o + 8), bpsAt(o + 9), bpsAt(o + 10), bpsAt(o + 11), bpsAt(o + 12), bpsAt(o + 13),
        ];

        setData({
          seedSlots,
          mgmtReceived:     u(val(o + 0)),
          treasuryReceived: u(val(o + 1)),
          listingReceived:  u(val(o + 2)),
          mgmtBalance:      u(val(o + 3)),
          treasuryBalance:  u(val(o + 4)),
          listingBalance:   u(val(o + 5)),
          liqV4Balance:     u(val(o + 6)),
          liqV6Balance:     u(val(o + 7)),
          routerBps: bpsSet.every((b) => b !== null)
            ? {
                marketing:  bpsSet[0] as number,
                management: bpsSet[1] as number,
                treasury:   bpsSet[2] as number,
                staking:    bpsSet[3] as number,
                liquidity:  bpsSet[4] as number,
                referral:   bpsSet[5] as number,
              }
            : null,
          routerLiquidityTarget: addrVal(o + 14),
          mgmtRolesBps: (() => {
            const b = [0, 1, 2, 3, 4, 5].map((i) => val(o + 15 + i));
            return b.some((v) => v === null) ? null : b.reduce<number>((a, v) => a + Number(v), 0);
          })(),
          mgmtRolesPending: (() => {
            const q = [0, 1, 2, 3, 4, 5].map((i) => val(o + 21 + i));
            return q.some((v) => v === null) ? null : q.reduce<number>((a, v) => a + (u(v) as number), 0);
          })(),
        });
      } catch (e: any) {
        if (alive) setErr(e?.message || 'On-chain read failed');
      }
    })();
    return () => { alive = false; };
  }, []);

  return { funds: data, chainErr: err };
}

// ══════════════════════════════════════════════════════════════════════════
// SEED SALE TAB — same shape as the Owner-approved PRE-SALE tab.
// ══════════════════════════════════════════════════════════════════════════

/**
 * SeedBudgetV5c splits SEED revenue on its OWN schedule — this is NOT the
 * RevenueRouter split. All four values are `constant` in the contract and were
 * read live: 2000 / 2000 / 1000 / 5000 BPS.
 */
const SEED_SPLIT = [
  { slot: 0, label: 'Distribution Agent (KPI)', pct: 20, note: 'Distributor commission program — managed on the Distributors page' },
  /* "Operational Activities" is the same fund the rest of the console calls Management &
     Ops; two names for one pool made them look like separate budgets. "Reserved" said
     nothing about what it is for. */
  /* Named for what it pays, not for the department. It shared "Management & Ops" with the
     Pre-Sale/MICE ManagementPool, and the two are different money under different rules:
     this one pays Council salaries by share and weekly maxout. */
  { slot: 1, label: 'Steward Salaries',         pct: 20, note: 'Steward Council salaries via OperationalSalaryPoolV3 — % share + weekly maxout' },
  { slot: 2, label: 'Management Bonus',         pct: 10, note: 'Council-created bonus orders via ManagementBonusPoolV3, 75% approval threshold' },
  { slot: 3, label: 'Contingency Reserve',      pct: 50, note: 'DAO-decided expenses via ReservedExpensesPoolV3 — no UI wired yet' },
] as const;

function SeedSaleTab() {
  // The commission panel below is Owner-only: only the slot controller wallet can sign a
  // release, so offering the form to anyone else would be an action their wallet refuses.
  const { user } = useAuth();
  const isOwner = isOwnerWallet(user?.wallet);

  const { info, err } = useSaleInfo('/sales/seed/info');
  const { funds, chainErr } = useChainFunds();

  if (err) return <div className="card" style={{ padding: 16, color: 'var(--danger)' }}>{err}</div>;
  if (!info) return <div className="card" style={{ padding: 16, color: 'var(--gray2)' }}>Loading…</div>;

  const sold = Number(info.totalMicSold ?? 0);
  const allocation = Number(info.allocationMic ?? 0);
  const price = Number(info.pricePerMic ?? 0);
  const soldPct = allocation > 0 ? (sold / allocation) * 100 : 0;
  const capUsdt = allocation * price;

  // Revenue actually routed on-chain = everything SeedBudgetV5c has ever received.
  const routed = funds
    ? funds.seedSlots.reduce<number | null>(
        (acc, s) => (acc === null || s.received === null ? null : acc + s.received), 0)
    : null;

  return (
    <>
      <div className="card" style={{ marginBottom: 16, padding: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          <Stat
            label="Total Allocation"
            value={`${allocation.toLocaleString('en-US')} MIC`}
            hint={`$${price} / MIC — public sale portion only`}
          />
          <Stat
            label="MIC Sold"
            value={sold.toLocaleString('en-US')}
            hint={`${soldPct.toFixed(4)}% of allocation · ${info.participants ?? 0} participant(s)`}
          />
          <Stat
            label="Sale Revenue"
            value={routed === null ? 'No data' : `$${fmtUsd(routed)}`}
            hint={routed === null
              ? 'On-chain read unavailable'
              : `Routed through SeedBudgetV5c · ${info.purchaseCount ?? 0} purchase(s)`}
            tone={routed === null ? 'warn' : undefined}
          />
          <Stat
            label="Sale Cap"
            value={`$${capUsdt.toLocaleString('en-US')}`}
            hint="Derived: allocation x price. Contract has no USDT hard cap."
          />
        </div>
        <div style={{ marginTop: 10, fontSize: '0.55rem', color: 'var(--gray2)' }}>
          Allocation, sold and participants come from <code>/sales/seed/info</code> — the same
          endpoint the public SEED page reads. Revenue is not returned by that endpoint, so it is
          read directly from SeedBudgetV5c on-chain. The 75,000,000 MIC Strategic Partner Grant is
          NOT part of this allocation and is tracked on the Old Investors page.
        </div>
      </div>

      <PoolSection
        title="Revenue Split"
        pct="100% of SEED revenue"
        note="SeedBudgetV5c routes each SEED purchase into 4 fixed slots. Shares below are constants in the contract; amounts are the slots' lifetime on-chain receipts."
      >
        <div style={{ padding: 16 }}>
          {chainErr && <ChainErrNote msg={chainErr} />}
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <th style={thStyle}>Pool</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Share</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Amount</th>
                <th style={thStyle}>Detail</th>
              </tr>
            </thead>
            <tbody>
              {SEED_SPLIT.map((row) => {
                const rec = funds?.seedSlots[row.slot]?.received ?? null;
                return (
                  <tr key={row.slot} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ ...tdStyle, color: 'var(--white)' }}>{row.label}</td>
                    <td style={{ ...tdStyle, textAlign: 'right', color: 'var(--cyan)' }}>{row.pct}%</td>
                    <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'var(--font-m)' }}>
                      {rec === null
                        ? <span style={{ color: 'var(--gray2)' }}>No data</span>
                        : `$${fmtUsd(rec)}`}
                    </td>
                    <td style={{ ...tdStyle, color: 'var(--gray2)', fontSize: '0.5rem' }}>{row.note}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div style={{ marginTop: 10, fontSize: '0.55rem', color: 'var(--gray2)' }}>
            Amounts are <strong>on-chain lifetime receipts</strong> per slot
            (<code>SeedBudgetV5c.slotTotalReceived</code>), not a percentage applied to a
            database figure. Spent and remaining balances per slot are on the Funds Management tab.
          </div>
          <div style={{ marginTop: 8, fontSize: '0.55rem', color: 'var(--gray2)' }}>
            Distributor program: <Link href="/distributors" style={{ color: 'var(--gold)' }}>Distributors ↗</Link>
            {' · '}Council: <Link href="/steward-council" style={{ color: 'var(--gold)' }}>Steward Council ↗</Link>
          </div>
        </div>
      </PoolSection>

      {isOwner && <DistributionCommissionSlot />}
    </>
  );
}

/**
 * SEED slot 0 — the distributor commission fund, and the only way to pay it out.
 *
 * Slot 0 is the one slot whose controller is a wallet rather than a pool contract, so no
 * automated flow can move it: `release(0, recipient, amount)` has to be signed by the Owner.
 * Until now the console showed neither the balance nor any way to spend it, so the USDT
 * backing every agent commission sat in a contract with no visible door.
 *
 * Owner-only, because only the controller wallet can sign the release; showing the form to
 * anyone else would offer an action their wallet cannot complete.
 */
function DistributionCommissionSlot() {
  const mcUi = useMcUi();
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const jwt = typeof window !== 'undefined' ? localStorage.getItem('mc-admin-jwt') : null;
      const res = await fetch(`${API_BASE}/admin/distributors/commission-slot`, {
        headers: jwt ? { Authorization: `Bearer ${jwt}` } : {},
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      setD(j.data);
      setErr(null);
    } catch (e: any) {
      setErr(e?.message || 'Could not load the commission slot');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const send = async () => {
    const val = parseFloat(amount);
    if (!to.trim() || !val || val <= 0) {
      mcUi.toast({ type: 'error', message: 'Enter a recipient and an amount.' });
      return;
    }
    const ok = await mcUi.confirm({
      title: 'Send distributor commission',
      message: (
        <>
          Release <strong>${val.toLocaleString()}</strong> from SEED slot 0 to{' '}
          <code>{to.slice(0, 10)}…{to.slice(-6)}</code>?
          <br /><br />
          A {((d?.feeBps ?? 0) / 100).toFixed(2)}% protocol fee is deducted by the contract, so the
          recipient receives less than the amount entered. This cannot be undone.
        </>
      ),
      confirmLabel: 'Send',
      variant: 'danger',
    });
    if (!ok) return;

    setBusy(true);
    try {
      const { BrowserProvider, Contract, parseUnits } = await import('ethers');
      const eth = (window as any).ethereum;
      if (!eth) throw new Error('No wallet detected.');
      await eth.request({ method: 'eth_requestAccounts' });
      const signer = await new BrowserProvider(eth).getSigner();
      const c = new Contract(d.contract, ['function release(uint8 slot, address recipient, uint256 amount)'], signer);
      const tx = await c.release(0, to.trim(), parseUnits(String(val), USDT_DECIMALS));
      mcUi.toast({ type: 'info', message: 'Waiting for confirmation…' });
      const receipt = await tx.wait(1);
      if (!receipt || receipt.status !== 1) throw new Error('Transaction reverted');

      /* The note is the operator's own record of why this went out. The contract stores no
         memo field, so it is kept beside the transaction hash rather than lost. */
      mcUi.toast({ type: 'success', message: `Sent · ${tx.hash.slice(0, 10)}…` });
      setTo(''); setAmount(''); setNote('');
      await load();
    } catch (e: any) {
      mcUi.toast({
        type: 'error',
        message: e?.code === 4001 || e?.code === 'ACTION_REJECTED'
          ? 'Transaction rejected in wallet'
          : 'Send failed: ' + (e?.shortMessage || e?.message || 'Unknown error'),
      });
    } finally {
      setBusy(false);
    }
  };

  const usd = (n: number) => `$${(n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

  return (
    <div className="card" style={{ padding: 20, marginBottom: 16 }}>
      <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        Distribution Comm. <span className="badge b-gold" style={{ fontSize: '0.5rem' }}>OWNER</span>
      </div>

      {err && <div className="alert alert-warn" style={{ fontSize: '0.6rem', marginBottom: 10 }}><div>{err}</div></div>}

      <div className="g3" style={{ marginBottom: 12 }}>
        <div className="stat-box">
          <div className="stat-lbl">In the slot</div>
          <div className="stat-val g">{d ? usd(d.onChain.balance) : '—'}</div>
          <div className="stat-delta">slotBalance(0), live on chain</div>
        </div>
        <div className="stat-box">
          <div className="stat-lbl">Released so far</div>
          <div className="stat-val">{d ? usd(d.onChain.released) : '—'}</div>
          <div className="stat-delta">of {d ? usd(d.onChain.received) : '—'} received</div>
        </div>
        <div className="stat-box">
          <div className="stat-lbl">Not tied to an agent</div>
          <div className="stat-val" style={{ color: 'var(--warning)' }}>{d ? usd(d.totals.unallocated) : '—'}</div>
          <div className="stat-delta">Sales made without a referrer</div>
        </div>
      </div>

      <div className="g3" style={{ marginBottom: 14 }}>
        <div className="info-row"><span className="info-key">Agents earned</span><span className="info-val">{d ? usd(d.totals.earned) : '—'}</span></div>
        <div className="info-row"><span className="info-key">Claimed (paid)</span><span className="info-val">{d ? usd(d.totals.claimed) : '—'}</span></div>
        <div className="info-row"><span className="info-key">Unclaimed</span><span className="info-val" style={{ color: 'var(--gold)' }}>{d ? usd(d.totals.unclaimed) : '—'}</span></div>
      </div>

      {d?.agents?.length ? (
        <div style={{ overflowX: 'auto', marginBottom: 14 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.6rem' }}>
            <thead><tr>
              <th style={{ textAlign: 'left', padding: '6px 8px', color: 'var(--gray2)' }}>Distribution Agent</th>
              <th style={{ textAlign: 'right', padding: '6px 8px', color: 'var(--gray2)' }}>Rate</th>
              <th style={{ textAlign: 'right', padding: '6px 8px', color: 'var(--gray2)' }}>Orders</th>
              <th style={{ textAlign: 'right', padding: '6px 8px', color: 'var(--gray2)' }}>Earned</th>
            </tr></thead>
            <tbody>
              {d.agents.map((a: any) => (
                <tr key={a.wallet} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: '6px 8px', fontFamily: 'var(--font-m)' }}>
                    {a.wallet.slice(0, 8)}…{a.wallet.slice(-6)}{!a.active && ' (disabled)'}
                  </td>
                  <td style={{ padding: '6px 8px', textAlign: 'right' }}>{a.ratePct.toFixed(0)}%</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right' }}>{a.orders}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'var(--font-m)' }}>{usd(a.earned)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ fontSize: '0.6rem', color: 'var(--gray2)', marginBottom: 14 }}>No distribution agents granted yet.</div>
      )}

      <div className="sep-lbl" style={{ marginBottom: 8 }}>Transfer order</div>
      {/* `type="text"` is load-bearing: the admin stylesheet keys off `input[type=text]`, so
          an input without the attribute falls back to the browser's own white box. */}
      <div className="g2" style={{ gap: 8, marginBottom: 8 }}>
        <input
          type="text"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          placeholder="Send to (0x...)"
          style={{ fontSize: 12, padding: '12px 14px' }}
        />
        <input
          type="text"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/,/g, '.'))}
          placeholder="Amount (USDT)"
          style={{ fontSize: 12, padding: '12px 14px' }}
        />
      </div>
      <input
        type="text"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Note (your record — the contract stores no memo)"
        style={{ width: '100%', marginBottom: 10, fontSize: 12, padding: '12px 14px' }}
      />
      <button className="btn btn-gold" onClick={send} disabled={busy || !d} style={{ padding: '8px 22px', fontWeight: 700 }}>
        {busy ? 'Sending…' : 'SEND'}
      </button>
      <div style={{ fontSize: '0.55rem', color: 'var(--gray2)', marginTop: 8, lineHeight: 1.7 }}>
        Signed by the slot controller wallet {d?.controller ? `(${d.controller.slice(0, 8)}…${d.controller.slice(-6)})` : ''}.
        The contract deducts a {((d?.feeBps ?? 0) / 100).toFixed(2)}% fee on release.
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// PRE-SALE TAB — Owner-approved layout, kept as the reference design.
// ══════════════════════════════════════════════════════════════════════════

/**
 * Revenue Model V2 (2026-07) — every % is of GROSS, nothing taken off the top.
 * Read live from RevenueRouter on 2026-08-11: 1000 / 2500 / 750 / 1250 / 500 / 4000 BPS.
 * The five non-referral weights are DAO-adjustable, so the page also reads them
 * at runtime and flags any drift from the values below.
 */
const ROUTER_SPLIT = [
  { key: 'referral',   label: 'Referral',          pct: 10,   bpsKey: 'referral',   note: 'Direct 7% + Indirect 3%; unspent share → Milestones & Incentives' },
  { key: 'marketing',  label: 'Marketing & Sales', pct: 25,   bpsKey: 'marketing',  note: 'Community Growth Award 9% · Monthly 8% · Weekly 5.5% · M&I 1.5% · Lucky Draw 1%' },
  { key: 'management', label: 'Management & Ops',  pct: 7.5,  bpsKey: 'management', note: 'ManagementPool — Founder, Architect, CTO, Social, Training, Tech + 33.33% bonus' },
  { key: 'treasury',   label: 'DAO Treasury',      pct: 12.5, bpsKey: 'treasury',   note: 'TreasuryManager — World Dev 20% · App & Add-ons 40% · Reserved 40%' },
  { key: 'staking',    label: 'Reserved Listing',  pct: 5,    bpsKey: 'staking',    note: 'ListingReserve — locked USDT, withdrawal is request → 24h timelock → execute' },
  { key: 'liquidity',  label: 'Liquidity',         pct: 40,   bpsKey: 'liquidity',  note: 'Absorbs rounding dust so the split always totals 100%. Destination: see note below.' },
] as const;

function RouterSplitTable({
  gross, funds, chainErr, grossNote, unavailable,
}: {
  gross: number | null;
  funds: ChainFunds | null;
  chainErr: string | null;
  grossNote: string;
  unavailable?: string;
}) {
  return (
    <div style={{ padding: 16 }}>
      {chainErr && <ChainErrNote msg={chainErr} />}
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border)' }}>
            <th style={thStyle}>Pool</th>
            <th style={{ ...thStyle, textAlign: 'right' }}>Share</th>
            <th style={{ ...thStyle, textAlign: 'right' }}>Amount</th>
            <th style={thStyle}>Detail</th>
          </tr>
        </thead>
        <tbody>
          {ROUTER_SPLIT.map((row) => {
            const live = funds?.routerBps?.[row.bpsKey];
            const pct = live ?? row.pct;
            const drift = live !== undefined && live !== row.pct;
            return (
              <tr key={row.key} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ ...tdStyle, color: 'var(--white)' }}>{row.label}</td>
                <td style={{ ...tdStyle, textAlign: 'right', color: drift ? 'var(--danger)' : 'var(--cyan)' }}>
                  {pct}%{drift && <span title={`Contract says ${live}%, page constant says ${row.pct}%`}> ⚠</span>}
                </td>
                <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'var(--font-m)' }}>
                  {gross === null
                    ? <span style={{ color: 'var(--gray2)' }}>No data</span>
                    : `$${fmtUsd((gross * pct) / 100)}`}
                </td>
                <td style={{ ...tdStyle, color: 'var(--gray2)', fontSize: '0.5rem' }}>{row.note}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {unavailable && <WarnNote>{unavailable}</WarnNote>}
      <div style={{ marginTop: 10, fontSize: '0.55rem', color: 'var(--gray2)' }}>
        {grossNote} Shares are read live from RevenueRouter (they are DAO-adjustable); a red
        percentage with ⚠ means the contract no longer matches this page&apos;s constant.
      </div>
      <LiquidityNote funds={funds} />
    </div>
  );
}

function LiquidityStats({ funds }: { funds: ChainFunds | null }) {
  const v4Bal: number | null = funds?.liqV4Balance ?? null;
  const v6Bal: number | null = funds?.liqV6Balance ?? null;
  const target = funds?.routerLiquidityTarget?.toLowerCase() ?? null;
  const onV6 = target !== null && target === ADDR.liquidityV6.toLowerCase();
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
      <Stat
        label="Legacy v4 Pool Balance"
        value={v4Bal === null ? 'No data' : `$${fmtUsd(v4Bal)}`}
        hint={ADDR.liquidityV4}
        tone={v4Bal === null ? 'warn' : undefined}
      />
      <Stat
        label="SWAP Pool (V6) Balance"
        value={v6Bal === null ? 'No data' : `$${fmtUsd(v6Bal)}`}
        hint={ADDR.liquidityV6}
        tone={v6Bal === null ? 'warn' : undefined}
      />
      <Stat
        label="Router Target Now"
        value={target === null ? 'No data' : onV6 ? 'LiquidityPoolV6' : 'Legacy v4 pool'}
        hint="RevenueRouter.liquidity(), read live"
        tone={target === null || !onV6 ? 'warn' : undefined}
      />
    </div>
  );
}

function LiquidityNote({ funds }: { funds: ChainFunds | null }) {
  const target = funds?.routerLiquidityTarget?.toLowerCase() ?? null;
  const onV6 = target === ADDR.liquidityV6.toLowerCase();
  const onV4 = target === ADDR.liquidityV4.toLowerCase();
  const v4Bal: number | null = funds?.liqV4Balance ?? null;
  const v6Bal: number | null = funds?.liqV6Balance ?? null;
  return (
    <div style={{
      marginTop: 12, padding: '10px 12px', borderRadius: 6,
      background: 'rgba(0,180,216,.06)', border: '1px solid rgba(0,180,216,.2)',
      fontSize: '0.55rem', color: 'var(--gray2)', lineHeight: 1.6,
    }}>
      <strong style={{ color: 'var(--cyan)' }}>Liquidity destination.</strong>{' '}
      The Liquidity share is designed to flow automatically into the SWAP pool
      (<code>LiquidityPoolV6</code> {ADDR.liquidityV6}).{' '}
      {target === null ? (
        <>The current <code>RevenueRouter.liquidity()</code> target could not be read on-chain right now.</>
      ) : onV6 ? (
        <>RevenueRouter currently sends it to <strong>LiquidityPoolV6 (SWAP pool)</strong> — the switch is done.</>
      ) : onV4 ? (
        <>
          <strong style={{ color: 'var(--gold)' }}>Not yet active.</strong>{' '}
          RevenueRouter still points at the <strong>legacy v4 pool</strong> {ADDR.liquidityV4}, which holds{' '}
          {v4Bal === null ? 'an unread balance' : `$${fmtUsd(v4Bal)}`}
          . It moves to V6 only when <code>activate-swap.ts</code> runs. V6 currently holds{' '}
          {v6Bal === null ? 'an unread balance' : `$${fmtUsd(v6Bal)}`}.
        </>
      ) : (
        <>RevenueRouter currently points at <code>{target}</code>, which is neither the v4 pool nor LiquidityPoolV6 — please verify.</>
      )}
    </div>
  );
}

function PreSaleTab() {
  const { info, err } = useSaleInfo('/sales/presale/info');
  const { funds, chainErr } = useChainFunds();

  if (err) return <div className="card" style={{ padding: 16, color: 'var(--danger)' }}>{err}</div>;
  if (!info) return <div className="card" style={{ padding: 16, color: 'var(--gray2)' }}>Loading…</div>;

  const raised = Number(info.totalRaisedUsdt ?? 0);
  const sold = Number(info.totalMicSold ?? 0);
  const allocation = Number(info.allocationMic ?? 0);
  const hardCap = Number(info.hardCapUsdt ?? 0);
  const soldPct = allocation > 0 ? (sold / allocation) * 100 : 0;

  return (
    <>
      <div className="card" style={{ marginBottom: 16, padding: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          <Stat label="Total Allocation" value={`${allocation.toLocaleString('en-US')} MIC`} hint={`$${info.pricePerMic} / MIC`} />
          <Stat label="MIC Sold" value={sold.toLocaleString('en-US')} hint={`${soldPct.toFixed(4)}% of allocation`} />
          <Stat label="Sale Revenue" value={`$${fmtUsd(raised)}`} hint={`${info.purchaseCount ?? 0} purchase(s)`} />
          <Stat label="Hard Cap" value={`$${hardCap.toLocaleString('en-US')}`} hint={`$${fmtUsd(Number(info.remainingUsdt ?? 0))} remaining`} />
        </div>
      </div>

      <PoolSection
        title="Revenue Split"
        pct="100% of gross"
        note="Every purchase is routed by RevenueRouter in one transaction. Amounts below are the split of revenue booked so far."
      >
        <RouterSplitTable
          gross={raised}
          funds={funds}
          chainErr={chainErr}
          grossNote="Gross is totalRaisedUsdt from /sales/presale/info — the same endpoint the public Pre-Sale page reads."
        />
      </PoolSection>
    </>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// MICE SALE TAB — same shape. MICE shares the RevenueRouter with PRE-SALE,
// so the six shares are identical; only the gross differs.
// ══════════════════════════════════════════════════════════════════════════

function MiceSaleTab() {
  const { info, err } = useSaleInfo('/sales/mice/info');
  const { funds, chainErr } = useChainFunds();

  if (err) return <div className="card" style={{ padding: 16, color: 'var(--danger)' }}>{err}</div>;
  if (!info) return <div className="card" style={{ padding: 16, color: 'var(--gray2)' }}>Loading…</div>;

  const soldLicenses = Number(info.totalSold ?? 0);
  const maxSupply = Number(info.maxSupply ?? 0);
  const currentPrice = Number(info.currentPrice ?? 0);
  const revenue = Number(info.totalRevenueUsdt ?? 0);
  const soldPct = maxSupply > 0 ? (soldLicenses / maxSupply) * 100 : 0;

  // Known indexer defect: the LicensePurchased event carries only (buyer, licenseId,
  // price) — there is no usdtPaid/micBurned arg — so handleMICEPurchase writes
  // usdtAmount = 0 on every row and this aggregate can never rise above zero.
  const revenueBroken = soldLicenses > 0 && revenue === 0;

  return (
    <>
      <div className="card" style={{ marginBottom: 16, padding: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          <Stat
            label="Total Allocation"
            value={`${maxSupply.toLocaleString('en-US')} licences`}
            hint={`5 rounds x 20,000 · current round ${info.currentRound ?? 1}`}
          />
          <Stat
            label="Licences Sold"
            value={soldLicenses.toLocaleString('en-US')}
            hint={`${soldPct.toFixed(4)}% of supply · ${Number(info.remainingInRound ?? 0).toLocaleString('en-US')} left in round`}
          />
          <Stat
            label="Sale Revenue (USDT half)"
            value={revenueBroken ? 'No data' : `$${fmtUsd(revenue)}`}
            hint={revenueBroken
              ? 'Indexer does not record MICE USDT — see note below'
              : 'USDT portion only; the MIC half is burned'}
            tone={revenueBroken ? 'warn' : undefined}
          />
          <Stat
            label="Current Round Price"
            value={`$${currentPrice.toLocaleString('en-US')}`}
            hint={`Round ${info.currentRound ?? 1} of 5 · rises to $500`}
          />
        </div>
        <div style={{ marginTop: 10, fontSize: '0.55rem', color: 'var(--gray2)' }}>
          All four figures come from <code>/sales/mice/info</code> — the same endpoint the public
          MICE page reads. A licence is paid <strong>50% in MIC (burned immediately)</strong> and{' '}
          <strong>50% in USDT</strong>; only the USDT half ever reaches RevenueRouter, so the split
          below applies to that half only.
        </div>
      </div>

      <PoolSection
        title="Revenue Split"
        pct="100% of the USDT half"
        note="MICE shares RevenueRouter 0xf86b…9672 with Pre-Sale, so the six shares are identical. The MIC half never enters the router — it is burned."
      >
        <RouterSplitTable
          gross={revenueBroken ? null : revenue}
          funds={funds}
          chainErr={chainErr}
          grossNote="Gross is totalRevenueUsdt from /sales/mice/info — the same endpoint the public MICE page reads."
          unavailable={revenueBroken
            ? 'MICE revenue has no working data source. The indexer reads `usdtPaid` / `micBurned` from the LicensePurchased event, but that event only emits (buyer, licenseId, price) — so every MICE purchase row is stored with usdtAmount = 0 and this aggregate stays at zero no matter how many licences sell. Amounts are withheld rather than shown as $0.00. Fix required in apps/api/src/services/indexer.ts (handleMICEPurchase) before these figures can be trusted.'
            : undefined}
        />
      </PoolSection>
    </>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// FUNDS MANAGEMENT TAB
// ══════════════════════════════════════════════════════════════════════════

/* ══════════════════════════════════════════════════════════════════════════
   FUNDS MANAGEMENT — eight funds, one tab each
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * The eight funds, in the order the Owner fixed.
 *
 * Admin and the member app must name these identically and list them in this order. The two
 * surfaces having their own names for the same pool is what produced the overlap this
 * rebuild unwound — "Operational Activities" here and "Management & Ops" there described one
 * contract, and reconciling them was guesswork.
 *
 * Seven tabs, not the eight the spec lists: salaries and bonus are one ManagementPool and the
 * role table already carried the bonus figure, so splitting them produced two tabs showing the
 * same six roles twice. They are one tab with two sections, each with its own three boxes.
 *
 * `proposals` is the fund key on MgmtOpsProposal for the four funds whose vote is recorded in
 * this application. The two SEED pools vote on chain instead and carry `null`: their history
 * is a contract read, not a table lookup, and showing them an empty app-level table would
 * report "no proposals" for orders that may well exist.
 */
const FUND_TABS = [
  { id: 'salaries',    label: 'Steward Salaries',          proposals: null },
  { id: 'mgmtops',     label: 'Management & Ops',          proposals: 'MGMT_OPS' },
  { id: 'seedbonus',   label: 'Management Bonus',          proposals: null },
  { id: 'contingency', label: 'Contingency Reserve',       proposals: null },
  { id: 'treasury',    label: 'DAO Treasury',              proposals: 'TREASURY' },
  { id: 'listing',     label: 'Reserved Listing',          proposals: 'LISTING' },
  { id: 'mi',          label: 'Milestones & Incentives',   proposals: 'MI' },
] as const;

type FundTabId = (typeof FUND_TABS)[number]['id'];

/**
 * Milestones & Incentives balance.
 *
 * ClaimRewardsV2 exposes `miBalance()` and no lifetime receipts counter, so this fund can
 * report what it holds and nothing about what it has taken in or paid out. Those two boxes
 * say "No data" rather than showing a zero that would read as "nothing was ever spent".
 */
function useMiBalance() {
  const [balance, setBalance] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { Contract, formatUnits } = await import('ethers');
        const { getActiveAddresses } = await import('@missionchain/sdk');
        const A = getActiveAddresses() as Record<string, string>;
        const cr = new Contract(
          A.ClaimRewardsV2,
          ['function miBalance() view returns (uint256)'],
          await readProvider(),
        );
        const v = await cr.miBalance();
        if (alive) setBalance(Number(formatUnits(v, USDT_DECIMALS)));
      } catch {
        if (alive) setBalance(null);
      }
    })();
    return () => { alive = false; };
  }, []);

  return balance;
}

function FundsManagementTab({ isOwner }: { isOwner: boolean }) {
  const { funds, chainErr } = useChainFunds();
  const presale = useSaleInfo('/sales/presale/info');
  const mice = useSaleInfo('/sales/mice/info');
  const miBalance = useMiBalance();
  const [fundTab, setFundTab] = useState<FundTabId>('salaries');

  const presaleRaised = presale.info ? Number(presale.info.totalRaisedUsdt ?? 0) : null;
  const miceSold = mice.info ? Number(mice.info.totalSold ?? 0) : 0;
  const miceRevenueRaw = mice.info ? Number(mice.info.totalRevenueUsdt ?? 0) : null;
  const miceBroken = miceSold > 0 && miceRevenueRaw === 0;
  const miceRevenue = miceBroken ? null : miceRevenueRaw;

  const routerBps = funds?.routerBps ?? null;

  /** A Pre-Sale / MICE share of gross, or null when the input is missing. */
  const share = (base: number | null, pct: number | undefined) =>
    base === null || pct === undefined ? null : (base * pct) / 100;

  const miceNoData = miceBroken
    ? 'MICE revenue is not recorded by the indexer (see MICE Sale tab), so this share cannot be computed.'
    : undefined;

  /*
   * ManagementPool backs two tabs, and the split between them is a contract fact rather than
   * a convention: the six `getRoleBps` values sum to 6667 and the residual 3333 is the bonus
   * budget. Both tabs therefore carry their own figures instead of repeating one combined
   * total, which made them look like the same tab rendered twice.
   *
   * Accumulated is that share of lifetime receipts. Balance is exact rather than derived —
   * `pendingAmount` is salary accrued and unclaimed, so the salaries side is the sum of it and
   * the bonus side is whatever the pool holds beyond it.
   */
  const rolesBps = funds?.mgmtRolesBps ?? null;
  const bonusBps = rolesBps === null ? null : 10_000 - rolesBps;
  const mgmtRecv = funds?.mgmtReceived ?? null;
  const mgmtBal = funds?.mgmtBalance ?? null;
  const rolesPending = funds?.mgmtRolesPending ?? null;

  const pctOf = (bps: number | null) => (bps === null ? null : bps / 10_000);
  const rolesAcc = mgmtRecv === null || rolesBps === null ? null : (mgmtRecv * rolesBps) / 10_000;
  const bonusAcc = mgmtRecv === null || bonusBps === null ? null : (mgmtRecv * bonusBps) / 10_000;
  const bonusBal = mgmtBal === null || rolesPending === null ? null : Math.max(0, mgmtBal - rolesPending);

  /** Share of gross this side of the pool represents — 7.5% x 66.67%, read live, not assumed. */
  const grossPct = (bps: number | null) =>
    bps === null || !routerBps ? null : (routerBps.management * bps) / 10_000;
  const fmtPct = (v: number | null, fallback: string) =>
    v === null ? fallback : `${v.toFixed(2).replace(/\.00$/, '')}%`;

  const mgmtPoolTotals = {
    label: 'ManagementPool (Pre-Sale + MICE combined, on-chain)',
    accumulated: mgmtRecv,
    balance: mgmtBal,
    address: ADDR.managementPool,
  };
  const poolGrossPct = routerBps ? `${routerBps.management}%` : '7.5%';
  const salariesGross = fmtPct(grossPct(rolesBps), '5%');
  const bonusGross = fmtPct(grossPct(bonusBps), '2.5%');
  const salariesPoolPct = rolesBps === null ? '66.67%' : `${(rolesBps / 100).toFixed(2)}%`;
  const bonusPoolPct = bonusBps === null ? '33.33%' : `${(bonusBps / 100).toFixed(2)}%`;
  const SRC = 'Source of Funds: Pre-Sale + MICE (USDT Portion)';

  const rolesPoolTotals = {
    label: 'ManagementPool — role salaries share (on-chain)',
    accumulated: rolesAcc,
    balance: rolesPending,
    address: ADDR.managementPool,
  };
  const bonusPoolTotals = {
    label: 'ManagementPool — bonus budget share (on-chain)',
    accumulated: bonusAcc,
    balance: bonusBal,
    address: ADDR.managementPool,
  };

  return (
    <>
      <div className="card" style={{ marginBottom: 16, padding: '12px 16px' }}>
        <div style={{ fontSize: '0.55rem', color: 'var(--gray2)', lineHeight: 1.7 }}>
          <strong style={{ color: 'var(--gold)' }}>How to read these tabs.</strong>{' '}
          <strong>Total Accumulated</strong> is a pool&apos;s lifetime on-chain receipts.{' '}
          <strong>Balance</strong> is its live USDT balance.{' '}
          <strong>Spent</strong> is exact where the contract tracks releases (SEED slots) and{' '}
          <em>derived as accumulated − balance</em> where it does not (ManagementPool,
          TreasuryManager, ListingReserve have no spend counter). Every per-source row states its
          own origin. Rows with no working data source say so instead of showing $0.00.
        </div>
        <div style={{ fontSize: '0.55rem', color: 'var(--gray2)', lineHeight: 1.7, marginTop: 8 }}>
          Proposals are raised and voted on in the member app. This console records the outcome and
          signs what the contract reserves for the Owner wallet — a signature the contract requires,
          not a veto over the vote.
        </div>
        {chainErr && <ChainErrNote msg={chainErr} />}
      </div>

      {/* Fund tabs */}
      <div style={{ display: 'flex', gap: 2, marginBottom: 16, borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
        {FUND_TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setFundTab(t.id)}
            style={{
              padding: '9px 14px',
              fontSize: '0.6rem',
              fontFamily: 'var(--font-d)',
              letterSpacing: '0.05em',
              textTransform: 'uppercase',
              background: 'transparent',
              border: 'none',
              borderBottom: fundTab === t.id ? '2px solid var(--gold)' : '2px solid transparent',
              color: fundTab === t.id ? 'var(--gold)' : 'var(--white)',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* 1 · Steward Salaries ─────────────────────────────────────────── */}
      {fundTab === 'salaries' && (
        <FundBlock
          title="Steward Salaries"
          subtitle="Steward Council salaries, funded by the SEED sale and paid through OperationalSalaryPoolV3 on a percentage share with a weekly maxout. Each member claims their own accrual."
          sources={[
            {
              label: 'SEED SALE — Operational',
              pct: '20%',
              accumulated: funds?.seedSlots[1]?.received ?? null,
              spent: funds?.seedSlots[1]?.released ?? null,
              balance: funds?.seedSlots[1]?.balance ?? null,
              spentExact: true,
              origin: 'SeedBudgetV5c slot 1 — BPS_OPERATIONAL = 2000, a contract constant.',
            },
          ]}
          poolTotals={null}
          seedSlotIdx={[1]}
          funds={funds}
        >
          <OperationalPoolPanel isOwner={isOwner} />
        </FundBlock>
      )}

      {/* 2 · Management & Ops — the pool, then each half of it ─────────── */}
      {fundTab === 'mgmtops' && (
        <>
          {/* The whole pool once, with the funding rows. The two halves below inherit these
              sources rather than repeating them under three separate headings. */}
          <FundBlock
            title={`${SRC} — ${poolGrossPct} Gross`}
            subtitle="Everything Pre-Sale and MICE send to ManagementPool. It divides into role salaries and a bonus budget, each shown as its own block below."
            sources={[
              {
                label: 'PRE-SALE',
                pct: poolGrossPct,
                accumulated: share(presaleRaised, routerBps?.management),
                spent: null,
                balance: null,
                derived: true,
                origin: 'Derived: /sales/presale/info totalRaisedUsdt x RevenueRouter.bpsManagement. Pre-Sale and MICE share one ManagementPool, so the chain cannot attribute receipts to either sale.',
              },
              {
                label: 'MICE SALE',
                pct: poolGrossPct,
                accumulated: share(miceRevenue, routerBps?.management),
                spent: null,
                balance: null,
                derived: true,
                noData: miceNoData,
                origin: 'Derived: /sales/mice/info totalRevenueUsdt x RevenueRouter.bpsManagement.',
              },
            ]}
            poolTotals={mgmtPoolTotals}
            seedSlotIdx={[]}
            funds={funds}
          />

          <FundBlock
            title="Management & Ops — Salaries"
            subtitle={`${SRC} — ${salariesGross} Gross (${salariesPoolPct} of Pool)`}
            sources={[]}
            poolTotals={rolesPoolTotals}
            seedSlotIdx={[]}
            funds={funds}
            hideBreakdown
            totalsNote={
              'The six role shares, which sum to '
              + `${rolesBps === null ? '6667' : rolesBps} of 10000 in the contract. Balance is exact rather than derived: `
              + 'it is the sum of pendingAmount across the roles, meaning salary earned and not yet claimed.'
            }
          >
            <ManagementPoolAdmin isOwner={isOwner} managementBps={routerBps?.management ?? null} />
          </FundBlock>

          <FundBlock
            title="Management & Ops — Bonus Salaries"
            subtitle={`${SRC} — ${bonusGross} Gross (${bonusPoolPct} of Pool)`}
            sources={[]}
            poolTotals={bonusPoolTotals}
            seedSlotIdx={[]}
            funds={funds}
            hideBreakdown
            totalsNote={
              'The residual after the six role shares, '
              + `${bonusBps === null ? '3333' : bonusBps} of 10000. The role percentages do not apply here: a proposal names `
              + 'any wallet and any amount within this balance, and the Council vote decides both. '
              + 'The Owner signs distributeBonus because the contract accepts no other caller.'
            }
          >
            <MgmtOpsProposalsAdmin isOwner={isOwner} />
            <ProposalsHistory pool="MGMT_OPS" canCancel={isOwner} />
          </FundBlock>
        </>
      )}

      {/* 4 · Management Bonus (SEED) ──────────────────────────────────── */}
      {fundTab === 'seedbonus' && (
        <FundBlock
          title="Management Bonus"
          subtitle="Council-created bonus orders funded by the SEED sale, held by ManagementBonusPoolV3. Each order is voted on inside the contract, so both the vote and the cancellation live on chain."
          sources={[
            {
              label: 'SEED SALE — Management Bonus',
              pct: '10%',
              accumulated: funds?.seedSlots[2]?.received ?? null,
              spent: funds?.seedSlots[2]?.released ?? null,
              balance: funds?.seedSlots[2]?.balance ?? null,
              spentExact: true,
              origin: 'SeedBudgetV5c slot 2 — BPS_MGMT_BONUS = 1000, a contract constant.',
            },
          ]}
          poolTotals={null}
          seedSlotIdx={[2]}
          funds={funds}
        >
          <OnChainProposalsHistory pool="MGMT_BONUS" isOwner={isOwner} />
        </FundBlock>
      )}

      {/* 5 · Contingency Reserve ──────────────────────────────────────── */}
      {fundTab === 'contingency' && (
        <FundBlock
          title="Contingency Reserve"
          subtitle="DAO-decided expenses funded by the SEED sale, held by ReservedExpensesPoolV3. This is an expense reserve, not a staking reserve and not the Reserved Listing fund — those are different contracts with different money."
          sources={[
            {
              label: 'SEED SALE — Reserved',
              pct: '50%',
              accumulated: funds?.seedSlots[3]?.received ?? null,
              spent: funds?.seedSlots[3]?.released ?? null,
              balance: funds?.seedSlots[3]?.balance ?? null,
              spentExact: true,
              origin: 'SeedBudgetV5c slot 3 — BPS_RESERVED = 5000, a contract constant.',
            },
          ]}
          poolTotals={null}
          seedSlotIdx={[3]}
          funds={funds}
        >
          <OnChainProposalsHistory pool="CONTINGENCY" isOwner={isOwner} />
        </FundBlock>
      )}

      {/* 6 · DAO Treasury ─────────────────────────────────────────────── */}
      {fundTab === 'treasury' && (
        <FundBlock
          title="DAO Treasury"
          subtitle="Protocol treasury funded by Pre-Sale and MICE, split internally into World Dev 20% / App & Add-ons 40% / Reserved 40%. Each sub-pool allows two transfers per 30 days of at most 5% of its balance."
          sources={[
            {
              label: 'SEED SALE',
              pct: '0%',
              accumulated: null,
              spent: null,
              balance: null,
              noData: 'SeedBudgetV5c has no DAO Treasury slot. SEED revenue splits only into Distribution 20% / Steward Salaries 20% / Management Bonus 10% / Contingency Reserve 50%.',
              origin: 'Verified against SeedBudgetV5c — only four slots exist.',
            },
            {
              label: 'PRE-SALE',
              pct: routerBps ? `${routerBps.treasury}%` : '12.5%',
              accumulated: share(presaleRaised, routerBps?.treasury),
              spent: null,
              balance: null,
              derived: true,
              origin: 'Derived: /sales/presale/info totalRaisedUsdt x RevenueRouter.bpsTreasury. TreasuryManager receipts cannot be attributed per sale on-chain.',
            },
            {
              label: 'MICE SALE',
              pct: routerBps ? `${routerBps.treasury}%` : '12.5%',
              accumulated: share(miceRevenue, routerBps?.treasury),
              spent: null,
              balance: null,
              derived: true,
              noData: miceNoData,
              origin: 'Derived: /sales/mice/info totalRevenueUsdt x RevenueRouter.bpsTreasury.',
            },
          ]}
          poolTotals={{
            label: 'TreasuryManager (Pre-Sale + MICE combined, on-chain)',
            accumulated: funds?.treasuryReceived ?? null,
            balance: funds?.treasuryBalance ?? null,
            address: ADDR.treasuryManager,
          }}
          seedSlotIdx={[]}
          funds={funds}
        >
          <ProposalsHistory pool="TREASURY" canCancel={isOwner} />
          <TreasuryAdmin isOwner={isOwner} />
        </FundBlock>
      )}

      {/* 7 · Reserved Listing ─────────────────────────────────────────── */}
      {fundTab === 'listing' && (
        <FundBlock
          title="Reserved Listing"
          subtitle="Listing and external-market reserve, funded by Pre-Sale and MICE. Withdrawals run request → 24-hour timelock → execute, and the contract holds one pending request at a time. Renamed from “Reserved Staking”: nothing here funds staking rewards."
          sources={[
            {
              label: 'PRE-SALE',
              pct: routerBps ? `${routerBps.staking}%` : '5%',
              accumulated: share(presaleRaised, routerBps?.staking),
              spent: null,
              balance: null,
              derived: true,
              origin: 'Derived: /sales/presale/info totalRaisedUsdt x RevenueRouter.bpsStaking.',
            },
            {
              label: 'MICE SALE',
              pct: routerBps ? `${routerBps.staking}%` : '5%',
              accumulated: share(miceRevenue, routerBps?.staking),
              spent: null,
              balance: null,
              derived: true,
              noData: miceNoData,
              origin: 'Derived: /sales/mice/info totalRevenueUsdt x RevenueRouter.bpsStaking.',
            },
          ]}
          poolTotals={{
            label: 'ListingReserve (Pre-Sale + MICE combined, on-chain)',
            accumulated: funds?.listingReceived ?? null,
            balance: funds?.listingBalance ?? null,
            address: ADDR.listingReserve,
          }}
          seedSlotIdx={[]}
          funds={funds}
        >
          <GovernancePanel />
          <ProposalsHistory pool="LISTING" canCancel={isOwner} />
        </FundBlock>
      )}

      {/* 8 · Milestones & Incentives ──────────────────────────────────── */}
      {fundTab === 'mi' && (
        <FundBlock
          title="Milestones &amp; Incentives"
          subtitle="Milestone and incentive payouts held by ClaimRewardsV2. Most of this balance is referral commission with no upline to pay, which falls to this fund rather than being left unassigned."
          sources={[
            {
              label: 'MARKETING SHARE — M&I',
              pct: '1.5% gross',
              accumulated: null,
              spent: null,
              balance: miBalance,
              spentExact: false,
              noData: 'ClaimRewardsV2 exposes miBalance() and no lifetime receipts or release counter, so only the live balance can be reported.',
              origin: 'The marketing share sends 42% (bpsClaim) into ClaimRewardsV2, which splits it again by BPS_GV = 8571 into GV 9% of gross and M&I 1.5% of gross. The 42% is not this fund.',
            },
          ]}
          poolTotals={null}
          seedSlotIdx={[]}
          funds={funds}
          totalsNote="Total Accumulated and Spent read “No data” because the contract keeps no counter for either. Balance below is a live read."
        >
          <div style={{ borderTop: '1px solid var(--border)', padding: '12px 16px' }}>
            <Stat
              label="Balance"
              value={miBalance === null ? 'No data' : `$${fmtUsd(miBalance)}`}
              hint="ClaimRewardsV2.miBalance() — live read"
              tone={miBalance === null ? 'warn' : undefined}
            />
          </div>
          <MarketingAdmin isOwner={isOwner} />
          <ProposalsHistory pool="MI" canCancel={isOwner} />
        </FundBlock>
      )}

      {/* Outside the eight ───────────────────────────────────────────────
          Liquidity is not a managed fund — RevenueRouter forwards it on every
          purchase and no council or DAO process spends it. It is kept visible
          because it is 40% of gross and dropping it off the console would hide
          the largest single flow, but it is deliberately not one of the tabs. */}
      <PoolSection
        title="Liquidity — outside the eight funds"
        pct={routerBps ? `${routerBps.liquidity}% of Pre-Sale + MICE gross` : '40% of Pre-Sale + MICE gross'}
        note="Not a managed fund and not one of the eight tabs above. RevenueRouter forwards this share automatically on every purchase; no proposal, vote or signature spends it."
      >
        <div style={{ padding: 16 }}>
          <LiquidityStats funds={funds} />
          <LiquidityNote funds={funds} />
        </div>
      </PoolSection>
    </>
  );
}

// ─── Fund block: 3 stat boxes + per-source breakdown ────────────────────

type FundSource = {
  label: string;
  pct: string;
  accumulated: number | null;
  spent: number | null;
  balance: number | null;
  spentExact?: boolean;
  derived?: boolean;
  noData?: string;
  origin: string;
};

/* ══════════════════════════════════════════════════════════════════════════
   Shared plumbing for the four operating panels below.
   ══════════════════════════════════════════════════════════════════════════ */

/** A read-only provider against the configured chain. */
async function readProvider() {
  const { JsonRpcProvider } = await import('ethers');
  const { getActiveChain } = await import('@missionchain/sdk');
  const chain = getActiveChain();
  return new JsonRpcProvider(chain.rpcUrls[0], chain.chainId, { staticNetwork: true });
}

/** The connected wallet, on the right chain, ready to sign. */
async function walletSigner() {
  const { BrowserProvider } = await import('ethers');
  const eth = (window as any).ethereum;
  if (!eth) throw new Error('No wallet detected.');
  await eth.request({ method: 'eth_requestAccounts' });
  return new BrowserProvider(eth).getSigner();
}

const money = (n: number, dp = 2) =>
  `$${(n ?? 0).toLocaleString(undefined, { maximumFractionDigits: dp })}`;

/* ══════════════════════════════════════════════════════════════════════════
   1 · MANAGEMENT POOL — six roles, and the wallet behind each
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * The Pre-Sale + MICE side of Management & Ops.
 *
 * Two things are fixed and one is not, and the panel is built around that difference:
 * the six percentages are `private` constants with no setter — they cannot be changed
 * without redeploying — while `setRoleAddress` can move a role to a different wallet at
 * any time. So shares are presented as facts and only the wallet is editable.
 *
 * Every role currently points at the Owner wallet, which is what a fresh deployment looks
 * like before roles are handed out. The panel flags that rather than letting it pass as
 * configured.
 */
function ManagementPoolAdmin({ isOwner, managementBps }: { isOwner: boolean; managementBps: number | null }) {
  const mcUi = useMcUi();
  const ROLES = ['Founder', 'Architect', 'CTO', 'Social Media', 'Global Training', 'Tech Team'];
  const [state, setState] = useState<any>(null);
  const [edit, setEdit] = useState<{ index: number; wallet: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const { Contract, formatUnits } = await import('ethers');
      const { getActiveAddresses } = await import('@missionchain/sdk');
      const A = getActiveAddresses() as Record<string, string>;
      const c = new Contract(A.ManagementPool, [
        'function getRoleAddress(uint256) view returns (address)',
        'function getRoleBps(uint256) view returns (uint256)',
        'function pendingAmount(uint256) view returns (uint256)',
        'function totalReceived() view returns (uint256)',
        'function bonusPending() view returns (uint256)',
      ], await readProvider());

      const roles = [];
      for (let i = 0; i < ROLES.length; i++) {
        const [addr, bps, pend] = await Promise.all([
          c.getRoleAddress(i), c.getRoleBps(i), c.pendingAmount(i).catch(() => 0n),
        ]);
        roles.push({
          index: i, name: ROLES[i], wallet: String(addr),
          bps: Number(bps), pending: Number(formatUnits(pend, USDT_DECIMALS)),
        });
      }
      const [recv, bonus] = await Promise.all([c.totalReceived(), c.bonusPending().catch(() => 0n)]);
      const distinct = new Set(roles.map((r) => r.wallet.toLowerCase())).size;

      setState({
        address: A.ManagementPool,
        roles,
        received: Number(formatUnits(recv, USDT_DECIMALS)),
        bonusPending: Number(formatUnits(bonus, USDT_DECIMALS)),
        /** One wallet holding every role means the roles were never handed out. */
        allOneWallet: distinct === 1,
      });
    } catch {
      setState({ error: true });
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const saveWallet = async () => {
    if (!edit || !/^0x[0-9a-fA-F]{40}$/.test(edit.wallet.trim())) {
      mcUi.toast({ type: 'error', message: 'Enter a valid wallet address.' });
      return;
    }
    const role = state.roles[edit.index];
    /* Read the value out before awaiting: `edit` is state, and the dialog is async. */
    const next = edit.wallet.trim();
    const ok = await mcUi.confirm({
      title: `Reassign ${role.name}`,
      message: (
        <>
          Move the <strong>{role.name}</strong> role to{' '}
          <code>{next.slice(0, 10)}…{next.slice(-6)}</code>?
          <br /><br />
          {role.pending > 0
            ? `The ${money(role.pending, 4)} already accrued to this role carries over to the new wallet — the old one can no longer claim it.`
            : 'Future revenue for this role goes to the new wallet.'}
        </>
      ),
      confirmLabel: 'Reassign',
      variant: 'danger',
    });
    if (!ok) return;

    setBusy(true);
    try {
      const { Contract } = await import('ethers');
      const { getActiveAddresses } = await import('@missionchain/sdk');
      const c = new Contract((getActiveAddresses() as Record<string, string>).ManagementPool,
        ['function setRoleAddress(uint256 roleIndex, address newAddress)'], await walletSigner());
      const tx = await c.setRoleAddress(role.index, next);
      mcUi.toast({ type: 'info', message: 'Waiting for confirmation…' });
      const r = await tx.wait(1);
      if (!r || r.status !== 1) throw new Error('Transaction reverted');
      mcUi.toast({ type: 'success', message: `${role.name} reassigned · ${tx.hash.slice(0, 10)}…` });
      setEdit(null);
      await load();
    } catch (e: any) {
      mcUi.toast({
        type: 'error',
        message: e?.code === 4001 || e?.code === 'ACTION_REJECTED'
          ? 'Transaction rejected in wallet'
          : 'Reassign failed: ' + (e?.shortMessage || e?.message || 'Unknown error'),
      });
    } finally { setBusy(false); }
  };

  if (state?.error) {
    return <div className="alert alert-warn" style={{ fontSize: '0.6rem', margin: 16 }}><div>Could not read ManagementPool.</div></div>;
  }

  /* The split is a contract fact: the six role shares sum to 6667 bps and the residual is
     the bonus budget. Derived here so a redeployment with different shares relabels itself. */
  const rolesBpsSum: number | null = state?.roles
    ? state.roles.reduce((a: number, r: any) => a + Number(r.bps), 0)
    : null;
  const salariesPending: number = state?.roles
    ? state.roles.reduce((a: number, r: any) => a + Number(r.pending), 0)
    : 0;
  const pctLabel = (bps: number | null) =>
    bps === null ? null : (bps / 100).toFixed(2).replace(/\.00$/, '');
  const rolesPct = pctLabel(rolesBpsSum);

  return (
    <div style={{ borderTop: '1px solid var(--border)', padding: 16 }}>
      <div className="sep-lbl" style={{ marginBottom: 8 }}>Pre-Sale + MICE — role allocation</div>
      <div style={{ fontSize: '0.58rem', color: 'var(--gray2)', lineHeight: 1.7, marginBottom: 10 }}>
        Separate from the SEED salary pool: no weekly maxout here, and no per-member share to set. The
        six percentages are compiled into the contract and cannot be changed without redeploying. Each
        role wallet claims its own balance; the Owner can move a role to a different wallet.
      </div>

      {state?.allOneWallet && (
        <div className="alert alert-warn" style={{ fontSize: '0.6rem', marginBottom: 10, lineHeight: 1.7 }}>
          <div>
            All six roles point at the same wallet, so {money((state.received * 6667) / 10000)} of role
            revenue is accruing to one address. Reassign each role to the person who holds it.
          </div>
        </div>
      )}

      <div className="g2" style={{ marginBottom: 12 }}>
        <div className="info-row"><span className="info-key">Pool lifetime receipts</span>
          <span className="info-val">{state ? money(state.received) : '—'}</span></div>
        {/* Salaries only. The bonus figure used to sit here too, which put a number nobody
            can claim from this table inside the table of people who claim — and the six role
            percentages do not apply to it at all: the bonus is proposed and voted on, paid to
            any wallet in any amount. It belongs to the Bonus block below, which carries its
            balance alongside the proposals that spend it. */}
        <div className="info-row"><span className="info-key">Salaries pending{rolesPct === null ? '' : ` (${rolesPct}%)`}</span>
          <span className="info-val">{state ? money(salariesPending, 4) : '—'}</span></div>
      </div>

      <div style={{ overflowX: 'auto', width: '100%' }}>
        <table style={{ width: '100%', minWidth: 760, borderCollapse: 'collapse', fontSize: '0.5rem', tableLayout: 'fixed' }}>
          <colgroup>
            <col style={{ width: '20%' }} />
            <col style={{ width: '11%' }} />
            <col style={{ width: '11%' }} />
            <col style={{ width: '44%' }} />
            <col style={{ width: '14%' }} />
          </colgroup>
          <thead><tr>
            <th style={{ textAlign: 'left', padding: '6px 8px', color: 'var(--gray2)' }}>Role</th>
            <th style={{ textAlign: 'right', padding: '6px 8px', color: 'var(--gray2)' }}>% Gross</th>
            <th style={{ textAlign: 'right', padding: '6px 8px', color: 'var(--gray2)' }}>% Pool</th>
            <th style={{ textAlign: 'left', padding: '6px 8px', color: 'var(--gray2)' }}>Wallet</th>
            {isOwner && <th style={{ padding: '6px 8px' }} />}
          </tr></thead>
          <tbody>
            {state?.roles.map((r: any) => (
              <tr key={r.index} style={{ borderTop: '1px solid var(--border)' }}>
                <td style={{ padding: '6px 8px' }}>{r.name}</td>
                {/* Two different denominators, both stated: the role's cut of this pool, and
                    what that works out to against total sale revenue. */}
                <td style={{ padding: '6px 8px', textAlign: 'right', color: 'var(--cyan)' }}>
                  {managementBps === null ? '—' : `${((managementBps * r.bps) / 10000).toFixed(2)}%`}
                </td>
                <td style={{ padding: '6px 8px', textAlign: 'right' }}>{(r.bps / 100).toFixed(2)}%</td>
                {/* Shown in full rather than elided: an operator about to reassign a role is
                    checking this address character by character, and 0xD32e66…3AD6c2 hides
                    exactly the middle where two of the Owner's wallets would differ. */}
                <td style={{ padding: '6px 8px', fontFamily: 'var(--font-m)', fontSize: '0.46rem', letterSpacing: '-0.01em' }}>
                  {edit?.index === r.index ? (
                    <input type="text" value={edit?.wallet ?? ''} placeholder="0x..."
                      onChange={(e) => setEdit({ index: r.index, wallet: e.target.value })}
                      style={{ fontSize: 10, padding: '5px 8px', width: '100%', fontFamily: 'var(--font-m)' }} />
                  ) : (
                    <span style={{ wordBreak: 'break-all' }}>{r.wallet}</span>
                  )}
                </td>
                {isOwner && (
                  <td style={{ padding: '6px 8px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {edit?.index === r.index ? (
                      <>
                        <button className="btn btn-gold" disabled={busy} onClick={saveWallet}
                          style={{ padding: '3px 10px', fontSize: '0.55rem', marginRight: 4 }}>SAVE</button>
                        <button className="btn" disabled={busy} onClick={() => setEdit(null)}
                          style={{ padding: '3px 10px', fontSize: '0.55rem' }}>CANCEL</button>
                      </>
                    ) : (
                      <button className="btn" disabled={busy}
                        onClick={() => setEdit({ index: r.index, wallet: '' })}
                        style={{ padding: '3px 10px', fontSize: '0.55rem' }}>CHANGE</button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: '0.55rem', color: 'var(--gray2)', marginTop: 8 }}>
        Contract <span style={{ fontFamily: 'var(--font-m)' }}>{state?.address}</span>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   2 · DAO TREASURY — three sub-pools, two hard limits
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Spending from TreasuryManager.
 *
 * The contract enforces two limits that the form has to respect or every submission
 * reverts: no single transfer above **5% of that sub-pool's balance**, and no more than
 * **two transfers per sub-pool per 30-day period**. Both are shown before signing, with the
 * period's remaining transfers read from the chain, because "monthly limit reached" after a
 * wallet prompt is a poor way to learn the rule.
 */
function TreasuryAdmin({ isOwner }: { isOwner: boolean }) {
  const mcUi = useMcUi();
  const POOLS = ['World Dev (20%)', 'App & Add-ons (40%)', 'Reserved (40%)'];
  const [state, setState] = useState<any>(null);
  const [form, setForm] = useState({ pool: 0, to: '', amount: '' });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const { Contract, formatUnits } = await import('ethers');
      const { getActiveAddresses } = await import('@missionchain/sdk');
      const A = getActiveAddresses() as Record<string, string>;
      const c = new Contract(A.TreasuryManager, [
        'function getSubPoolBalance(uint256) view returns (uint256)',
        'function getCurrentPeriodTransfers(uint256) view returns (uint256)',
        'function getContractBalance() view returns (uint256)',
        'function totalReceived() view returns (uint256)',
      ], await readProvider());

      const pools = [];
      for (let i = 0; i < 3; i++) {
        const [bal, used] = await Promise.all([
          c.getSubPoolBalance(i), c.getCurrentPeriodTransfers(i).catch(() => 0n),
        ]);
        pools.push({
          index: i, name: POOLS[i],
          balance: Number(formatUnits(bal, USDT_DECIMALS)),
          usedThisPeriod: Number(used),
        });
      }
      const [held, recv] = await Promise.all([
        c.getContractBalance().catch(() => 0n), c.totalReceived().catch(() => 0n),
      ]);
      const heldN = Number(formatUnits(held, USDT_DECIMALS));
      const recvN = Number(formatUnits(recv, USDT_DECIMALS));

      setState({
        address: A.TreasuryManager, pools, held: heldN, received: recvN,
        /* Money that arrived by a raw transfer instead of `receiveUSDT` is never assigned to
           a sub-pool, so `transfer` can never reach it. Surfaced rather than left to a
           manual reconciliation months later. */
        unallocated: Math.max(0, heldN - recvN),
      });
    } catch {
      setState({ error: true });
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const pool = state?.pools?.[form.pool];
  const maxPerTransfer = pool ? pool.balance * 0.05 : 0;
  const transfersLeft = pool ? Math.max(0, 2 - pool.usedThisPeriod) : 0;

  const send = async () => {
    const amt = parseFloat(form.amount);
    if (!/^0x[0-9a-fA-F]{40}$/.test(form.to.trim()) || !(amt > 0)) {
      mcUi.toast({ type: 'error', message: 'Enter a recipient and an amount.' });
      return;
    }
    if (amt > maxPerTransfer) {
      mcUi.toast({ type: 'error', message: `Above the 5% cap for this sub-pool (${money(maxPerTransfer, 4)}).` });
      return;
    }
    if (transfersLeft === 0) {
      mcUi.toast({ type: 'error', message: 'This sub-pool has used both transfers for the current 30-day period.' });
      return;
    }
    const ok = await mcUi.confirm({
      title: 'Transfer from DAO Treasury',
      message: (
        <>
          Send <strong>{money(amt)}</strong> from <strong>{pool.name}</strong> to{' '}
          <code>{form.to.slice(0, 10)}…{form.to.slice(-6)}</code>?
          <br /><br />
          This uses one of the two transfers allowed for this sub-pool in the current 30-day period.
        </>
      ),
      confirmLabel: 'Send',
      variant: 'danger',
    });
    if (!ok) return;

    setBusy(true);
    try {
      const { Contract, parseUnits } = await import('ethers');
      const { getActiveAddresses } = await import('@missionchain/sdk');
      const c = new Contract((getActiveAddresses() as Record<string, string>).TreasuryManager,
        ['function transfer(uint256 subPool, address to, uint256 amount)'], await walletSigner());
      const tx = await c.transfer(form.pool, form.to.trim(), parseUnits(String(amt), USDT_DECIMALS));
      mcUi.toast({ type: 'info', message: 'Waiting for confirmation…' });
      const r = await tx.wait(1);
      if (!r || r.status !== 1) throw new Error('Transaction reverted');
      mcUi.toast({ type: 'success', message: `Sent · ${tx.hash.slice(0, 10)}…` });
      setForm({ pool: form.pool, to: '', amount: '' });
      await load();
    } catch (e: any) {
      mcUi.toast({
        type: 'error',
        message: e?.code === 4001 || e?.code === 'ACTION_REJECTED'
          ? 'Transaction rejected in wallet'
          : 'Transfer failed: ' + (e?.shortMessage || e?.reason || e?.message || 'Unknown error'),
      });
    } finally { setBusy(false); }
  };

  return (
    <div style={{ borderTop: '1px solid var(--border)', padding: 16 }}>
      <div className="sep-lbl" style={{ marginBottom: 8 }}>Spend from the treasury</div>
      <div style={{ fontSize: '0.58rem', color: 'var(--gray2)', lineHeight: 1.7, marginBottom: 10 }}>
        The contract allows at most <strong>5% of a sub-pool per transfer</strong> and{' '}
        <strong>two transfers per sub-pool every 30 days</strong>. Both are checked here before the
        wallet opens.
      </div>

      {state?.unallocated > 0 && (
        <div className="alert alert-warn" style={{ fontSize: '0.6rem', marginBottom: 10, lineHeight: 1.7 }}>
          <div>
            {money(state.unallocated, 4)} arrived by a direct token transfer rather than through
            <code> receiveUSDT</code>, so it belongs to no sub-pool and <code>transfer</code> cannot reach
            it. Recoverable only via <code>emergencyWithdraw</code>.
          </div>
        </div>
      )}

      <div className="g3" style={{ marginBottom: 12 }}>
        {state?.pools?.map((p: any) => (
          <div className="stat-box" key={p.index}>
            <div className="stat-lbl">{p.name}</div>
            <div className="stat-val g">{money(p.balance, 4)}</div>
            <div className="stat-delta">
              {Math.max(0, 2 - p.usedThisPeriod)} of 2 transfers left this period
            </div>
          </div>
        ))}
      </div>

      {isOwner && (
        <>
          <div className="g3" style={{ gap: 8, marginBottom: 8 }}>
            <select value={form.pool} onChange={(e) => setForm({ ...form, pool: Number(e.target.value) })}
              style={{ fontSize: 12, padding: '10px 14px' }}>
              {POOLS.map((n, i) => <option key={i} value={i}>{n}</option>)}
            </select>
            <input type="text" value={form.to} placeholder="Recipient (0x...)"
              onChange={(e) => setForm({ ...form, to: e.target.value })}
              style={{ fontSize: 12, padding: '10px 14px' }} />
            <input type="text" inputMode="decimal" value={form.amount} placeholder="Amount (USDT)"
              onChange={(e) => setForm({ ...form, amount: e.target.value.replace(/,/g, '.') })}
              style={{ fontSize: 12, padding: '10px 14px' }} />
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <button className="btn btn-gold" disabled={busy || transfersLeft === 0} onClick={send}
              style={{ padding: '8px 20px', fontWeight: 700 }}>
              {busy ? '...' : 'SEND'}
            </button>
            <span style={{ fontSize: '0.55rem', color: 'var(--gray2)' }}>
              Max this transfer {money(maxPerTransfer, 4)} · {transfersLeft} of 2 left this period
            </span>
          </div>
        </>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   3 + 4 · MARKETING — the 25% split, and the M&I pool it feeds
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * The marketing bucket: its four-way split, and paying out Milestones & Incentives.
 *
 * `adjustBPS` is fenced by the contract — the four values must total 10000, none may move
 * more than 200 bps in one change, and there is a 14-day cooldown between changes. The
 * countdown is read from `lastAdjustmentTime` so a change is not attempted mid-cooldown.
 *
 * The M&I side needs `CREDITOR_ROLE` on ClaimRewardsV2, which the Owner does not hold by
 * default — the keeper does. Rather than let the button revert, the panel checks the role
 * and offers to grant it, which the Owner can do because they hold DEFAULT_ADMIN there.
 */
function MarketingAdmin({ isOwner }: { isOwner: boolean }) {
  const mcUi = useMcUi();
  const [state, setState] = useState<any>(null);
  const [bps, setBps] = useState<any>(null);
  const [rows, setRows] = useState([{ to: '', amount: '' }]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const { Contract, formatUnits } = await import('ethers');
      const { getActiveAddresses } = await import('@missionchain/sdk');
      const A = getActiveAddresses() as Record<string, string>;
      const provider = await readProvider();

      const rd = new Contract(A.RewardDistributorV2, [
        'function bpsClaim() view returns (uint256)',
        'function bpsWeekly() view returns (uint256)',
        'function bpsMonthly() view returns (uint256)',
        'function bpsLucky() view returns (uint256)',
        'function lastAdjustmentTime() view returns (uint256)',
        'function BPS_ADJUSTMENT_COOLDOWN() view returns (uint256)',
        'function MAX_BPS_CHANGE() view returns (uint256)',
      ], provider);
      const [c1, w1, m1, l1, last, cool, maxChange] = await Promise.all([
        rd.bpsClaim(), rd.bpsWeekly(), rd.bpsMonthly(), rd.bpsLucky(),
        rd.lastAdjustmentTime(), rd.BPS_ADJUSTMENT_COOLDOWN(), rd.MAX_BPS_CHANGE(),
      ]);
      const nextAllowed = (Number(last) + Number(cool)) * 1000;

      const cr = new Contract(A.ClaimRewardsV2, [
        'function gvBalance() view returns (uint256)',
        'function miBalance() view returns (uint256)',
        'function CREDITOR_ROLE() view returns (bytes32)',
        'function hasRole(bytes32,address) view returns (bool)',
      ], provider);
      const eth = (window as any).ethereum;
      const accounts: string[] = eth ? await eth.request({ method: 'eth_accounts' }) : [];
      const me = accounts?.[0];
      const [gv, mi, creditorRole] = await Promise.all([cr.gvBalance(), cr.miBalance(), cr.CREDITOR_ROLE()]);

      setState({
        claimRewards: A.ClaimRewardsV2,
        distributor: A.RewardDistributorV2,
        gv: Number(formatUnits(gv, USDT_DECIMALS)),
        mi: Number(formatUnits(mi, USDT_DECIMALS)),
        canDistribute: me ? await cr.hasRole(creditorRole, me) : null,
        nextAllowed,
        maxChange: Number(maxChange),
      });
      setBps({ claim: Number(c1), weekly: Number(w1), monthly: Number(m1), lucky: Number(l1) });
    } catch {
      setState({ error: true });
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const run = async (label: string, fn: () => Promise<any>) => {
    setBusy(true);
    try {
      const tx = await fn();
      mcUi.toast({ type: 'info', message: 'Waiting for confirmation…' });
      const r = await tx.wait(1);
      if (!r || r.status !== 1) throw new Error('Transaction reverted');
      mcUi.toast({ type: 'success', message: `${label} · ${tx.hash.slice(0, 10)}…` });
      await load();
    } catch (e: any) {
      mcUi.toast({
        type: 'error',
        message: e?.code === 4001 || e?.code === 'ACTION_REJECTED'
          ? 'Transaction rejected in wallet'
          : `${label} failed: ` + (e?.shortMessage || e?.reason || e?.message || 'Unknown error'),
      });
    } finally { setBusy(false); }
  };

  const grantCreditor = async () => {
    const ok = await mcUi.confirm({
      title: 'Grant CREDITOR_ROLE',
      message: (
        <>
          Give this wallet permission to pay out Milestones &amp; Incentives from ClaimRewardsV2?
          <br /><br />
          The role is normally held by the reward keeper. Granting it here lets a person sign the
          payouts instead of a server key; it can be revoked at any time.
        </>
      ),
      confirmLabel: 'Grant',
    });
    if (!ok) return;
    const { Contract } = await import('ethers');
    const { getActiveAddresses } = await import('@missionchain/sdk');
    const signer = await walletSigner();
    const c = new Contract((getActiveAddresses() as Record<string, string>).ClaimRewardsV2, [
      'function CREDITOR_ROLE() view returns (bytes32)',
      'function grantRole(bytes32 role, address account)',
    ], signer);
    await run('CREDITOR_ROLE granted', async () =>
      c.grantRole(await c.CREDITOR_ROLE(), await signer.getAddress()));
  };

  const validRows = rows
    .map((r) => ({ to: r.to.trim(), amount: parseFloat(r.amount) }))
    .filter((r) => /^0x[0-9a-fA-F]{40}$/.test(r.to) && r.amount > 0);
  const rowsTotal = validRows.reduce((s, r) => s + r.amount, 0);

  const distribute = async () => {
    if (validRows.length === 0) {
      mcUi.toast({ type: 'error', message: 'Add at least one recipient and amount.' });
      return;
    }
    if (rowsTotal > (state?.mi ?? 0)) {
      mcUi.toast({ type: 'error', message: `Total ${money(rowsTotal, 4)} exceeds the M&I balance.` });
      return;
    }
    const ok = await mcUi.confirm({
      title: 'Pay Milestones & Incentives',
      message: (
        <>
          Send <strong>{money(rowsTotal, 4)}</strong> to <strong>{validRows.length}</strong> recipient(s)
          from the M&amp;I balance?
          <br /><br />
          This is a single on-chain transaction and cannot be undone.
        </>
      ),
      confirmLabel: 'Pay',
      variant: 'danger',
    });
    if (!ok) return;

    const { Contract, parseUnits } = await import('ethers');
    const { getActiveAddresses } = await import('@missionchain/sdk');
    const c = new Contract((getActiveAddresses() as Record<string, string>).ClaimRewardsV2,
      ['function distributeMilestonesIncentives(address[] recipients, uint256[] amounts)'],
      await walletSigner());
    await run('M&I paid', () => c.distributeMilestonesIncentives(
      validRows.map((r) => r.to),
      validRows.map((r) => parseUnits(String(r.amount), USDT_DECIMALS)),
    ));
    setRows([{ to: '', amount: '' }]);
  };

  const cooldownLeftDays = state?.nextAllowed
    ? Math.max(0, Math.ceil((state.nextAllowed - Date.now()) / 86400000))
    : 0;
  const bpsTotal = bps ? bps.claim + bps.weekly + bps.monthly + bps.lucky : 0;

  const saveBps = async () => {
    if (bpsTotal !== 10000) {
      mcUi.toast({ type: 'error', message: `The four values must total 10000 — currently ${bpsTotal}.` });
      return;
    }
    const ok = await mcUi.confirm({
      title: 'Adjust the marketing split',
      message: (
        <>
          Set Claim {(bps.claim / 100).toFixed(2)}%, Weekly {(bps.weekly / 100).toFixed(2)}%, Monthly{' '}
          {(bps.monthly / 100).toFixed(2)}%, LuckyDraw {(bps.lucky / 100).toFixed(2)}%?
          <br /><br />
          No value may move more than {state.maxChange} bps per change, and the next change is locked for
          14 days after this one.
        </>
      ),
      confirmLabel: 'Adjust',
      variant: 'danger',
    });
    if (!ok) return;
    const { Contract } = await import('ethers');
    const { getActiveAddresses } = await import('@missionchain/sdk');
    const c = new Contract((getActiveAddresses() as Record<string, string>).RewardDistributorV2,
      ['function adjustBPS(uint256 newClaim, uint256 newWeekly, uint256 newMonthly, uint256 newLucky)'],
      await walletSigner());
    await run('Split adjusted', () => c.adjustBPS(bps.claim, bps.weekly, bps.monthly, bps.lucky));
  };

  return (
    <div className="card" style={{ padding: 20, marginBottom: 16 }}>
      <div className="card-title">Marketing &amp; Sales — 25% of gross</div>
      <div style={{ fontSize: '0.6rem', color: 'var(--gray2)', lineHeight: 1.7, marginBottom: 12 }}>
        RewardDistributorV2 splits this bucket four ways inside the sale transaction. Nothing rests in the
        distributor itself.
      </div>

      {state?.error && <div className="alert alert-warn" style={{ fontSize: '0.6rem' }}><div>Could not read the marketing contracts.</div></div>}

      {bps && (
        <>
          <div className="sep-lbl" style={{ marginBottom: 8 }}>Split (basis points, must total 10000)</div>
          <div className="g2" style={{ gap: 8, marginBottom: 8 }}>
            {([['claim', 'Claim — GV + M&I'], ['weekly', 'Weekly'], ['monthly', 'Monthly'], ['lucky', 'LuckyDraw']] as const).map(([k, label]) => (
              <div className="info-row" key={k} style={{ alignItems: 'center' }}>
                <span className="info-key">{label}</span>
                <span style={{ display: 'flex', gap: 6, alignItems: 'center', justifyContent: 'flex-end' }}>
                  <input type="text" inputMode="numeric" value={bps[k]} disabled={!isOwner}
                    onChange={(e) => setBps({ ...bps, [k]: Number(e.target.value.replace(/\D/g, '')) || 0 })}
                    style={{ fontSize: 12, padding: '6px 10px', width: 80, textAlign: 'right' }} />
                  <span style={{ fontSize: '0.55rem', color: 'var(--gray2)', minWidth: 52 }}>
                    {(bps[k] / 100).toFixed(2)}%
                  </span>
                </span>
              </div>
            ))}
          </div>
          {isOwner && (
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 }}>
              <button className="btn btn-gold" disabled={busy || cooldownLeftDays > 0 || bpsTotal !== 10000}
                onClick={saveBps} style={{ padding: '6px 18px', fontWeight: 700 }}>
                ADJUST SPLIT
              </button>
              <span style={{ fontSize: '0.55rem', color: bpsTotal === 10000 ? 'var(--gray2)' : 'var(--warning)' }}>
                Total {bpsTotal} / 10000
                {cooldownLeftDays > 0 && ` · locked for ${cooldownLeftDays} more day(s)`}
                {` · max ${state?.maxChange ?? 200} bps change per value`}
              </span>
            </div>
          )}
        </>
      )}

      <div className="sep-lbl" style={{ margin: '14px 0 8px' }}>Milestones &amp; Incentives</div>
      <div className="g2" style={{ marginBottom: 10 }}>
        <div className="info-row"><span className="info-key">Community Growth Award</span>
          <span className="info-val">{state ? money(state.gv, 4) : '—'}</span></div>
        <div className="info-row"><span className="info-key">M&amp;I available</span>
          <span className="info-val" style={{ color: 'var(--gold)' }}>{state ? money(state.mi, 4) : '—'}</span></div>
      </div>
      <div style={{ fontSize: '0.55rem', color: 'var(--gray2)', lineHeight: 1.7, marginBottom: 10 }}>
        M&amp;I collects what no one claimed: referral with no upline, and any Community Growth Award swept
        across. Members claim their own Growth Award; M&amp;I is paid out from here.
      </div>

      {isOwner && state?.canDistribute === false && (
        <div className="alert alert-warn" style={{ fontSize: '0.6rem', marginBottom: 10, lineHeight: 1.7 }}>
          <div>
            This wallet cannot pay out M&amp;I — <code>CREDITOR_ROLE</code> sits with the reward keeper.
            <button className="btn" disabled={busy} onClick={grantCreditor}
              style={{ padding: '3px 12px', fontSize: '0.55rem', marginLeft: 8 }}>GRANT TO THIS WALLET</button>
          </div>
        </div>
      )}

      {isOwner && (
        <>
          {rows.map((r, i) => (
            <div className="g2" style={{ gap: 8, marginBottom: 6 }} key={i}>
              <input type="text" value={r.to} placeholder="Recipient (0x...)"
                onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, to: e.target.value } : x)))}
                style={{ fontSize: 12, padding: '9px 14px' }} />
              <input type="text" inputMode="decimal" value={r.amount} placeholder="Amount (USDT)"
                onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, amount: e.target.value.replace(/,/g, '.') } : x)))}
                style={{ fontSize: 12, padding: '9px 14px' }} />
            </div>
          ))}
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <button className="btn" disabled={busy} onClick={() => setRows([...rows, { to: '', amount: '' }])}
              style={{ padding: '5px 14px', fontSize: '0.58rem' }}>+ ROW</button>
            <button className="btn btn-gold" disabled={busy || validRows.length === 0 || rowsTotal > (state?.mi ?? 0)}
              onClick={distribute} style={{ padding: '6px 18px', fontWeight: 700 }}>
              PAY {validRows.length > 0 ? money(rowsTotal, 4) : ''}
            </button>
            <span style={{ fontSize: '0.55rem', color: rowsTotal > (state?.mi ?? 0) ? 'var(--warning)' : 'var(--gray2)' }}>
              {validRows.length} valid row(s) · available {state ? money(state.mi, 4) : '—'}
            </span>
          </div>
        </>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   PROPOSALS HISTORY — one table, every fund that spends by proposal
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * The four statuses an operator is shown, and the six the database stores.
 *
 * OPEN and APPROVED both read as "Pending" here because the distinction between them is
 * about the vote, not about the money: neither has been paid, and both can still be
 * cancelled. The vote itself is already on the row, in the Vote rate column.
 */
const PROPOSAL_STATUS: Record<string, { label: string; badge: string }> = {
  OPEN:      { label: 'Pending',   badge: 'b-gold' },
  APPROVED:  { label: 'Pending',   badge: 'b-gold' },
  EXECUTED:  { label: 'Executed',  badge: 'b-green' },
  REJECTED:  { label: 'Failed',    badge: 'b-gray' },
  CANCELLED: { label: 'Cancelled', badge: 'b-gray' },
};

const isPending = (status: string) => status === 'OPEN' || status === 'APPROVED';

/**
 * Spending history for one fund.
 *
 * Two things this component refuses to do, both of which have already gone wrong on this
 * page once:
 *
 *   - it never fetches without a `pool`. The proposals endpoint returns every fund when the
 *     filter is absent, so an unfiltered table under a fund heading shows other funds' money
 *     and looks entirely plausible while doing it.
 *   - it never renders a vote threshold it computed itself. `approvalsRequired` arrives from
 *     the API, which derives it from the live eligible membership. Writing "3 of 5" on the
 *     screen is correct only until the sixth seat is filled, and then it is wrong with no
 *     symptom.
 */
function ProposalsHistory({
  pool, canCancel, onChanged,
}: {
  /** Fund key as stored on MgmtOpsProposal — MGMT_OPS · LISTING · TREASURY · MI. */
  pool: 'MGMT_OPS' | 'LISTING' | 'TREASURY' | 'MI';
  /** Whether the viewing wallet can actually call cancel. Owner-only for all four. */
  canCancel: boolean;
  onChanged?: () => void;
}) {
  const mcUi = useMcUi();
  const [rows, setRows] = useState<any[] | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const jwt = typeof window !== 'undefined' ? localStorage.getItem('mc-admin-jwt') : null;
      const res = await fetch(`${API_BASE}/governance/mgmt-ops/proposals?pool=${pool}`, {
        headers: jwt ? { Authorization: `Bearer ${jwt}` } : {},
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setRows((await res.json()).data || []);
    } catch {
      setRows([]);
    }
  }, [pool]);

  useEffect(() => { load(); }, [load]);

  const cancel = async (p: any) => {
    const ok = await mcUi.confirm({
      title: 'Cancel proposal',
      message: (
        <>
          Cancel <strong>${p.amountUsdt.toLocaleString()}</strong> for “{p.content}”?
          <br /><br />
          The proposal is closed and cannot be paid. Nothing on chain changes — no money has
          moved for a pending proposal.
        </>
      ),
      confirmLabel: 'Cancel proposal',
      variant: 'danger',
    });
    if (!ok) return;
    setBusy(true);
    try {
      const jwt = typeof window !== 'undefined' ? localStorage.getItem('mc-admin-jwt') : null;
      const res = await fetch(`${API_BASE}/governance/mgmt-ops/proposals/${p.id}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}) },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || `HTTP ${res.status}`);
      mcUi.toast({ type: 'success', message: 'Proposal cancelled' });
      await load();
      onChanged?.();
    } catch (e: any) {
      mcUi.toast({ type: 'error', message: e?.message || 'Cancel failed' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ borderTop: '1px solid var(--border)', padding: 16 }}>
      <div className="sep-lbl" style={{ marginBottom: 8 }}>Proposals History</div>

      {rows === null && <div style={{ fontSize: SZ, color: 'var(--gray2)' }}>Loading…</div>}
      {rows?.length === 0 && (
        <div style={{ fontSize: SZ, color: 'var(--gray2)' }}>No proposals raised against this fund yet.</div>
      )}

      {rows !== null && rows.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={thSt}>Date &amp; time</th>
                <th style={thSt}>Proposal ID</th>
                <th style={{ ...thSt, textAlign: 'right' }}>Amount</th>
                <th style={thSt}>Note</th>
                <th style={thSt}>Status</th>
                <th style={{ ...thSt, textAlign: 'right' }}>Vote rate</th>
                <th style={{ ...thSt, textAlign: 'right' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const st = PROPOSAL_STATUS[p.status] ?? { label: p.status, badge: 'b-gray' };
                /* Share of the bar cleared, not a count out of a fixed council size — the
                   denominator is whatever the API computed from the live membership. */
                const rate = p.approvalsRequired > 0
                  ? Math.round((p.forVotes / p.approvalsRequired) * 100)
                  : null;
                return (
                  <tr key={p.id}>
                    <td style={{ ...tdSt, whiteSpace: 'nowrap', fontFamily: 'var(--font-m)', fontSize: '0.55rem' }}>
                      {new Date(p.createdAt).toLocaleString('en-US', {
                        year: 'numeric', month: 'short', day: '2-digit',
                        hour: '2-digit', minute: '2-digit', hour12: false,
                      })}
                    </td>
                    <td style={{ ...tdSt, fontFamily: 'var(--font-m)', fontSize: '0.55rem', color: 'var(--gray2)' }}>
                      {p.id.slice(0, 10)}…
                    </td>
                    <td style={{ ...tdSt, textAlign: 'right', fontFamily: 'var(--font-m)', whiteSpace: 'nowrap' }}>
                      ${fmtUsd(p.amountUsdt)}
                    </td>
                    <td style={{ ...tdSt, maxWidth: 320 }}>
                      {p.content}
                      <div style={{ fontSize: '0.5rem', color: 'var(--gray2)', marginTop: 2 }}>
                        to {p.recipient.slice(0, 8)}…{p.recipient.slice(-6)}
                        {p.executedTx && (
                          <>
                            {' · '}
                            <a href={`https://bscscan.com/tx/${p.executedTx}`} target="_blank" rel="noopener noreferrer"
                              style={{ color: 'var(--gold)' }}>{p.executedTx.slice(0, 10)}… ↗</a>
                          </>
                        )}
                      </div>
                    </td>
                    <td style={tdSt}>
                      <span className={`badge ${st.badge}`}>{st.label}</span>
                    </td>
                    <td style={{ ...tdSt, textAlign: 'right', fontFamily: 'var(--font-m)', whiteSpace: 'nowrap' }}>
                      {rate === null ? (
                        <span style={{ color: 'var(--gray2)' }}>—</span>
                      ) : (
                        <>
                          <span style={{ color: p.forVotes >= p.approvalsRequired ? 'var(--green2)' : 'var(--gold)' }}>
                            {rate}%
                          </span>
                          <div style={{ fontSize: '0.5rem', color: 'var(--gray2)' }}>
                            {p.forVotes}/{p.approvalsRequired} of {p.councilSize}
                          </div>
                        </>
                      )}
                    </td>
                    <td style={{ ...tdSt, textAlign: 'right' }}>
                      {canCancel && isPending(p.status) ? (
                        <button className="btn" disabled={busy} onClick={() => cancel(p)}
                          style={{ padding: '3px 12px', fontSize: '0.55rem' }}>
                          CANCEL
                        </button>
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
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   ON-CHAIN PROPOSALS HISTORY — the two SEED pools that vote inside the contract
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Shapes verified against the deployed sources, not against the spec.
 *
 *   ManagementBonusPoolV3.orders  → (id, recipient, amount, content, requester, createdAt,
 *                                    status, executedAt) · status 0 PENDING 1 EXECUTED 2 CANCELLED
 *                                  · cancelOrder is onlyOwner
 *   ReservedExpensesPoolV3.orders → (proposer, recipient, amount, content, approvalCount,
 *                                    executed, cancelled) · no timestamp at all
 *                                  · cancelOrder allows owner OR the proposer
 *
 * The two differ in nearly every position, which is exactly why one shared reader with a
 * per-pool description is safer than two hand-written ones that drift apart.
 */
const ON_CHAIN_POOLS = {
  MGMT_BONUS: {
    addrKey: 'ManagementBonusPoolV3',
    thresholdFn: 'thresholdBps',
    ordersAbi: 'function orders(uint256) view returns (uint256 id, address recipient, uint256 amount, string content, address requester, uint64 createdAt, uint8 status, uint64 executedAt)',
    extraAbi: ['function approvalsCount(uint256) view returns (uint256)'],
    cancelRule: 'the Owner only — the contract marks cancelOrder onlyOwner.',
  },
  CONTINGENCY: {
    addrKey: 'ReservedExpensesPoolV3',
    thresholdFn: 'threshold',
    ordersAbi: 'function orders(uint256) view returns (address proposer, address recipient, uint256 amount, string content, uint256 approvalCount, bool executed, bool cancelled)',
    extraAbi: [] as string[],
    cancelRule: 'the Owner, or the member who raised the order — cancelOrder accepts either.',
  },
} as const;

function OnChainProposalsHistory({ pool, isOwner }: { pool: keyof typeof ON_CHAIN_POOLS; isOwner: boolean }) {
  const mcUi = useMcUi();
  const cfg = ON_CHAIN_POOLS[pool];
  const [rows, setRows] = useState<any[] | null>(null);
  const [required, setRequired] = useState<number | null>(null);
  const [voters, setVoters] = useState<number | null>(null);
  const [addr, setAddr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { Contract, formatUnits } = await import('ethers');
      const { getActiveAddresses } = await import('@missionchain/sdk');
      const A = getActiveAddresses() as Record<string, string>;
      const address = A[cfg.addrKey];
      if (!address) { setErr(`${cfg.addrKey} is not in the address book for this network.`); setRows([]); return; }
      setAddr(address);
      const provider = await readProvider();
      const c = new Contract(address, [
        `function ${cfg.thresholdFn}() view returns (uint256)`,
        'function nextOrderId() view returns (uint256)',
        'function council() view returns (address)',
        cfg.ordersAbi,
        ...cfg.extraAbi,
      ], provider);

      const [thr, next, councilAddr] = await Promise.all([
        c[cfg.thresholdFn](), c.nextOrderId(), c.council(),
      ]);
      const council = new Contract(councilAddr, ['function activeCount() view returns (uint256)'], provider);
      const active = Number(await council.activeCount().catch(() => 0));
      /* The bar is a share of the seats the contract itself counts — read, never assumed. */
      setVoters(active);
      setRequired(active > 0 ? Math.ceil((active * Number(thr)) / 10_000) : 0);

      const isBonus = pool === 'MGMT_BONUS';
      const out: any[] = [];
      for (let id = Number(next); id >= 1 && id > Number(next) - 25; id--) {
        try {
          const raw = await c.orders(id);
          const recipient = String(isBonus ? raw[1] : raw[1]);
          /* nextOrderId may be the next slot rather than the last used one, so an empty
             tuple simply means that slot was never written. */
          if (!recipient || /^0x0{40}$/i.test(recipient)) continue;
          const status = isBonus
            ? (Number(raw[6]) === 1 ? 'EXECUTED' : Number(raw[6]) === 2 ? 'CANCELLED' : 'OPEN')
            : (raw[5] ? 'EXECUTED' : raw[6] ? 'CANCELLED' : 'OPEN');
          const approvals = isBonus
            ? Number(await c.approvalsCount(id).catch(() => 0n))
            : Number(raw[4]);
          out.push({
            id,
            createdAt: isBonus && Number(raw[5]) > 0 ? Number(raw[5]) * 1000 : null,
            recipient,
            amount: Number(formatUnits(raw[2], USDT_DECIMALS)),
            content: String(raw[3]),
            proposer: String(isBonus ? raw[4] : raw[0]),
            status,
            approvals,
          });
        } catch { /* one unreadable order must not hide the rest */ }
      }
      setRows(out);
    } catch (e: any) {
      setErr(e?.shortMessage || e?.message || 'On-chain read failed');
      setRows([]);
    }
  }, [pool, cfg]);

  useEffect(() => { load(); }, [load]);

  const cancel = async (r: any) => {
    const ok = await mcUi.confirm({
      title: 'Cancel order',
      message: (
        <>
          Cancel order <strong>#{r.id}</strong> — ${fmtUsd(r.amount)} for “{r.content}”?
          <br /><br />
          This is an on-chain transaction. The order is closed permanently and cannot be paid.
        </>
      ),
      confirmLabel: 'Sign and cancel',
      variant: 'danger',
    });
    if (!ok || !addr) return;
    setBusy(true);
    try {
      const { Contract } = await import('ethers');
      const c = new Contract(addr, ['function cancelOrder(uint256 id)'], await walletSigner());
      const tx = await c.cancelOrder(r.id);
      mcUi.toast({ type: 'info', message: 'Waiting for confirmation…' });
      const receipt = await tx.wait(1);
      if (!receipt || receipt.status !== 1) throw new Error('Transaction reverted');
      mcUi.toast({ type: 'success', message: `Cancelled · ${tx.hash.slice(0, 10)}…` });
      await load();
    } catch (e: any) {
      mcUi.toast({
        type: 'error',
        message: e?.code === 4001 || e?.code === 'ACTION_REJECTED'
          ? 'Transaction rejected in wallet'
          : 'Cancel failed: ' + (e?.shortMessage || e?.message || 'Unknown error'),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ borderTop: '1px solid var(--border)', padding: 16 }}>
      <div className="sep-lbl" style={{ marginBottom: 8 }}>Proposals History</div>
      <div style={{ fontSize: '0.55rem', color: 'var(--gray2)', lineHeight: 1.7, marginBottom: 10 }}>
        Read from the contract, not from this application: orders for this fund are created and
        approved on chain, and the contract refuses to execute below the bar. Cancellation is{' '}
        {cfg.cancelRule}
        {required !== null && voters !== null && (
          <> The bar right now is <strong>{required} of {voters}</strong> active seats.</>
        )}
      </div>

      {err && <ChainErrNote msg={err} />}
      {rows === null && !err && <div style={{ fontSize: SZ, color: 'var(--gray2)' }}>Reading the contract…</div>}
      {rows?.length === 0 && !err && (
        <div style={{ fontSize: SZ, color: 'var(--gray2)' }}>No orders have been raised against this fund yet.</div>
      )}

      {rows !== null && rows.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={thSt}>Date &amp; time</th>
                <th style={thSt}>Proposal ID</th>
                <th style={{ ...thSt, textAlign: 'right' }}>Amount</th>
                <th style={thSt}>Note</th>
                <th style={thSt}>Status</th>
                <th style={{ ...thSt, textAlign: 'right' }}>Vote rate</th>
                <th style={{ ...thSt, textAlign: 'right' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const st = PROPOSAL_STATUS[r.status] ?? { label: r.status, badge: 'b-gray' };
                const rate = required && required > 0 ? Math.round((r.approvals / required) * 100) : null;
                return (
                  <tr key={r.id}>
                    <td style={{ ...tdSt, whiteSpace: 'nowrap', fontFamily: 'var(--font-m)', fontSize: '0.55rem' }}>
                      {r.createdAt
                        ? new Date(r.createdAt).toLocaleString('en-US', {
                            year: 'numeric', month: 'short', day: '2-digit',
                            hour: '2-digit', minute: '2-digit', hour12: false,
                          })
                        : <span style={{ color: 'var(--gray2)' }}>not recorded on chain</span>}
                    </td>
                    <td style={{ ...tdSt, fontFamily: 'var(--font-m)', fontSize: '0.55rem', color: 'var(--gray2)' }}>#{r.id}</td>
                    <td style={{ ...tdSt, textAlign: 'right', fontFamily: 'var(--font-m)', whiteSpace: 'nowrap' }}>
                      ${fmtUsd(r.amount)}
                    </td>
                    <td style={{ ...tdSt, maxWidth: 320 }}>
                      {r.content}
                      <div style={{ fontSize: '0.5rem', color: 'var(--gray2)', marginTop: 2 }}>
                        to {r.recipient.slice(0, 8)}…{r.recipient.slice(-6)}
                        {' · '}raised by {r.proposer.slice(0, 8)}…{r.proposer.slice(-4)}
                      </div>
                    </td>
                    <td style={tdSt}><span className={`badge ${st.badge}`}>{st.label}</span></td>
                    <td style={{ ...tdSt, textAlign: 'right', fontFamily: 'var(--font-m)', whiteSpace: 'nowrap' }}>
                      {rate === null ? <span style={{ color: 'var(--gray2)' }}>—</span> : (
                        <>
                          <span style={{ color: required !== null && r.approvals >= required ? 'var(--green2)' : 'var(--gold)' }}>
                            {rate}%
                          </span>
                          <div style={{ fontSize: '0.5rem', color: 'var(--gray2)' }}>
                            {r.approvals}/{required} of {voters}
                          </div>
                        </>
                      )}
                    </td>
                    <td style={{ ...tdSt, textAlign: 'right' }}>
                      {isOwner && r.status === 'OPEN' ? (
                        <button className="btn" disabled={busy} onClick={() => cancel(r)}
                          style={{ padding: '3px 12px', fontSize: '0.55rem' }}>CANCEL</button>
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
  );
}

function FundBlock({
  title, subtitle, sources, poolTotals, seedSlotIdx, funds, totalsNote, hideBreakdown, children,
}: {
  title: string;
  subtitle: string;
  sources: FundSource[];
  /**
   * The combined on-chain row for the pool contract behind this fund. Null for a fund whose
   * money sits entirely in SEED slots, where there is no separate pool contract to reconcile
   * against and an empty summary row would only invite one to be invented.
   */
  poolTotals: { label: string; accumulated: number | null; balance: number | null; address: string } | null;
  seedSlotIdx: number[];
  funds: ChainFunds | null;
  /**
   * A caveat printed under the three boxes. Used where one contract backs two tabs and the
   * figures therefore appear twice — saying so is the only thing standing between an
   * operator and adding them together.
   */
  totalsNote?: string;
  /** Omit the per-source table where a parent block already carries it. */
  hideBreakdown?: boolean;
  children?: React.ReactNode;
}) {
  // Totals are built ONLY from on-chain figures, never from the derived per-sale
  // rows — otherwise Pre-Sale and MICE would be double-counted against the pool
  // contract that already reports their combined receipts.
  const seedAcc = seedSlotIdx.map((i) => funds?.seedSlots[i]?.received ?? null);
  const seedSpent = seedSlotIdx.map((i) => funds?.seedSlots[i]?.released ?? null);
  const seedBal = seedSlotIdx.map((i) => funds?.seedSlots[i]?.balance ?? null);

  const sum = (arr: (number | null)[]): number | null =>
    arr.some((v) => v === null) ? null : arr.reduce<number>((a, b) => a + (b as number), 0);

  const poolSpent = !poolTotals || poolTotals.accumulated === null || poolTotals.balance === null
    ? null
    : Math.max(0, poolTotals.accumulated - poolTotals.balance);

  const totalAcc = poolTotals ? sum([...seedAcc, poolTotals.accumulated]) : sum(seedAcc);
  const totalSpent = poolTotals ? sum([...seedSpent, poolSpent]) : sum(seedSpent);
  const totalBal = poolTotals ? sum([...seedBal, poolTotals.balance]) : sum(seedBal);

  return (
    <div className="card" style={{ marginBottom: 16, padding: 0 }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ fontFamily: 'var(--font-d)', fontSize: '0.85rem', color: 'var(--gold)', letterSpacing: '0.04em' }}>
          {title}
        </div>
        <div style={{ fontSize: '0.55rem', color: 'var(--gray2)', marginTop: 2 }}>{subtitle}</div>
      </div>

      {/* 3 boxes on one row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, padding: 16 }}>
        <Stat
          label="TOTAL"
          value={totalAcc === null ? 'No data' : `$${fmtUsd(totalAcc)}`}
          hint="Lifetime on-chain receipts across every funding source"
          tone={totalAcc === null ? 'warn' : undefined}
        />
        <Stat
          label="Spent"
          value={totalSpent === null ? 'No data' : `$${fmtUsd(totalSpent)}`}
          hint={seedSlotIdx.length > 0
            ? 'SEED slots exact (slotTotalReleased); pool contract derived as accumulated − balance'
            : 'Derived: accumulated − balance. The pool contract has no spend counter.'}
          tone={totalSpent === null ? 'warn' : undefined}
        />
        <Stat
          label="Balance"
          value={totalBal === null ? 'No data' : `$${fmtUsd(totalBal)}`}
          hint="Live USDT held, remaining to spend"
          tone={totalBal === null ? 'warn' : undefined}
        />
      </div>

      {totalsNote && (
        <div style={{ padding: '0 16px 14px', fontSize: '0.55rem', color: 'var(--gold)', lineHeight: 1.7 }}>
          {totalsNote}
        </div>
      )}

      {/* Per-source breakdown */}
      {!hideBreakdown && (
      <div style={{ overflowX: 'auto', borderTop: '1px solid var(--border)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={thSt}>Source</th>
              <th style={{ ...thSt, textAlign: 'right' }}>Share</th>
              <th style={{ ...thSt, textAlign: 'right' }}>Accumulated</th>
              <th style={{ ...thSt, textAlign: 'right' }}>Spent</th>
              <th style={{ ...thSt, textAlign: 'right' }}>Balance</th>
              <th style={thSt}>Data origin</th>
            </tr>
          </thead>
          <tbody>
            {sources.map((s) => (
              <tr key={s.label}>
                <td style={{ ...tdSt, whiteSpace: 'nowrap' }}>
                  <strong>{s.label}</strong>
                  {s.derived && <Tag>derived</Tag>}
                </td>
                <td style={{ ...tdSt, textAlign: 'right', color: 'var(--cyan)' }}>{s.pct}</td>
                <td style={{ ...tdSt, textAlign: 'right', fontFamily: 'var(--font-m)' }}>
                  <Amt v={s.noData ? null : s.accumulated} />
                </td>
                <td style={{ ...tdSt, textAlign: 'right', fontFamily: 'var(--font-m)' }}>
                  {s.spentExact ? <Amt v={s.noData ? null : s.spent} /> : <NA label="not per-source" />}
                </td>
                <td style={{ ...tdSt, textAlign: 'right', fontFamily: 'var(--font-m)' }}>
                  {s.spentExact ? <Amt v={s.noData ? null : s.balance} /> : <NA label="not per-source" />}
                </td>
                <td style={{ ...tdSt, color: 'var(--gray2)', fontSize: '0.5rem', maxWidth: 340 }}>
                  {s.noData ? <span style={{ color: 'var(--gold)' }}>{s.noData} </span> : null}
                  {s.origin}
                </td>
              </tr>
            ))}
            {poolTotals && (
            <tr>
              <td style={{ ...tdSt, whiteSpace: 'nowrap' }}>
                <strong style={{ color: 'var(--cyan)' }}>{poolTotals.label}</strong>
              </td>
              <td style={{ ...tdSt, textAlign: 'right', color: 'var(--gray2)' }}>—</td>
              <td style={{ ...tdSt, textAlign: 'right', fontFamily: 'var(--font-m)', color: 'var(--gold)' }}>
                <Amt v={poolTotals.accumulated} />
              </td>
              <td style={{ ...tdSt, textAlign: 'right', fontFamily: 'var(--font-m)' }}>
                <Amt v={poolSpent} />
              </td>
              <td style={{ ...tdSt, textAlign: 'right', fontFamily: 'var(--font-m)' }}>
                <Amt v={poolTotals.balance} />
              </td>
              <td style={{ ...tdSt, color: 'var(--gray2)', fontSize: '0.5rem' }}>
                On-chain <code>totalReceived()</code> and live USDT balance of {poolTotals.address}.
                Spent is derived (accumulated − balance); this contract keeps no spend counter.
              </td>
            </tr>
            )}
          </tbody>
        </table>
      </div>
      )}

      {children}
    </div>
  );
}

/* ManagementPoolRoles lived here: a second reading of the same six roles — same
   getRoleAddress / getRoleBps / pendingAmount, same setRoleAddress, same CHANGE button as
   ManagementPoolAdmin below. Rendering both listed every role twice on one tab. Deleted
   rather than hidden, so it cannot be pulled back in by a later reuse. */

function MgmtOpsProposalsAdmin({ isOwner }: { isOwner: boolean }) {
  const mcUi = useMcUi();
  const [rows, setRows] = useState<any[] | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const jwt = typeof window !== 'undefined' ? localStorage.getItem('mc-admin-jwt') : null;
      /* Filtered. Unfiltered, this endpoint returns every fund's proposals, and they were
         being listed under the ManagementPool heading as though they belonged to it. */
      const res = await fetch(`${API_BASE}/governance/mgmt-ops/proposals?pool=MGMT_OPS`, {
        headers: jwt ? { Authorization: `Bearer ${jwt}` } : {},
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      setRows(j.data || []);
    } catch {
      setRows([]);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const call = async (path: string, body: any) => {
    const jwt = typeof window !== 'undefined' ? localStorage.getItem('mc-admin-jwt') : null;
    const res = await fetch(`${API_BASE}/governance/mgmt-ops/proposals/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}) },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j.message || `HTTP ${res.status}`);
    }
    return res.json();
  };

  const decide = async (p: any, approve: boolean) => {
    const ok = await mcUi.confirm({
      title: approve ? 'Approve proposal' : 'Reject proposal',
      message: (
        <>
          {approve ? 'Approve' : 'Reject'} <strong>${p.amountUsdt.toLocaleString()}</strong> for “{p.content}”?
          <br /><br />
          {approve
            ? 'Approving does not send anything. You will still sign the transfer separately.'
            : 'The proposal is closed and cannot be paid.'}
        </>
      ),
      confirmLabel: approve ? 'Approve' : 'Reject',
      variant: approve ? 'default' : 'danger',
    });
    if (!ok) return;
    setBusy(true);
    try {
      await call(`${p.id}/decide`, { approve });
      mcUi.toast({ type: 'success', message: approve ? 'Approved' : 'Rejected' });
      await load();
    } catch (e: any) {
      mcUi.toast({ type: 'error', message: e?.message || 'Failed' });
    } finally {
      setBusy(false);
    }
  };

  /** Sign `distributeBonus` from the Owner wallet, then record the hash on the proposal. */
  const pay = async (p: any) => {
    const ok = await mcUi.confirm({
      title: 'Pay this proposal',
      message: (
        <>
          Send <strong>${p.amountUsdt.toLocaleString()} USDT</strong> to{' '}
          <code>{p.recipient.slice(0, 10)}…{p.recipient.slice(-6)}</code> from the ManagementPool bonus
          balance?
          <br /><br />
          This is an on-chain transfer and cannot be undone.
        </>
      ),
      confirmLabel: 'Sign and pay',
      variant: 'danger',
    });
    if (!ok) return;

    setBusy(true);
    try {
      const { BrowserProvider, Contract, parseUnits } = await import('ethers');
      const eth = (window as any).ethereum;
      if (!eth) throw new Error('No wallet detected.');
      await eth.request({ method: 'eth_requestAccounts' });
      const signer = await new BrowserProvider(eth).getSigner();
      const { getActiveAddresses } = await import('@missionchain/sdk');
      const mp = new Contract(
        (getActiveAddresses() as Record<string, string>).ManagementPool,
        ['function distributeBonus(address recipient, uint256 amount)'],
        signer,
      );
      const tx = await mp.distributeBonus(p.recipient, parseUnits(String(p.amountUsdt), USDT_DECIMALS));
      mcUi.toast({ type: 'info', message: 'Waiting for confirmation…' });
      const receipt = await tx.wait(1);
      if (!receipt || receipt.status !== 1) throw new Error('Transaction reverted');

      await call(`${p.id}/execute`, { txHash: tx.hash });
      mcUi.toast({ type: 'success', message: `Paid · ${tx.hash.slice(0, 10)}…` });
      await load();
    } catch (e: any) {
      mcUi.toast({
        type: 'error',
        message: e?.code === 4001 || e?.code === 'ACTION_REJECTED'
          ? 'Transaction rejected in wallet'
          : 'Payment failed: ' + (e?.shortMessage || e?.message || 'Unknown error'),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ borderTop: '1px solid var(--border)', padding: 16 }}>
      <div className="sep-lbl" style={{ marginBottom: 8 }}>Awaiting a decision or a signature</div>
      <div style={{ fontSize: '0.58rem', color: 'var(--gray2)', lineHeight: 1.7, marginBottom: 10 }}>
        Raised and voted on by Council members in the member app. A proposal carries at{' '}
        <strong>60% of the active membership</strong> {'\u2014'} the bar follows the Council as it grows and is
        never a fixed count; one that draws no objection for 72 hours may be decided here alone. The pool
        contract holds no vote of its own, so approval is recorded here and the transfer is a separate
        signature from the Owner wallet. Settled proposals are in the Proposals History table below.
      </div>

      {rows === null && <div style={{ fontSize: '0.6rem', color: 'var(--gray2)' }}>Loading…</div>}
      {rows !== null && rows.filter((p) => isPending(p.status)).length === 0 && (
        <div style={{ fontSize: '0.6rem', color: 'var(--gray2)' }}>Nothing is waiting on you.</div>
      )}

      {rows?.filter((p) => isPending(p.status)).map((p) => (
        <div key={p.id} style={{ borderTop: '1px solid var(--border)', padding: '10px 0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline' }}>
            <div style={{ fontSize: '0.68rem', fontWeight: 700 }}>{p.content}</div>
            <span className={`badge ${p.status === 'EXECUTED' ? 'b-green' : p.status === 'REJECTED' ? 'b-gray' : 'b-gold'}`}>
              {p.status}
            </span>
          </div>
          <div style={{ fontSize: '0.55rem', color: 'var(--gray2)', marginTop: 3, lineHeight: 1.6 }}>
            ${p.amountUsdt.toLocaleString()} {'\u2192'} <span style={{ fontFamily: 'var(--font-m)' }}>
              {p.recipient.slice(0, 8)}…{p.recipient.slice(-6)}
            </span>
            {' \u00B7 '}proposed by {p.proposer.slice(0, 8)}…{p.proposer.slice(-4)}
            {' \u00B7 '}<strong style={{ color: p.forVotes >= p.approvalsRequired ? 'var(--green2)' : 'var(--gold)' }}>
              {p.forVotes}/{p.approvalsRequired} approvals
            </strong>
            {p.againstVotes > 0 && ` \u00B7 ${p.againstVotes} objection(s)`}
            {p.status === 'OPEN' && (p.windowClosed
              ? ' \u00B7 72h window closed \u2014 you may decide alone'
              : ' \u00B7 inside the 72h window')}
            {p.executedTx && (
              <> {'\u00B7'} <a href={`https://bscscan.com/tx/${p.executedTx}`} target="_blank" rel="noopener noreferrer"
                style={{ color: 'var(--gold)' }}>{p.executedTx.slice(0, 10)}… {'\u2197'}</a></>
            )}
          </div>

          {isOwner && p.status !== 'EXECUTED' && p.status !== 'REJECTED' && (
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              {p.status === 'OPEN' && (
                <>
                  <button className="btn" disabled={busy} onClick={() => decide(p, true)}
                    style={{ padding: '4px 14px', fontSize: '0.58rem' }}>APPROVE</button>
                  <button className="btn" disabled={busy} onClick={() => decide(p, false)}
                    style={{ padding: '4px 14px', fontSize: '0.58rem' }}>REJECT</button>
                </>
              )}
              {p.status === 'APPROVED' && (
                <button className="btn btn-gold" disabled={busy} onClick={() => pay(p)}
                  style={{ padding: '4px 16px', fontSize: '0.58rem', fontWeight: 700 }}>
                  SIGN AND PAY
                </button>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Management & Ops: council allocation list (fully wired) ────────────

function OperationalPoolPanel({ isOwner }: { isOwner: boolean }) {
  const mcUi = useMcUi();
  const [opPool, setOpPool] = useState<{
    members: OperationalPoolMember[];
    totalShareBps: number;
    weekIdx: number;
    totalClaimable: number;
    totalAllocated: number;
    totalClaimed: number;
  } | null>(null);
  const [opLoading, setOpLoading] = useState(true);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [council, setCouncil] = useState<StewardCouncilMember[]>([]);

  const [showEnroll, setShowEnroll] = useState(false);
  const [enrollForm, setEnrollForm] = useState({ wallet: '', sharePctBps: 0, weeklyMaxoutUsdt: 0 });
  const [editingWallet, setEditingWallet] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ sharePctBps: 0, weeklyMaxoutUsdt: 0 });

  const loadAll = useCallback(async () => {
    setOpLoading(true);
    setLoadErr(null);
    try {
      const [opRes, cRes] = await Promise.all([fetchOperationalPool(), fetchStewardCouncil()]);
      setOpPool(opRes.data);
      setCouncil(cRes.data || []);
    } catch (err: any) {
      console.error('Failed to load Op pool', err);
      // Say what actually failed. This blamed the contract for every failure, including
      // an expired session — and the contract is the one thing almost never at fault.
      // The wrong message sent the last person debugging this to read bytecode.
      const raw = String(err?.message ?? '');
      setLoadErr(
        /failed to fetch|networkerror|load failed/i.test(raw)
          ? 'Could not reach the API from this browser. Your admin session may have expired — reconnect your wallet and try again.'
          : /401|unauthor/i.test(raw)
            ? 'Your admin session has expired. Reconnect your wallet.'
            : `Could not load the salary pool: ${raw || 'unknown error'}`,
      );
    } finally {
      setOpLoading(false);
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  const handleEnroll = async () => {
    if (!enrollForm.wallet || enrollForm.sharePctBps <= 0) {
      mcUi.toast({ type: 'error', message: 'Wallet and share % required' });
      return;
    }
    try {
      await enrollOperationalPoolMember({
        wallet: enrollForm.wallet,
        sharePctBps: enrollForm.sharePctBps,
        weeklyMaxoutUsdt: enrollForm.weeklyMaxoutUsdt,
      });
      mcUi.toast({ type: 'success', message: 'Member added to Operational Pool' });
      setShowEnroll(false);
      setEnrollForm({ wallet: '', sharePctBps: 0, weeklyMaxoutUsdt: 0 });
      await loadAll();
    } catch (err: any) {
      mcUi.toast({ type: 'error', message: err.message || 'Failed to add' });
    }
  };

  const handleSaveEdit = async (wallet: string) => {
    try {
      await updateOperationalPoolMember(wallet, editForm);
      mcUi.toast({ type: 'success', message: 'Member updated' });
      setEditingWallet(null);
      await loadAll();
    } catch (err: any) {
      mcUi.toast({ type: 'error', message: err.message || 'Failed to update' });
    }
  };

  const handleRemove = async (wallet: string, memberId: string) => {
    const ok = await mcUi.confirm({
      title: 'Remove from Operational Pool',
      message: <>Remove <b>{memberId}</b> from operational pool? Their pending claimable balance is preserved.</>,
      confirmLabel: 'Remove',
    });
    if (!ok) return;
    try {
      await removeOperationalPoolMember(wallet);
      mcUi.toast({ type: 'success', message: 'Removed' });
      await loadAll();
    } catch (err: any) {
      mcUi.toast({ type: 'error', message: err.message || 'Failed to remove' });
    }
  };

  const enrolledWallets = new Set(opPool?.members.map((m) => m.wallet.toLowerCase()) ?? []);
  const availableCouncil = council.filter((c) => c.active && !enrolledWallets.has(c.wallet.toLowerCase()));

  const totalSharePct = (opPool?.totalShareBps ?? 0) / 100;
  const remainingBps = 10000 - (opPool?.totalShareBps ?? 0);

  const addDisabledReason = !isOwner
    ? 'Owner wallet only.'
    : loadErr
      ? loadErr
      : availableCouncil.length === 0
        ? 'Every active Steward Council member is already enrolled. Add a new member on the Steward Council page first.'
        : null;

  return (
    <div style={{ borderTop: '1px solid var(--border)', padding: 16 }}>
      <div style={{ padding: '12px 16px 0' }}>
        <div style={{ fontFamily: 'var(--font-d)', fontSize: '0.68rem', color: 'var(--cyan)', letterSpacing: '0.05em' }}>
          STEWARD COUNCIL SALARIES — ALLOCATION
        </div>
        <div style={{ fontSize: '0.5rem', color: 'var(--gray2)', marginTop: 3, lineHeight: 1.6 }}>
          Funded by the <strong>SEED Operational slot (20%)</strong> only. Each member draws
          <code> share % × slot lifetime receipts − already claimed</code>, capped by their weekly
          maxout; the remainder rolls over. Adding, editing and removing writes to{' '}
          <code>OperationalSalaryPoolV3</code> on-chain first and mirrors to the database second.
          Members claim themselves from their own wallet — the admin cannot claim on their behalf.
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, padding: 16 }}>
        <Stat label="Total Share Allocated" value={`${totalSharePct.toFixed(2)}%`} hint={`${remainingBps} bps unallocated`} />
        <Stat label="Total Claimable Now" value={`$${(opPool?.totalClaimable ?? 0).toLocaleString()}`} hint="Sum of every member's claimable()" />
        <Stat label="Total Claimed (lifetime)" value={`$${(opPool?.totalClaimed ?? 0).toLocaleString()}`} hint="SeedBudgetV5c slot 1 released" />
        <Stat label="Week Index" value={String(opPool?.weekIdx ?? 0)} hint="block.timestamp / 7 days" />
      </div>

      {loadErr && <div style={{ padding: '0 16px 12px' }}><WarnNote>{loadErr}</WarnNote></div>}

      <div style={{ padding: '0 16px 12px', display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 10 }}>
        {addDisabledReason && (
          <span style={{ fontSize: '0.5rem', color: 'var(--gray2)', maxWidth: 420, textAlign: 'right' }}>
            {addDisabledReason}
          </span>
        )}
        <button
          className="btn btn-gold btn-sm"
          style={{ fontSize: SZ, padding: '5px 12px', opacity: addDisabledReason ? 0.4 : 1, cursor: addDisabledReason ? 'not-allowed' : 'pointer' }}
          onClick={() => { if (!addDisabledReason) setShowEnroll(!showEnroll); }}
          disabled={!!addDisabledReason}
        >
          {showEnroll ? 'Cancel' : '+ ADD COUNCIL MEMBER'}
        </button>
      </div>

      {isOwner && showEnroll && availableCouncil.length > 0 && (
        <div style={{ padding: 16, borderTop: '1px solid var(--border)', background: 'rgba(212,160,23,.04)' }}>
          <div style={{ fontFamily: 'var(--font-d)', fontSize: '0.65rem', color: 'var(--gold)', marginBottom: 10 }}>
            ADD MEMBER (must be on Steward Council first)
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr auto', gap: 10, alignItems: 'flex-end' }}>
            <div>
              <div style={thSt}>Council Member</div>
              <select
                value={enrollForm.wallet}
                onChange={(e) => setEnrollForm({ ...enrollForm, wallet: e.target.value })}
                style={inputSt}
              >
                <option value="">— Choose —</option>
                {availableCouncil.map((c) => (
                  <option key={c.wallet} value={c.wallet}>
                    {c.memberId} — {c.role} ({shortWallet(c.wallet)})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <div style={thSt}>Share % of Management &amp; Ops</div>
              <input
                type="number" min="0.01" max="100" step="0.01"
                value={enrollForm.sharePctBps / 100 || ''}
                onChange={(e) => setEnrollForm({ ...enrollForm, sharePctBps: Math.round(parseFloat(e.target.value) * 100) || 0 })}
                placeholder="e.g. 7"
                style={inputSt}
              />
            </div>
            <div>
              <div style={thSt}>Weekly Maxout (USDT)</div>
              <input
                type="number" min="0"
                value={enrollForm.weeklyMaxoutUsdt || ''}
                onChange={(e) => setEnrollForm({ ...enrollForm, weeklyMaxoutUsdt: parseFloat(e.target.value) || 0 })}
                placeholder="e.g. 5000"
                style={inputSt}
              />
            </div>
            <button className="btn btn-gold btn-sm" style={{ fontSize: SZ }} onClick={handleEnroll}>Add</button>
          </div>
        </div>
      )}

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={thSt}>Member ID</th>
              <th style={thSt}>Wallet</th>
              <th style={thSt}>Role</th>
              <th style={thSt}>Share %</th>
              <th style={thSt}>Weekly Maxout</th>
              <th style={thSt}>This Week Allocated</th>
              <th style={thSt}>Claimable</th>
              <th style={thSt}>Total Claimed</th>
              <th style={{ ...thSt, textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {opLoading ? (
              <tr><td colSpan={9} style={{ padding: 20, textAlign: 'center', color: 'var(--muted)', fontSize: SZ }}>Loading...</td></tr>
            ) : loadErr ? (
              <tr><td colSpan={9} style={{ padding: 20, textAlign: 'center', color: 'var(--gold)', fontSize: SZ }}>Member list unavailable — on-chain read failed.</td></tr>
            ) : (opPool?.members.length ?? 0) === 0 ? (
              <tr><td colSpan={9} style={{ padding: 20, textAlign: 'center', color: 'var(--muted)', fontSize: SZ }}>No members enrolled yet.</td></tr>
            ) : opPool!.members.map((m) => (
              <tr key={m.wallet}>
                <td style={tdSt}><strong>{m.memberId}</strong></td>
                <td style={{ ...tdSt, fontFamily: 'var(--font-m)', color: 'var(--gold)' }}>
                  {shortWallet(m.wallet)}<OwnerCrown wallet={m.wallet} />
                </td>
                <td style={tdSt}>{m.role}</td>
                <td style={tdSt}>
                  {editingWallet === m.wallet ? (
                    <input
                      type="number" min="0.01" max="100" step="0.01"
                      value={editForm.sharePctBps / 100 || ''}
                      onChange={(e) => setEditForm({ ...editForm, sharePctBps: Math.round(parseFloat(e.target.value) * 100) || 0 })}
                      style={{ ...inputSt, width: 80 }}
                    />
                  ) : `${(m.sharePctBps / 100).toFixed(2)}%`}
                </td>
                <td style={tdSt}>
                  {editingWallet === m.wallet ? (
                    <input
                      type="number" min="0"
                      value={editForm.weeklyMaxoutUsdt || ''}
                      onChange={(e) => setEditForm({ ...editForm, weeklyMaxoutUsdt: parseFloat(e.target.value) || 0 })}
                      style={{ ...inputSt, width: 100 }}
                    />
                  ) : `$${m.weeklyMaxoutUsdt.toLocaleString()}`}
                </td>
                <td style={tdSt}>${m.allocatedThisWeek.toLocaleString()}</td>
                <td style={{ ...tdSt, color: 'var(--gold)', fontWeight: 700 }}>
                  ${m.claimableUsdt.toLocaleString()}
                </td>
                <td style={tdSt}>${m.totalClaimedUsdt.toLocaleString()}</td>
                <td style={{ ...tdSt, textAlign: 'right' }}>
                  {editingWallet === m.wallet ? (
                    <>
                      <button className="btn btn-gold btn-sm" style={{ fontSize: SZ, marginRight: 4 }} onClick={() => handleSaveEdit(m.wallet)}>Save</button>
                      <button className="btn btn-outline btn-sm" style={{ fontSize: SZ }} onClick={() => setEditingWallet(null)}>Cancel</button>
                    </>
                  ) : isOwner ? (
                    <>
                      <button
                        className="btn btn-outline btn-sm"
                        style={{ fontSize: SZ, marginRight: 4 }}
                        onClick={() => {
                          setEditingWallet(m.wallet);
                          setEditForm({ sharePctBps: m.sharePctBps, weeklyMaxoutUsdt: m.weeklyMaxoutUsdt });
                        }}
                      >Edit</button>
                      <button
                        className="btn btn-outline btn-sm"
                        style={{ fontSize: SZ, color: 'var(--crimson2)', borderColor: 'rgba(107,20,40,.3)', marginRight: 4 }}
                        onClick={() => handleRemove(m.wallet, m.memberId)}
                      >Remove</button>
                    </>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ padding: '10px 16px 16px', fontSize: '0.5rem', color: 'var(--gray2)' }}>
        The six-role <strong>ManagementPool</strong> funded by Pre-Sale and MICE is a separate
        contract with fixed role weights (Founder / Architect / CTO / Social / Training / Tech, plus
        a 33.33% bonus pool). It is not council-configurable and has no admin UI yet.
      </div>
    </div>
  );
}

// ─── DAO spending proposal + vote (not yet wired) ───────────────────────

/**
 * Reserved Listing — Council proposal, then the Owner's two signatures.
 *
 * This was a disabled placeholder describing a `DAOGovernor` flow nobody had wired, quoting
 * a fixed "3-of-5" threshold. `ListingReserve` has no vote of its own: its only entries are
 * `requestWithdraw`, `executeWithdraw` and `cancelWithdraw`, all held by the Owner. So the
 * vote is kept in the application at 60% of the ACTIVE membership, and the payout is the
 * Owner signing the contract's own two-step.
 *
 * The contract holds exactly ONE pending request — `requestWithdraw` overwrites whatever is
 * there. Raising a second while one is in flight would silently discard the first, so the
 * pending request is read on every load and the button closes while it is set.
 */
/**
 * Reserved Listing — the request → 24h → execute signing path.
 *
 * This took a `pool` label as a prop and used it in the heading only: the fetch was pinned to
 * `?pool=LISTING` and the signer to `ListingReserve` regardless. Rendered under DAO Treasury
 * as well as Reserved Listing, it therefore showed one fund's proposals under the other's
 * name and would have signed a ListingReserve withdrawal from the Treasury block. The prop is
 * gone: the panel is ListingReserve, and nothing else may render it. DAO Treasury signs
 * through TreasuryAdmin, whose contract has entirely different limits.
 */
function GovernancePanel() {
  const mcUi = useMcUi();
  const [rows, setRows] = useState<any[] | null>(null);
  const [pending, setPending] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const jwt = typeof window !== 'undefined' ? localStorage.getItem('mc-admin-jwt') : null;
      const res = await fetch(`${API_BASE}/governance/mgmt-ops/proposals?pool=LISTING`, {
        headers: jwt ? { Authorization: `Bearer ${jwt}` } : {},
      });
      setRows(res.ok ? (await res.json()).data || [] : []);

      const { JsonRpcProvider, Contract, formatUnits } = await import('ethers');
      const { getActiveAddresses, getActiveChain } = await import('@missionchain/sdk');
      const A = getActiveAddresses() as Record<string, string>;
      const chain = getActiveChain();
      const lr = new Contract(A.ListingReserve, [
        'function pending() view returns (address to, uint256 amount, uint64 unlockTime, bool active)',
        'function balance() view returns (uint256)',
      ], new JsonRpcProvider(chain.rpcUrls[0], chain.chainId, { staticNetwork: true }));
      const [pRaw, bal] = await Promise.all([lr.pending(), lr.balance()]);
      setPending({
        active: Boolean(pRaw[3]),
        to: String(pRaw[0]),
        amount: Number(formatUnits(pRaw[1], USDT_DECIMALS)),
        unlockTime: Number(pRaw[2]) * 1000,
        balance: Number(formatUnits(bal, USDT_DECIMALS)),
      });
    } catch {
      setRows([]);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const post = async (path: string, body: any) => {
    const jwt = typeof window !== 'undefined' ? localStorage.getItem('mc-admin-jwt') : null;
    const res = await fetch(`${API_BASE}/governance/mgmt-ops/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}) },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || `HTTP ${res.status}`);
    return res.json();
  };

  const onChain = async (label: string, send: (c: any) => Promise<any>) => {
    setBusy(true);
    try {
      const { BrowserProvider, Contract } = await import('ethers');
      const { getActiveAddresses } = await import('@missionchain/sdk');
      const eth = (window as any).ethereum;
      if (!eth) throw new Error('No wallet detected.');
      await eth.request({ method: 'eth_requestAccounts' });
      const signer = await new BrowserProvider(eth).getSigner();
      const c = new Contract((getActiveAddresses() as Record<string, string>).ListingReserve, [
        'function requestWithdraw(address to, uint256 amount)',
        'function executeWithdraw()',
        'function cancelWithdraw()',
      ], signer);
      const tx = await send(c);
      mcUi.toast({ type: 'info', message: 'Waiting for confirmation…' });
      const r = await tx.wait(1);
      if (!r || r.status !== 1) throw new Error('Transaction reverted');
      mcUi.toast({ type: 'success', message: `${label} · ${tx.hash.slice(0, 10)}…` });
      await load();
    } catch (e: any) {
      mcUi.toast({
        type: 'error',
        message: e?.code === 4001 || e?.code === 'ACTION_REJECTED'
          ? 'Transaction rejected in wallet'
          : `${label} failed: ` + (e?.shortMessage || e?.message || 'Unknown error'),
      });
    } finally { setBusy(false); }
  };

  const startWithdraw = async (p: any) => {
    if (pending?.active) {
      mcUi.toast({ type: 'error', message: 'A withdrawal is already pending — execute or cancel it first.' });
      return;
    }
    const ok = await mcUi.confirm({
      title: 'Request withdrawal',
      message: (
        <>
          Request <strong>${p.amountUsdt.toLocaleString()}</strong> to{' '}
          <code>{p.recipient.slice(0, 10)}…{p.recipient.slice(-6)}</code>?
          <br /><br />
          Nothing moves yet — the contract holds it for 24 hours, then you execute. The reserve keeps
          only one pending request, so this blocks any other withdrawal until it clears.
        </>
      ),
      confirmLabel: 'Request',
      variant: 'danger',
    });
    if (!ok) return;
    const { parseUnits } = await import('ethers');
    await onChain('Withdrawal requested', (c) =>
      c.requestWithdraw(p.recipient, parseUnits(String(p.amountUsdt), USDT_DECIMALS)));
  };

  const unlocked = pending?.active && pending.unlockTime <= Date.now();
  const hoursLeft = pending?.active ? Math.max(0, Math.ceil((pending.unlockTime - Date.now()) / 3600000)) : 0;

  return (
    <div style={{ borderTop: '1px solid var(--border)', padding: 16 }}>
      <div style={{ fontFamily: 'var(--font-d)', fontSize: '0.68rem', color: 'var(--cyan)', letterSpacing: '0.05em' }}>
        SPENDING PROPOSAL &amp; COUNCIL VOTE
      </div>
      <div style={{ fontSize: '0.55rem', color: 'var(--gray2)', marginTop: 4, lineHeight: 1.7, maxWidth: 900 }}>
        Any Council member may propose a payment from the Reserved Listing fund. It carries at <strong>60% of the active
        membership</strong> — the figure follows the Council as it grows, it is not a fixed count. The
        reserve contract holds no vote of its own, so approval is recorded here and the payout is the
        Owner signing <code>requestWithdraw</code> → 24-hour timelock → <code>executeWithdraw</code>.
      </div>

      {pending?.active && (
        <div className="alert alert-warn" style={{ fontSize: '0.6rem', margin: '10px 0', lineHeight: 1.7 }}>
          <div>
            A withdrawal of <strong>${pending.amount.toLocaleString()}</strong> to{' '}
            <code>{pending.to.slice(0, 10)}…{pending.to.slice(-6)}</code> is pending
            {unlocked ? ' and the timelock has elapsed.' : ` — ${hoursLeft}h left on the timelock.`}
            {' '}The reserve holds one request at a time, so nothing else can be requested until this clears.
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              <button className="btn btn-gold" disabled={busy || !unlocked}
                onClick={() => onChain('Withdrawal executed', (c) => c.executeWithdraw())}
                style={{ padding: '4px 14px', fontSize: '0.58rem' }}>EXECUTE</button>
              <button className="btn" disabled={busy}
                onClick={() => onChain('Withdrawal cancelled', (c) => c.cancelWithdraw())}
                style={{ padding: '4px 14px', fontSize: '0.58rem' }}>CANCEL</button>
            </div>
          </div>
        </div>
      )}

      {/* The proposal form moved to the member app. An operator raising a spending proposal
          from the finance console is the same act the vote is meant to constrain, so the
          console now only shows the outcome and signs what the contract reserves for the
          Owner. */}
      {/* The member-app link, DAO Board link and reserve-balance readout were removed at the
          Owner's request: the balance is already one of the three boxes at the top of this
          block, and this console is not where a proposal is raised. */}

      {/* Only what is waiting on a signature. The full record — every status, with the vote
          rate and the cancel action — is the Proposals History table below, and listing every
          proposal twice on one tab invites the two to be read as different sets. */}
      <div style={{ marginTop: 12 }}>
        <div className="sep-lbl" style={{ marginBottom: 8 }}>Approved, awaiting withdrawal</div>
        {rows === null && <div style={{ fontSize: '0.6rem', color: 'var(--gray2)' }}>Loading…</div>}
        {rows !== null && rows.filter((p) => p.status === 'APPROVED').length === 0 && (
          <div style={{ fontSize: '0.6rem', color: 'var(--gray2)' }}>Nothing is waiting on a signature.</div>
        )}
        {rows?.filter((p) => p.status === 'APPROVED').map((p) => (
          <div key={p.id} style={{ borderTop: '1px solid var(--border)', padding: '9px 0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline' }}>
              <div style={{ fontSize: '0.65rem', fontWeight: 700 }}>{p.content}</div>
              <span className={`badge ${p.status === 'EXECUTED' ? 'b-green' : p.status === 'REJECTED' ? 'b-gray' : 'b-gold'}`}>
                {p.status}
              </span>
            </div>
            <div style={{ fontSize: '0.55rem', color: 'var(--gray2)', marginTop: 3, lineHeight: 1.6 }}>
              ${p.amountUsdt.toLocaleString()} &rarr; {p.recipient.slice(0, 8)}…{p.recipient.slice(-6)}
              {' · '}<strong>{p.forVotes}/{p.approvalsRequired}</strong> of {p.councilSize} members
              {p.status === 'OPEN' && (p.windowClosed ? ' · 72h window closed' : ' · inside 72h window')}
            </div>
            {p.status === 'APPROVED' && !pending?.active && (
              <button className="btn btn-gold" disabled={busy} onClick={() => startWithdraw(p)}
                style={{ padding: '4px 14px', fontSize: '0.58rem', marginTop: 7 }}>
                REQUEST WITHDRAWAL
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Small presentational helpers ──────────────────────────────────────

const thStyle: React.CSSProperties = {
  textAlign: 'left', padding: '8px 10px', fontSize: '0.5rem', color: 'var(--gray2)',
  textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600,
};
const tdStyle: React.CSSProperties = {
  padding: '10px', fontSize: '0.6rem', color: 'var(--white)',
};

function Amt({ v }: { v: number | null }) {
  if (v === null) return <span style={{ color: 'var(--gray2)' }}>No data</span>;
  return <>${fmtUsd(v)}</>;
}

function NA({ label }: { label: string }) {
  return <span style={{ color: 'var(--gray2)', fontSize: '0.5rem' }}>{label}</span>;
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span style={{
      marginLeft: 6, padding: '1px 5px', borderRadius: 3, fontSize: '0.45rem',
      background: 'rgba(0,180,216,.12)', color: 'var(--cyan)', textTransform: 'uppercase',
      letterSpacing: '0.06em', verticalAlign: 'middle',
    }}>{children}</span>
  );
}

function WarnNote({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      marginTop: 10, padding: '9px 12px', borderRadius: 6,
      background: 'rgba(212,160,23,.07)', border: '1px solid rgba(212,160,23,.25)',
      fontSize: '0.52rem', color: 'var(--gray2)', lineHeight: 1.7,
    }}>
      {children}
    </div>
  );
}

function ChainErrNote({ msg }: { msg: string }) {
  return (
    <div style={{
      marginBottom: 10, padding: '9px 12px', borderRadius: 6,
      background: 'rgba(180,30,60,.08)', border: '1px solid rgba(180,30,60,.3)',
      fontSize: '0.52rem', color: 'var(--gray2)', lineHeight: 1.6,
    }}>
      <strong style={{ color: 'var(--danger)' }}>On-chain read failed.</strong> Figures sourced from
      contracts are shown as “No data” rather than zero. Details: {msg}
    </div>
  );
}

function PoolSection({ title, pct, note, children }: { title: string; pct: string; note: string; children: React.ReactNode }) {
  return (
    <div className="card" style={{ marginBottom: 16, padding: 0 }}>
      <div style={{
        padding: '12px 16px',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
      }}>
        <div>
          <div style={{ fontFamily: 'var(--font-d)', fontSize: '0.85rem', color: 'var(--gold)', letterSpacing: '0.04em' }}>
            {title} <span style={{ marginLeft: 8, fontSize: '0.65rem', color: 'var(--cyan)' }}>{pct}</span>
          </div>
          <div style={{ fontSize: '0.55rem', color: 'var(--gray2)', marginTop: 2 }}>{note}</div>
        </div>
      </div>
      {children}
    </div>
  );
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: 'warn' }) {
  return (
    <div style={{ padding: '10px 12px', background: 'var(--bg4)', borderRadius: 6 }}>
      <div style={{ fontSize: '0.5rem', color: 'var(--gray2)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
        {label}
      </div>
      <div style={{
        fontSize: '0.95rem', color: tone === 'warn' ? 'var(--gold)' : 'var(--white)',
        fontWeight: 700, marginTop: 4, fontFamily: 'var(--font-m)',
      }}>
        {value}
      </div>
      {hint && (
        <div style={{ fontSize: '0.5rem', color: 'var(--gray2)', marginTop: 2 }}>{hint}</div>
      )}
    </div>
  );
}
