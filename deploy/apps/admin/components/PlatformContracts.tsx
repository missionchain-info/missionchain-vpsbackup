'use client';

import { getActiveAddresses, getActiveChain } from '@missionchain/sdk';

/**
 * Every Mission Chain contract on mainnet, read from the SDK.
 *
 * This panel used to show four hand-typed strings — `0x9B7f…4E2A`, `0x3C1a…B72D` and two
 * more — that matched nothing on chain. They were placeholders nobody replaced, sitting
 * on the page that people open specifically to look up an address.
 *
 * Nothing here is written by hand. `getActiveAddresses()` is the same source the DApp and
 * the API read, so a deploy that updates `packages/sdk/src/addresses.ts` updates this
 * screen with it, and an address that has not been deployed shows as "not deployed"
 * rather than as a plausible-looking lie.
 */

const A = getActiveAddresses() as Record<string, string>;
const CHAIN = getActiveChain();
const ZERO = '0x0000000000000000000000000000000000000000';

type Row = { label: string; key: string; note?: string; warn?: boolean };
type Group = { title: string; rows: Row[] };

const GROUPS: Group[] = [
  {
    title: 'Token & Vesting',
    rows: [
      { label: 'MIC Token', key: 'MICToken', note: 'ERC-20, 18 decimals' },
      { label: 'LockManager', key: 'LockManager', note: 'Vesting locks held at the holder’s own wallet' },
      { label: 'USDT (BSC-USD)', key: 'USDT', note: '18 decimals — not the 6-decimal Ethereum USDT' },
    ],
  },
  {
    title: 'Sales',
    rows: [
      { label: 'Pre-Sale', key: 'PreSale', note: '$0.005 / MIC · 315,000,000 allocated' },
      { label: 'SEED Sale (V9)', key: 'SeedSaleV9', note: '$0.0025 / MIC · whitelist enforced' },
      { label: 'SEED Budget (V5c)', key: 'SeedBudgetV5c', note: '4-slot split of SEED revenue' },
      { label: 'MICE License', key: 'MICELicense' },
    ],
  },
  {
    title: 'Revenue routing',
    rows: [
      { label: 'RevenueRouter', key: 'RevenueRouter', note: 'Splits gross six ways' },
      { label: 'ReferralRegistry', key: 'ReferralRegistry', note: 'F1 7% + F2 3%, paid on purchase' },
      { label: 'RewardDistributorV2', key: 'RewardDistributorV2', note: 'Splits the 25% marketing slice' },
      { label: 'TreasuryManager', key: 'TreasuryManager', note: 'DAO Treasury 12.5%, USDT only' },
      { label: 'ManagementPool', key: 'ManagementPool', note: '7.5% · six roles claim their own share' },
      { label: 'ListingReserve', key: 'ListingReserve', note: '5% · two-step withdrawal, 24h timelock' },
      { label: 'LiquidityPool (revenue holder)', key: 'LiquidityPool', note: '40% of gross lands here · admin moves it into the AMM pool' },
      { label: 'LiquidityPoolV6 (live AMM)', key: 'LiquidityPoolV6', note: 'The SWAP pool · seeded · virtual reserve, 7-day TWAP, 30-day sell gate · no withdrawal path' },
    ],
  },
  {
    title: 'Rewards',
    rows: [
      { label: 'ClaimRewardsV2', key: 'ClaimRewardsV2', note: 'Community Growth Award + Milestones' },
      { label: 'NFT Reward Pool — Weekly', key: 'NFTRewardPoolWeekly', note: '5.5% of gross' },
      { label: 'NFT Reward Pool — Monthly', key: 'NFTRewardPoolMonthly', note: '8% of gross' },
      { label: 'LuckyDraw', key: 'LuckyDraw', note: '1% · commit-reveal, 18 prizes, $5,000 cap' },
      { label: 'Community NFT Reward Pool', key: 'CommunityNFTRewardPool', note: 'Weight comes from enrol, not from mint' },
      { label: 'MFP Reward Pool', key: 'MFPRewardPool', note: 'Same enrol-based weighting as the Community pool' },
    ],
  },
  {
    title: 'NFTs & Marketplace',
    rows: [
      { label: 'MFP-NFT', key: 'MFPNFT', note: 'ERC-721 · cap 2,500' },
      { label: 'Community NFT (v2)', key: 'CommunityNFTv2', note: 'ERC-721, unique serial, on-chain SVG' },
      { label: 'P2P Escrow (MIC)', key: 'P2PEscrowMIC', note: 'MIC ⇄ USDT between members · 2.5% fee, paid by the seller' },
      { label: 'P2P Escrow (MFP-NFT)', key: 'P2PEscrowNFT_MFP', note: 'P2PEscrowNFT · $1–$1,000,000, adjustable · 5% ERC-2981 royalty' },
      { label: 'P2P Escrow (Community NFT)', key: 'P2PEscrowNFT_Community', note: 'P2PEscrowNFT · no royalty — CommunityNFTv2 has no ERC-2981' },
      { label: 'Rank Bonus Claim', key: 'RankBonusClaim', note: 'Members mint their own rank NFTs' },
      { label: 'P2P Escrow (MFP, retired)', key: 'P2PEscrowMFP', note: 'DEAD — $0.000001 ceiling is a constant; never took an order', warn: true },
    ],
  },
  {
    title: 'Governance & Vaults',
    rows: [
      { label: 'DAO Governor', key: 'DAOGovernor', note: '3 of 5 by head · timelock runs from proposal creation' },
      { label: 'Steward Council', key: 'StewardCouncil' },
      { label: 'Operational Salary Pool V3', key: 'OperationalSalaryPoolV3' },
      { label: 'Management Bonus Pool V3', key: 'ManagementBonusPoolV3', note: 'Threshold 6000 bps = 3 of 5' },
      { label: 'Reserved Expenses Pool V3', key: 'ReservedExpensesPoolV3', note: 'Threshold 6000 bps = 3 of 5' },
      { label: 'Founders Vault', key: 'FoundersVault' },
      { label: 'Listing Reserve Vault', key: 'ListingReserveVault', note: '7-day withdrawal cooldown' },
      { label: 'Airdrop Distributor', key: 'AirdropDistributor' },
    ],
  },
  {
    title: 'Mining & Staking',
    rows: [
      { label: 'EmissionController', key: 'EmissionController' },
      { label: 'MiningPool', key: 'MiningPool' },
      { label: 'MIC Staking', key: 'NFTStaking', note: 'Filename is legacy — pure MIC staking' },
    ],
  },
  {
    title: 'Retired — do not link or reactivate',
    rows: [
      { label: 'SeedSaleV7', key: 'SeedSaleV7', note: 'Halted 2026-08-08 — 6-decimal prices sold 4,000,000 MIC for $0.00000001', warn: true },
      { label: 'SeedSaleV8', key: 'SeedSaleV8', note: 'Never activated — shipped without the whitelist. Empty', warn: true },
      { label: 'LiquidityPoolV5', key: 'LiquidityPoolV5', note: 'No withdrawal path — its 31,500,000 MIC was burned 2026-08-05', warn: true },
      { label: 'SeedSaleV6', key: 'SeedSaleV6', note: 'Superseded by V9', warn: true },
      { label: 'Community NFT (v1, ERC-1155)', key: 'CommunityNFT', note: 'Superseded by CommunityNFTv2 (ERC-721). Reading balances here returns nothing useful', warn: true },
      { label: 'SeedBudgetV5b', key: 'SeedBudgetV5b', note: 'Superseded by V5c', warn: true },
      { label: 'Operational Salary Pool V2', key: 'OperationalSalaryPoolV2', note: 'Superseded by V3', warn: true },
      { label: 'Management Bonus Pool V2', key: 'ManagementBonusPoolV2', note: 'Superseded by V3', warn: true },
      { label: 'Reserved Expenses Pool V2', key: 'ReservedExpensesPoolV2', note: 'Superseded by V3', warn: true },
    ],
  },
];

