/**
 * 디자인 시안의 WinRateRing — 기수 승률을 둥근 게이지로 표현.
 * 외곽: 옅은 navy 트랙 / 채워지는 호: gold-deep / 중앙: 값(%) + 라벨.
 */
export function WinRateRing({
  value,
  size = 96,
  label = "승률",
}: {
  value: number | null | undefined;
  size?: number;
  label?: string;
}) {
  if (value == null || isNaN(Number(value))) return null;
  const v = Math.min(100, Math.max(0, Number(value)));
  const r = size / 2 - 8;
  const c = 2 * Math.PI * r;
  const off = c * (1 - v / 100);
  return (
    <div className="relative inline-block" style={{ width: size, height: size }}>
      <svg width={size} height={size} aria-label={`${label} ${v.toFixed(1)}%`}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="rgba(29, 51, 78, 0.08)"
          strokeWidth={8}
          fill="none"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="var(--color-gold)"
          strokeWidth={8}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={off}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-primary">
        <div
          className="font-mono font-bold leading-none tabular-nums"
          style={{ fontSize: size * 0.22 }}
        >
          {v.toFixed(1)}
          <span className="opacity-60" style={{ fontSize: size * 0.13 }}>
            %
          </span>
        </div>
        <div
          className="mt-1 font-semibold uppercase tracking-wider text-muted-foreground"
          style={{ fontSize: 10 }}
        >
          {label}
        </div>
      </div>
    </div>
  );
}
