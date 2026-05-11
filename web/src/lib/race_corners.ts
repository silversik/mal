import { query } from "./db";

/**
 * 경주 구간별 성적 — KRA API6_1/raceDetailSectionRecord_1 (publicDataPk=15057847).
 *
 * ⚠ 마필 단위가 아닌 **경주 단위** 1 row. 한 row 안에 1등마의 통과순위 변화
 *    (S1F → 1C/2C/3C/4C → G2F/G1F) + 펄롱별 구간기록·통과거리·통과시간.
 *
 * race_corners 테이블이 적재되면 페이스 맵 (B-1) 자동 활성화.
 */
export type RaceCorner = {
  rc_dist: number | null;

  // 통과순위 텍스트 — KRA 표기 (예: "(^1,3,9)-7,2,6,(5,8),4").
  // parsePassrank() 로 [{rank, chul_nos[]}] 배열 추출.
  passrank_s1f: string | null;
  passrank_g8f_1c: string | null;
  passrank_g6f_2c: string | null;
  passrank_g4f_3c: string | null;
  passrank_g3f_4c: string | null;
  passrank_g2f: string | null;
  passrank_g1f: string | null;

  time_1f: string | null;
  time_2f: string | null;
  time_3f: string | null;
  time_4f: string | null;
  time_5f: string | null;
  time_6f: string | null;
  time_7f: string | null;
  time_8f: string | null;
  time_9f: string | null;
  time_10f: string | null;
  time_11f: string | null;
  time_12f: string | null;

  passtime_1f: string | null;
  passtime_2f: string | null;
  passtime_3f: string | null;
  passtime_4f: string | null;
  passtime_5f: string | null;
  passtime_6f: string | null;
  passtime_7f: string | null;
  passtime_8f: string | null;
  passtime_9f: string | null;
  passtime_10f: string | null;
};

export async function getRaceCorner(
  raceDate: string,
  meet: string,
  raceNo: number,
): Promise<RaceCorner | null> {
  // race_corners 테이블이 아직 없을 수 있다 (마이그레이션 028 미적용 환경) —
  // information_schema 확인 후 안전하게 null.
  const exists = await query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
        WHERE table_name = 'race_corners'
     ) AS exists`,
  );
  if (!exists[0]?.exists) return null;

  const rows = await query<RaceCorner>(
    `SELECT rc_dist,
            passrank_s1f, passrank_g8f_1c, passrank_g6f_2c, passrank_g4f_3c,
            passrank_g3f_4c, passrank_g2f, passrank_g1f,
            time_1f, time_2f, time_3f, time_4f, time_5f, time_6f,
            time_7f, time_8f, time_9f, time_10f, time_11f, time_12f,
            passtime_1f, passtime_2f, passtime_3f, passtime_4f, passtime_5f,
            passtime_6f, passtime_7f, passtime_8f, passtime_9f, passtime_10f
       FROM race_corners
      WHERE race_date = $1::date AND meet = $2 AND race_no = $3`,
    [raceDate, meet, raceNo],
  );
  return rows[0] ?? null;
}

/**
 * KRA 통과순위 텍스트 파싱.
 *
 * 입력 예: "(^1,3,9)-7,2,6,(5,8),4"
 * 출력:    [
 *            { rank: 1, chul_nos: [1, 3, 9] },  // 동률 1등 그룹
 *            { rank: 2, chul_nos: [7] },
 *            { rank: 3, chul_nos: [2] },
 *            { rank: 4, chul_nos: [6] },
 *            { rank: 5, chul_nos: [5, 8] },     // 동률 5등 그룹
 *            { rank: 6, chul_nos: [4] },        // 동률 그룹의 두 마필이 5등 차지 → 다음은 6 (skipped)
 *          ]
 *
 * - `(...)` 로 묶인 출전번호는 같은 그룹 (동률).
 * - `-` 와 `=` 는 그룹 사이 간격 — 순위 계산에는 영향 없음.
 * - `^` 는 선두 표시 — 무시.
 * - `·` (가운데 점) 은 큰 간격 — `=` 와 동일 취급.
 * - 동률 그룹이 N 마필 이면 다음 그룹은 +N 등.
 */
export type PassrankGroup = { rank: number; chul_nos: number[] };

export function parsePassrank(s: string | null): PassrankGroup[] {
  if (!s) return [];

  // ^ (선두) 제거, 공백 정리.
  const cleaned = s.replace(/\^/g, "").replace(/\s+/g, " ").trim();

  // 토큰 추출 — 괄호 안의 ',' 는 동률(내부 sep). 괄호 밖의 ',' / '-' / '=' / '·'
  // 는 모두 등수 sep. 한 토큰 = 단일 숫자 또는 (n,n,...) 동률 그룹.
  const tokens: string[] = [];
  let buf = "";
  let depth = 0;
  for (const ch of cleaned) {
    if (ch === "(") {
      depth += 1;
      buf += ch;
    } else if (ch === ")") {
      depth = Math.max(0, depth - 1);
      buf += ch;
    } else if (
      depth === 0 &&
      (ch === "," || ch === "-" || ch === "=" || ch === "·" || ch === " ")
    ) {
      if (buf.trim()) tokens.push(buf.trim());
      buf = "";
    } else {
      buf += ch;
    }
  }
  if (buf.trim()) tokens.push(buf.trim());

  const groups: PassrankGroup[] = [];
  let currentRank = 1;
  for (const tok of tokens) {
    const inner = tok.replace(/[()]/g, "").trim();
    if (!inner) continue;
    const nos = inner
      .split(",")
      .map((x) => parseInt(x.trim(), 10))
      .filter((n) => Number.isFinite(n) && n > 0);
    if (nos.length === 0) continue;
    groups.push({ rank: currentRank, chul_nos: nos });
    currentRank += nos.length;
  }
  return groups;
}

/**
 * 통과순위 텍스트 시리즈 → 마필별 (chul_no) 통과순위 시계열.
 * 페이스 맵 UI 가 직접 호출.
 *
 * stage 별 그룹 → { chul_no: rank } map 으로 변환.
 */
export function passrankSeriesByHorse(
  stages: Array<{ key: string; text: string | null }>,
): { stageKeys: string[]; rankByHorse: Map<number, (number | null)[]> } {
  const stageKeys = stages.map((s) => s.key);
  const parsed = stages.map((s) => parsePassrank(s.text));

  // 등장하는 모든 chul_no 수집.
  const allHorses = new Set<number>();
  for (const groups of parsed) {
    for (const g of groups) for (const n of g.chul_nos) allHorses.add(n);
  }

  const rankByHorse = new Map<number, (number | null)[]>();
  for (const chul of allHorses) {
    const series: (number | null)[] = parsed.map((groups) => {
      for (const g of groups) {
        if (g.chul_nos.includes(chul)) return g.rank;
      }
      return null;
    });
    rankByHorse.set(chul, series);
  }
  return { stageKeys, rankByHorse };
}
