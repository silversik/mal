import type { JockeyMonthlyStat } from "@/lib/jockeys";

/**
 * 기수 월별 출전·우승 차트 (SVG, recharts 등 의존 없음).
 * stacked bar: 1착(금) / 2-3착(채도 약함) / 그 외 출전(매우 흐림).
 */
export function JockeyMonthlyChart({
  data,
  height = 140,
  width = 720,
}: {
  data: JockeyMonthlyStat[];
  height?: number;
  width?: number;
}) {
  if (data.length === 0) return null;

  const max = Math.max(1, ...data.map((d) => d.starts));
  const padX = 24;
  const padY = 24;
  const innerW = width - padX * 2;
  const innerH = height - padY * 2;
  const barW = (innerW / data.length) * 0.7;
  const step = innerW / data.length;

  // y → pixel
  const yScale = (v: number) => innerH * (1 - v / max);

  return (
    <div className="overflow-x-auto">
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="block"
        role="img"
        aria-label="월별 기승 통계"
      >
        {/* y축 가이드: 25/50/75/100% */}
        {[0.25, 0.5, 0.75, 1].map((p) => {
          const y = padY + yScale(max * p);
          return (
            <line
              key={p}
              x1={padX}
              x2={width - padX}
              y1={y}
              y2={y}
              stroke="currentColor"
              strokeOpacity={0.08}
              strokeWidth={1}
            />
          );
        })}

        {data.map((d, i) => {
          const x = padX + step * i + (step - barW) / 2;
          const otherCount = Math.max(0, d.starts - d.win - d.place - d.show);

          // bottom-up stacking: other → show → place → win
          const otherTop = yScale(d.starts);
          const showTop = yScale(d.starts - otherCount);
          const placeTop = yScale(d.win + d.place);
          const winTop = yScale(d.win);
          const baseY = innerH;

          const segments: Array<[number, number, string, string]> = [];
          if (otherCount > 0) {
            segments.push([otherTop, showTop, "rgba(100,116,139,0.25)", "etc"]);
          }
          if (d.show > 0) {
            segments.push([showTop, placeTop, "rgba(180,83,9,0.55)", "show"]);
          }
          if (d.place > 0) {
            segments.push([placeTop, winTop, "rgba(148,163,184,0.7)", "place"]);
          }
          if (d.win > 0) {
            segments.push([winTop, baseY, "var(--color-champagne-gold)", "win"]);
          }

          // segments: [top, bottom, fill, type] — inverted means top is smaller y.
          // We want each segment to draw rect from top to bottom (filling correctly).
          // The "bottom" arg represents height baseline; recompute proper rect.
          const monthLabel = d.ym.slice(5); // MM only

          return (
            <g key={d.ym}>
              {segments.map(([top, bottom], si) => (
                <rect
                  key={si}
                  x={x}
                  y={padY + top}
                  width={barW}
                  height={Math.max(1, bottom - top)}
                  fill={segments[si][2]}
                />
              ))}
              <title>
                {`${d.ym} · 출전 ${d.starts} / 1착 ${d.win} · 2착 ${d.place} · 3착 ${d.show}`}
              </title>
              <text
                x={x + barW / 2}
                y={height - 6}
                textAnchor="middle"
                fontSize="10"
                fill="currentColor"
                fillOpacity="0.6"
              >
                {monthLabel}
              </text>
              {d.win > 0 && (
                <text
                  x={x + barW / 2}
                  y={padY + winTop - 2}
                  textAnchor="middle"
                  fontSize="10"
                  fontWeight="600"
                  fill="var(--color-primary)"
                >
                  {d.win}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <div className="mt-1 flex flex-wrap gap-3 text-[10px] text-muted-foreground">
        <Legend color="var(--color-champagne-gold)" label="1착" />
        <Legend color="rgba(148,163,184,0.7)" label="2착" />
        <Legend color="rgba(180,83,9,0.55)" label="3착" />
        <Legend color="rgba(100,116,139,0.25)" label="기타" />
      </div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        aria-hidden="true"
        className="inline-block h-2 w-2 rounded-sm"
        style={{ background: color }}
      />
      {label}
    </span>
  );
}
