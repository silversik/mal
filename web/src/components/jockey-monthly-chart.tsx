import type { JockeyMonthlyStat } from "@/lib/jockeys";

/**
 * 기수 월별 1착 차트 (SVG only, recharts 등 의존 없음).
 * 디자인 스펙: 단일 막대(1착 건수)를 gold-pale 로, 가장 최근 달은 gold-deep 로 강조.
 * stacked 출전/2착/3착 표시는 가독성을 떨어뜨려 제거.
 */
export function JockeyMonthlyChart({
  data,
  height = 100,
  width = 720,
}: {
  data: JockeyMonthlyStat[];
  height?: number;
  width?: number;
}) {
  if (data.length === 0) return null;

  const max = Math.max(1, ...data.map((d) => d.win));
  const padX = 12;
  const padY = 18;
  const labelGap = 16;
  const barH = height - padY - labelGap;
  const innerW = width - padX * 2;
  const step = innerW / data.length;
  const barW = step * 0.65;

  const yOf = (v: number) => padY + barH - (v / max) * barH;
  const total = data.reduce((s, d) => s + d.win, 0);

  return (
    <div className="overflow-x-auto">
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="block"
        role="img"
        aria-label="월별 1착 추이"
      >
        {data.map((d, i) => {
          const x = padX + step * i + (step - barW) / 2;
          const isLast = i === data.length - 1;
          const y = yOf(d.win);
          const h = padY + barH - y;
          const monthLabel = d.ym.slice(5); // MM only

          return (
            <g key={d.ym}>
              <rect
                x={x}
                y={y}
                width={barW}
                height={Math.max(1, h)}
                rx={3}
                fill={isLast ? "var(--color-gold-deep)" : "var(--color-gold-pale)"}
                stroke="rgba(160, 108, 0, 0.18)"
              />
              <title>{`${d.ym} · 출전 ${d.starts} / 1착 ${d.win}`}</title>
              <text
                x={x + barW / 2}
                y={height - 4}
                textAnchor="middle"
                fontSize="10"
                fontFamily="var(--font-mono)"
                fill="var(--muted-foreground)"
              >
                {monthLabel}
              </text>
              {d.win > 0 && (
                <text
                  x={x + barW / 2}
                  y={y - 3}
                  textAnchor="middle"
                  fontSize="10"
                  fontWeight="700"
                  fontFamily="var(--font-mono)"
                  fill={isLast ? "var(--color-gold-ink)" : "var(--color-navy)"}
                  opacity={isLast ? 1 : 0.65}
                >
                  {d.win}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <div className="mt-1 px-2 text-right text-[11px] font-mono tabular-nums text-muted-foreground">
        연 누계 <span className="font-bold text-foreground">{total}</span>회
      </div>
    </div>
  );
}
