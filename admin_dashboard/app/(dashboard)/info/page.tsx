import StatCard from '@/components/ui/StatCard';
import SectionHead from '@/components/ui/SectionHead';

export default function InfoDashboard() {
  return (
    <>
      <div className="stat-grid">
        <StatCard label="Total Pages" value="14" sub="Public website" color="teal" />
        <StatCard label="Documents" value="10" sub="WP + 8 Appendices + Glossary" color="gold" />
        <StatCard label="Translations" value="4" sub="ES / VI / KO / PT" color="cyan" />
        <StatCard label="Last Published" value="2h ago" sub="appendix-e.html" color="green" />
        <StatCard label="Pending Review" value="2" sub="Translation updates" color="purple" />
        <StatCard label="SEO Score" value="87" sub="Good" color="orange" />
      </div>
      <SectionHead title="Content Overview" />
      <div className="banner banner-info">📄 Mission Info manages the public website missionchain.info — landing pages, white paper, appendices, and translations.</div>
    </>
  );
}
