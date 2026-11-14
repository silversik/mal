/**
 * 경마지(/form) DB 읽기 — server 전용 (`query()` = pg Pool). 쓰기는 없다.
 *
 * - 정본: docs/spec/racing-form-contract.md. 타입·순수 판정은 `racing_form-shared.ts`.
 * - SQL 은 이름 붙은 상수로 내보낸다 — PR-2 크롤러 e2e 가 글자 그대로 복사해 실행한다
 *   (`e2e.web_query`: `$n` → psycopg 파라미터). 그래서 SQL 에는 사용자 입력·경마장 한글 라벨을
 *   끼워 넣지 않고 전부 `$n` 파라미터로 넘긴다 (배열은 `= ANY($n::text[])`).
 *   SQL 안에 백슬래시 정규식을 쓰지 않는다 (템플릿 문자열에서 `\d` 가 `d` 로 바뀜 → `[0-9]`).
 * - 시각은 KST ISO 문자열 "YYYY-MM-DDTHH:MI:SS.mmm+09:00" 로 꺼낸다 (published_at 의 '늦게 발행'
 *   판정이 밀리초 단위라 초에서 자르지 않는다). 날짜는 "YYYY-MM-DD". sitemap lastmod 만 UTC "…Z"
 *   (sitemap-shared.ts 와 같은 형식).
 * - payload 는 필요한 조각만 jsonb 로 잘라 읽는다 (경주면 = 그 경주 하나, 1면 = 출전마 빼고).
 * - `*Safe` 함수와 getRuleRecord 는 실패해도 화면을 깨지 않게 [] / null 을 돌려준다.
 *   getRuleRecord 의 try/catch 는 unstable_cache **바깥**이다 — 실패가 600초 동안 캐시되지 않게.
 */
import { unstable_cache } from "next/cache";

import { query } from "./db";
import {
  FORM_INDEXABLE,
  FORM_MEET_LABELS,
  SCHEMA_VERSION,
  formEditionPath,
  isFormMeet,
  meetOrder,
  normalizeFormDate,
  parseEditionFront,
  parseEditionSummary,
  parseFinish,
  parseRaceSlice,
  slugFromMeet,
  type CurrentJockeyRow,
  type EditionFront,
  type EditionHead,
  type EditionTally,
  type EditionTallyRule,
  type FormCalendarRow,
  type FormMeet,
  type FormNotice,
  type FormNoticeKind,
  type Mark,
  type OutcomeRow,
  type OutcomeStatus,
  type ParseErrorHandler,
  type PublicBacktest,
  type RaceSlice,
  type RecordKey,
  type RuleRecord,
  type RuleRecordCell,
  type RuleRecordRule,
  type RuleSetRow,
} from "./racing_form-shared";
import type { SitemapUrl } from "./sitemap-shared";

// sitemap-shared.ts 의 SITE 와 같다. sitemap-shared 가 PR-3 에서 이 모듈을 import 하므로
// 순환 import 를 피하려고 값은 따로 둔다 (타입만 가져옴).
const SITE = "https://mal.kr";

function logParse(what: string): ParseErrorHandler {
  return (path) => console.warn(`[racing_form] payload 형식 오류 (${what}): ${path}`);
}

function validId(id: number): boolean {
  return Number.isSafeInteger(id) && id > 0;
}

// ============================================================================
// Q0 달력 — 발행 대상 (경주일, 경마장)
// ============================================================================

/**
 * races ∩ race_entries 인 (race_date, meet) 별 경주 수와 첫 발주.
 * first_post = 가장 이른 발주 시각을 **시·분으로 비교**해 "HH:MM" 으로 맞춘 값
 * ('9:30' 처럼 0 이 빠진 값을 사전순으로 비교하면 '10:35' 가 앞서므로). 해석 규칙은
 * crawler schedule.parse_hhmm 과 같다 ('1035'·'10:35:00' 허용, 24시·60분 이상은 무시).
 * $1 from · $2 to (YYYY-MM-DD, 포함) · $3 경마장 라벨 배열 (MEET_ORDER 순 — 정렬에도 씀).
 */
export const FORM_CALENDAR_SQL = `
SELECT to_char(c.race_date, 'YYYY-MM-DD') AS race_date,
       c.meet,
       COUNT(*)::int AS race_count,
       CASE WHEN MIN(c.post_min) IS NULL THEN NULL
            ELSE lpad((MIN(c.post_min) / 60)::text, 2, '0') || ':' ||
                 lpad(mod(MIN(c.post_min), 60)::text, 2, '0')
       END AS first_post
  FROM (
        SELECT r.race_date, r.meet, r.race_no,
               CASE WHEN t.hm IS NOT NULL AND t.hm[1]::int <= 23 AND t.hm[2]::int <= 59
                    THEN t.hm[1]::int * 60 + t.hm[2]::int
               END AS post_min
          FROM races r
          CROSS JOIN LATERAL (
                SELECT regexp_match(
                         r.start_time,
                         '^[[:space:]]*([0-9]{1,2}):?([0-9]{2})(:[0-9]{2})?[[:space:]]*$'
                       ) AS hm
               ) t
         WHERE r.race_date BETWEEN $1::date AND $2::date
           AND r.meet = ANY($3::text[])
           AND EXISTS (SELECT 1
                         FROM race_entries e
                        WHERE e.race_date = r.race_date
                          AND e.meet = r.meet
                          AND e.race_no = r.race_no)
       ) c
 GROUP BY c.race_date, c.meet
 ORDER BY c.race_date, array_position($3::text[], c.meet::text)`;

