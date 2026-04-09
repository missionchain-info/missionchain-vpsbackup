import StatCard from '@/components/ui/StatCard';
import SectionHead from '@/components/ui/SectionHead';

export default function AppsDashboard() {
  return (
    <>
      <div className="stat-grid">
        <StatCard label="Total Raised" value="$2.08M" sub="SEED + Pre-Sale" color="gold" />
        <StatCard label="Active Investors" value="1,247" sub="Verified wallets" color="green" />
        <StatCard label="MICE Sold" value="18,420" sub="92.1% of cap" color="purple" />
        <StatCard label="MIC Staked" value="284M" sub="NFT Staking pool" color="cyan" />
        <StatCard label="Treasury USDT" value="$482K" sub="Multi-sig" color="teal" />
        <StatCard label="Referral Commissions" value="$148K" sub="428 referrers" color="orange" />
      </div>
      <SectionHead title="Financial Overview" />
      <div className="banner banner-info">📊 Mission Apps manages the Web3 DApp missionchain.io — token sales, mining, staking, vesting, treasury, and smart contracts.</div>
    </>
  );
}
