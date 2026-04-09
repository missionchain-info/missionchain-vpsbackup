'use client';

import { useState } from 'react';
import SectionHead from '@/components/ui/SectionHead';
import StatCard from '@/components/ui/StatCard';
import DataTable from '@/components/ui/DataTable';

const topReferrers = [
  { rank: '#1', wallet: '0x8F3a...4c2D', f1: '47', f1f2: '128', commission: '$28,400', volume: '$847,000' },
  { rank: '#2', wallet: '0x2A4b...8E1F', f1: '34', f1f2: '91', commission: '$19,200', volume: '$642,000' },
  { rank: '#3', wallet: '0x7D2c...5B3E', f1: '28', f1f2: '76', commission: '$16,800', volume: '$520,000' },
  { rank: '#4', wallet: '0x9C1d...3A7F', f1: '22', f1f2: '58', commission: '$12,400', volume: '$384,000' },
  { rank: '#5', wallet: '0x5E4f...2B9A', f1: '19', f1f2: '43', commission: '$9,800', volume: '$298,000' },
];

const columns = [
  { key: 'rank', label: 'Rank', className: 'td-gold' },
  { key: 'wallet', label: 'Wallet', className: 'td-mono' },
  { key: 'f1', label: 'F1 Refs', className: 'td-gold' },
  { key: 'f1f2', label: 'F1+F2' },
  { key: 'commission', label: 'Commission', className: 'td-gold' },
  { key: 'volume', label: 'Volume', className: 'td-gold' },
];

export default function ReferralPage() {
  const [lookup, setLookup] = useState('');

  return (
    <>
      <SectionHead title="Referral Network" />
      <div className="stat-grid">
        <StatCard label="Total Referrers" value="428" sub="Active wallets" color="gold" />
        <StatCard label="Commissions Paid" value="$148K" sub="USDT total" color="green" />
        <StatCard label="Avg F1/User" value="2.9" sub="Direct referrals" color="purple" />
        <StatCard label="Deepest Chain" value="F2" sub="Two levels" color="cyan" />
      </div>

      <div className="banner banner-info">🔗 Referral program applies to Pre-Sale ONLY (NOT Seed Round). F1: 5% USDT / F2: 2% USDT. Payment in USDT + BNB.</div>

      <div style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
        <input className="form-input" placeholder="0x... Enter wallet to lookup referral tree" value={lookup} onChange={e => setLookup(e.target.value)} style={{ flex: 1 }} />
        <button className="btn btn-primary">Search</button>
      </div>

      <SectionHead title="Top Referrers" />
      <DataTable columns={columns} data={topReferrers} />
    </>
  );
}