type CalendarDbRow = { race_date: string; meet: string; race_count: number; first_post: string | null };

/** 경주일 from~to(포함)의 발행 대상. redirect·허브·1면이 함께 쓴다. 날짜가 이상하면 []. */
export async function getFormCalendar(from: string, to: string): Promise<FormCalendarRow[]> {
  const f = normalizeFormDate(from);
  const t = normalizeFormDate(to);
  if (!f || !t) return [];
  const rows = await query<CalendarDbRow>(FORM_CALENDAR_SQL, [f, t, [...FORM_MEET_LABELS]]);
  return rows
    .filter((r): r is CalendarDbRow & { meet: FormMeet } => isFormMeet(r.meet))
    .map((r) => ({
      race_date: r.race_date,
      meet: r.meet,
      race_count: r.race_count,
      first_post: r.first_post,
    }));
}

// ============================================================================
// 출시 경계 launchAt = MIN(rule_sets.registered_at)
// ============================================================================

export const LAUNCH_AT_SQL = `
SELECT to_char(MIN(s.registered_at) AT TIME ZONE 'Asia/Seoul',
               'YYYY-MM-DD"T"HH24:MI:SS.MS"+09:00"') AS launch_at
  FROM racing_form_rule_sets s`;

/** 최초 기준 등록 시각 (첫 발행 잡이 만든다). 없으면 null = 출시 전. */
export async function getLaunchAt(): Promise<string | null> {
  const rows = await query<{ launch_at: string | null }>(LAUNCH_AT_SQL);
  return rows[0]?.launch_at ?? null;
}

// ============================================================================
// 발행본 머리 (payload 없이)
// ============================================================================

/** 기간 안의 발행본 머리 + summary. $1 from · $2 to (경주일, 포함) · $3 경마장 라벨 배열(정렬). */
export const EDITION_INDEX_SQL = `
SELECT e.id::int AS id,
       to_char(e.race_date, 'YYYY-MM-DD') AS race_date,
       e.meet,
       e.issue_no,
       e.rules_version,
       e.schema_version,
       to_char(e.history_before, 'YYYY-MM-DD') AS history_before,
       to_char(e.results_through, 'YYYY-MM-DD') AS results_through,
       to_char(e.entries_batch_at AT TIME ZONE 'Asia/Seoul',
               'YYYY-MM-DD"T"HH24:MI:SS.MS"+09:00"') AS entries_batch_at,
       to_char(e.freeze_at AT TIME ZONE 'Asia/Seoul',
               'YYYY-MM-DD"T"HH24:MI:SS.MS"+09:00"') AS freeze_at,
       to_char(e.deadline_at AT TIME ZONE 'Asia/Seoul',
               'YYYY-MM-DD"T"HH24:MI:SS.MS"+09:00"') AS deadline_at,
       to_char(e.published_at AT TIME ZONE 'Asia/Seoul',
               'YYYY-MM-DD"T"HH24:MI:SS.MS"+09:00"') AS published_at,
       e.race_count,
       e.runner_count,
       e.summary
  FROM racing_form_editions e
 WHERE e.race_date BETWEEN $1::date AND $2::date
 ORDER BY e.race_date, array_position($3::text[], e.meet::text), e.meet`;

/** (경주일, 경마장) 한 호의 머리 + summary. $1 race_date · $2 meet(한글 라벨). */
export const EDITION_HEAD_SQL = `
SELECT e.id::int AS id,
       to_char(e.race_date, 'YYYY-MM-DD') AS race_date,
       e.meet,
       e.issue_no,
       e.rules_version,
       e.schema_version,
       to_char(e.history_before, 'YYYY-MM-DD') AS history_before,
       to_char(e.results_through, 'YYYY-MM-DD') AS results_through,
       to_char(e.entries_batch_at AT TIME ZONE 'Asia/Seoul',
               'YYYY-MM-DD"T"HH24:MI:SS.MS"+09:00"') AS entries_batch_at,
       to_char(e.freeze_at AT TIME ZONE 'Asia/Seoul',
               'YYYY-MM-DD"T"HH24:MI:SS.MS"+09:00"') AS freeze_at,
       to_char(e.deadline_at AT TIME ZONE 'Asia/Seoul',
               'YYYY-MM-DD"T"HH24:MI:SS.MS"+09:00"') AS deadline_at,
       to_char(e.published_at AT TIME ZONE 'Asia/Seoul',
               'YYYY-MM-DD"T"HH24:MI:SS.MS"+09:00"') AS published_at,
       e.race_count,
       e.runner_count,
       e.summary
  FROM racing_form_editions e
 WHERE e.race_date = $1::date
   AND e.meet = $2`;

type EditionHeadDbRow = Omit<EditionHead, "summary"> & { summary: unknown };

function toHead(r: EditionHeadDbRow): EditionHead {
  return {
    ...r,
    summary:
      r.schema_version === SCHEMA_VERSION
        ? parseEditionSummary(r.summary, logParse(`edition ${r.id} summary`))
        : null,
  };
}

/** 경주일 from~to(포함) 발행본 머리 목록 — 경주일 → MEET_ORDER 순. payload 는 읽지 않는다. */
export async function getEditionIndex(from: string, to: string): Promise<EditionHead[]> {
  const f = normalizeFormDate(from);
  const t = normalizeFormDate(to);
  if (!f || !t) return [];
  const rows = await query<EditionHeadDbRow>(EDITION_INDEX_SQL, [f, t, [...FORM_MEET_LABELS]]);
  return rows.map(toHead);
}

