import { query } from "./db";

export type RaceInfo = {
  id: number;
  race_date: string;
  meet: string;
  race_no: number;
  race_name: string | null;
  distance: number | null;
  grade: string | null;
  track_type: string | null;
  track_condition: string | null;
  entry_count: number | null;
  start_time: string | null;  // HH:MM 발주시각 (KRA API 수집 시 채워짐)
};

export type RaceEntry = {
  rank: number | null;        // 경주 확정 후에만 채워짐 (phase='pre' 이면 항상 null)
  chul_no: number | null;     // 출전번호(gate #) — 경주 전 출전표 핵심 식별자
  horse_no: string;
  horse_name: string;
  jockey_name: string | null;
  trainer_name: string | null;
  trainer_no: string | null;  // trainers 테이블 LEFT JOIN — 매칭 안 되면 null (raw text 만 표시)
  record_time: string | null; // phase='pre' 이면 null (아직 뛰지 않음)
  weight: string | null;      // 마체중(kg)
  win_rate: string | null;   // 단승 배당률 (phase='pre' 이면 null — 배당은 확정 후)
  plc_rate: string | null;   // 연승 배당률 (phase='pre' 이면 null)
  // race_results.raw JSONB / race_entries 컬럼에서 추출한 부가 필드.
  age: string | null;         // 말 연령 (예: "4") — 양쪽 phase 에서 채워짐
  budam_weight: string | null; // 부담중량(kg) — 마체중(wgHr)과 별개의 핸디캡 중량. raw.wgBudam
  differ: string | null;       // 1착과의 착차 (예: "1", "코") — phase='post' 만. raw.differ
  hr_rating: number | null;    // 경주 시점의 말 레이팅 — 양쪽 phase (race_entries.rating / raw.hrRating)
  // 기수변경 (jockey_changes LEFT JOIN) — 출주표 발표 후 교체된 경우만 채워짐.
  jockey_changed_from: string | null;  // 변경 전 기수명 (jk_name_before)
  jockey_change_reason: string | null; // 사유 (예: "기수부상")
  // 교체 시 부담중량 변화 (kg) — 조교사가 기수 체중 차이를 반영해 부담중량을 조정.
  jockey_weight_before: string | null;
  jockey_weight_after: string | null;
};

/**
 * 경주 출전표/결과 조회 결과.
 * - phase='post': race_results 에 결과가 확정된 상태 (과거 경주). rank·record_time·단/연승 채워짐.
 * - phase='pre':  race_results 가 아직 비어 있어 race_entries(출마표, API26_2)로 폴백.
 *                 rank=null, record_time=null, win_rate/plc_rate=null. 대신 chul_no 가 채워짐.
 */
export type RaceEntriesResult = {
  phase: "pre" | "post";
  entries: RaceEntry[];
};

const RACE_COLUMNS = `
  id,
  to_char(race_date, 'YYYY-MM-DD') AS race_date,
  meet, race_no, race_name, distance, grade,
  track_type, track_condition, entry_count, start_time
`;

export async function getRecentRaces(limit = 20, meet?: string): Promise<RaceInfo[]> {
  if (meet) {
    return query<RaceInfo>(
      `SELECT ${RACE_COLUMNS}
         FROM races
        WHERE meet = $1
        ORDER BY race_date DESC, race_no
        LIMIT $2`,
      [meet, limit],
    );
  }
  return query<RaceInfo>(
    `SELECT ${RACE_COLUMNS}
       FROM races
      ORDER BY race_date DESC, race_no
      LIMIT $1`,
    [limit],
  );
}

export async function getUpcomingRaces(limit = 60, meet?: string): Promise<RaceInfo[]> {
  if (meet) {
    return query<RaceInfo>(
      `SELECT ${RACE_COLUMNS}
         FROM races
        WHERE race_date >= CURRENT_DATE AND meet = $1
        ORDER BY race_date ASC, race_no
        LIMIT $2`,
      [meet, limit],
    );
  }
  return query<RaceInfo>(
    `SELECT ${RACE_COLUMNS}
       FROM races
      WHERE race_date >= CURRENT_DATE
      ORDER BY race_date ASC, meet, race_no
      LIMIT $1`,
    [limit],
  );
}

/**
 * 오늘 이후(포함) 첫 번째로 경기가 있는 날의 모든 경주를 반환.
 * 대부분의 경우 주말 단위로 경기가 몰리므로 "다음 개최일" 전체를 가져와야
 * 대상/메인 경주를 뽑을 수 있다.
 */
