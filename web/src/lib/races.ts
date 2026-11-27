import { query } from "./db";
import { normMeetSql, storedMeetLabels } from "./meets";

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
  // 해당 경주에 race_results.rank 가 적재됐는지. "종료" 판정에 사용.
  // mergedRacesSql 을 쓰는 모든 쿼리에서 채워짐.
  has_results: boolean;
};

export type RaceEntry = {
  rank: number | null;        // 경주 확정 후에만 채워짐 (phase='pre' 이면 항상 null)
  chul_no: number | null;     // 출전번호(gate #) — 경주 전 출전표 핵심 식별자
  horse_no: string;
  horse_name: string;
  jockey_name: string | null;
  jockey_no: string | null;   // jockeys 테이블 LEFT JOIN — 매칭 안 되면 null (이름만 표시)
  trainer_name: string | null;
  trainer_no: string | null;  // trainers 테이블 LEFT JOIN — 매칭 안 되면 null (raw text 만 표시)
  record_time: string | null; // phase='pre' 이면 null (아직 뛰지 않음)
  weight: string | null;      // 마체중(kg)
  win_rate: string | null;   // 단승 배당률 (phase='pre' 이면 null — 배당은 확정 후)
  plc_rate: string | null;   // 연승 배당률 (phase='pre' 이면 null)
  // race_results.raw JSONB / race_entries 컬럼에서 추출한 부가 필드.
  age: string | null;         // 말 연령 (예: "4") — 양쪽 phase 에서 채워짐
  sex: string | null;         // 말 성별 (horses.sex, 예: "수4", "암3", "거6")
  budam_weight: string | null; // 부담중량(kg) — 마체중(wgHr)과 별개의 핸디캡 중량. raw.wgBudam
  differ: string | null;       // 1착과의 착차 (예: "1", "코") — phase='post' 만. raw.differ
  hr_rating: number | null;    // 경주 시점의 말 레이팅 — 양쪽 phase (race_entries.rating / raw.hrRating)
  weight_diff: number | null;  // 직전 경주 마체중과의 ± 차이 (kg). 직전 경주 없으면 null.
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

const R_MEET = normMeetSql("r.meet");

/** 같은 경주의 두 라벨 행에서 값이 있는 쪽을 고른다 (정규 라벨 행 우선). */
function pickMerged(col: string): string {
  return `(array_agg(r.${col} ORDER BY (r.meet <> ${R_MEET}), r.meet)
            FILTER (WHERE r.${col} IS NOT NULL))[1] AS ${col}`;
}

/**
 * races 를 (race_date, 정규 meet, race_no) 한 행으로 합쳐 RaceInfo 컬럼으로 내보내는 SELECT.
 *
 * 부경은 같은 경주가 '부경'·'부산경남' 두 행으로 따로 있다 (한쪽엔 발주시각·거리, 다른 쪽엔
 * 등급·출전두수). 라벨 그대로 읽으면 화면의 '부경' 경주에 결과·출전표가 붙지 않는다.
 * `where` 는 races r 에 거는 조건 — 날짜로 좁혀야 한다 (전체를 합치면 느리다).
 */
function mergedRacesSql(where: string): string {
  return `
    SELECT m.id,
           to_char(m.race_day, 'YYYY-MM-DD') AS race_date,
           m.meet, m.race_no, m.race_name, m.distance, m.grade,
           m.track_type, m.track_condition, m.entry_count, m.start_time,
           EXISTS (SELECT 1 FROM race_results rr
                    WHERE rr.race_date = m.race_day
                      AND ${normMeetSql("rr.meet")} = m.meet
                      AND rr.race_no = m.race_no
                      AND rr.rank IS NOT NULL) AS has_results
      FROM (
            SELECT MIN(r.id) AS id,
                   r.race_date AS race_day,
                   ${R_MEET} AS meet,
                   r.race_no,
                   ${pickMerged("race_name")},
                   ${pickMerged("distance")},
                   ${pickMerged("grade")},
                   ${pickMerged("track_type")},
                   ${pickMerged("track_condition")},
                   ${pickMerged("entry_count")},
                   ${pickMerged("start_time")}
              FROM races r
             WHERE ${where}
             GROUP BY r.race_date, ${R_MEET}, r.race_no
           ) m`;
}

// "오늘" 비교는 항상 KST. DB 기본 시간대(UTC)의 CURRENT_DATE 를 그대로 쓰면
// 자정~9시(KST) 구간에 어제/오늘 경계가 어긋나 어제 끝난 경기가 "다음 경기"로
// 잡히는 버그가 난다. 모든 race_date 비교는 이 헬퍼를 사용.
const KST_TODAY = `(NOW() AT TIME ZONE 'Asia/Seoul')::date`;

/**
 * 오늘 이후(포함) 첫 번째로 경기가 있는 날의 모든 경주를 반환.
 * 대부분의 경우 주말 단위로 경기가 몰리므로 "다음 개최일" 전체를 가져와야
 * 대상/메인 경주를 뽑을 수 있다.
 */
export async function getNextRaceDayRaces(): Promise<RaceInfo[]> {
  return query<RaceInfo>(
    `${mergedRacesSql(`r.race_date = (
        SELECT MIN(race_date) FROM races WHERE race_date >= ${KST_TODAY}
      )`)}
      ORDER BY m.meet, m.race_no`,
    [],
  );
}

/**
 * 가장 최근 N개의 개최일에 속한 모든 경주를 반환 (최신일 먼저).
 * 메인 페이지에서 (날짜 × 경마장) 단위로 묶어 보여줄 때 사용.
 *
 * "끝난 개최일" 판정: 결과(rank) 가 1건 이상 적재됐거나, KRBC 영상이 1건 이상
 * 등록된 날. 결과는 KRA OpenAPI(live 30분 · 23:05 backstop) 가 늦을 수 있어, 영상이 먼저
 * 들어온 race day(예: 5/9 KRBC 라이브 후 결과 적재 전 시점) 도 즉시 "최근
 * 경기" 에 노출하기 위함. 영상만 있는 카드는 입상마 빈 채로 노출되지만 직접
 * 경기 페이지로 진입할 수 있다는 가치가 있음.
 */
export async function getRecentRaceDaysRaces(days = 2): Promise<RaceInfo[]> {
  return query<RaceInfo>(
    `WITH recent_days AS (
       SELECT DISTINCT r.race_date
         FROM races r
        WHERE r.race_date <= ${KST_TODAY}
          AND (
            EXISTS (
              SELECT 1 FROM race_results rr
               WHERE rr.race_date = r.race_date
                 AND rr.rank IS NOT NULL
            )
            OR EXISTS (
              SELECT 1 FROM kra_videos v
               WHERE v.race_date = r.race_date
            )
          )
        ORDER BY r.race_date DESC
        LIMIT $1
     )
     ${mergedRacesSql("r.race_date IN (SELECT race_date FROM recent_days)")}
      ORDER BY m.race_day DESC, m.meet, m.race_no`,
    [days],
  );
}

export type TopFinisher = {
  race_date: string;
  meet: string;
  race_no: number;
  rank: number;
  horse_no: string;
  horse_name: string;
  jockey_name: string | null;
};

/**
 * 최근 N개 경기일의 모든 경주에 대해 1·2·3착 마필을 한 번의 쿼리로 조회.
 * 홈 화면 "최근 경기" 탭에서 라운드별 입상권을 한꺼번에 그리는 데 사용.
 */
export async function getRecentTopFinishers(days = 4): Promise<TopFinisher[]> {
  return query<TopFinisher>(
    `WITH recent_days AS (
       SELECT DISTINCT r.race_date
         FROM races r
        WHERE r.race_date <= ${KST_TODAY}
          AND EXISTS (
            SELECT 1 FROM race_results rr
             WHERE rr.race_date = r.race_date
               AND rr.rank IS NOT NULL
          )
        ORDER BY r.race_date DESC
        LIMIT $1
     )
     SELECT t.race_day::text AS race_date, t.meet, t.race_no, t.rank,
            t.horse_no, t.horse_name, t.jockey_name
       FROM (
             -- 같은 말이 두 라벨로 겹쳐 있어도 한 번만 (정규 라벨 행 우선)
             SELECT DISTINCT ON (r.race_date, ${R_MEET}, r.race_no, r.horse_no)
                    r.race_date AS race_day,
                    ${R_MEET} AS meet,
                    r.race_no, r.rank, r.horse_no, h.horse_name, r.jockey_name
               FROM race_results r
               JOIN horses h ON h.horse_no = r.horse_no
              WHERE r.race_date IN (SELECT race_date FROM recent_days)
                AND r.rank IN (1, 2, 3)
              ORDER BY r.race_date, ${R_MEET}, r.race_no, r.horse_no,
                       (r.meet <> ${R_MEET}), r.meet
            ) t
      ORDER BY t.race_day DESC, t.meet, t.race_no, t.rank`,
    [days],
  );
}

export async function getRacesByDate(date: string, meet?: string): Promise<RaceInfo[]> {
  if (meet) {
    return query<RaceInfo>(
      `${mergedRacesSql("r.race_date = $1::date AND r.meet = ANY($2::text[])")}
        ORDER BY m.race_no`,
      [date, storedMeetLabels(meet)],
    );
  }
  return query<RaceInfo>(
    `${mergedRacesSql("r.race_date = $1::date")}
      ORDER BY m.meet, m.race_no`,
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
 * 예정된 대상경주(race_plans.raw.pgDate)도 함께 UNION 해서, KRA 가 아직
 * races 테이블에 주간 카드를 올리지 않은 미래 일자도 달력에서 선택 가능하게 한다.
 * DayPicker 의 modifiers 에 넘겨 "경주 있는 날" 을 금색으로 강조.
 */
export async function getAllRaceDates(
  fromDate: string,
  months = 3,
): Promise<string[]> {
  const rows = await query<{ race_date: string }>(
    `SELECT DISTINCT race_date FROM (
       SELECT to_char(race_date, 'YYYY-MM-DD') AS race_date
         FROM races
        WHERE race_date BETWEEN $1::date - ($2 * INTERVAL '1 month') AND $1::date + ($2 * INTERVAL '1 month')
       UNION
       SELECT to_char(to_date(raw->>'pgDate','YYYYMMDD'), 'YYYY-MM-DD') AS race_date
         FROM race_plans
        WHERE raw->>'pgDate' ~ '^[0-9]{8}$'
          AND to_date(raw->>'pgDate','YYYYMMDD')
              BETWEEN $1::date - ($2 * INTERVAL '1 month') AND $1::date + ($2 * INTERVAL '1 month')
     ) d
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

/** 기수변경 붙이기 — 라벨을 정규화해 맞추고, 여러 건이면 가장 최근 것 하나. */
function jockeyChangeJoinSql(src: "r" | "e"): string {
  return `LEFT JOIN LATERAL (
              SELECT c.jk_name_before, c.jk_name_after, c.jk_no_after, c.reason,
                     c.weight_before, c.weight_after
                FROM jockey_changes c
               WHERE c.race_date = ${src}.race_date
                 AND ${normMeetSql("c.meet")} = ${normMeetSql(`${src}.meet`)}
                 AND c.race_no = ${src}.race_no
                 AND c.horse_no = ${src}.horse_no
               ORDER BY c.updated_at DESC, c.id DESC
               LIMIT 1
            ) jc ON true`;
}

export async function getRaceEntries(
  raceDate: string,
  meet: string,
  raceNo: number,
): Promise<RaceEntriesResult> {
  // 확정된 결과(race_results) 우선. 없으면 출마표(race_entries)로 폴백해
  // 경주 전 페이지가 비어 보이지 않게 한다.
  // meet 은 정규 라벨·저장 라벨 어느 쪽으로 와도 저장 라벨 후보 전부로 찾는다.
  const labels = storedMeetLabels(meet);
  const post = await query<RaceEntry>(
    // trainer JOIN 은 이름 매칭 — race_results.tr_no 가 백필되기 전까지의 임시 브릿지.
    // 동명이인 가능하나 실데이터상 충돌 거의 없음 (trainers ~333명).
    // weight_diff: 마필의 직전 race_results 와 weight 비교 (lateral subquery).
    `SELECT x.* FROM (
     SELECT DISTINCT ON (r.horse_no)
            r.rank, (r.raw->>'chulNo')::int AS chul_no,
            r.horse_no, h.horse_name,
            r.jockey_name,
            j.jk_no AS jockey_no,
            r.trainer_name,
            t.tr_no AS trainer_no,
            COALESCE(NULLIF(NULLIF(r.raw->>'rcTime', '-'), ''), r.record_time::text) AS record_time,
            r.weight::text,
            d.win_rate::text AS win_rate,
            d.plc_rate::text AS plc_rate,
            r.raw->>'age' AS age,
            h.sex AS sex,
            r.raw->>'wgBudam' AS budam_weight,
            r.raw->>'differ' AS differ,
            (r.raw->>'hrRating')::int AS hr_rating,
            (r.weight - prev.weight)::int AS weight_diff,
            jc.jk_name_before AS jockey_changed_from,
            jc.reason AS jockey_change_reason,
            jc.weight_before::text AS jockey_weight_before,
            jc.weight_after::text AS jockey_weight_after
       FROM race_results r
       JOIN horses h ON h.horse_no = r.horse_no
       LEFT JOIN jockeys j ON j.jk_name = r.jockey_name
       LEFT JOIN trainers t ON t.tr_name = r.trainer_name
       LEFT JOIN LATERAL (
              SELECT d.win_rate, d.plc_rate FROM race_dividends d
               WHERE d.race_date = r.race_date
                 AND ${normMeetSql("d.meet")} = ${R_MEET}
                 AND d.race_no = r.race_no
                 AND d.horse_no = (r.raw->>'chulNo')
               ORDER BY (d.meet <> r.meet), d.meet
               LIMIT 1
            ) d ON true
       ${jockeyChangeJoinSql("r")}
       LEFT JOIN LATERAL (
              SELECT pr.weight FROM race_results pr
               WHERE pr.horse_no = r.horse_no
                 AND (pr.race_date, pr.race_no) < (r.race_date, r.race_no)
                 AND pr.weight IS NOT NULL
               ORDER BY pr.race_date DESC, pr.race_no DESC
               LIMIT 1
            ) prev ON true
      WHERE r.race_date = $1::date
        AND r.meet = ANY($2::text[])
        AND r.race_no = $3
      -- 같은 말이 두 라벨로 겹쳐 있으면 정규 라벨 행을 쓴다
      ORDER BY r.horse_no, (r.meet <> ${R_MEET}), r.meet
     ) x
      ORDER BY x.rank NULLS LAST, x.chul_no NULLS LAST`,
    [raceDate, labels, raceNo],
  );
  if (post.length > 0) return { phase: "post", entries: post };

  // 경주 전 — race_entries(API26_2, 3시간 주기) 로부터 출전표를 구성.
  // 단/연승 배당은 결과 확정 후에만 존재하므로 null. 기수변경은 조기에 발표되는 경우도
  // 있으므로 LEFT JOIN 유지.
  // race_entries 가 기수변경 발표 전에 수집됐으면 jockey_name 이 변경 전 기수다 →
  // 실제 기승 기수는 jockey_changes.jk_name_after 우선 (lib/racing_form.ts 와 같은 규칙).
  // 그렇지 않으면 교체 배지가 "A → A" 로 읽힌다.
  const pre = await query<RaceEntry>(
    `SELECT x.* FROM (
     SELECT DISTINCT ON (e.horse_no)
            NULL::int AS rank, e.chul_no,
            e.horse_no, e.horse_name,
            COALESCE(NULLIF(btrim(jc.jk_name_after), ''), e.jockey_name) AS jockey_name,
            j.jk_no AS jockey_no,
            e.trainer_name,
            t.tr_no AS trainer_no,
            NULL::text AS record_time, e.weight::text,
            NULL::text AS win_rate, NULL::text AS plc_rate,
            e.age,
            h.sex AS sex,
            e.raw->>'wgBudam' AS budam_weight,
            NULL::text AS differ, e.rating AS hr_rating,
            (e.weight - prev.weight)::int AS weight_diff,
            jc.jk_name_before AS jockey_changed_from,
            jc.reason AS jockey_change_reason,
            jc.weight_before::text AS jockey_weight_before,
            jc.weight_after::text AS jockey_weight_after
       FROM race_entries e
       LEFT JOIN horses h ON h.horse_no = e.horse_no
       ${jockeyChangeJoinSql("e")}
       LEFT JOIN jockeys j
              ON j.jk_name = COALESCE(NULLIF(btrim(jc.jk_name_after), ''), e.jockey_name)
       LEFT JOIN trainers t ON t.tr_name = e.trainer_name
       LEFT JOIN LATERAL (
              SELECT pr.weight FROM race_results pr
               WHERE pr.horse_no = e.horse_no
                 AND (pr.race_date, pr.race_no) < (e.race_date, e.race_no)
                 AND pr.weight IS NOT NULL
               ORDER BY pr.race_date DESC, pr.race_no DESC
               LIMIT 1
            ) prev ON true
      WHERE e.race_date = $1::date
        AND e.meet = ANY($2::text[])
        AND e.race_no = $3
      -- 같은 말이 두 라벨로 겹쳐 있으면 나중에 수집한 행을 쓴다
      ORDER BY e.horse_no, e.updated_at DESC, (e.meet <> ${normMeetSql("e.meet")}), e.meet
     ) x
      ORDER BY x.chul_no NULLS LAST`,
    [raceDate, labels, raceNo],
  );
  return { phase: "pre", entries: pre };
}

/**
 * 한 경주에 출전하는 마필들의 직전 N전 착순 — 대량(10마리) 일괄 조회.
 * 마명 셀 form-dots 용. 결과: { horse_no: [rank1, rank2, ...] } (최신 → 과거 순).
 */
export async function getRecentFinishesBulk(
  horseNos: string[],
  beforeDate: string,
  beforeRaceNo: number,
  limit = 5,
): Promise<Record<string, (number | null)[]>> {
  if (horseNos.length === 0) return {};
  const placeholders = horseNos.map((_, i) => `$${i + 1}`).join(", ");
  const limitParam = `$${horseNos.length + 1}`;
  const dateParam = `$${horseNos.length + 2}`;
  const raceNoParam = `$${horseNos.length + 3}`;
  const rows = await query<{ horse_no: string; rn: string; rank: number | null }>(
    `WITH ranked AS (
       SELECT pr.horse_no, pr.rank,
              ROW_NUMBER() OVER (
                PARTITION BY pr.horse_no
                ORDER BY pr.race_date DESC, pr.race_no DESC
              )::text AS rn
         FROM race_results pr
        WHERE pr.horse_no IN (${placeholders})
          AND (pr.race_date, pr.race_no) < (${dateParam}::date, ${raceNoParam}::int)
     )
     SELECT horse_no, rn, rank FROM ranked WHERE rn::int <= ${limitParam}::int
     ORDER BY horse_no, rn::int ASC`,
    [...horseNos, limit, beforeDate, beforeRaceNo],
  );
  const out: Record<string, (number | null)[]> = {};
  for (const r of rows) {
    (out[r.horse_no] ??= []).push(r.rank);
  }
  return out;
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
        AND meet = ANY($2::text[])
        AND race_no = $3`,
    [raceDate, storedMeetLabels(meet), raceNo],
  );
  return rows[0]?.synced_at ?? null;
}