/** 한 호의 머리. meet 는 한글 라벨(서울·제주·부경). 없으면 null. */
export async function getEditionHead(date: string, meet: string): Promise<EditionHead | null> {
  const d = normalizeFormDate(date);
  if (!d || !isFormMeet(meet)) return null;
  const rows = await query<EditionHeadDbRow>(EDITION_HEAD_SQL, [d, meet]);
  return rows[0] ? toHead(rows[0]) : null;
}

// ============================================================================
// payload 조각 — 1면(출전마 빼고) · 경주면(한 경주만)
// ============================================================================

/**
 * 1면 묶음. races = payload 경주에서 runners·rules 를 뺀 것, runners = 헤드라인 마명·발행 후
 * 기수 변경 비교용 축약 {race_no, horse_no, chul_no, horse_name, jockey_name} (원래 순서).
 * $1 edition id.
 */
export const EDITION_FRONT_SQL = `
SELECT e.payload -> 'schema_version' AS schema_version,
       e.payload -> 'edition' AS edition,
       e.payload -> 'rules' AS rules,
       e.payload -> 'headlines' AS headlines,
       e.payload -> 'headline_overflow' AS headline_overflow,
       (SELECT COALESCE(jsonb_agg((r.race - 'runners') - 'rules' ORDER BY r.ord), '[]'::jsonb)
          FROM jsonb_array_elements(
                 CASE WHEN jsonb_typeof(e.payload -> 'races') = 'array'
                      THEN e.payload -> 'races' ELSE '[]'::jsonb END
               ) WITH ORDINALITY AS r(race, ord)) AS races,
       (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                          'race_no', r.race -> 'race_no',
                          'horse_no', u.runner -> 'horse_no',
                          'chul_no', u.runner -> 'chul_no',
                          'horse_name', u.runner -> 'horse_name',
                          'jockey_name', u.runner -> 'jockey_name')
                        ORDER BY r.ord, u.ord), '[]'::jsonb)
          FROM jsonb_array_elements(
                 CASE WHEN jsonb_typeof(e.payload -> 'races') = 'array'
                      THEN e.payload -> 'races' ELSE '[]'::jsonb END
               ) WITH ORDINALITY AS r(race, ord)
          CROSS JOIN LATERAL jsonb_array_elements(
                 CASE WHEN jsonb_typeof(r.race -> 'runners') = 'array'
                      THEN r.race -> 'runners' ELSE '[]'::jsonb END
               ) WITH ORDINALITY AS u(runner, ord)) AS runners
  FROM racing_form_editions e
 WHERE e.id = $1::bigint`;

type FrontDbRow = {
  schema_version: unknown;
  edition: unknown;
  rules: unknown;
  headlines: unknown;
  headline_overflow: unknown;
  races: unknown;
  runners: unknown;
};

/** 1면 데이터 (전 출전마 카드는 싣지 않는다). 없음·모르는 schema·형식 오류 → null. */
export async function getEditionRaces(editionId: number): Promise<EditionFront | null> {
  if (!validId(editionId)) return null;
  const rows = await query<FrontDbRow>(EDITION_FRONT_SQL, [editionId]);
  const row = rows[0];
  if (!row || row.schema_version !== SCHEMA_VERSION) return null;
  return parseEditionFront(row, logParse(`edition ${editionId} front`));
}

/**
 * 경주면 — payload 에서 그 경주 하나만 + 기준 정의 + edition 도장 + 이전/다음용 경주 번호들.
 * $1 edition id · $2 race_no.
 */
export const RACE_SLICE_SQL = `
SELECT e.payload -> 'schema_version' AS schema_version,
       e.payload -> 'edition' AS edition,
       e.payload -> 'rules' AS rules,
       (SELECT r.race
          FROM jsonb_array_elements(
                 CASE WHEN jsonb_typeof(e.payload -> 'races') = 'array'
                      THEN e.payload -> 'races' ELSE '[]'::jsonb END
               ) AS r(race)
         WHERE r.race -> 'race_no' = to_jsonb($2::int)
         LIMIT 1) AS race,
       (SELECT COALESCE(jsonb_agg(r.race -> 'race_no' ORDER BY r.ord), '[]'::jsonb)
          FROM jsonb_array_elements(
                 CASE WHEN jsonb_typeof(e.payload -> 'races') = 'array'
                      THEN e.payload -> 'races' ELSE '[]'::jsonb END
               ) WITH ORDINALITY AS r(race, ord)) AS race_nos
  FROM racing_form_editions e
 WHERE e.id = $1::bigint`;

type SliceDbRow = { schema_version: unknown; edition: unknown; rules: unknown; race: unknown; race_nos: unknown };

/** 경주면 데이터. 호·경주가 없거나 모르는 schema 면 null. */
export async function getRaceSlice(editionId: number, raceNo: number): Promise<RaceSlice | null> {
  if (!validId(editionId) || !Number.isInteger(raceNo) || raceNo < 1 || raceNo > 30) return null;
  const rows = await query<SliceDbRow>(RACE_SLICE_SQL, [editionId, raceNo]);
  const row = rows[0];
  if (!row || row.schema_version !== SCHEMA_VERSION) return null;
  return parseRaceSlice(row, logParse(`edition ${editionId} race ${raceNo}`));
}

// ============================================================================
// 정산
// ============================================================================

