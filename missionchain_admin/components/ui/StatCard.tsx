interface StatCardProps {
  label: string;
  value: string;
  sub?: string;
  color: string; // gold, purple, green, red, cyan, blue, teal, orange
}

export default function StatCard({ label, value, sub, color }: StatCardProps) {
  return (
    <div className={`stat-card ${color}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-val">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}
