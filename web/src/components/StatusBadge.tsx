import type { InvoiceStatus } from '../api/types';

const MAP: Record<InvoiceStatus, { cls: string; label: string }> = {
  OPEN: { cls: 'badge-neutral', label: 'Open' },
  IN_PROGRESS: { cls: 'badge-warn', label: 'In progress' },
  COMPLETED: { cls: 'badge-ok', label: 'Completed' },
};

export function StatusBadge({ status }: { status: InvoiceStatus }) {
  const s = MAP[status] ?? MAP.OPEN;
  return <span className={`badge ${s.cls}`}>{s.label}</span>;
}

/** Green when reconciled (variance 0), red for shortfall, amber for overage. */
export function VarianceBadge({ variance }: { variance: number }) {
  if (variance === 0) return <span className="badge badge-ok">0</span>;
  if (variance > 0) return <span className="badge badge-bad">−{variance}</span>;
  return <span className="badge badge-warn">+{Math.abs(variance)}</span>;
}
