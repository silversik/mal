interface WinRateBarProps {
  rate: number | string | null;
  /** "inline" = number + bar in one row, "stacked" = number above bar */
  layout?: "inline" | "stacked";
  /** Bar height in px */
  height?: number;
  className?: string;
}

export function WinRateBar({ rate, layout = "stacked", height = 3, className = "" }: WinRateBarProps) {
  const value = rate == null ? null : Number(rate);
  if (value == null || isNaN(value)) return null;

  const pct = Math.min(100, Math.max(0, value));

  if (layout === "inline") {
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        <div className="w-16 overflow-hidden rounded-full bg-muted" style={{ height }}>
          <div
            className="h-full rounded-full bg-secondary"
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="font-mono tabular-nums text-xs text-muted-foreground">
          {value.toFixed(1)}%
        </span>
      </div>
    );
  }

  return (
    <div className={`text-right ${className}`}>
      <span className="text-sm font-bold text-primary">{value.toFixed(1)}%</span>
      <div className="mt-1 w-full overflow-hidden rounded-full bg-muted" style={{ height }}>
        <div
          className="h-full rounded-full bg-secondary transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

/**
 * 디자인 시안의 WinRateBars — 1착·복승률·복연승률을 한 카드에 세로로 쌓아 표시.
 * gold tones (deep → mid → pale) 로 위계.
 */
export function WinRateBars({
  winRate,
  plcRate,
  showRate,
  className = "",
}: {
  winRate: number | null | undefined;
  plcRate: number | null | undefined;
  showRate: number | null | undefined;
  className?: string;
}) {
  const rows: { label: string; value: number; color: string }[] = [];
  if (winRate != null && !isNaN(Number(winRate))) {
    rows.push({ label: "1착", value: Number(winRate), color: "var(--color-gold-deep)" });
  }
  if (plcRate != null && !isNaN(Number(plcRate))) {
    rows.push({ label: "복승률", value: Number(plcRate), color: "var(--color-gold)" });
  }
  if (showRate != null && !isNaN(Number(showRate))) {
    rows.push({ label: "복연승률", value: Number(showRate), color: "var(--color-gold-pale)" });
  }
  if (rows.length === 0) return null;

  return (
    <div className={`grid gap-2.5 ${className}`}>
      {rows.map((r) => (
        <div key={r.label}>
          <div className="mb-1 flex items-center justify-between text-[11px]">
            <span className="font-semibold text-muted-foreground">{r.label}</span>
            <span className="font-mono font-bold tabular-nums text-primary">
              {r.value.toFixed(1)}%
            </span>
          </div>
          <div className="relative h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.min(100, Math.max(0, r.value))}%`,
                background: r.color,
                border: "1px solid var(--border)",
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
