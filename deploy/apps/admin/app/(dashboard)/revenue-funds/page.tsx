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
  { slot: 1, label: 'Operational Activities',   pct: 20, note: 'Steward Council salaries via OperationalSalaryPoolV3 — % share + weekly maxout' },
  { slot: 2, label: 'Management Bonus',         pct: 10, note: 'Council-created bonus orders via ManagementBonusPoolV3, 75% approval threshold' },
  { slot: 3, label: 'Reserved',                 pct: 50, note: 'DAO-decided expenses via ReservedExpensesPoolV3 — no UI wired yet' },
] as const;

function SeedSaleTab() {
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
    </>
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
  { key: 'staking',    label: 'Reserved Staking',  pct: 5,    bpsKey: 'staking',    note: 'ListingReserve — locked USDT, withdrawal is request → 24h timelock → execute' },
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

function FundsManagementTab({ isOwner }: { isOwner: boolean }) {
  const { funds, chainErr } = useChainFunds();
  const presale = useSaleInfo('/sales/presale/info');
  const mice = useSaleInfo('/sales/mice/info');

  const presaleRaised = presale.info ? Number(presale.info.totalRaisedUsdt ?? 0) : null;
  const miceSold = mice.info ? Number(mice.info.totalSold ?? 0) : 0;
  const miceRevenueRaw = mice.info ? Number(mice.info.totalRevenueUsdt ?? 0) : null;
  const miceBroken = miceSold > 0 && miceRevenueRaw === 0;
  const miceRevenue = miceBroken ? null : miceRevenueRaw;

  const routerBps = funds?.routerBps ?? null;

  return (
    <>
      <div className="card" style={{ marginBottom: 16, padding: '12px 16px' }}>
        <div style={{ fontSize: '0.55rem', color: 'var(--gray2)', lineHeight: 1.7 }}>
          <strong style={{ color: 'var(--gold)' }}>How to read this tab.</strong>{' '}
          <strong>Total Accumulated</strong> is a pool&apos;s lifetime on-chain receipts.{' '}
          <strong>Balance</strong> is its live USDT balance.{' '}
          <strong>Spent</strong> is exact where the contract tracks releases (SEED slots) and{' '}
          <em>derived as accumulated − balance</em> where it does not (ManagementPool,
          TreasuryManager, ListingReserve have no spend counter). Every per-source row states its
          own origin. Rows with no working data source say so instead of showing $0.00.
        </div>
        {chainErr && <ChainErrNote msg={chainErr} />}
      </div>

      {/* ─── Management & Ops ─────────────────────────────────────────── */}
      <FundBlock
        title="Management & Ops"
        subtitle="Salaries and management bonus. Two independent systems: SEED revenue funds the Steward Council salary pool; Pre-Sale and MICE revenue funds the six-role ManagementPool."
        sources={[
          {
            label: 'SEED SALE — Operational',
            pct: '20%',
            accumulated: funds?.seedSlots[1]?.received ?? null,
            spent: funds?.seedSlots[1]?.released ?? null,
            balance: funds?.seedSlots[1]?.balance ?? null,
            spentExact: true,
            origin: 'SeedBudgetV5c slot 1 — BPS_OPERATIONAL = 2000, a contract constant',
          },
          {
            label: 'SEED SALE — Management Bonus',
            pct: '10%',
            accumulated: funds?.seedSlots[2]?.received ?? null,
            spent: funds?.seedSlots[2]?.released ?? null,
            balance: funds?.seedSlots[2]?.balance ?? null,
            spentExact: true,
            origin: 'SeedBudgetV5c slot 2 — BPS_MGMT_BONUS = 1000, a contract constant',
          },
          {
            label: 'PRE-SALE',
            pct: routerBps ? `${routerBps.management}%` : '7.5%',
            accumulated: presaleRaised === null || !routerBps
              ? null
              : (presaleRaised * routerBps.management) / 100,
            spent: null,
            balance: null,
            derived: true,
            origin: 'Derived: /sales/presale/info totalRaisedUsdt x RevenueRouter.bpsManagement. Pre-Sale and MICE share one ManagementPool, so the chain cannot attribute receipts to either sale.',
          },
          {
            label: 'MICE SALE',
            pct: routerBps ? `${routerBps.management}%` : '7.5%',
            accumulated: miceRevenue === null || !routerBps
              ? null
              : (miceRevenue * routerBps.management) / 100,
            spent: null,
            balance: null,
            derived: true,
            noData: miceBroken ? 'MICE revenue is not recorded by the indexer (see MICE Sale tab), so this share cannot be computed.' : undefined,
            origin: 'Derived: /sales/mice/info totalRevenueUsdt x RevenueRouter.bpsManagement.',
          },
        ]}
        poolTotals={{
          label: 'ManagementPool (Pre-Sale + MICE combined, on-chain)',
          accumulated: funds?.mgmtReceived ?? null,
          balance: funds?.mgmtBalance ?? null,
          address: ADDR.managementPool,
        }}
        seedSlotIdx={[1, 2]}
        funds={funds}
      >
        <OperationalPoolPanel isOwner={isOwner} />
      </FundBlock>

      {/* ─── DAO Treasury ─────────────────────────────────────────────── */}
      <FundBlock
        title="DAO Treasury"
        subtitle="Protocol treasury funded by Pre-Sale and MICE. Split internally into World Dev 20% / App & Add-ons 40% / Reserved 40%."
        sources={[
          {
            label: 'SEED SALE',
            pct: '0%',
            accumulated: null,
            spent: null,
            balance: null,
            noData: 'SeedBudgetV5c has no DAO Treasury slot. SEED revenue splits only into Distribution 20% / Operational 20% / Management Bonus 10% / Reserved 50%. The SEED Reserved 50% slot is shown under Reserved Staking below, because it is a separate contract with its own approval flow.',
            origin: 'Verified against SeedBudgetV5c — only four slots exist.',
          },
          {
            label: 'PRE-SALE',
            pct: routerBps ? `${routerBps.treasury}%` : '12.5%',
            accumulated: presaleRaised === null || !routerBps
              ? null
              : (presaleRaised * routerBps.treasury) / 100,
            spent: null,
            balance: null,
            derived: true,
            origin: 'Derived: /sales/presale/info totalRaisedUsdt x RevenueRouter.bpsTreasury. TreasuryManager receipts cannot be attributed per sale on-chain.',
          },
          {
            label: 'MICE SALE',
            pct: routerBps ? `${routerBps.treasury}%` : '12.5%',
            accumulated: miceRevenue === null || !routerBps
              ? null
              : (miceRevenue * routerBps.treasury) / 100,
            spent: null,
            balance: null,
            derived: true,
            noData: miceBroken ? 'MICE revenue is not recorded by the indexer (see MICE Sale tab), so this share cannot be computed.' : undefined,
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
        <GovernancePanel pool="DAO Treasury" />
      </FundBlock>

      {/* ─── Reserved Staking ─────────────────────────────────────────── */}
      <FundBlock
        title="Reserved Staking"
        subtitle="Locked USDT reserve funded by Pre-Sale and MICE. Withdrawals are request → 24h timelock → execute."
        sources={[
          {
            label: 'SEED SALE — Reserved',
            pct: '50%',
            accumulated: funds?.seedSlots[3]?.received ?? null,
            spent: funds?.seedSlots[3]?.released ?? null,
            balance: funds?.seedSlots[3]?.balance ?? null,
            spentExact: true,
            origin: 'SeedBudgetV5c slot 3 — BPS_RESERVED = 5000, a contract constant. This is a DAO-decided expense reserve held by ReservedExpensesPoolV3, NOT a staking reserve; it is grouped here because it is the only remaining SEED slot.',
          },
          {
            label: 'PRE-SALE',
            pct: routerBps ? `${routerBps.staking}%` : '5%',
            accumulated: presaleRaised === null || !routerBps
              ? null
              : (presaleRaised * routerBps.staking) / 100,
            spent: null,
            balance: null,
            derived: true,
            origin: 'Derived: /sales/presale/info totalRaisedUsdt x RevenueRouter.bpsStaking.',
          },
          {
            label: 'MICE SALE',
            pct: routerBps ? `${routerBps.staking}%` : '5%',
            accumulated: miceRevenue === null || !routerBps
              ? null
              : (miceRevenue * routerBps.staking) / 100,
            spent: null,
            balance: null,
            derived: true,
            noData: miceBroken ? 'MICE revenue is not recorded by the indexer (see MICE Sale tab), so this share cannot be computed.' : undefined,
            origin: 'Derived: /sales/mice/info totalRevenueUsdt x RevenueRouter.bpsStaking.',
          },
        ]}
        poolTotals={{
          label: 'ListingReserve (Pre-Sale + MICE combined, on-chain)',
          accumulated: funds?.listingReceived ?? null,
          balance: funds?.listingBalance ?? null,
          address: ADDR.listingReserve,
        }}
        seedSlotIdx={[3]}
        funds={funds}
      >
        <GovernancePanel pool="Reserved Staking" />
      </FundBlock>

      {/* ─── Liquidity ────────────────────────────────────────────────── */}
      <PoolSection
        title="Liquidity"
        pct={routerBps ? `${routerBps.liquidity}% of Pre-Sale + MICE gross` : '40% of Pre-Sale + MICE gross'}
        note="Renamed from “Liquidity & Buffer”. Not a managed fund — it is forwarded automatically by RevenueRouter on every purchase and is not spent by any council or DAO process."
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

function FundBlock({
  title, subtitle, sources, poolTotals, seedSlotIdx, funds, children,
}: {
  title: string;
  subtitle: string;
  sources: FundSource[];
  poolTotals: { label: string; accumulated: number | null; balance: number | null; address: string };
  seedSlotIdx: number[];
  funds: ChainFunds | null;
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

  const totalAcc = sum([...seedAcc, poolTotals.accumulated]);
  const poolSpent = poolTotals.accumulated === null || poolTotals.balance === null
    ? null
    : Math.max(0, poolTotals.accumulated - poolTotals.balance);
  const totalSpent = sum([...seedSpent, poolSpent]);
  const totalBal = sum([...seedBal, poolTotals.balance]);

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
          label="Total Accumulated"
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

      {/* Per-source breakdown */}
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
          </tbody>
        </table>
      </div>

      {children}
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
      setLoadErr(err?.message || 'Failed to read OperationalSalaryPoolV3 on-chain');
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
    <div style={{ borderTop: '1px solid var(--border)' }}>
      <div style={{ padding: '12px 16px 0' }}>
        <div style={{ fontFamily: 'var(--font-d)', fontSize: '0.68rem', color: 'var(--cyan)', letterSpacing: '0.05em' }}>
          ALLOCATION — STEWARD COUNCIL SALARIES
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

function GovernancePanel({ pool }: { pool: string }) {
  return (
    <div style={{ borderTop: '1px solid var(--border)', padding: 16 }}>
      <div style={{ fontFamily: 'var(--font-d)', fontSize: '0.68rem', color: 'var(--cyan)', letterSpacing: '0.05em' }}>
        SPENDING PROPOSAL &amp; DAO VOTE
      </div>
      <div style={{ fontSize: '0.5rem', color: 'var(--gray2)', marginTop: 4, lineHeight: 1.7, maxWidth: 900 }}>
        Spending from {pool} is meant to run through <code>DAOGovernor</code> (mainnet
        0xDCD65DC97b0A147BeCf542E22a5C218C006231cC) using the <code>BUDGET</code> timelock category:
        propose → 3-of-5 Steward Council approvals → 24h timelock → execute.
      </div>

      <div style={{ display: 'flex', gap: 10, marginTop: 12, alignItems: 'center' }}>
        <button
          className="btn btn-gold btn-sm"
          style={{ fontSize: SZ, opacity: 0.4, cursor: 'not-allowed' }}
          disabled
        >
          + NEW SPENDING PROPOSAL
        </button>
        <Link href="/dao" style={{ color: 'var(--gold)', fontSize: SZ }}>DAO Board ↗</Link>
      </div>

      <WarnNote>
        Disabled on purpose — this is not a placeholder for a working feature. DAOGovernor is
        deployed but <strong>no API route or UI anywhere in this codebase calls</strong>{' '}
        <code>propose()</code>, <code>approve()</code> or <code>execute()</code>, and the contract&apos;s
        <code> daoActive</code> flag still gates Phase 1 to Owner mode. The existing{' '}
        <Link href="/dao" style={{ color: 'var(--gold)' }}>/dao</Link> page is a board-member
        directory only — it has no proposal or voting flow to link into. Wiring required before this
        button can do anything: an admin route that reads <code>getProposal</code>/
        <code>proposalCount</code> and submits <code>propose</code> with a BUDGET-category calldata
        payload targeting the pool contract.
      </WarnNote>
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
