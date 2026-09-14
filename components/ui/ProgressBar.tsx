export function ProgressBar({
  pct,
  color = "#1466FF",
  thin = false,
}: {
  pct: number;
  color?: string;
  thin?: boolean;
}) {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div className={`progress-track ${thin ? "progress-track-thin" : ""}`}>
      <div className="progress-fill" style={{ width: `${clamped}%`, background: color }} />
    </div>
  );
}