/** 호의 경주별 정산 (행이 없는 경주는 대기). $1 edition id. */
export const OUTCOMES_SQL = `
SELECT o.race_no,
       o.status,
       o.starters,
       o.finish,
       o.winners,
       o.placed,
       o.non_starters,
       o.extra_starters,
       o.favorites,
       o.pop_ranks,
       o.is_final,
       to_char(o.first_settled_at AT TIME ZONE 'Asia/Seoul',
               'YYYY-MM-DD"T"HH24:MI:SS.MS"+09:00"') AS first_settled_at,
       to_char(o.settled_at AT TIME ZONE 'Asia/Seoul',
               'YYYY-MM-DD"T"HH24:MI:SS.MS"+09:00"') AS settled_at,
       to_char(o.finalized_at AT TIME ZONE 'Asia/Seoul',
               'YYYY-MM-DD"T"HH24:MI:SS.MS"+09:00"') AS finalized_at
  FROM racing_form_race_outcomes o
 WHERE o.edition_id = $1::bigint
 ORDER BY o.race_no`;

type OutcomeDbRow = Omit<OutcomeRow, "finish" | "pop_ranks" | "status"> & {
  status: string;
  finish: unknown;
  pop_ranks: unknown;
};

function popRanks(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (typeof v !== "object" || v === null || Array.isArray(v)) return out;
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if (typeof x === "number" && Number.isInteger(x)) out[k] = x;
  }
  return out;
}

export async function getOutcomes(editionId: number): Promise<OutcomeRow[]> {
  if (!validId(editionId)) return [];
  const rows = await query<OutcomeDbRow>(OUTCOMES_SQL, [editionId]);
  return rows
    .filter((r): r is OutcomeDbRow & { status: OutcomeStatus } =>
      r.status === "official" || r.status === "race_void",
    )
    .map((r) => ({
      ...r,
      finish: parseFinish(r.finish),
      pop_ranks: popRanks(r.pop_ranks),
      winners: r.winners ?? [],
      placed: r.placed ?? [],
      non_starters: r.non_starters ?? [],
      extra_starters: r.extra_starters ?? [],
      favorites: r.favorites ?? [],
    }));
}

/**
 * 호들의 결산 재료 (mark 1 만 — 기준 ◎ 와 주목마). verdict 는 pickOutcome(§6.1) 과 같은 순서:
 * race_void 또는 non_starters → 무효, winners → 1착, placed → 3착 이내. 정산 행이 없으면 대기.
 * $1 edition id 배열.
 */
export const EDITION_TALLY_PICKS_SQL = `
SELECT pk.edition_id::int AS edition_id,
       pk.rule_key,
       COUNT(*)::int AS picks,
       COUNT(o.race_no)::int AS settled,
       COUNT(*) FILTER (WHERE o.status = 'race_void'
                           OR pk.horse_no = ANY(o.non_starters))::int AS voids,
       COUNT(*) FILTER (WHERE o.status = 'official'
                          AND NOT (pk.horse_no = ANY(o.non_starters))
                          AND pk.horse_no = ANY(o.winners))::int AS wins,
       COUNT(*) FILTER (WHERE o.status = 'official'
                          AND NOT (pk.horse_no = ANY(o.non_starters))
                          AND pk.horse_no = ANY(o.placed))::int AS top3
  FROM racing_form_picks pk
  LEFT JOIN racing_form_race_outcomes o
         ON o.edition_id = pk.edition_id AND o.race_no = pk.race_no
 WHERE pk.edition_id = ANY($1::bigint[])
   AND pk.mark = 1
 GROUP BY pk.edition_id, pk.rule_key`;

/** 호별 정산 경주 수·확정 수·경주 무효 수. $1 edition id 배열. */
export const EDITION_TALLY_RACES_SQL = `
SELECT o.edition_id::int AS edition_id,
       COUNT(*)::int AS races_settled,
       COUNT(*) FILTER (WHERE o.is_final)::int AS races_final,
       COUNT(*) FILTER (WHERE o.status = 'race_void')::int AS races_void
  FROM racing_form_race_outcomes o
 WHERE o.edition_id = ANY($1::bigint[])
 GROUP BY o.edition_id`;

type TallyPickDbRow = {
  edition_id: number;
  rule_key: string;
  picks: number;
  settled: number;
  voids: number;
  wins: number;
  top3: number;
};

const RECORD_KEYS: readonly RecordKey[] = ["rating", "form", "course", "jockey", "trainer", "consensus"];

function isRecordKey(v: unknown): v is RecordKey {
  return (RECORD_KEYS as readonly unknown[]).includes(v);
}

/** 1면 상태 블록·허브 지난 호 카드의 결산 한 줄 재료 (settlementLine 에 넘긴다). */
export async function getEditionTallies(editionIds: number[]): Promise<EditionTally[]> {
  const ids = [...new Set(editionIds.filter(validId))];
  if (ids.length === 0) return [];
  const [picks, races] = await Promise.all([
    query<TallyPickDbRow>(EDITION_TALLY_PICKS_SQL, [ids]),
    query<{ edition_id: number; races_settled: number; races_final: number; races_void: number }>(
      EDITION_TALLY_RACES_SQL,
      [ids],
    ),
  ]);
  return ids.map((id) => {
    const r = races.find((x) => x.edition_id === id);
    const rules: EditionTallyRule[] = picks
      .filter((p) => p.edition_id === id && isRecordKey(p.rule_key))
      .map((p) => ({
        rule_key: p.rule_key as RecordKey,
        picks: p.picks,
        settled: p.settled,
        voids: p.voids,
        n: p.settled - p.voids,
        wins: p.wins,
        top3: p.top3,
      }));
    return {
      edition_id: id,
      races_settled: r?.races_settled ?? 0,
      races_final: r?.races_final ?? 0,
      races_void: r?.races_void ?? 0,
      rules,
    };
  });
}

