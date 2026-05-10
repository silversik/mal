import Link from "next/link";
import type { CornerRow } from "@/lib/race_corners";

/**
 * 페이스 맵 (Sectional Chart) — racingpost·keibalab 스타일.
 *
 * x축: 통과 지점 (S1F → 1C → 2C → 3C → 4C → G3F → G1F → 결승)
 * y축: 순위 (위가 1등)
 * 1착 마필 라인은 금색, 그 외 채도 약하게.
 *
 * race_result_corners 테이블 row 가 있을 때만 사용 — 없으면 lib 가 빈 배열.
 */

const STAGES: { key: keyof Pick<CornerRow, "ord_s1f" | "ord_1c" | "ord_2c" | "ord_3c" | "ord_4c" | "ord_g3f" | "ord_g1f">; label: string }[] = [
  { key: "ord_s1f", label: "S1F" },
  { key: "ord_1c", label: "1C" },
  { key: "ord_2c", label: "2C" },
  { key: "ord_3c", label: "3C" },
  { key: "ord_4c", label: "4C" },
  { key: "ord_g3f", label: "G3F" },
  { key: "ord_g1f", label: "G1F" },
];

export function PaceMap({ rows }: { rows: CornerRow[] }) {
  if (rows.length === 0) return null;

  const max = Math.max(rows.length, ...rows.flatMap((r) => STAGES.map((s) => r[s.key] ?? 0)));
  if (max === 0) return null;

  const width = 640;
  const height = 280;
  const padX = 48;
  const padY = 24;
  const innerW = width - padX * 2;
  const innerH = height - padY * 2;
  const stepX = innerW / (STAGES.length + 1); // +1 = finish (= rank)

  const yScale = (rank: number) => padY + ((rank - 1) / (max - 1 || 1)) * innerH;

  return (
    <div className="overflow-x-auto">
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="페이스 맵"
      >
        {/* y축 가이드: 1, max */}
        {[1, Math.ceil(max / 2), max].map((r) => (
          <g key={r}>
            <line
              x1={padX}
              x2={width - padX}
              y1={yScale(r)}
              y2={yScale(r)}
              stroke="currentColor"
              strokeOpacity="0.08"
            />
            <text
              x={padX - 6}
              y={yScale(r) + 3}
              textAnchor="end"
              fontSize="9"
              fill="currentColor"
              fillOpacity="0.6"
            >
              {r}
            </text>
          </g>
        ))}

        {/* x축 라벨 */}
        {[...STAGES, { key: "rank" as const, label: "결승" }].map((s, i) => (
          <text
            key={s.label}
            x={padX + stepX * (i + 0.5)}
            y={height - 6}
            textAnchor="middle"
            fontSize="10"
            fill="currentColor"
            fillOpacity="0.7"
          >
            {s.label}
          </text>
        ))}

        {rows.map((row) => {
          const points: [number, number][] = [];
          STAGES.forEach((s, i) => {
            const v = row[s.key];
            if (v !== null) {
              points.push([padX + stepX * (i + 0.5), yScale(v)]);
            }
          });
          if (row.rank !== null) {
            points.push([padX + stepX * (STAGES.length + 0.5), yScale(row.rank)]);
          }
          if (points.length < 2) return null;

          const isWinner = row.rank === 1;
          const stroke = isWinner ? "var(--color-champagne-gold)" : "rgba(30,58,138,0.45)";
          const strokeWidth = isWinner ? 2 : 1;
          const d = points
            .map(([x, y], i) => `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`)
            .join(" ");

          return (
            <g key={row.horse_no}>
              <path d={d} stroke={stroke} strokeWidth={strokeWidth} fill="none" />
              {points.map(([x, y], i) => (
                <circle
                  key={i}
                  cx={x}
                  cy={y}
                  r={isWinner ? 3 : 2}
                  fill={stroke}
                />
              ))}
              {isWinner && (
                <text
                  x={points[points.length - 1][0] + 6}
                  y={points[points.length - 1][1] + 3}
                  fontSize="10"
                  fontWeight="700"
                  fill="var(--color-champagne-gold)"
                >
                  {row.horse_name}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
        {rows.map((r) => (
          <Link
            key={r.horse_no}
            href={`/horse/${r.horse_no}`}
            className="hover:text-primary"
          >
            <span
              className={`mr-1 inline-block h-2 w-2 rounded-full ${
                r.rank === 1 ? "bg-champagne-gold" : "bg-slate-400/60"
              }`}
            />
            {r.rank ?? "-"}. {r.horse_name}
          </Link>
        ))}
      </div>
    </div>
  );
}
