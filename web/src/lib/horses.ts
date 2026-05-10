import { query } from "./db";

export type Horse = {
  horse_no: string;
  horse_name: string;
  country: string | null;
  sex: string | null;
  birth_date: string | null;
  sire_name: string | null;
  dam_name: string | null;
  total_race_count: number;
  first_place_count: number;
  coat_color: string | null;
  characteristics: string[] | null;
  ow_no: string | null;       // 마주번호 (horses.ow_no 또는 raw->>'owNo' 폴백)
  owner_name: string | null;  // owners.ow_name (LEFT JOIN, 미등록 마주는 NULL)
};

export type RaceResult = {
  id: number;
  horse_no: string;
  race_date: string;
  meet: string | null;
  race_no: number;
  track_condition: string | null;
  rank: number | null;
  record_time: string | null;
  weight: string | null;
  jockey_name: string | null;
  trainer_name: string | null;
  trainer_no: string | null;  // trainers JOIN by name
};

const HORSE_COLUMNS = `
  h.horse_no, h.horse_name, h.country, h.sex,
  to_char(h.birth_date, 'YYYY-MM-DD') AS birth_date,
  h.sire_name, h.dam_name, h.total_race_count, h.first_place_count,
  h.coat_color, h.characteristics,
  COALESCE(h.ow_no, h.raw->>'owNo') AS ow_no,
  o.ow_name AS owner_name
`;

// horses 와 owners 의 LEFT JOIN — ow_no 가 채워져 있거나 raw 에 owNo 가 있을 때만 매칭.
const HORSE_FROM = `
  horses h
    LEFT JOIN owners o ON o.ow_no = COALESCE(h.ow_no, h.raw->>'owNo')
`;

export type HorseSearchMode = "name" | "year" | "age";

export type HorseSearchHit = {
  mode: HorseSearchMode;
  /** 매칭한 출생년도 — mode='year'|'age' 일 때만 채움. 표시용 힌트. */
  birthYear?: number;
  rows: Horse[];
};

/**
 * 마필 검색 — 입력 형태에 따라 자동 분기.
 *  - "2016", "2020" 등 4자리 연도   → 출생년도 일치
 *  - "5", "5세", "5살" 등 1~2자리   → 통상 나이 (당해년도 - 출생년도)
 *  - 그 외                          → 마명 부분일치 (ILIKE)
 */
export async function searchHorses(q: string, limit = 60): Promise<HorseSearchHit> {
  const trimmed = q.trim();
  if (!trimmed) return { mode: "name", rows: [] };

  const yearMatch = trimmed.match(/^(19|20)\d{2}$/);
  if (yearMatch) {
    const year = Number(trimmed);
    const rows = await query<Horse>(
      `SELECT ${HORSE_COLUMNS}
         FROM ${HORSE_FROM}
        WHERE EXTRACT(YEAR FROM h.birth_date) = $1
        ORDER BY h.horse_name
        LIMIT $2`,
      [year, limit],
    );
    return { mode: "year", birthYear: year, rows };
  }

  const ageMatch = trimmed.match(/^(\d{1,2})\s*(세|살)?$/);
  if (ageMatch) {
    const age = Number(ageMatch[1]);
    if (age >= 1 && age <= 30) {
      const birthYear = new Date().getFullYear() - age;
      const rows = await query<Horse>(
        `SELECT ${HORSE_COLUMNS}
           FROM ${HORSE_FROM}
          WHERE EXTRACT(YEAR FROM h.birth_date) = $1
          ORDER BY h.horse_name
          LIMIT $2`,
        [birthYear, limit],
      );
      return { mode: "age", birthYear, rows };
    }
  }

  const rows = await query<Horse>(
    `SELECT ${HORSE_COLUMNS}
       FROM ${HORSE_FROM}
      WHERE h.horse_name ILIKE $1
      ORDER BY h.horse_name
      LIMIT $2`,
    [`%${trimmed}%`, limit],
  );
  return { mode: "name", rows };
}

/** @deprecated use {@link searchHorses}. */
export async function searchHorsesByName(name: string, limit = 30): Promise<Horse[]> {
  const hit = await searchHorses(name, limit);
  return hit.rows;
}