export async function getNextRaceDayRaces(): Promise<RaceInfo[]> {
  return query<RaceInfo>(
    `SELECT ${RACE_COLUMNS}
       FROM races
      WHERE race_date = (
        SELECT MIN(race_date) FROM races WHERE race_date >= CURRENT_DATE
      )
      ORDER BY meet, race_no`,
    [],
  );
}

/**
 * 가장 최근 N개의 개최일에 속한 모든 경주를 반환 (최신일 먼저).
 * 메인 페이지에서 (날짜 × 경마장) 단위로 묶어 보여줄 때 사용.
 */
export async function getRecentRaceDaysRaces(days = 2): Promise<RaceInfo[]> {
  return query<RaceInfo>(
    `WITH recent_days AS (
       SELECT DISTINCT race_date
         FROM races
        WHERE race_date < CURRENT_DATE
        ORDER BY race_date DESC
        LIMIT $1
     )
     SELECT ${RACE_COLUMNS}
       FROM races
      WHERE race_date IN (SELECT race_date FROM recent_days)
      ORDER BY race_date DESC, meet, race_no`,
    [days],
  );
}

export async function getFutureRaces(limit = 90, meet?: string): Promise<RaceInfo[]> {
  if (meet) {
    return query<RaceInfo>(
      `SELECT ${RACE_COLUMNS}
         FROM races
        WHERE race_date > CURRENT_DATE AND meet = $1
        ORDER BY race_date ASC, race_no
        LIMIT $2`,
      [meet, limit],
    );
  }
  return query<RaceInfo>(
    `SELECT ${RACE_COLUMNS}
       FROM races
      WHERE race_date > CURRENT_DATE
      ORDER BY race_date ASC, meet, race_no
      LIMIT $1`,
    [limit],
  );
}

export async function getRacesByDate(date: string, meet?: string): Promise<RaceInfo[]> {
  if (meet) {
    return query<RaceInfo>(
      `SELECT ${RACE_COLUMNS}
         FROM races
        WHERE race_date = $1::date AND meet = $2
        ORDER BY race_no`,
      [date, meet],
    );
  }
  return query<RaceInfo>(
    `SELECT ${RACE_COLUMNS}
       FROM races
      WHERE race_date = $1::date
      ORDER BY meet, race_no`,
    [date],
  );
}

/** currentDate 기준 ±days 범위 내에서 경기가 있는 날짜 목록 반환 */
export async function getNearbyRaceDates(
  fromDate: string,
  days = 7,
): Promise<string[]> {
  const rows = await query<{ race_date: string }>(
    `SELECT DISTINCT to_char(race_date, 'YYYY-MM-DD') AS race_date
       FROM races
      WHERE race_date BETWEEN $1::date - ($2 * INTERVAL '1 day') AND $1::date + ($2 * INTERVAL '1 day')
      ORDER BY race_date`,
    [fromDate, days],
  );
  return rows.map((r) => r.race_date);
}

/**
 * fromDate 기준 ±months 개월 범위 내 경주가 있는 날짜 목록 (달력 하이라이트용).
 * DayPicker 의 modifiers 에 넘겨 "경주 있는 날" 을 금색으로 강조.
 */
export async function getAllRaceDates(
  fromDate: string,
  months = 3,
): Promise<string[]> {
  const rows = await query<{ race_date: string }>(
    `SELECT DISTINCT to_char(race_date, 'YYYY-MM-DD') AS race_date
       FROM races
      WHERE race_date BETWEEN $1::date - ($2 * INTERVAL '1 month') AND $1::date + ($2 * INTERVAL '1 month')
      ORDER BY race_date`,
    [fromDate, months],
  );
  return rows.map((r) => r.race_date);
}

export async function getAvailableMeets(): Promise<string[]> {
  const rows = await query<{ meet: string }>(
    `SELECT DISTINCT meet FROM races ORDER BY meet`,
    [],
  );
  return rows.map((r) => r.meet);
}

