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

const WINNER = "var(--brown)";
const UPSET = "var(--negative)";
const NORMAL = "var(--muted-ink)";

type Entry = { horse_no: string; horse_name: string; win_rate: string | null; rank: number | null };

/** 차트를 그릴 수 있는지(배당·착순 둘 다 있는 마필 ≥3). 부모가 헤딩·카드째 생략할 때 사용 —
 *  예전엔 헤딩+빈 카드만 남는 "빈 껍데기"가 생겼다. */
export function hasPopularityVsResultData(entries: Entry[]): boolean {
  return toPoints(entries).length >= 3;
}

function toPoints(entries: Entry[]): Pt[] {
  return entries
    .filter((e): e is { horse_no: string; horse_name: string; win_rate: string; rank: number } =>
      e.win_rate !== null && e.rank !== null && Number(e.win_rate) > 0,
    )
    .map((e) => ({
      horse_no: e.horse_no,
      horse_name: e.horse_name,
      win_rate: Number(e.win_rate),
      rank: e.rank,
    }));
}

export function PopularityVsResult({ entries }: { entries: Entry[] }) {
  const pts = toPoints(entries);
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
        viewBox={`0 0 ${size} ${size}`}
        className="block h-auto w-full max-w-[260px] shrink-0 text-foreground"
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
          strokeOpacity="0.3"
        />

        {/* 대각선 (popularity = rank) */}
        <line
          x1={pad}
          y1={pad}
          x2={size - pad}
          y2={size - pad}
          stroke="currentColor"
          strokeOpacity="0.35"
          strokeDasharray="3 3"
        />

        {/* 축 라벨 */}
        <text x={pad} y={pad - 8} fontSize="11" fill="var(--muted-ink)">
          1
        </text>
        <text x={size - pad - 8} y={pad - 8} fontSize="11" fill="var(--muted-ink)">
          {max}
        </text>
        <text x={4} y={pad + 4} fontSize="11" fill="var(--muted-ink)">
          1
        </text>
        <text x={4} y={size - pad + 4} fontSize="11" fill="var(--muted-ink)">
          {max}
        </text>
        <text
          x={size / 2}
          y={size - 6}
          textAnchor="middle"
          fontSize="11"
          fill="var(--muted-ink)"
        >
          ← 인기 순위 →
        </text>
        <text
          x={10}
          y={size / 2}
          textAnchor="middle"
          fontSize="11"
          fill="var(--muted-ink)"
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
          // 단색 + 강조(DESIGN Data Viz): 1착=brown, 의외성=negative, 나머지=muted-ink.
          const fill = isWinner ? WINNER : isUpset ? UPSET : NORMAL;
          // 오른쪽 끝(인기 하위 = 이변 우승마) 라벨은 점 왼쪽으로 — SVG 밖으로 잘리지 않게.
          const labelLeft = cx > size * 0.6;
          return (
            <g key={p.horse_no}>
              <circle cx={cx} cy={cy} r={5} fill={fill}>
                <title>
                  {`${p.horse_name} — 인기 ${pop}위 / 착순 ${p.rank}, 배당 ${p.win_rate.toFixed(1)}`}
                </title>
              </circle>
              {(isWinner || isUpset) && (
                <text
                  x={labelLeft ? cx - 8 : cx + 8}
                  y={cy + 4}
                  textAnchor={labelLeft ? "end" : "start"}
                  fontSize="11"
                  fontWeight={600}
                  fill="currentColor"
                >
                  {p.horse_name.slice(0, 5)}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      <div className="text-small">
        <div className="mb-1.5 flex flex-wrap gap-3">
          <Legend color={WINNER} label="1착" />
          <Legend color={NORMAL} label="정상권" />
          <Legend color={UPSET} label="의외성" />
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
        className="inline-block h-3 w-3 rounded-full"
        style={{ background: color }}
      />
      {label}
    </span>
  );
}
