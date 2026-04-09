interface BadgeProps {
  children: React.ReactNode;
  variant: 'active' | 'pending' | 'gold' | 'purple' | 'verified' | 'teal' | 'draft';
}

export default function Badge({ children, variant }: BadgeProps) {
  return <span className={`badge badge-${variant}`}>{children}</span>;
}
