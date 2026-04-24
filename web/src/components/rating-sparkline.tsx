"use client";

import { useState } from "react";

import type { HorseRatingPoint } from "@/lib/horse_ratings";

type Props = {
  /** newest-first 로 들어와도 내부에서 시간 오름차순으로 정렬. */
  points: HorseRatingPoint[];
  width?: number;
  height?: number;
};

/**
 * 경주마 레이팅(rating4 = 가장 최근 누적값) 의 시계열 스파크라인.
 * - 외부 차트 lib 없이 SVG <path> + <circle> 로 렌더.
 * - 호버 시 해당 시점의 snapshot_date / rating4 를 상단에 표시.
 * - 2점 미만이면 숨김 (차트로서 의미 없음).
 */
export function RatingSparkline({ points, width = 240, height = 56 }: Props) {
  const [hover, setHover] = useState<number | null>(null);

  const series = [...points]
    .filter((p) => p.rating4 !== null)
    .sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date));

  if (series.length < 2) return null;

  const values = series.map((p) => p.rating4 as number);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(1, max - min);

  const pad = 4;
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;

  const xOf = (i: number) =>
    series.length === 1 ? width / 2 : pad + (i * innerW) / (series.length - 1);
  const yOf = (v: number) => pad + innerH - ((v - min) / span) * innerH;

  const d = series
    .map((p, i) => {
      const x = xOf(i);
      const y = yOf(p.rating4 as number);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");

  const current = hover ?? series.length - 1;
  const currentPoint = series[current];

  return (
    <div className="inline-flex flex-col items-start gap-1">
      <div className="text-[10px] text-muted-foreground tabular-nums">
        {currentPoint.snapshot_date} · <strong className="text-foreground">{currentPoint.rating4}</strong>
        {hover === null && values.length > 1 && (
          <span className="ml-1 opacity-60">(최근)</span>
        )}
      </div>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="overflow-visible"
        onMouseLeave={() => setHover(null)}
      >
        <path
          d={d}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-primary"
        />
        {series.map((p, i) => {
          const x = xOf(i);
          const y = yOf(p.rating4 as number);
          const isActive = i === current;
          return (
            <g key={p.snapshot_date}>
              {/* 호버 히트박스 — 얇은 세로 띠 */}
              <rect
                x={x - innerW / (series.length * 2 || 1)}
                y={0}
                width={Math.max(6, innerW / series.length)}
                height={height}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
              />
              <circle
                cx={x}
                cy={y}
                r={isActive ? 3 : 1.5}
                className={isActive ? "fill-primary" : "fill-primary/60"}
              />
            </g>
          );
        })}
      </svg>
    </div>
  );
}
