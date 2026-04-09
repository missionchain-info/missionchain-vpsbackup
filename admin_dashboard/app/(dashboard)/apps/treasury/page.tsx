'use client';

import SectionHead from '@/components/ui/SectionHead';
import StatCard from '@/components/ui/StatCard';
import DataTable from '@/components/ui/DataTable';
import Badge from '@/components/ui/Badge';

const transactions = [
  { date: 'Mar 30, 2026', type: 'Withdrawal', amount: '$50,000', currency: 'USDT', reason: 'Marketing Campaign', approved: 'SA', status: 'Complete' },
  { date: 'Mar 29, 2026', type: 'Deposit', amount: '$32,500', currency: 'USDT', reason: 'Pre-Sale Revenue', approved: 'Protocol', status: 'Complete' },
  { date: 'Mar 28, 2026', type: 'Withdrawal', amount: '10 BNB', currency: 'BNB', reason: 'Gas & Ops', approved: 'SA', status: 'Pending' },
  { date: 'Mar 27, 2026', type: 'Deposit', amount: '$18,200', currency: 'USDT', reason: 'MICE License Sales', approved: 'Protocol', status: 'Complete' },
  { date: 'Mar 26, 2026', type: 'Buyback', amount: '2.5M MIC', currency: 'MIC', reason: 'Scheduled Buyback & Burn', approved: 'SA', status: 'Complete' },
];

const columns = [
  { key: 'date', label: 'Date' },
  { key: 'type', label: 'Type', render: (v: string) => {
    const map: Record<string, 'active' | 'pending' | 'gold' | 'purple'> = { Deposit: 'active', Withdrawal: 'pending', Buyback: 'gold' };
    return <Badge variant={map[v] || 'draft'}>{v}</Badge>;
  }},
  { key: 'amount', label: 'Amount', className: 'td-gold' },
  { key: 'currency', label: 'Currency' },
  { key: 'reason', label: 'Reason' },
  { key: 'approved', label: 'Approved By' },
  { key: 'status', label: 'Status', render: (v: string) => <Badge variant={v === 'Complete' ? 'active' : 'pending'}>{v}</Badge> },
];

export default function TreasuryPage() {
  return (
    <>
      <SectionHead title="Treasury Management" />
      <div className="stat-grid">
        <StatCard label="USDT Balance" value="$482K" sub="Gnosis Safe 3-of-5" color="gold" />
        <StatCard label="BNB Balance" value="124.8 BNB" sub="Operations wallet" color="cyan" />
        <StatCard label="MIC Reserve" value="142M" sub="Buyback reserve" color="purple" />
      </div>

      <div className="banner banner-info">🏦 Treasury secured by Gnosis Safe 3-of-5 multisig. Revenue split: 50% Treasury / 30% Liquidity / 20% Buyback & Burn.</div>
      <SectionHead title="Recent Transactions" />
      <DataTable columns={columns} data={transactions} />
    </>
  );
}