// ============================================================================
// 지금 실제 기수 (발행 후 기수 변경 덧씌움)
// ============================================================================

/**
 * 지금 출전표 기준 실제 기수 = btrim(COALESCE(기수변경 after, 출전표 기수)) — 빈 문자열은 NULL
 * 취급(after 가 비면 출전표 기수). jockey_changes 는 meet 없이 (race_date, race_no, horse_no)
 * 최신 1건 (계약 Q1 과 같은 LATERAL). $1 race_date · $2 meet(한글 라벨).
 */
export const CURRENT_JOCKEYS_SQL = `
SELECT e.race_no,
       e.horse_no,
       e.chul_no,
       COALESCE(NULLIF(btrim(jc.jk_name_after), ''), NULLIF(btrim(e.jockey_name), '')) AS jockey_name,
       NULLIF(btrim(jc.reason), '') AS reason
  FROM race_entries e
  LEFT JOIN LATERAL (
        SELECT c.jk_name_after, c.reason
          FROM jockey_changes c
         WHERE c.race_date = e.race_date
           AND c.race_no = e.race_no
           AND c.horse_no = e.horse_no
         ORDER BY c.updated_at DESC, c.id DESC
         LIMIT 1
       ) jc ON TRUE
 WHERE e.race_date = $1::date
   AND e.meet = $2
 ORDER BY e.race_no, e.chul_no NULLS LAST, e.horse_no`;

export async function getCurrentJockeys(date: string, meet: string): Promise<CurrentJockeyRow[]> {
  const d = normalizeFormDate(date);
  if (!d || !isFormMeet(meet)) return [];
  return query<CurrentJockeyRow>(CURRENT_JOCKEYS_SQL, [d, meet]);
}

// ============================================================================
// 공지 (publish_failed 는 내부용 — 읽지 않는다)
// ============================================================================

/**
 * (D, meet) 의 공개 공지: 그 호에 붙은 공지(정정·철회·결과 변경) + 그날의 missed +
 * 기간에 D 가 들어가는 paused. meet NULL = 모든 경마장. detail 에서는 until·hide_picks·race_no 만.
 * until 은 'YYYY-MM-DD' 문자열이라 C 정렬로 비교한다 (캐스트 오류로 페이지가 깨지지 않게).
 * $1 race_date · $2 meet(한글 라벨).
 */
export const NOTICES_SQL = `
SELECT n.id::int AS id,
       to_char(n.race_date, 'YYYY-MM-DD') AS race_date,
       n.meet,
       n.edition_id::int AS edition_id,
       n.kind,
       n.public_text,
       CASE WHEN n.detail ->> 'until' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
            THEN n.detail ->> 'until' END AS until,
       COALESCE(n.detail -> 'hide_picks' = 'true'::jsonb, false) AS hide_picks,
       CASE WHEN n.detail ->> 'race_no' ~ '^[0-9]{1,2}$'
            THEN (n.detail ->> 'race_no')::int END AS race_no,
       to_char(n.noticed_at AT TIME ZONE 'Asia/Seoul',
               'YYYY-MM-DD"T"HH24:MI:SS.MS"+09:00"') AS noticed_at
  FROM racing_form_notices n
 WHERE n.kind IN ('missed', 'erratum', 'withdrawn', 'result_changed', 'paused')
   AND (
         n.edition_id IN (SELECT x.id
                            FROM racing_form_editions x
                           WHERE x.race_date = $1::date
                             AND x.meet = $2)
      OR (n.edition_id IS NULL
          AND n.kind <> 'paused'
          AND n.race_date = $1::date
          AND (n.meet IS NULL OR n.meet = $2))
      OR (n.kind = 'paused'
          AND n.race_date <= $1::date
          AND (n.detail ->> 'until') COLLATE "C" >= to_char($1::date, 'YYYY-MM-DD') COLLATE "C"
          AND (n.meet IS NULL OR n.meet = $2))
       )
 ORDER BY n.noticed_at, n.id`;

/**
 * 경주일 from~to 의 공개 공지 전부 (허브·기록 페이지 발행 이력용) + 기간이 겹치는 paused.
 * editionState 가 호별로 다시 거른다. $1 from · $2 to.
 */
export const NOTICES_BETWEEN_SQL = `
SELECT n.id::int AS id,
       to_char(n.race_date, 'YYYY-MM-DD') AS race_date,
       n.meet,
       n.edition_id::int AS edition_id,
       n.kind,
       n.public_text,
       CASE WHEN n.detail ->> 'until' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
            THEN n.detail ->> 'until' END AS until,
       COALESCE(n.detail -> 'hide_picks' = 'true'::jsonb, false) AS hide_picks,
       CASE WHEN n.detail ->> 'race_no' ~ '^[0-9]{1,2}$'
            THEN (n.detail ->> 'race_no')::int END AS race_no,
       to_char(n.noticed_at AT TIME ZONE 'Asia/Seoul',
               'YYYY-MM-DD"T"HH24:MI:SS.MS"+09:00"') AS noticed_at
  FROM racing_form_notices n
 WHERE n.kind IN ('missed', 'erratum', 'withdrawn', 'result_changed', 'paused')
   AND (
         (n.kind <> 'paused' AND n.race_date BETWEEN $1::date AND $2::date)
      OR (n.kind = 'paused'
          AND n.race_date <= $2::date
          AND (n.detail ->> 'until') COLLATE "C" >= to_char($1::date, 'YYYY-MM-DD') COLLATE "C")
       )
 ORDER BY n.race_date, n.noticed_at, n.id`;

