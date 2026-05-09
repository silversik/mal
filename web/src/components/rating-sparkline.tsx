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
 * 경주마 레이팅 스파크라인.
 *
 * KRA 의 horse_ratings 한 행에는 rating1~rating4 4개 값이 들어 있고, 코멘트 기준
 * "rating4 가 가장 최근, rating1 이 가장 오래된" 누적 4시점이다. snapshot_date 별로는
 * 한 마필이 한동안 출주하지 않으면 4개 값이 그대로 반복돼 (예: 4/23·4/25·5/9 모두
 * 67/60/58/63) — 기존엔 snapshot_date 축으로 rating4 만 점을 찍어서 차트가 평평하게
 * 보이는 사고가 있었다. 사용자 기대는 "67 → 60 → 58 → 63 의 변동 곡선" 이므로 가장
 * 최근 snapshot 의 rating1→rating4 4점을 시리즈로 사용한다. 4개 점 사이의 실제 일자
 * 간격은 KRA 가 노출하지 않으므로 인덱스 기준 등간격으로 배치한다.
 *
 * 2점 미만(예: rating1·2 만 있고 3·4 가 NULL)이면 숨김.
 */
export function RatingSparkline({ points, width = 240, height = 56 }: Props) {
  const [hover, setHover] = useState<number | null>(null);

  const latest = [...points]
    .filter((p) => p.rating4 !== null)
    .sort((a, b) => b.snapshot_date.localeCompare(a.snapshot_date))[0];

  if (!latest) return null;

  const series: { label: string; value: number }[] = [
    { label: "R1", value: latest.rating1 as number },
    { label: "R2", value: latest.rating2 as number },
    { label: "R3", value: latest.rating3 as number },
    { label: "R4", value: latest.rating4 as number },
  ].filter((p): p is { label: string; value: number } => p.value !== null && p.value !== undefined);

  if (series.length < 2) return null;

  const values = series.map((p) => p.value);
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
      const y = yOf(p.value);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");

  const current = hover ?? series.length - 1;
  const currentPoint = series[current];

  return (
    <div className="inline-flex flex-col items-start gap-1">
      <div className="text-[10px] text-muted-foreground tabular-nums">
        {currentPoint.label} · <strong className="text-foreground">{currentPoint.value}</strong>
        {hover === null && (
          <span className="ml-1 opacity-60">(최근 · {latest.snapshot_date})</span>
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
          const y = yOf(p.value);
          const isActive = i === current;
          return (
            <g key={p.label}>
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
