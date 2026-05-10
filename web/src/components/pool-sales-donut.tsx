/**
 * 풀별 매출 도넛 차트 — 의존성 없는 SVG.
 * race detail 의 PoolSalesSection 옆에 컴팩트 시각화.
 */

const POOL_COLORS: Record<string, string> = {
  단식: "#1e3a8a", // 진한 navy — 가장 큰 풀
  연식: "#2563eb",
  쌍식: "#0891b2",
  복식: "#0d9488",
  복연: "#65a30d",
  삼복: "#a16207",
  삼쌍: "#b45309",
};

const FALLBACK_COLOR = "#94a3b8";

export function PoolSalesDonut({
  rows,
  size = 140,
  thickness = 24,
}: {
  rows: { pool: string; amount: string }[];
  size?: number;
  thickness?: number;
}) {
  const data = rows
    .map((r) => ({ pool: r.pool, amount: Number(r.amount) }))
    .filter((d) => d.amount > 0);
  const total = data.reduce((s, d) => s + d.amount, 0);
  if (total === 0) return null;

  const r = (size - thickness) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const C = 2 * Math.PI * r;

  let acc = 0;
  const segments = data.map((d) => {
    const fraction = d.amount / total;
    const dash = C * fraction;
    const offset = -acc * C;
    acc += fraction;
    return {
      pool: d.pool,
      amount: d.amount,
      fraction,
      dash,
      offset,
      color: POOL_COLORS[d.pool] ?? FALLBACK_COLOR,
    };
  });

  return (
    <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start">
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label="풀별 매출 도넛"
      >
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke="rgba(0,0,0,0.05)"
          strokeWidth={thickness}
        />
        {segments.map((s) => (
          <circle
            key={s.pool}
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke={s.color}
            strokeWidth={thickness}
            strokeDasharray={`${s.dash} ${C - s.dash}`}
            strokeDashoffset={s.offset}
            transform={`rotate(-90 ${cx} ${cy})`}
          >
            <title>{`${s.pool} · ${(s.fraction * 100).toFixed(1)}%`}</title>
          </circle>
        ))}
        <text
          x={cx}
          y={cy - 4}
          textAnchor="middle"
          fontSize="10"
          fill="currentColor"
          fillOpacity="0.6"
        >
          총 매출
        </text>
        <text
          x={cx}
          y={cy + 12}
          textAnchor="middle"
          fontSize="13"
          fontWeight="700"
          fill="currentColor"
        >
          {formatAmountShort(total)}
        </text>
      </svg>

      <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-1">
        {segments.map((s) => (
          <li key={s.pool} className="flex items-center gap-1.5">
            <span
              className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
              style={{ background: s.color }}
            />
            <span className="font-semibold">{s.pool}</span>
            <span className="font-mono tabular-nums text-muted-foreground">
              {(s.fraction * 100).toFixed(0)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function formatAmountShort(n: number): string {
  if (n >= 100_000_000) return `${(n / 100_000_000).toFixed(1)}억`;
  if (n >= 10_000) return `${Math.round(n / 10_000).toLocaleString("ko-KR")}만`;
  return n.toLocaleString("ko-KR");
}