export async function getRaceEntries(
  raceDate: string,
  meet: string,
  raceNo: number,
): Promise<RaceEntriesResult> {
  // 확정된 결과(race_results) 우선. 없으면 출마표(race_entries)로 폴백해
  // 경주 전 페이지가 비어 보이지 않게 한다.
  const post = await query<RaceEntry>(
    // trainer JOIN 은 이름 매칭 — race_results.tr_no 가 백필되기 전까지의 임시 브릿지.
    // 동명이인 가능하나 실데이터상 충돌 거의 없음 (trainers ~333명).
    `SELECT r.rank, (r.raw->>'chulNo')::int AS chul_no,
            r.horse_no, h.horse_name,
            r.jockey_name, r.trainer_name,
            t.tr_no AS trainer_no,
            r.record_time::text, r.weight::text,
            d.win_rate::text AS win_rate,
            d.plc_rate::text AS plc_rate,
            r.raw->>'age' AS age,
            r.raw->>'wgBudam' AS budam_weight,
            r.raw->>'differ' AS differ,
            (r.raw->>'hrRating')::int AS hr_rating,
            jc.jk_name_before AS jockey_changed_from,
            jc.reason AS jockey_change_reason,
            jc.weight_before::text AS jockey_weight_before,
            jc.weight_after::text AS jockey_weight_after
       FROM race_results r
       JOIN horses h ON h.horse_no = r.horse_no
       LEFT JOIN trainers t ON t.tr_name = r.trainer_name
       LEFT JOIN race_dividends d
              ON d.race_date = r.race_date
             AND d.meet = r.meet
             AND d.race_no = r.race_no
             AND d.horse_no = (r.raw->>'chulNo')
       LEFT JOIN jockey_changes jc
              ON jc.race_date = r.race_date
             AND jc.meet = r.meet
             AND jc.race_no = r.race_no
             AND jc.horse_no = r.horse_no
      WHERE r.race_date = $1::date
        AND r.meet = $2
        AND r.race_no = $3
      ORDER BY r.rank NULLS LAST`,
    [raceDate, meet, raceNo],
  );
  if (post.length > 0) return { phase: "post", entries: post };

  // 경주 전 — race_entries(API26_2, 3시간 주기) 로부터 출전표를 구성.
  // 단/연승 배당은 결과 확정 후에만 존재하므로 null. 기수변경은 조기에 발표되는 경우도
  // 있으므로 LEFT JOIN 유지.
  const pre = await query<RaceEntry>(
    `SELECT NULL::int AS rank, e.chul_no,
            e.horse_no, e.horse_name,
            e.jockey_name, e.trainer_name,
            t.tr_no AS trainer_no,
            NULL::text AS record_time, e.weight::text,
            NULL::text AS win_rate, NULL::text AS plc_rate,
            e.age, e.raw->>'wgBudam' AS budam_weight,
            NULL::text AS differ, e.rating AS hr_rating,
            jc.jk_name_before AS jockey_changed_from,
            jc.reason AS jockey_change_reason,
            jc.weight_before::text AS jockey_weight_before,
            jc.weight_after::text AS jockey_weight_after
       FROM race_entries e
       LEFT JOIN trainers t ON t.tr_name = e.trainer_name
       LEFT JOIN jockey_changes jc
              ON jc.race_date = e.race_date
             AND jc.meet = e.meet
             AND jc.race_no = e.race_no
             AND jc.horse_no = e.horse_no
      WHERE e.race_date = $1::date
        AND e.meet = $2
        AND e.race_no = $3
      ORDER BY e.chul_no NULLS LAST`,
    [raceDate, meet, raceNo],
  );
  return { phase: "pre", entries: pre };
}

/**
 * 해당 경주의 출전표/성적이 크롤러에 의해 가장 최근에 수집/갱신된 시각.
 * `race_results.created_at` 은 per-row 삽입 시각이므로 MAX 를 "마지막 동기화"
 * 로 간주한다 (upsert 시 created_at 은 유지되지만, 새로 들어온 출전 row 가
 * 생기면 그 시점이 MAX 가 되므로 사실상 "가장 최근 sync" 와 동치).
 * 반환값은 ISO 8601 with offset (예: "2026-04-22 13:15:42+00").
 */
export async function getRaceDataSyncedAt(
  raceDate: string,
  meet: string,
  raceNo: number,
): Promise<string | null> {
  const rows = await query<{ synced_at: string | null }>(
    `SELECT MAX(created_at)::text AS synced_at
       FROM race_results
      WHERE race_date = $1::date
        AND meet = $2
        AND race_no = $3`,
    [raceDate, meet, raceNo],
  );
  return rows[0]?.synced_at ?? null;
}