export async function countAllHorses(): Promise<number> {
  const rows = await query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM horses`);
  return Number(rows[0]?.count ?? 0);
}

export async function getHorseByNo(horseNo: string): Promise<Horse | null> {
  const rows = await query<Horse>(
    `SELECT ${HORSE_COLUMNS} FROM ${HORSE_FROM} WHERE h.horse_no = $1`,
    [horseNo],
  );
  return rows[0] ?? null;
}

export async function getRecentHorses(limit = 20): Promise<Horse[]> {
  return query<Horse>(
    `SELECT ${HORSE_COLUMNS}
       FROM ${HORSE_FROM}
      ORDER BY h.created_at DESC
      LIMIT $1`,
    [limit],
  );
}

export type RecentWinner = Horse & {
  last_win_date: string;
  last_win_meet: string | null;
  win_count: number;
};

/** 가장 최근 1착 기록 기준으로 마필을 내림차순 반환. win_count는 race_results 집계값. */
export async function getRecentWinners(limit = 6): Promise<RecentWinner[]> {
  return query<RecentWinner>(
    `SELECT ${HORSE_COLUMNS},
            lw.last_win_date,
            lw.last_win_meet,
            lw.win_count
       FROM (
         SELECT DISTINCT ON (rr.horse_no)
                rr.horse_no,
                to_char(rr.race_date, 'YYYY-MM-DD') AS last_win_date,
                rr.meet                              AS last_win_meet,
                cnt.win_count
           FROM race_results rr
           JOIN (
                 SELECT horse_no, COUNT(*) AS win_count
                   FROM race_results
                  WHERE rank = 1
                  GROUP BY horse_no
                ) cnt ON cnt.horse_no = rr.horse_no
          WHERE rr.rank = 1
          ORDER BY rr.horse_no, rr.race_date DESC
       ) lw
       JOIN horses h ON h.horse_no = lw.horse_no
       LEFT JOIN owners o ON o.ow_no = COALESCE(h.ow_no, h.raw->>'owNo')
      ORDER BY lw.last_win_date DESC
      LIMIT $1`,
    [limit],
  );
}

export type HorseSort = "latest" | "wins";
export type HorseAgeBucket = "under5" | "under10" | "over11";

function ageWhereClause(bucket: HorseAgeBucket): string {
  // KRA 한국 마령은 만 나이 기준이 아닌 출생연도 기준 — 같은 해 출생은 동일 마령.
  // 따라서 'EXTRACT(YEAR FROM age)' 보다 birth_date 범위 비교가 정확.
  switch (bucket) {
    case "under5":
      return "h.birth_date >= (CURRENT_DATE - INTERVAL '5 years')";
    case "under10":
      return "h.birth_date >= (CURRENT_DATE - INTERVAL '10 years')";
    case "over11":
      return "h.birth_date <= (CURRENT_DATE - INTERVAL '11 years')";
  }
}

export type HorseSexFilter = "all" | "수" | "암" | "거";
export type HorseCountryFilter = "all" | "domestic" | "foreign";

/** /horses 페이지용 정렬 + 나이/성별/산지 필터 쿼리. */
export async function getHorsesSorted(
  sort: HorseSort = "wins",
  ageBucket: HorseAgeBucket = "under5",
  sexFilter: HorseSexFilter = "all",
  countryFilter: HorseCountryFilter = "all",
  limit = 60,
): Promise<Horse[]> {
  const order =
    sort === "wins"
      ? "h.first_place_count DESC, h.total_race_count DESC, h.created_at DESC"
      : "h.created_at DESC";

  const where: string[] = [ageWhereClause(ageBucket)];
  const params: unknown[] = [limit];

  if (sexFilter !== "all") {
    params.push(`${sexFilter}%`);
    where.push(`h.sex LIKE $${params.length}`);
  }
  if (countryFilter === "domestic") {
    where.push(`h.country = '국내산'`);
  } else if (countryFilter === "foreign") {
    where.push(`(h.country IS NOT NULL AND h.country <> '국내산')`);
  }

  return query<Horse>(
    `SELECT ${HORSE_COLUMNS}
       FROM ${HORSE_FROM}
       WHERE ${where.join(" AND ")}
      ORDER BY ${order}
      LIMIT $1`,
    params,
  );
}

// raw->>'rcTime' 이 "1:49.0" 형식이라 NUMERIC record_time 파싱이 실패하는 row 가 다수.
// 두 곳에서 (mine CTE + LATERAL subquery) 모두 alias `rr` 기준으로 사용.
const RC_TIME_SECONDS_SQL = `
  CASE
    WHEN rr.record_time IS NOT NULL THEN rr.record_time
    WHEN rr.raw->>'rcTime' ~ '^[0-9]+:[0-9]+(\\.[0-9]+)?$'
      THEN (split_part(rr.raw->>'rcTime', ':', 1)::numeric * 60
          + split_part(rr.raw->>'rcTime', ':', 2)::numeric)
    WHEN rr.raw->>'rcTime' ~ '^[0-9]+(\\.[0-9]+)?$'
      THEN (rr.raw->>'rcTime')::numeric
    ELSE NULL
  END
`;

/**
 * mal지수 (MSF, mal Speed Figure) — 단순형.
 *
 * 정의: 같은 경주의 1착 record_time 을 기준으로 100 으로 잡고,
 *       본인 기록을 ratio 로 환산한 뒤 100 점 만점 스케일로 표시.
 *
 *   msf = 1착_시간 / 본인_시간 * 100
 *
 * 같은 경주 (= 같은 거리·코스·주로상태) 내 비교라 보정 무관.
 * 1착이면 100, 1착보다 1% 느리면 99, 5% 느리면 95.
 *
 * 한계:
 *   - 거리·트랙 다른 경주 간 절대비교는 안 됨 → 같은 마필의 시즌 추세는 OK
 *   - 1착보다 빠를 수는 없음 (당연)
 *   - 결과 미수집 race (1착 record_time NULL) 는 NULL
 */
export function computeMsf(record: number | null | undefined, winnerTime: number | null | undefined): number | null {
  if (!record || !winnerTime || record <= 0 || winnerTime <= 0) return null;
  return Math.round((winnerTime / record) * 100 * 10) / 10; // 1소수점
}

export type RaceWithMsf = RaceResult & { msf: number | null };

/**
 * 마필의 경주 기록 + msf 동시 조회.
 * 같은 (race_date, meet, race_no) 의 1착 record_time 을 window function 으로 가져와 비율 계산.
 */
export async function getRaceResultsWithMsf(
  horseNo: string,
  limit = 10,
): Promise<RaceWithMsf[]> {
  // 같은 race 의 모든 row 를 같이 가져와 1착의 record_time 을 PARTITION 으로 추출.
  // race_results 의 record_time 은 NUMERIC. raw->>'rcTime' 은 표시용 텍스트.
  const rows = await query<{
    id: number;
    horse_no: string;
    race_date: string;
    meet: string | null;
    race_no: number;
    track_condition: string | null;
    rank: number | null;
    record_time_text: string | null;
    record_time_num: string | null;
    weight: string | null;
    jockey_name: string | null;
    trainer_name: string | null;
    trainer_no: string | null;
    winner_time: string | null;
  }>(
    // 동일 race 의 1착 record_time 을 LATERAL subquery 로 N+1 회피 + cartesian 방지.
    `WITH mine AS (
       SELECT rr.*,
              ${RC_TIME_SECONDS_SQL} AS my_seconds
         FROM race_results rr
        WHERE rr.horse_no = $1
        ORDER BY rr.race_date DESC, rr.race_no DESC
        LIMIT $2
     )
     SELECT m.id, m.horse_no,
            to_char(m.race_date, 'YYYY-MM-DD') AS race_date,
            m.meet, m.race_no, m.track_condition, m.rank,
            COALESCE(NULLIF(NULLIF(m.raw->>'rcTime','-'),''), m.record_time::text) AS record_time_text,
            m.my_seconds::text AS record_time_num,
            m.weight::text,
            m.jockey_name, m.trainer_name,
            t.tr_no AS trainer_no,
            w.winner_time::text AS winner_time
       FROM mine m
       LEFT JOIN trainers t ON t.tr_name = m.trainer_name
       LEFT JOIN LATERAL (
         SELECT MIN(${RC_TIME_SECONDS_SQL}) AS winner_time
           FROM race_results rr
          WHERE rr.race_date = m.race_date
            AND rr.meet      = m.meet
            AND rr.race_no   = m.race_no
            AND rr.rank = 1
       ) w ON TRUE
      ORDER BY m.race_date DESC, m.race_no DESC`,
    [horseNo, limit],
  );

  return rows.map((r) => {
    const myTime = r.record_time_num ? Number(r.record_time_num) : null;
    const winTime = r.winner_time ? Number(r.winner_time) : null;
    return {
      id: r.id,
      horse_no: r.horse_no,
      race_date: r.race_date,
      meet: r.meet,
      race_no: r.race_no,
      track_condition: r.track_condition,
      rank: r.rank,
      record_time: r.record_time_text,
      weight: r.weight,
      jockey_name: r.jockey_name,
      trainer_name: r.trainer_name,
      trainer_no: r.trainer_no,
      msf: computeMsf(myTime, winTime),
    };
  });
}

/**
 * 출주마 비교용 sumamry — 다수 horse_no 한번에 조회.
 * race detail 의 비교 카드에서 사용.
 */
export type HorseCompareSummary = {
  horse_no: string;
  horse_name: string;
  total_race_count: number;
  first_place_count: number;
  second_place_count: number;
  third_place_count: number;
  /** 최근 5전 착순 (oldest-first, 표시 시 그대로 사용) */
  recent_finishes: (number | null)[];
  /** 최근 10전 평균 mal지수 (NULL 제외 평균). 데이터 없으면 null. */
  avg_msf: number | null;
  /** 최근 10전 최고 mal지수. */
  best_msf: number | null;
};

export async function getHorseCompareSummaries(
  horseNos: string[],
): Promise<HorseCompareSummary[]> {
  if (horseNos.length === 0) return [];
  const placeholders = horseNos.map((_, i) => `$${i + 1}`).join(", ");

  // 한 번 조회로: 마필 마스터 + race_results 집계 + 최근 mal지수 평균/최고.
  // 최근 mal지수는 본인 record_time 과 같은 race 1착 record_time 비율.
  const rows = await query<{
    horse_no: string;
    horse_name: string;
    total_race_count: number;
    first_place_count: number;
    second_place_count: number;
    third_place_count: number;
    avg_msf: string | null;
    best_msf: string | null;
  }>(
    `WITH recent AS (
       SELECT rr.horse_no,
              rr.race_date,
              rr.race_no,
              rr.meet,
              ROW_NUMBER() OVER (PARTITION BY rr.horse_no ORDER BY rr.race_date DESC, rr.race_no DESC) AS rn,
              ${RC_TIME_SECONDS_SQL} AS my_seconds
         FROM race_results rr
        WHERE rr.horse_no IN (${placeholders})
     ),
     msf_calc AS (
       SELECT r.horse_no,
              CASE WHEN r.my_seconds > 0 AND w.winner_time > 0
                   THEN (w.winner_time / r.my_seconds * 100.0) END AS msf
         FROM recent r
         LEFT JOIN LATERAL (
           SELECT MIN(${RC_TIME_SECONDS_SQL}) AS winner_time
             FROM race_results rr
            WHERE rr.race_date = r.race_date
              AND rr.meet      = r.meet
              AND rr.race_no   = r.race_no
              AND rr.rank = 1
         ) w ON TRUE
        WHERE r.rn <= 10
     ),
     stats AS (
       SELECT rr.horse_no,
              COUNT(*) FILTER (WHERE rr.rank = 2)::int AS second_place_count,
              COUNT(*) FILTER (WHERE rr.rank = 3)::int AS third_place_count
         FROM race_results rr
        WHERE rr.horse_no IN (${placeholders})
        GROUP BY rr.horse_no
     )
     SELECT h.horse_no, h.horse_name,
            h.total_race_count, h.first_place_count,
            COALESCE(s.second_place_count, 0) AS second_place_count,
            COALESCE(s.third_place_count, 0) AS third_place_count,
            (SELECT AVG(msf)::numeric(6,1) FROM msf_calc m WHERE m.horse_no = h.horse_no AND msf IS NOT NULL)::text AS avg_msf,
            (SELECT MAX(msf)::numeric(6,1) FROM msf_calc m WHERE m.horse_no = h.horse_no AND msf IS NOT NULL)::text AS best_msf
       FROM horses h
       LEFT JOIN stats s ON s.horse_no = h.horse_no
      WHERE h.horse_no IN (${placeholders})`,
    horseNos,
  );

  // 최근 5전 finishes 별도 조회 (마필별 5 row × N 마필 — 작아서 OK).
  const finishesRows = await query<{ horse_no: string; rank: number | null; rn: number }>(
    `SELECT horse_no, rank, rn FROM (
       SELECT rr.horse_no, rr.rank,
              ROW_NUMBER() OVER (PARTITION BY rr.horse_no ORDER BY rr.race_date DESC, rr.race_no DESC) AS rn
         FROM race_results rr
        WHERE rr.horse_no IN (${placeholders})
     ) ord
     WHERE rn <= 5`,
    horseNos,
  );
  const finishesByHorse = new Map<string, (number | null)[]>();
  for (const f of finishesRows) {
    const arr = finishesByHorse.get(f.horse_no) ?? [];
    arr.push(f.rank);
    finishesByHorse.set(f.horse_no, arr);
  }

  return rows.map((r) => ({
    horse_no: r.horse_no,
    horse_name: r.horse_name,
    total_race_count: Number(r.total_race_count),
    first_place_count: Number(r.first_place_count),
    second_place_count: Number(r.second_place_count),
    third_place_count: Number(r.third_place_count),
    // ROW_NUMBER 는 최신부터 1 → reverse 로 oldest-first 만들기.
    recent_finishes: (finishesByHorse.get(r.horse_no) ?? []).reverse(),
    avg_msf: r.avg_msf !== null ? Number(r.avg_msf) : null,
    best_msf: r.best_msf !== null ? Number(r.best_msf) : null,
  }));
}

/** mal지수 시계열 (오래된 순). sparkline 용. */
export async function getMsfHistory(
  horseNo: string,
  limit = 20,
): Promise<{ race_date: string; msf: number }[]> {
  const rows = await query<{ race_date: string; record_time_num: string | null; winner_time: string | null }>(
    `WITH mine AS (
       SELECT rr.race_date, rr.race_no, rr.meet,
              ${RC_TIME_SECONDS_SQL} AS my_seconds
         FROM race_results rr
        WHERE rr.horse_no = $1
        ORDER BY rr.race_date DESC, rr.race_no DESC
        LIMIT $2
     )
     SELECT to_char(m.race_date,'YYYY-MM-DD') AS race_date,
            m.my_seconds::text AS record_time_num,
            w.winner_time::text AS winner_time
       FROM mine m
       LEFT JOIN LATERAL (
         SELECT MIN(${RC_TIME_SECONDS_SQL}) AS winner_time
           FROM race_results rr
          WHERE rr.race_date = m.race_date
            AND rr.meet      = m.meet
            AND rr.race_no   = m.race_no
            AND rr.rank = 1
       ) w ON TRUE
      ORDER BY m.race_date DESC, m.race_no DESC`,
    [horseNo, limit],
  );
  // 오래된 순으로 뒤집어 반환.
  return rows
    .reverse()
    .map((r) => {
      const my = r.record_time_num ? Number(r.record_time_num) : null;
      const win = r.winner_time ? Number(r.winner_time) : null;
      const m = computeMsf(my, win);
      return m !== null ? { race_date: r.race_date, msf: m } : null;
    })
    .filter((x): x is { race_date: string; msf: number } => x !== null);
}

/** 최근 N전의 착순 시퀀스 (최신이 마지막). null = 미확정/취소. */
export async function getRecentFinishes(
  horseNo: string,
  limit = 5,
): Promise<(number | null)[]> {
  const rows = await query<{ rank: number | null }>(
    `SELECT rr.rank
       FROM race_results rr
      WHERE rr.horse_no = $1
      ORDER BY rr.race_date DESC, rr.race_no DESC
      LIMIT $2`,
    [horseNo, limit],
  );
  // 표시는 오래된 순 → 최신 순 (왼쪽 oldest, 오른쪽 latest).
  return rows.map((r) => (r.rank ?? null)).reverse();
}

export type FormRow = {
  /** 표시용 라벨 — "1400m" / "잔디" / "건조" / "서울" 등 */
  bucket: string;
  /** 정렬용 숫자 키 (없으면 0) — 거리 그룹은 거리, 그 외는 0 */
  sortKey: number;
  starts: number;
  win: number;
  place: number;
  show: number;
  /** win / starts (0..1) */
  win_rate: number;
  /** (win+place+show) / starts (0..1) */
  in_money_rate: number;
  /** 1착 평균 record_time (초) — 비교용. 1착 없으면 null */
  best_time: number | null;
};

export type FormBreakdown = {
  by_distance: FormRow[];
  by_track_type: FormRow[];
  by_track_condition: FormRow[];
  by_meet: FormRow[];
};

/**
 * 마필의 조건별 폼 분해. race_results 와 races (거리/주로타입) 을 JOIN.
 * 첫 컷은 단순 SELECT 4개. 향후 캐싱 가능.
 */
export async function getHorseFormBreakdown(
  horseNo: string,
): Promise<FormBreakdown> {
  // 공통: rr.record_time 이 NULL 인 row 가 많아 raw->>'rcTime' 폴백.
  // 분 표기("1:22.4") 는 복원 어려우니 best_time 은 NUMERIC 컬럼 기준 평균만.
  const SELECT_FIELDS = `
    COUNT(*)::int AS starts,
    SUM(CASE WHEN rr.rank = 1 THEN 1 ELSE 0 END)::int AS win,
    SUM(CASE WHEN rr.rank = 2 THEN 1 ELSE 0 END)::int AS place,
    SUM(CASE WHEN rr.rank = 3 THEN 1 ELSE 0 END)::int AS show_,
    AVG(CASE WHEN rr.rank = 1 THEN rr.record_time END) AS best_time
  `;

  // races 테이블에 매칭이 약한 row 가 많아 raw->>'rcDist' / 'track' 폴백.
  const distanceRows = await query<{
    distance: number | null;
    starts: number;
    win: number;
    place: number;
    show_: number;
    best_time: string | null;
  }>(
    `SELECT COALESCE(r.distance, NULLIF(rr.raw->>'rcDist','')::int) AS distance,
            ${SELECT_FIELDS}
       FROM race_results rr
       LEFT JOIN races r
         ON r.race_date = rr.race_date AND r.meet = rr.meet AND r.race_no = rr.race_no
      WHERE rr.horse_no = $1
      GROUP BY COALESCE(r.distance, NULLIF(rr.raw->>'rcDist','')::int)
     HAVING COALESCE(r.distance, NULLIF(rr.raw->>'rcDist','')::int) IS NOT NULL
      ORDER BY COALESCE(r.distance, NULLIF(rr.raw->>'rcDist','')::int)`,
    [horseNo],
  );

  // race_results.raw 의 track 필드(잔디/모래)는 'track' 또는 'trkNm' 두 케이스 존재.
  const trackRows = await query<{
    track_type: string | null;
    starts: number;
    win: number;
    place: number;
    show_: number;
    best_time: string | null;
  }>(
    `WITH base AS (
       SELECT rr.*,
              COALESCE(r.track_type,
                       NULLIF(rr.raw->>'trkNm',''),
                       NULLIF(rr.raw->>'track','')) AS tt
         FROM race_results rr
         LEFT JOIN races r
           ON r.race_date = rr.race_date AND r.meet = rr.meet AND r.race_no = rr.race_no
        WHERE rr.horse_no = $1
     )
     SELECT tt AS track_type,
            ${SELECT_FIELDS}
       FROM base rr
      WHERE tt IS NOT NULL
      GROUP BY tt
      ORDER BY tt`,
    [horseNo],
  );

  const condRows = await query<{
    track_condition: string | null;
    starts: number;
    win: number;
    place: number;
    show_: number;
    best_time: string | null;
  }>(
    `SELECT rr.track_condition,
            ${SELECT_FIELDS}
       FROM race_results rr
      WHERE rr.horse_no = $1 AND rr.track_condition IS NOT NULL
      GROUP BY rr.track_condition
      ORDER BY rr.track_condition`,
    [horseNo],
  );

  const meetRows = await query<{
    meet: string | null;
    starts: number;
    win: number;
    place: number;
    show_: number;
    best_time: string | null;
  }>(
    `SELECT rr.meet,
            ${SELECT_FIELDS}
       FROM race_results rr
      WHERE rr.horse_no = $1 AND rr.meet IS NOT NULL
      GROUP BY rr.meet
      ORDER BY rr.meet`,
    [horseNo],
  );

  const toRow = (
    bucket: string,
    sortKey: number,
    r: { starts: number; win: number; place: number; show_: number; best_time: string | null },
  ): FormRow => {
    const starts = Number(r.starts);
    const win = Number(r.win);
    const place = Number(r.place);
    const show = Number(r.show_);
    return {
      bucket,
      sortKey,
      starts,
      win,
      place,
      show,
      win_rate: starts > 0 ? win / starts : 0,
      in_money_rate: starts > 0 ? (win + place + show) / starts : 0,
      best_time: r.best_time !== null ? Number(r.best_time) : null,
    };
  };

  return {
    by_distance: distanceRows.map((r) =>
      toRow(`${r.distance}m`, r.distance ?? 0, r),
    ),
    by_track_type: trackRows.map((r) => toRow(r.track_type ?? "-", 0, r)),
    by_track_condition: condRows.map((r) =>
      toRow(r.track_condition ?? "-", 0, r),
    ),
    by_meet: meetRows.map((r) => toRow(r.meet ?? "-", 0, r)),
  };
}

export async function getRaceResultsForHorse(
  horseNo: string,
  limit = 10,
): Promise<RaceResult[]> {
  return query<RaceResult>(
    // record_time(NUMERIC) 은 KRA rcTime "1:22.4" 가 float() 파싱 실패로 NULL 인 경우가 많다.
    // 표시용으로는 raw->>'rcTime' (이미 "M:SS.f" 형식) 을 우선 사용하고, 없을 때만 컬럼값.
    `SELECT rr.id, rr.horse_no,
            to_char(rr.race_date, 'YYYY-MM-DD') AS race_date,
            rr.meet, rr.race_no, rr.track_condition, rr.rank,
            COALESCE(NULLIF(NULLIF(rr.raw->>'rcTime', '-'), ''), rr.record_time::text) AS record_time,
            rr.weight::text,
            rr.jockey_name, rr.trainer_name,
            t.tr_no AS trainer_no
       FROM race_results rr
       LEFT JOIN trainers t ON t.tr_name = rr.trainer_name
      WHERE rr.horse_no = $1
      ORDER BY rr.race_date DESC, rr.race_no DESC
      LIMIT $2`,
    [horseNo, limit],
  );
}

/**
 * 주어진 horse_no 를 sire_no 또는 dam_no 로 가진 마필(자식) 목록.
 * DB 미수집 부모 페이지에서 "이 마필을 부모로 둔 자식들" 표시용.
 */
export async function getChildrenByParentNo(
  parentNo: string,
  limit = 30,
): Promise<Horse[]> {
  return query<Horse>(
    `SELECT ${HORSE_COLUMNS}
       FROM ${HORSE_FROM}
      WHERE h.sire_no = $1 OR h.dam_no = $1
      ORDER BY h.birth_date DESC NULLS LAST
      LIMIT $2`,
    [parentNo, limit],
  );
}

export async function getSiblings(sireName: string | null, excludeHorseNo: string): Promise<Horse[]> {
  if (!sireName) return [];
  return query<Horse>(
    `SELECT ${HORSE_COLUMNS}
       FROM ${HORSE_FROM}
      WHERE h.sire_name = $1 AND h.horse_no <> $2
      ORDER BY h.birth_date DESC NULLS LAST
      LIMIT 12`,
    [sireName, excludeHorseNo],
  );
}

/* ── Pedigree (ancestors) ─────────────────────────────── */

export type PedigreeNode = {
  id: string;                    // horse_no, 또는 `__stub_...` (DB 미등록 조상)
  horse_no: string | null;       // DB에 있는 경우만 값, 없으면 null
  name: string;
  gender: "Male" | "Female" | "Unknown";
  country: string | null;
  birthYear: string | null;
  gradeWinner: boolean;
  stats?: Record<string, string | number>;
  sire?: PedigreeNode | null;
  dam?: PedigreeNode | null;
};

type AncestryRow = {
  horse_no: string;
  horse_name: string;
  sex: string | null;
  birth_date: string | null;
  country: string | null;
  sire_name: string | null;
  sire_no: string | null;
  dam_name: string | null;
  dam_no: string | null;
  total_race_count: number;
  first_place_count: number;
  gen: number;
  parent_horse_no: string | null;
  side: "sire" | "dam" | null;
};

function mapGender(side: "sire" | "dam" | null, sex: string | null): "Male" | "Female" | "Unknown" {
  if (side === "sire") return "Male";
  if (side === "dam") return "Female";
  if (!sex) return "Unknown";
  if (sex.startsWith("수") || sex.startsWith("거")) return "Male";
  if (sex.startsWith("암")) return "Female";
  return "Unknown";
}

export async function getPedigree(
  rootHorseNo: string,
  maxGenerations = 4,
): Promise<PedigreeNode | null> {
  // 마이그레이션 019 이후: horses.sire_no/dam_no 가 채워져 있어 ID-기반 traversal.
  // 폴백: sire_no 가 NULL 이면 sire_name 으로 fuzzy match (구버전 데이터).
  const rows = await query<AncestryRow>(
    `
    WITH RECURSIVE ancestry AS (
      SELECT horse_no, horse_name, sex,
             to_char(birth_date, 'YYYY-MM-DD') AS birth_date,
             country, sire_name, sire_no, dam_name, dam_no,
             total_race_count, first_place_count,
             0 AS gen,
             ARRAY[horse_no]::text[] AS path,
             NULL::text AS parent_horse_no,
             NULL::text AS side
        FROM horses
       WHERE horse_no = $1
      UNION ALL
      SELECT h.horse_no, h.horse_name, h.sex,
             to_char(h.birth_date, 'YYYY-MM-DD') AS birth_date,
             h.country, h.sire_name, h.sire_no, h.dam_name, h.dam_no,
             h.total_race_count, h.first_place_count,
             a.gen + 1,
             a.path || h.horse_no,
             a.horse_no,
             s.side
        FROM ancestry a
        CROSS JOIN LATERAL (
          VALUES ('sire'::text, a.sire_no, a.sire_name),
                 ('dam'::text,  a.dam_no,  a.dam_name)
        ) AS s(side, ancestor_no, ancestor_name)
        JOIN LATERAL (
          SELECT * FROM (
            -- 1순위: ID 매칭 (정확)
            SELECT h2.*, 0 AS prio FROM horses h2
             WHERE s.ancestor_no IS NOT NULL AND h2.horse_no = s.ancestor_no
            UNION ALL
            -- 2순위: ID 가 없을 때만 이름 매칭 (구버전 fallback)
            SELECT h2.*, 1 AS prio FROM horses h2
             WHERE s.ancestor_no IS NULL
               AND s.ancestor_name IS NOT NULL
               AND h2.horse_name = s.ancestor_name
          ) cands
          ORDER BY prio ASC, cands.birth_date ASC NULLS LAST
          LIMIT 1
        ) h ON TRUE
       WHERE a.gen < $2
         AND (s.ancestor_no IS NOT NULL OR s.ancestor_name IS NOT NULL)
         AND NOT (h.horse_no = ANY(a.path))
    )
    SELECT horse_no, horse_name, sex, birth_date, country,
           sire_name, sire_no, dam_name, dam_no,
           total_race_count, first_place_count,
           gen, parent_horse_no, side
      FROM ancestry
    `,
    [rootHorseNo, maxGenerations],
  );

  if (rows.length === 0) return null;

  const childrenMap = new Map<string, { sire?: AncestryRow; dam?: AncestryRow }>();
  for (const r of rows) {
    if (!r.parent_horse_no || !r.side) continue;
    const slot = childrenMap.get(r.parent_horse_no) ?? {};
    slot[r.side] = r;
    childrenMap.set(r.parent_horse_no, slot);
  }

  const stub = (name: string, side: "sire" | "dam", no?: string | null): PedigreeNode => ({
    id: no ?? `__stub_${name}`,
    horse_no: no ?? null,
    name,
    gender: side === "sire" ? "Male" : "Female",
    country: null,
    birthYear: null,
    gradeWinner: false,
  });

  const build = (row: AncestryRow, side: "sire" | "dam" | null): PedigreeNode => {
    const kids = childrenMap.get(row.horse_no);
    const gradeWinner = row.first_place_count > 0;
    return {
      id: row.horse_no,
      horse_no: row.horse_no,
      name: row.horse_name,
      gender: mapGender(side, row.sex),
      country: row.country,
      birthYear: row.birth_date ? row.birth_date.slice(0, 4) : null,
      gradeWinner,
      stats: {
        출전: row.total_race_count,
        "1착": row.first_place_count,
      },
      sire: kids?.sire
        ? build(kids.sire, "sire")
        : row.sire_name
          ? stub(row.sire_name, "sire", row.sire_no)
          : null,
      dam: kids?.dam
        ? build(kids.dam, "dam")
        : row.dam_name
          ? stub(row.dam_name, "dam", row.dam_no)
          : null,
    };
  };

  const rootRow = rows.find((r) => r.gen === 0);
  return rootRow ? build(rootRow, null) : null;
}