const short = (a: string) => `${a.slice(0, 8)}…${a.slice(-6)}`;

function AddressRow({ row }: { row: Row }) {
  const addr = A[row.key];
  const live = Boolean(addr) && addr !== ZERO;

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(150px, 1.1fr) minmax(0, 1.4fr)',
        gap: 12,
        alignItems: 'baseline',
        padding: '9px 0',
        borderBottom: '1px solid var(--border)',
      }}
    >
      <div>
        <div style={{ fontSize: '0.68rem', color: row.warn ? 'var(--warning)' : 'var(--white)' }}>
          {row.warn && '⚠ '}{row.label}
        </div>
        {row.note && (
          <div style={{ fontSize: '0.58rem', color: 'var(--gray2)', lineHeight: 1.5, marginTop: 2 }}>
            {row.note}
          </div>
        )}
      </div>

      {live ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <a
            href={`${CHAIN.explorerUrl}/address/${addr}`}
            target="_blank"
            rel="noopener noreferrer"
            title={addr}
            style={{
              fontFamily: 'var(--font-m)', fontSize: '0.64rem',
              color: 'var(--gold)', textDecoration: 'none', borderBottom: '1px dotted currentColor',
            }}
          >
            {short(addr)} ↗
          </a>
          <button
            onClick={() => navigator.clipboard?.writeText(addr)}
            title="Copy the full address"
            style={{
              background: 'none', border: '1px solid var(--border)', borderRadius: 4,
              color: 'var(--gray2)', cursor: 'pointer', fontSize: '0.55rem', padding: '1px 6px',
            }}
          >
            copy
          </button>
        </div>
      ) : (
        <span style={{ fontSize: '0.62rem', color: 'var(--gray2)', fontStyle: 'italic' }}>
          not deployed
        </span>
      )}
    </div>
  );
}

