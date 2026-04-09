interface SectionHeadProps {
  title: string;
  action?: React.ReactNode;
}

export default function SectionHead({ title, action }: SectionHeadProps) {
  return (
    <div className="section-head">
      <div className="section-title">
        <span className="dot" />
        {title}
      </div>
      {action}
    </div>
  );
}
