/**
 * 인기 vs 결과 dot plot — post-race only.
 *
 * x축: 인기순위 (단승 배당률 오름차순) — 1이 1번 인기
 * y축: 실제 착순 — 1이 1착 (위가 좋음)
 * 대각선 근처는 "정직한 결과", 좌하단/우상단으로 흩어지면 의외성 ↑.
 */

type Pt = {
  horse_no: string;
  horse_name: string;
  win_rate: number; // 단승 배당률 (낮을수록 인기)
  rank: number;     // 실제 착순
};

export function PopularityVsResult({ entries }: { entries: { horse_no: string; horse_name: string; win_rate: string | null; rank: number | null; }[] }) {
  const pts: Pt[] = entries
    .filter((e): e is { horse_no: string; horse_name: string; win_rate: string; rank: number } =>
      e.win_rate !== null && e.rank !== null && Number(e.win_rate) > 0,
    )
    .map((e) => ({
      horse_no: e.horse_no,
      horse_name: e.horse_name,
      win_rate: Number(e.win_rate),
      rank: e.rank,
    }));

  if (pts.length < 3) return null;

  // 인기순위: win_rate 오름차순 1, 2, 3 ... (동률은 같은 등수 — stable sort)
  const sorted = [...pts].sort((a, b) => a.win_rate - b.win_rate);
  const popMap = new Map<string, number>();
  sorted.forEach((p, i) => popMap.set(p.horse_no, i + 1));

  const max = Math.max(pts.length, ...pts.map((p) => p.rank));
  const size = 220;
  const pad = 28;
  const inner = size - pad * 2;
  const step = inner / (max - 1 || 1);

  const xy = (n: number) => pad + (n - 1) * step;

  const upset = pts.filter((p) => Math.abs((popMap.get(p.horse_no) ?? 0) - p.rank) >= 3);

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label="인기 vs 결과 산점도"
      >
        {/* 축 frame */}
        <rect
          x={pad}
          y={pad}
          width={inner}
          height={inner}
          fill="none"
          stroke="currentColor"
          strokeOpacity="0.15"
        />

        {/* 대각선 (popularity = rank) */}
        <line
          x1={pad}
          y1={pad}
          x2={size - pad}
          y2={size - pad}
          stroke="currentColor"
          strokeOpacity="0.18"
          strokeDasharray="3 3"
        />

        {/* 축 라벨 */}
        <text x={pad} y={pad - 8} fontSize="9" fill="currentColor" fillOpacity="0.6">
          1
        </text>
        <text x={size - pad - 8} y={pad - 8} fontSize="9" fill="currentColor" fillOpacity="0.6">
          {max}
        </text>
        <text x={4} y={pad + 4} fontSize="9" fill="currentColor" fillOpacity="0.6">
          1
        </text>
        <text x={4} y={size - pad + 4} fontSize="9" fill="currentColor" fillOpacity="0.6">
          {max}
        </text>
        <text
          x={size / 2}
          y={size - 6}
          textAnchor="middle"
          fontSize="10"
          fill="currentColor"
          fillOpacity="0.6"
        >
          ← 인기 순위 →
        </text>
        <text
          x={10}
          y={size / 2}
          textAnchor="middle"
          fontSize="10"
          fill="currentColor"
          fillOpacity="0.6"
          transform={`rotate(-90 10 ${size / 2})`}
        >
          ← 착순 →
        </text>

        {pts.map((p) => {
          const pop = popMap.get(p.horse_no) ?? 0;
          const cx = xy(pop);
          const cy = xy(p.rank);
          const isWinner = p.rank === 1;
          const isUpset = Math.abs(pop - p.rank) >= 3;
          const fill = isWinner
            ? "var(--color-champagne-gold)"
            : isUpset
              ? "rgb(220 38 38 / 0.7)"
              : "rgba(30,58,138,0.55)";
          return (
            <g key={p.horse_no}>
              <circle cx={cx} cy={cy} r={5} fill={fill}>
                <title>
                  {`${p.horse_name} — 인기 ${pop}위 / 착순 ${p.rank}, 배당 ${p.win_rate.toFixed(1)}`}
                </title>
              </circle>
              {(isWinner || isUpset) && (
                <text
                  x={cx + 7}
                  y={cy + 3}
                  fontSize="9"
                  fill="currentColor"
                  fillOpacity="0.85"
                >
                  {p.horse_name.slice(0, 5)}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      <div className="text-xs">
        <div className="mb-1.5 flex flex-wrap gap-3">
          <Legend color="var(--color-champagne-gold)" label="1착" />
          <Legend color="rgba(30,58,138,0.55)" label="정상권" />
          <Legend color="rgb(220 38 38 / 0.7)" label="의외성" />
        </div>
        {upset.length > 0 ? (
          <p className="text-muted-foreground">
            인기와 결과 차 {upset.length}건 (3계단 이상). 점선에서 멀수록 의외.
          </p>
        ) : (
          <p className="text-muted-foreground">결과가 인기 순위에 가까운 정직한 경기.</p>
        )}
      </div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-muted-foreground">
      <span
        aria-hidden="true"
        className="inline-block h-2.5 w-2.5 rounded-full"
        style={{ background: color }}
      />
      {label}
    </span>
  );
}
