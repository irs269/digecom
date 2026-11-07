import { cn } from '@/lib/utils';

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('rounded-xl border border-surface-border bg-white p-5', className)}
      {...props}
    />
  );
}

interface KpiCardProps {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  accent?: boolean;
}

/** Carte KPI du tableau de bord. */
export function KpiCard({ label, value, hint, accent }: KpiCardProps) {
  return (
    <Card className={cn('flex flex-col gap-1', accent && 'border-brand-orange')}>
      <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{label}</span>
      <span className="text-2xl font-extrabold text-ink">{value}</span>
      {hint ? <span className="text-xs text-ink-muted">{hint}</span> : null}
    </Card>
  );
}
