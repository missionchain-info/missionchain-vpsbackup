'use client';

import SectionHead from '@/components/ui/SectionHead';
import StatCard from '@/components/ui/StatCard';
import DataTable from '@/components/ui/DataTable';
import Badge from '@/components/ui/Badge';

const nfts = [
  { collection: 'MFP-NFT (Governance)', standard: 'ERC-721', minted: '500', holders: '142', floor: '2,500 MIC', volume: '1.2M MIC' },
  { collection: 'MICE License', standard: 'ERC-1155', minted: '18,420', holders: '18,420', floor: '$300', volume: '$6.8M' },
  { collection: 'SOPHIA Genesis', standard: 'ERC-721', minted: '1,000', holders: '847', floor: '500 MIC', volume: '284K MIC' },
  { collection: 'Challenge Rewards', standard: 'ERC-1155', minted: '4,200', holders: '3,100', floor: '100 MIC', volume: '42K MIC' },
];

const columns = [
  { key: 'collection', label: 'Collection' },
  { key: 'standard', label: 'Standard', render: (v: string) => <Badge variant="teal">{v}</Badge> },
  { key: 'minted', label: 'Minted', className: 'td-gold' },
  { key: 'holders', label: 'Holders' },
  { key: 'floor', label: 'Floor Price', className: 'td-gold' },
  { key: 'volume', label: 'Total Volume', className: 'td-gold' },
  { key: 'action', label: 'Action', render: () => <button className="btn btn-outline btn-sm">Manage</button> },
];

const tiers = [
  { tier: 'MFP-NFT', multiplier: '×10', cap: '1,000,000 MIC', benefit: 'Full governance voting rights + max staking' },
  { tier: 'Platinum', multiplier: '×5', cap: '500,000 MIC', benefit: 'Enhanced staking + priority access' },
  { tier: 'Gold', multiplier: '×2.5', cap: '250,000 MIC', benefit: 'Standard staking bonus' },
  { tier: 'Silver', multiplier: '×1', cap: '100,000 MIC', benefit: 'Base staking rate' },
];

const tierColumns = [
  { key: 'tier', label: 'Tier', render: (v: string) => <Badge variant="gold">{v}</Badge> },
  { key: 'multiplier', label: 'Multiplier', className: 'td-gold' },
  { key: 'cap', label: 'Staking Cap', className: 'td-mono' },
  { key: 'benefit', label: 'Benefits' },
];

export default function NftPage() {
  return (
    <>
      <SectionHead title="NFT Management" action={<button className="btn btn-primary btn-sm">+ Mint New</button>} />
      <div className="stat-grid">
        <StatCard label="Total Collections" value="4" sub="On BSC Testnet" color="gold" />
        <StatCard label="Total Minted" value="24,120" sub="All collections" color="green" />
        <StatCard label="Unique Holders" value="19,842" sub="Distinct wallets" color="purple" />
        <StatCard label="MFP-NFT Holders" value="142" sub="Governance members" color="cyan" />
      </div>

      <SectionHead title="NFT Collections" />
      <DataTable columns={columns} data={nfts} />

      <SectionHead title="Staking Tier Benefits" />
      <DataTable columns={tierColumns} data={tiers} />
    </>
  );
}
