'use client';

import SectionHead from '@/components/ui/SectionHead';
import StatCard from '@/components/ui/StatCard';
import DataTable from '@/components/ui/DataTable';
import Badge from '@/components/ui/Badge';

const pools = [
  { pool: 'Miners (MICE)', allocation: '60%', totalMIC: '3,570,000,000', emitted: '124M', active: '18,420', apr: '~284%' },
  { pool: 'NFT Staking (Merged)', allocation: '20%', totalMIC: '1,190,000,000', emitted: '41M', active: '4,847', apr: '~142%' },
  { pool: 'DAO Treasure', allocation: '15%', totalMIC: '892,500,000', emitted: '31M', active: '—', apr: '—' },
  { pool: 'Buyback & Burn', allocation: '5%', totalMIC: '297,500,000', emitted: '10M', active: '—', apr: '—' },
];

const poolColumns = [
  { key: 'pool', label: 'Pool' },
  { key: 'allocation', label: 'Allocation', className: 'td-gold' },
  { key: 'totalMIC', label: 'Total MIC', className: 'td-mono' },
  { key: 'emitted', label: 'Emitted', className: 'td-gold' },
  { key: 'active', label: 'Active Users' },
  { key: 'apr', label: 'Est. APR', className: 'td-gold' },
];

const nftTiers = [
  { tier: 'MFP-NFT', multiplier: '×10', stakingCap: '1,000,000 MIC', stakers: '142', totalStaked: '89M MIC' },
  { tier: 'Platinum', multiplier: '×5', stakingCap: '500,000 MIC', stakers: '384', totalStaked: '67M MIC' },
  { tier: 'Gold', multiplier: '×2.5', stakingCap: '250,000 MIC', stakers: '1,247', totalStaked: '84M MIC' },
  { tier: 'Silver', multiplier: '×1', stakingCap: '100,000 MIC', stakers: '2,108', totalStaked: '32M MIC' },
  { tier: 'No-NFT', multiplier: '×0.5', stakingCap: '50,000 MIC', stakers: '966', totalStaked: '12M MIC' },
];

const tierColumns = [
  { key: 'tier', label: 'Tier', render: (v: string) => <Badge variant="gold">{v}</Badge> },
  { key: 'multiplier', label: 'Multiplier', className: 'td-gold' },
  { key: 'stakingCap', label: 'Staking Cap', className: 'td-mono' },
  { key: 'stakers', label: 'Stakers' },
  { key: 'totalStaked', label: 'Total Staked', className: 'td-gold' },
];

export default function MiningPage() {
  return (
    <>
      <SectionHead title="Mining & Staking Overview" />
      <div className="stat-grid">
        <StatCard label="Daily Emission" value="22.9M MIC" sub="E₀ base rate" color="gold" />
        <StatCard label="Total Emitted" value="206M" sub="of 5.95B pool" color="green" />
        <StatCard label="Active Miners" value="18,420" sub="MICE holders" color="purple" />
        <StatCard label="Total Staked" value="284M MIC" sub="All tiers" color="cyan" />
      </div>

      <div style={{ background: 'rgba(201,168,76,0.05)', border: '1px solid rgba(201,168,76,0.15)', borderRadius: '8px', padding: '16px', margin: '0 0 20px 0' }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '13px', color: 'var(--gold)', textAlign: 'center' }}>
          E(t) = E_base(t) × D(t) × R(t) &nbsp;&nbsp;|&nbsp;&nbsp; E₀ ≈ 22,907,500 MIC/day &nbsp;&nbsp;|&nbsp;&nbsp; T_half = 180 days
        </div>
      </div>

      <SectionHead title="Emission Pools" />
      <DataTable columns={poolColumns} data={pools} />

      <SectionHead title="NFT Staking Tiers" />
      <DataTable columns={tierColumns} data={nftTiers} />
    </>
  );
}