export default function PlatformContracts({ version }: { version?: string }) {
  const liveCount = GROUPS.flatMap(g => g.rows).filter(r => A[r.key] && A[r.key] !== ZERO).length;

  return (
    <div className="card card-p">
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <div className="card-title" style={{ margin: 0 }}>Platform Information</div>
        <span className="badge b-active" style={{ fontSize: '0.5rem' }}>{CHAIN.name}</span>
        <span style={{ marginLeft: 'auto', fontSize: '0.58rem', color: 'var(--gray2)' }}>
          {liveCount} contracts live · chain {CHAIN.chainId}
        </span>
      </div>

      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', margin: '10px 0 4px' }}>
        <div>
          <div className="info-key">VERSION</div>
          <div className="info-val">{version || 'v1.0.0'}</div>
        </div>
        <div>
          <div className="info-key">EXPLORER</div>
          <div className="info-val">
            <a href={CHAIN.explorerUrl} target="_blank" rel="noopener noreferrer"
               style={{ color: 'var(--gold)', textDecoration: 'none' }}>
              {CHAIN.explorerUrl.replace('https://', '')} ↗
            </a>
          </div>
        </div>
      </div>

      <p style={{ fontSize: '0.58rem', color: 'var(--gray2)', lineHeight: 1.6, margin: '6px 0 12px' }}>
        Read from <code>@missionchain/sdk</code> — the same list the DApp and the API use.
        Nothing on this screen is typed by hand, so a deploy updates it automatically.
      </p>

      {GROUPS.map((g) => (
        <div key={g.title} style={{ marginTop: 14 }}>
          <div style={{
            fontSize: '0.55rem', letterSpacing: '.12em', textTransform: 'uppercase',
            color: 'var(--gray2)', marginBottom: 2,
          }}>
            {g.title}
          </div>
          {g.rows.map((r) => <AddressRow key={r.key} row={r} />)}
        </div>
      ))}
    </div>
  );
}