const NOTICE_KINDS: readonly FormNoticeKind[] = [
  "missed",
  "erratum",
  "withdrawn",
  "result_changed",
  "paused",
];

type NoticeDbRow = Omit<FormNotice, "kind"> & { kind: string };

function publicNotices(rows: NoticeDbRow[]): FormNotice[] {
  return rows.filter((r): r is FormNotice => (NOTICE_KINDS as readonly string[]).includes(r.kind));
}

/** (D, meet) 공개 공지 — editionState 의 notices 입력. */
export async function getNotices(date: string, meet: string): Promise<FormNotice[]> {
  const d = normalizeFormDate(date);
  if (!d || !isFormMeet(meet)) return [];
  return publicNotices(await query<NoticeDbRow>(NOTICES_SQL, [d, meet]));
}

/** 경주일 from~to(포함) 공개 공지 (전 경마장). */
export async function getNoticesBetween(from: string, to: string): Promise<FormNotice[]> {
  const f = normalizeFormDate(from);
  const t = normalizeFormDate(to);
  if (!f || !t) return [];
  return publicNotices(await query<NoticeDbRow>(NOTICES_BETWEEN_SQL, [f, t]));
}

// ============================================================================
// 기준 정의 · 과거 시험
// ============================================================================

/** $1 rules_version. */
export const RULE_SET_SQL = `
SELECT s.rules_version,
       s.definition,
       s.definition_sha256,
       to_char(s.registered_at AT TIME ZONE 'Asia/Seoul',
               'YYYY-MM-DD"T"HH24:MI:SS.MS"+09:00"') AS registered_at
  FROM racing_form_rule_sets s
 WHERE s.rules_version = $1`;

export async function getRuleSet(version: string): Promise<RuleSetRow | null> {
  if (typeof version !== "string" || !/^[A-Za-z0-9_.-]{1,40}$/.test(version)) return null;
  const rows = await query<RuleSetRow>(RULE_SET_SQL, [version]);
  return rows[0] ?? null;
}

/** 공개로 표시한 과거 시험 보고서 중 최신 1건 (holdout 우선). */
export const PUBLIC_BACKTEST_SQL = `
SELECT b.id::int AS id,
       b.candidate_version,
       b.definition_sha256,
       b.label,
       to_char(b.period_from, 'YYYY-MM-DD') AS period_from,
       to_char(b.period_to, 'YYYY-MM-DD') AS period_to,
       b.meets,
       b.report,
       b.code_rev,
       to_char(b.computed_at AT TIME ZONE 'Asia/Seoul',
               'YYYY-MM-DD"T"HH24:MI:SS.MS"+09:00"') AS computed_at
  FROM racing_form_backtests b
 WHERE b.is_public
 ORDER BY (b.label = 'holdout') DESC, b.computed_at DESC, b.id DESC
 LIMIT 1`;

/** /form/record "과거 데이터로 시험(참고)" — 실전과 합산하지 않는다. 없으면 null. */
export async function getPublicBacktest(): Promise<PublicBacktest | null> {
  const rows = await query<PublicBacktest>(PUBLIC_BACKTEST_SQL);
  const r = rows[0];
  if (!r || (r.label !== "dev" && r.label !== "holdout")) return null;
  return r;
}

// ============================================================================
// 기록 (확정 정산만) — 기준 × 기호, 주목마 mark 1, 무작위·1번 인기 비교, 평균 인기
// ============================================================================

/**
 * 기준 × 기호 셀. 확정(is_final) 정산만, 주목마는 mark 1 만. 판정 순서는 §6.1
 * (race_void·non_starters → 무효, winners → 1착, placed → 3착 이내).
 * 무작위·1번 인기 기대값은 **같은 SQL·같은 경주 집합**(무효를 뺀 표시)에서:
 *   무작위 = Σ(|winners| / starters), Σ(|placed| / starters)
 *   1번 인기 = favorites 가 있는 경주에서 Σ(|favorites ∩ winners| / |favorites|) (배당 숫자는 안 꺼냄)
 * 평균 인기 = pop_ranks[horse_no] 평균. ROI 는 계산하지 않는다.
 * $1 meet(한글, NULL = 전체) · $2 from · $3 to (경주일, NULL = 끝 없음) · $4 rules_version(NULL = 전체).
 */
