import StatCard from '@/components/ui/StatCard';
import SectionHead from '@/components/ui/SectionHead';

export default function WorldDashboard() {
  return (
    <>
      <div className="stat-grid">
        <StatCard label="Total Users" value="2,847" sub="Community members" color="blue" />
        <StatCard label="New This Week" value="312" sub="+12.3%" color="green" />
        <StatCard label="Pending Content" value="47" sub="Needs review" color="orange" />
        <StatCard label="Active Challenges" value="4" sub="In progress" color="purple" />
        <StatCard label="SOPHIA Chats" value="8,420" sub="Last 7 days" color="gold" />
        <StatCard label="Mod Queue" value="7" sub="Flagged items" color="red" />
      </div>
      <SectionHead title="Community Overview" />
      <div className="banner banner-info">🌍 Mission World manages the community platform missionchain.world — SOPHIA KOL, challenges, moderation, and marketplace.</div>
    </>
  );
}
