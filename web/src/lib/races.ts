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
  rank: number | null;
  horse_no: string;
  horse_name: string;
  jockey_name: string | null;
  record_time: string | null;
  weight: string | null;
  win_rate: string | null;   // 단승 배당률 (모든 출주마)
  plc_rate: string | null;   // 연승 배당률 (모든 출주마)
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
): Promise<RaceEntry[]> {
  return query<RaceEntry>(
    `SELECT r.rank, r.horse_no, h.horse_name,
            r.jockey_name, r.record_time::text, r.weight::text,
            d.win_rate::text AS win_rate,
            d.plc_rate::text AS plc_rate
       FROM race_results r
       JOIN horses h ON h.horse_no = r.horse_no
       LEFT JOIN race_dividends d
              ON d.race_date = r.race_date
             AND d.meet = r.meet
             AND d.race_no = r.race_no
             AND d.horse_no = (r.raw->>'chulNo')
      WHERE r.race_date = $1::date
        AND r.meet = $2
        AND r.race_no = $3
      ORDER BY r.rank NULLS LAST`,
    [raceDate, meet, raceNo],
  );
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