export const RULE_RECORD_SQL = `
WITH o AS (
  SELECT o.edition_id, o.race_no, o.status, o.starters,
         o.winners, o.placed, o.non_starters, o.favorites, o.pop_ranks
    FROM racing_form_race_outcomes o
    JOIN racing_form_editions e ON e.id = o.edition_id
   WHERE o.is_final
     AND ($1::text IS NULL OR e.meet = $1::text)
     AND ($2::date IS NULL OR o.race_date >= $2::date)
     AND ($3::date IS NULL OR o.race_date <= $3::date)
     AND ($4::text IS NULL OR e.rules_version = $4::text)
),
p AS (
  SELECT pk.rule_key,
         pk.mark,
         (o.status = 'race_void' OR pk.horse_no = ANY(o.non_starters)) AS is_void,
         pk.horse_no = ANY(o.winners) AS is_win,
         pk.horse_no = ANY(o.placed) AS is_top3,
         cardinality(o.winners)::float8 / NULLIF(o.starters, 0) AS rand_win,
         cardinality(o.placed)::float8 / NULLIF(o.starters, 0) AS rand_top3,
         cardinality(o.favorites) AS fav_n,
         (SELECT COUNT(*) FROM unnest(o.favorites) f WHERE f = ANY(o.winners))::float8
           / NULLIF(cardinality(o.favorites), 0) AS fav_win,
         (SELECT COUNT(*) FROM unnest(o.favorites) f WHERE f = ANY(o.placed))::float8
           / NULLIF(cardinality(o.favorites), 0) AS fav_top3,
         CASE WHEN jsonb_typeof(o.pop_ranks -> pk.horse_no) = 'number'
              THEN (o.pop_ranks ->> pk.horse_no)::float8 END AS pop_rank
    FROM racing_form_picks pk
    JOIN o ON o.edition_id = pk.edition_id AND o.race_no = pk.race_no
   WHERE pk.rule_key <> 'consensus' OR pk.mark = 1
)
SELECT p.rule_key,
       p.mark::int AS mark,
       COUNT(*) FILTER (WHERE NOT p.is_void)::int AS n,
       COUNT(*) FILTER (WHERE NOT p.is_void AND p.is_win)::int AS wins,
       COUNT(*) FILTER (WHERE NOT p.is_void AND p.is_top3)::int AS top3,
       COUNT(*) FILTER (WHERE p.is_void)::int AS voids,
       COALESCE(SUM(p.rand_win) FILTER (WHERE NOT p.is_void), 0)::float8 AS random_win,
       COALESCE(SUM(p.rand_top3) FILTER (WHERE NOT p.is_void), 0)::float8 AS random_top3,
       COUNT(*) FILTER (WHERE NOT p.is_void AND p.fav_n > 0)::int AS fav_races,
       COALESCE(SUM(p.fav_win) FILTER (WHERE NOT p.is_void AND p.fav_n > 0), 0)::float8 AS fav_win,
       COALESCE(SUM(p.fav_top3) FILTER (WHERE NOT p.is_void AND p.fav_n > 0), 0)::float8 AS fav_top3,
       COUNT(p.pop_rank) FILTER (WHERE NOT p.is_void)::int AS pop_n,
       AVG(p.pop_rank) FILTER (WHERE NOT p.is_void)::float8 AS avg_pop_rank
  FROM p
 GROUP BY p.rule_key, p.mark
 ORDER BY p.rule_key, p.mark`;

/**
 * 기준 단위 — 예상을 낸 경주 수(참여율·선정률 분자), 무효 아닌 표시가 있는 경주 수,
 * 1착마를 표시한 경주 수(◎○△ 중 1착마 포함률). 파라미터는 RULE_RECORD_SQL 과 같다.
 */
export const RULE_RECORD_RULES_SQL = `
WITH o AS (
  SELECT o.edition_id, o.race_no, o.status, o.winners, o.non_starters
    FROM racing_form_race_outcomes o
    JOIN racing_form_editions e ON e.id = o.edition_id
   WHERE o.is_final
     AND ($1::text IS NULL OR e.meet = $1::text)
     AND ($2::date IS NULL OR o.race_date >= $2::date)
     AND ($3::date IS NULL OR o.race_date <= $3::date)
     AND ($4::text IS NULL OR e.rules_version = $4::text)
),
p AS (
  SELECT pk.rule_key,
         o.edition_id::text || ':' || o.race_no::text AS race_key,
         (o.status = 'race_void' OR pk.horse_no = ANY(o.non_starters)) AS is_void,
         pk.horse_no = ANY(o.winners) AS is_win
    FROM racing_form_picks pk
    JOIN o ON o.edition_id = pk.edition_id AND o.race_no = pk.race_no
   WHERE pk.rule_key <> 'consensus' OR pk.mark = 1
)
SELECT p.rule_key,
       COUNT(DISTINCT p.race_key)::int AS races_picked,
       COUNT(DISTINCT p.race_key) FILTER (WHERE NOT p.is_void)::int AS races_n,
       COUNT(DISTINCT p.race_key) FILTER (WHERE NOT p.is_void AND p.is_win)::int AS races_any_win
  FROM p
 GROUP BY p.rule_key
 ORDER BY p.rule_key`;

/** 확정 정산 경주 수·경주 무효 수·호 수·기간. 파라미터는 RULE_RECORD_SQL 과 같다. */
export const RULE_RECORD_TOTALS_SQL = `
SELECT COUNT(*)::int AS races,
       COUNT(*) FILTER (WHERE o.status = 'race_void')::int AS races_void,
       COUNT(DISTINCT o.edition_id)::int AS editions,
       to_char(MIN(o.race_date), 'YYYY-MM-DD') AS first_date,
       to_char(MAX(o.race_date), 'YYYY-MM-DD') AS last_date
  FROM racing_form_race_outcomes o
  JOIN racing_form_editions e ON e.id = o.edition_id
 WHERE o.is_final
   AND ($1::text IS NULL OR e.meet = $1::text)
   AND ($2::date IS NULL OR o.race_date >= $2::date)
   AND ($3::date IS NULL OR o.race_date <= $3::date)
   AND ($4::text IS NULL OR e.rules_version = $4::text)`;

type CellDbRow = Omit<RuleRecordCell, "rule_key" | "mark"> & { rule_key: string; mark: number };
type RulesDbRow = Omit<RuleRecordRule, "rule_key"> & { rule_key: string };
type TotalsDbRow = {
  races: number;
  races_void: number;
  editions: number;
  first_date: string | null;
  last_date: string | null;
};

