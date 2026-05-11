import { passrankSeriesByHorse, type RaceCorner } from "@/lib/race_corners";

/**
 * 페이스 맵 — 마필별 통과순위 변화 라인 (Sectional Chart).
 *
 * KRA API6_1 의 passrank_* 텍스트를 파싱해 마필별 (chul_no) 시계열로 변환.
 * 진정한 racingpost·keibalab 스타일 페이스 차트.
 *
 * 표시 단계 (서울/제주 기준 명칭, 부경은 G8F/G6F/G4F/G3F 동일 컬럼):
 *   S1F → 1C → 2C → 3C → 4C → G2F → G1F
 *
 * 1등마 (final rank 가 가장 좋은) 의 라인을 금색으로 강조.
 */
type Stage = {
  key:
    | "passrank_s1f" | "passrank_g8f_1c" | "passrank_g6f_2c" | "passrank_g4f_3c"
    | "passrank_g3f_4c" | "passrank_g2f" | "passrank_g1f";
  seoul: string;
  bukgyeong?: string;
};

const STAGES: Stage[] = [
  { key: "passrank_s1f",    seoul: "S1F" },
  { key: "passrank_g8f_1c", seoul: "1C",  bukgyeong: "G8F" },
  { key: "passrank_g6f_2c", seoul: "2C",  bukgyeong: "G6F" },
  { key: "passrank_g4f_3c", seoul: "3C",  bukgyeong: "G4F" },
  { key: "passrank_g3f_4c", seoul: "4C",  bukgyeong: "G3F" },
  { key: "passrank_g2f",    seoul: "G2F" },
  { key: "passrank_g1f",    seoul: "G1F" },
];

// 마필 라인 색상 팔레트 (1등=금, 그 외는 채도 약한 색)
const LINE_COLORS = [
  "rgba(30,58,138,0.65)",   // navy
  "rgba(190,18,60,0.6)",     // rose
  "rgba(13,148,136,0.6)",    // teal
  "rgba(146,64,14,0.6)",     // amber
  "rgba(99,102,241,0.6)",    // indigo
  "rgba(220,38,38,0.6)",     // red
  "rgba(22,163,74,0.6)",     // green
  "rgba(124,58,237,0.6)",    // violet
  "rgba(234,88,12,0.55)",    // orange
  "rgba(8,145,178,0.6)",     // sky
];

export function PaceMap({
  corner,
  meet,
  winnerChulNo,
}: {
  corner: RaceCorner;
  meet: string;
  /** 1착 마필의 출전번호 (있으면 금색 강조). race_results 와 join 해서 외부 주입. */
  winnerChulNo?: number | null;
}) {
  const isBukgyeong = meet === "부경";

  // STAGES 의 각 key 에 대해 corner 의 통과순위 텍스트 추출.
  const stageData = STAGES.map((s) => ({ key: s.key, text: corner[s.key] }));
  const { rankByHorse } = passrankSeriesByHorse(stageData);

  if (rankByHorse.size === 0) return null;

  // 차트에 표시할 마필 리스트 — chul_no 오름차순.
  const horses = [...rankByHorse.entries()].sort(([a], [b]) => a - b);
  const maxRank = Math.max(
    ...horses.flatMap(([, s]) => s.filter((r): r is number => r !== null)),
    horses.length,
  );

  const width = 680;
  const height = 280;
  const padX = 50;
  const padY = 28;
  const innerW = width - padX * 2;
  const innerH = height - padY * 2;
  const stepX = innerW / (STAGES.length - 1);

  const yScale = (r: number) => padY + ((r - 1) / (maxRank - 1 || 1)) * innerH;
  const xOf = (idx: number) => padX + stepX * idx;

  return (
    <div className="overflow-x-auto">
      <div className="mb-2 text-xs text-muted-foreground">
        마필별 통과순위 변화. 위쪽일수록 선행, 우상향이면 추입형.
      </div>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="페이스 맵"
      >
        {/* y축 가이드 */}
        {[1, Math.ceil(maxRank / 2), maxRank].map((r) => (
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
              x={padX - 8}
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
        {STAGES.map((s, i) => {
          const label = isBukgyeong && s.bukgyeong ? s.bukgyeong : s.seoul;
          return (
            <text
              key={s.key}
              x={xOf(i)}
              y={height - 8}
              textAnchor="middle"
              fontSize="10"
              fill="currentColor"
              fillOpacity="0.7"
            >
              {label}
            </text>
          );
        })}

        {horses.map(([chul, series], i) => {
          const isWinner = chul === winnerChulNo;
          const stroke = isWinner ? "var(--color-champagne-gold)" : LINE_COLORS[i % LINE_COLORS.length];
          const strokeWidth = isWinner ? 2.4 : 1.4;

          const path = series
            .map((r, idx) => (r === null ? null : `${xOf(idx).toFixed(1)} ${yScale(r).toFixed(1)}`))
            .filter((s): s is string => s !== null);
          if (path.length < 2) return null;
          const d = "M " + path.join(" L ");

          const lastDefined = [...series.entries()].reverse().find(([, v]) => v !== null);
          return (
            <g key={chul}>
              <path d={d} stroke={stroke} strokeWidth={strokeWidth} fill="none" opacity={isWinner ? 1 : 0.85} />
              {series.map((r, idx) =>
                r === null ? null : (
                  <circle
                    key={idx}
                    cx={xOf(idx)}
                    cy={yScale(r)}
                    r={isWinner ? 3.5 : 2.2}
                    fill={stroke}
                  />
                ),
              )}
              {lastDefined && (
                <text
                  x={xOf(lastDefined[0]) + 7}
                  y={yScale(lastDefined[1]!) + 3}
                  fontSize="10"
                  fontWeight={isWinner ? 700 : 500}
                  fill={stroke}
                >
                  {chul}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {corner.rc_dist && (
        <div className="mt-2 text-xs text-muted-foreground">
          경주 거리 <span className="font-mono">{corner.rc_dist}m</span>
          {winnerChulNo && (
            <span className="ml-3">
              1착 출전번호 <span className="font-mono font-bold text-champagne-gold">{winnerChulNo}</span>
            </span>
          )}
        </div>
      )}
    </div>
  );
}
