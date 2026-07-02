export function ProgressBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : value > 0 ? 100 : 0;
  const over = value > max;
  return (
    <div className={`progress ${over ? 'over' : ''}`}>
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}
