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
        <div className="h-1.5 w-16 overflow-hidden rounded-full bg-primary/10" style={{ height }}>
          <div
            className="h-full rounded-full bg-champagne-gold"
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
      <span className="text-sm font-bold text-dirt-brown">{value.toFixed(1)}%</span>
      <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-primary/10" style={{ height }}>
        <div
          className="h-full rounded-full bg-champagne-gold transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
