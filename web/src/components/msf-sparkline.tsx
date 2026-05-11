/**
 * mal지수 추세 sparkline — RatingSparkline 과 동일한 시각 스타일.
 * 점수 100을 점선으로 표시 (1착 라인).
 */
export function MsfSparkline({
  points,
  width = 220,
  height = 40,
}: {
  points: { race_date: string; msf: number }[];
  width?: number;
  height?: number;
}) {
  if (points.length < 2) return null;

  const ys = points.map((p) => p.msf);
  const lo = Math.min(...ys, 90); // 보통 90~100 범위
  const hi = Math.max(...ys, 100);
  const yPad = 2;
  const range = Math.max(hi - lo, 1);

  const xStep = points.length > 1 ? width / (points.length - 1) : 0;
  const yScale = (v: number) => height - yPad - ((v - lo) / range) * (height - yPad * 2);

  const d = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${(i * xStep).toFixed(1)} ${yScale(p.msf).toFixed(1)}`)
    .join(" ");

  // area path → gold-tinted fill (디자인 Sparkline 스펙).
  const lastX = (points.length - 1) * xStep;
  const area = `${d} L ${lastX.toFixed(1)} ${height} L 0 ${height} Z`;

  // 100 (1착 기준선) 점선
  const baselineY = yScale(100);
  const lastPoint = points[points.length - 1];

  return (
    <div className="inline-flex items-center gap-2">
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        aria-label="mal지수 추세"
      >
        <path d={area} fill="rgba(252, 223, 104, 0.45)" />
        <line
          x1={0}
          y1={baselineY}
          x2={width}
          y2={baselineY}
          stroke="currentColor"
          strokeOpacity={0.2}
          strokeDasharray="2 3"
          strokeWidth={1}
        />
        <path d={d} stroke="var(--color-primary)" strokeWidth={1.6} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        {points.map((p, i) => (
          <circle
            key={i}
            cx={i * xStep}
            cy={yScale(p.msf)}
            r={i === points.length - 1 ? 2.5 : 1.4}
            fill={i === points.length - 1 ? "var(--color-primary)" : "currentColor"}
            fillOpacity={i === points.length - 1 ? 1 : 0.5}
          />
        ))}
      </svg>
      <span className="text-xs font-mono tabular-nums text-slate-grey">
        최근 <span className="font-bold text-primary">{lastPoint.msf.toFixed(1)}</span>
      </span>
    </div>
  );
}
