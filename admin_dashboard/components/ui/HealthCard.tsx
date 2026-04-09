interface HealthCardProps {
  title: string;
  status: 'green' | 'red' | 'yellow';
  label: string;
  meta: string[];
}

export default function HealthCard({ title, status, label, meta }: HealthCardProps) {
  return (
    <div className="health-card">
      <div className="health-title">{title}</div>
      <div className="health-status">
        <div className={`health-dot ${status}`} />
        <div className="health-label">{label}</div>
      </div>
      {meta.map((m, i) => <div key={i} className="health-meta">{m}</div>)}
    </div>
  );
}