async function fetchRuleRecord(
  meet: string | null,
  from: string | null,
  to: string | null,
  version: string | null,
): Promise<RuleRecord> {
  const params = [meet, from, to, version];
  const [cells, rules, totals] = await Promise.all([
    query<CellDbRow>(RULE_RECORD_SQL, params),
    query<RulesDbRow>(RULE_RECORD_RULES_SQL, params),
    query<TotalsDbRow>(RULE_RECORD_TOTALS_SQL, params),
  ]);
  const t = totals[0];
  return {
    races: t?.races ?? 0,
    races_void: t?.races_void ?? 0,
    editions: t?.editions ?? 0,
    first_date: t?.first_date ?? null,
    last_date: t?.last_date ?? null,
    cells: cells
      .filter((c) => isRecordKey(c.rule_key) && (c.mark === 1 || c.mark === 2 || c.mark === 3))
      .map((c) => ({ ...c, rule_key: c.rule_key as RecordKey, mark: c.mark as Mark })),
    rules: rules
      .filter((r) => isRecordKey(r.rule_key))
      .map((r) => ({ ...r, rule_key: r.rule_key as RecordKey })),
  };
}

// 확정분 집계라 하루 몇 번만 바뀐다 → 600초. 실패는 캐시하지 않는다 (try/catch 는 바깥).
const cachedRuleRecord = unstable_cache(fetchRuleRecord, ["racing_form:ruleRecord"], {
  revalidate: 600,
  tags: ["racing_form"],
});

export type RuleRecordOptions = {
  /** 한글 라벨(서울·제주·부경). 없거나 모르는 값이면 전체 */
  meet?: string | null;
  /** 경주일 범위 (포함). 이상한 날짜는 무시 */
  period?: { from?: string | null; to?: string | null } | null;
  /** rules_version (예 "r1"). 없으면 전체 */
  version?: string | null;
};

/** 실전 기록 (확정 정산만). 조회 실패 시 null — 화면은 "기록을 불러오지 못했습니다". */
export async function getRuleRecord(opts: RuleRecordOptions = {}): Promise<RuleRecord | null> {
  const meet = opts.meet && isFormMeet(opts.meet) ? opts.meet : null;
  const from = normalizeFormDate(opts.period?.from ?? undefined);
  const to = normalizeFormDate(opts.period?.to ?? undefined);
  const version =
    opts.version && /^[A-Za-z0-9_.-]{1,40}$/.test(opts.version) ? opts.version : null;
  try {
    return await cachedRuleRecord(meet, from, to, version);
  } catch (err) {
    console.error("[racing_form] getRuleRecord 실패", err);
    return null;
  }
}

// ============================================================================
// 다른 화면이 쓰는 안전 함수 (/races 링크 · sitemap) — 실패하면 []
// ============================================================================

/** $1 race_date. */
export const EDITION_MEETS_SQL = `
SELECT e.meet
  FROM racing_form_editions e
 WHERE e.race_date = $1::date`;

/** 그날 발행본이 있는 경마장 (MEET_ORDER 순). /races 의 "이 경주 경마지 예상 보기 ›" 용. */
export async function getEditionMeetsSafe(date: string): Promise<FormMeet[]> {
  const d = normalizeFormDate(date);
  if (!d) return [];
  try {
    const rows = await query<{ meet: string }>(EDITION_MEETS_SQL, [d]);
    return rows
      .map((r) => r.meet)
      .filter(isFormMeet)
      .sort((a, b) => meetOrder(a) - meetOrder(b));
  } catch (err) {
    console.error("[racing_form] getEditionMeetsSafe 실패", err);
    return [];
  }
}

/**
 * 1면 URL 의 lastmod = GREATEST(발행 시각, 마지막 확정 시각). 철회된 호·경주면·미발행 호는 싣지 않는다.
 * lastmod 는 sitemap-shared.ts 와 같은 UTC 형식.
 */
export const FORM_SITEMAP_SQL = `
SELECT to_char(e.race_date, 'YYYY-MM-DD') AS race_date,
       e.meet,
       to_char(GREATEST(e.published_at, MAX(o.finalized_at)) AT TIME ZONE 'UTC',
               'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS lastmod
  FROM racing_form_editions e
  LEFT JOIN racing_form_race_outcomes o ON o.edition_id = e.id
 WHERE NOT EXISTS (SELECT 1
                     FROM racing_form_notices n
                    WHERE n.edition_id = e.id
                      AND n.kind = 'withdrawn')
 GROUP BY e.id
 ORDER BY e.race_date, e.id`;

/** FORM_SITEMAP_SQL 행 → sitemap URL (모르는 경마장은 버린다). */
export function formSitemapUrls(
  rows: readonly { race_date: string; meet: string; lastmod: string | null }[],
): SitemapUrl[] {
  return rows
    .filter((r) => slugFromMeet(r.meet) !== null)
    .map((r) => ({
      loc: `${SITE}${formEditionPath(r.race_date, r.meet)}`,
      ...(r.lastmod ? { lastmod: r.lastmod } : {}),
      changefreq: "weekly" as const,
      priority: 0.6,
    }));
}

/**
 * sitemap 용 1면 URL. FORM_INDEXABLE 이 꺼져 있으면(PR-3 전) noindex 페이지라 싣지 않는다 → [].
 * DB 실패도 [] (sitemap 전체가 500 이 되지 않게).
 */
export async function getFormSitemapUrlsSafe(): Promise<SitemapUrl[]> {
  if (!FORM_INDEXABLE) return [];
  try {
    return formSitemapUrls(
      await query<{ race_date: string; meet: string; lastmod: string | null }>(FORM_SITEMAP_SQL),
    );
  } catch (err) {
    console.error("[racing_form] getFormSitemapUrlsSafe 실패", err);
    return [];
  }
}
