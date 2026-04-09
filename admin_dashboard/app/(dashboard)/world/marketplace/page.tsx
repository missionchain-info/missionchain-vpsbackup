'use client';

import SectionHead from '@/components/ui/SectionHead';
import StatCard from '@/components/ui/StatCard';
import DataTable from '@/components/ui/DataTable';
import Badge from '@/components/ui/Badge';

const listings = [
  { item: '🎵 Light of the World — SOPHIA', type: 'Music NFT', price: '500 MIC', seller: 'SOPHIA', status: 'Active', listed: 'Mar 28, 2026' },
  { item: '🎨 Genesis Collection #42', type: 'Art NFT', price: '1,200 MIC', seller: 'john.eth', status: 'Active', listed: 'Mar 25, 2026' },
  { item: '📖 Scripture Study Pack', type: 'Digital Content', price: '100 MIC', seller: 'paul.bnb', status: 'Under Review', listed: 'Mar 30, 2026' },
  { item: '🎬 Faith Stories Vol.1', type: 'Video NFT', price: '800 MIC', seller: 'maria.sol', status: 'Active', listed: 'Mar 20, 2026' },
  { item: '✝️ Cross Pendant Design', type: 'Art NFT', price: '300 MIC', seller: 'carol.bnb', status: 'Flagged', listed: 'Mar 29, 2026' },
];

const columns = [
  { key: 'item', label: 'Item' },
  { key: 'type', label: 'Type', render: (v: string) => <Badge variant="teal">{v}</Badge> },
  { key: 'price', label: 'Price', className: 'td-gold' },
  { key: 'seller', label: 'Seller' },
  { key: 'status', label: 'Status', render: (v: string) => {
    const map: Record<string, 'active' | 'pending' | 'draft'> = { Active: 'active', 'Under Review': 'pending', Flagged: 'draft' };
    return <Badge variant={map[v] || 'draft'}>{v}</Badge>;
  }},
  { key: 'listed', label: 'Listed' },
  { key: 'action', label: 'Action', render: () => <button className="btn btn-outline btn-sm">Review</button> },
];

export default function MarketplacePage() {
  return (
    <>
      <SectionHead title="Marketplace Management" />
      <div className="stat-grid">
        <StatCard label="Active Listings" value="147" sub="On marketplace" color="green" />
        <StatCard label="Total Volume" value="284K MIC" sub="All time" color="gold" />
        <StatCard label="Under Review" value="12" sub="Pending approval" color="orange" />
        <StatCard label="Flagged" value="3" sub="Need attention" color="red" />
      </div>
      <DataTable columns={columns} data={listings} searchPlaceholder="Search listings..." />
    </>
  );
}
