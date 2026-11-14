/**
 * 경마지(/form) 공유 모듈 — 타입·순수 함수·상수만 (DB 의존 없음, 클라이언트·서버 양쪽에서 import 가능).
 *
 * 정본은 docs/spec/racing-form-contract.md — payload v1(§4) · 정산 판정(§6.1) · 공지(§7) ·
 * 화면 상태(§8) · 금지어·라벨·일정 벡터 공유(§9). DB 읽기는 `racing_form.ts`(server 전용).
 *
 * - payload 는 크롤러가 D−1 18:00 에 동결한 JSON 이다. 웹은 읽기만 하고 다시 계산하지 않는다.
 *   모르는 schema_version 이면 parse* 가 null → 화면은 "이 호는 새 형식이라 아직 표시할 수 없습니다".
 *   v1 안에서는 키 추가만 허용되므로 parse* 는 모르는 키를 무시한다(아는 키만 옮겨 담음).
 * - 일정 규칙은 crawler/src/racing_form/schedule.py 를 +09:00 산술로 옮겼다 — 프로세스 TZ 와 무관.
 *   벡터 crawler/tests/fixtures/racing_form/schedule_vectors.json 을 양쪽 테스트가 함께 쓴다.
 * - 시각 문자열은 오프셋이 붙은 ISO8601 만 받는다 (`…+09:00` / `…Z`). 오프셋 없는 문자열은
 *   프로세스 TZ 로 해석되므로 RangeError. 소수 초는 µs 까지 읽고 시각 비교는 µs 로 한다
 *   (DB·크롤러 정밀도 — '늦게 발행' 19:00:00.000400 같은 경계가 크롤러와 같게 판정된다).
 * - 금지어(FORBIDDEN_WORDS)·기준 라벨(RULE_LABEL)은 크롤러 정본과 vitest 가 대조한다.
 */
import type { Metadata } from "next";

import { normalizeRaceDate } from "./race-seo";

// ============================================================================
// 1. payload v1 타입 (계약 §4)
// ============================================================================

export const SCHEMA_VERSION = 1 as const;

export type RuleKey = "rating" | "form" | "course" | "jockey" | "trainer";
/** 기록 집계 키 — 기준 + 주목마(consensus). */
export type RecordKey = RuleKey | "consensus";
export type Mark = 1 | 2 | 3;
export type ConsensusMark = 1 | 2;
export type MarkMap = Partial<Record<RuleKey, Mark>>;

export type PickV1 = { mark: Mark; horse_no: string; chul_no: number; reason: string };

export type RuleResultV1 =
  | { key: RuleKey; status: "picked"; picks: PickV1[] }
  | { key: RuleKey; status: "no_pick"; reason_code: string; reason: string };

export type ConsensusStatus = "picked" | "split" | "insufficient" | "small_field";

export type ConsensusPickV1 = {
  mark: ConsensusMark;
  horse_no: string;
  chul_no: number;
  votes: number;
  /** 기준별로 받은 기호 */
  marks: MarkMap;
  /** 최대 2 */
  reasons: string[];
  reasons_more: number;
};

export type ConsensusV1 = {
  status: ConsensusStatus;
  /** A — 예상을 낸 발행 기준 수 */
  active_rules: number;
  /** 동결된 임계값 (r1 = 3) */
  min_votes: number;
  picks: ConsensusPickV1[];
};

export type JockeyChangeV1 = {
  before: string | null;
  after: string | null;
  reason: string | null;
  weight_before_tenths: number | null;
  weight_after_tenths: number | null;
};

/** 지난 경주 한 줄 — last5 는 오래된 → 최근. */
export type StartV1 = {
  race_date: string;
  meet: string;
  race_no: number;
  rank: number | null;
  distance: number | null;
  field_size: number | null;
};

/** delta 는 rating_change(정수)·budam_change(0.1kg) 에만 있다 (부호 포함, 오늘 − 직전). */
export type BadgeV1 = { kind: string; text: string; delta?: number };

export type RunnerV1 = {
  horse_no: string;
  chul_no: number;
  horse_name: string;
  sex: string | null;
  age: string | null;
  rating: number | null;
  rating_prev: number | null;
  /** 유효 부담 ×10 */
  budam_tenths: number | null;
  /** 발행 시점 실제 기수 */
  jockey_name: string | null;
  jockey_change: JockeyChangeV1 | null;
  trainer_name: string | null;
  marks: MarkMap;
  consensus_mark: ConsensusMark | null;
  career: { starts: number; wins: number; top3: number };
  last5: StartV1[];
  days_since_last: number | null;
  last_start: { race_date: string; rank: number | null } | null;
  course: { meet: string; distance: number; starts: number; wins: number; top3: number } | null;
  best_time: { time_tenths: number; race_date: string; track_condition: string | null } | null;
  /** 우선순위 순 전체 — 화면이 앞 3개 + <details> 로 나눈다 */
  badges: BadgeV1[];
};

export type StakesV1 = { name: string; grade: string | null };
export type RaceStatus = "ok" | "small_field";

export type RaceV1 = {
  race_no: number;
  race_name: string | null;
  distance: number | null;
  grade: string | null;
  track_type: string | null;
  /** "HH:MM" (발행 시점 값, 부경은 null 일 수 있음) */
  start_time: string | null;
  /** 활성 출전마 N */
  field_size: number;
  status: RaceStatus;
  stakes: StakesV1 | null;
  /** payload.rules 와 같은 순서 */
  rules: RuleResultV1[];
  consensus: ConsensusV1;
  /** chul_no 오름차순 */
  runners: RunnerV1[];
};

export type HeadlineV1 = {
  kind: string;
  race_no: number | null;
  chul_no: number | null;
  horse_no: string | null;
  text: string;
};

export type EditionMetaV1 = {
  race_date: string;
  meet: string;
  rules_version: string;
  /** H — 과거 성적은 race_date < H */
  history_before: string;
  results_through: string | null;
  entries_batch_at: string | null;
  freeze_at: string;
  warnings: string[];
};

export type RuleDefV1 = { key: RuleKey; label: string; definition: string };

export type SummaryRaceV1 = {
  race_no: number;
  race_name: string | null;
  start_time: string | null;
  distance: number | null;
  field_size: number;
  stakes: boolean;
  consensus: {
    status: ConsensusStatus;
    active_rules: number;
    pick: { chul_no: number; horse_no: string; horse_name: string; votes: number } | null;
  };
};

export type SummaryV1 = {
  schema_version: 1;
  race_date: string;
  meet: string;
  rules_version: string;
  race_count: number;
  runner_count: number;
  races: SummaryRaceV1[];
  counts: { headlines: number; jockey_changes: number; debuts: number; class_changes: number };
};

export type PayloadV1 = {
  schema_version: 1;
  edition: EditionMetaV1;
  rules: RuleDefV1[];
  races: RaceV1[];
  headlines: HeadlineV1[];
  headline_overflow: number;
  summary: SummaryV1;
};

/** 1면용 경주 — payload 의 경주에서 runners·rules 를 뺀 것 (1면은 기준×기호 표를 싣지 않는다). */
export type FrontRaceV1 = Omit<RaceV1, "runners" | "rules">;

/** 1면용 출전마 축약 — 헤드라인 마명·발행 후 기수 변경 비교에 쓴다. */
export type FrontRunnerV1 = {
  race_no: number;
  horse_no: string;
  chul_no: number;
  horse_name: string;
  jockey_name: string | null;
};

// ============================================================================
// 2. DB 읽기 결과 타입 (racing_form.ts 가 채운다). 시각은 KST ISO µs "…T18:00:00.000000+09:00".
// ============================================================================

export type FormMeet = "서울" | "제주" | "부경";
export type FormMeetSlug = "seoul" | "jeju" | "busan";

/** Q0 달력 — 발행 대상 (경주일, 경마장). first_post 는 가장 이른 발주 "HH:MM" (모르면 null). */
export type FormCalendarRow = {
  race_date: string;
  meet: FormMeet;
  race_count: number;
  first_post: string | null;
};

/** 발행본 머리 (payload 없음). summary 는 모르는 schema 면 null. */
export type EditionHead = {
  id: number;
  race_date: string;
  meet: string;
  issue_no: number;
  rules_version: string;
  schema_version: number;
  history_before: string;
  results_through: string | null;
  entries_batch_at: string | null;
  freeze_at: string;
  deadline_at: string;
  published_at: string;
  race_count: number;
  runner_count: number;
  summary: SummaryV1 | null;
};

/** 1면 묶음 (getEditionRaces). */
export type EditionFront = {
  edition: EditionMetaV1;
  rules: RuleDefV1[];
  races: FrontRaceV1[];
  headlines: HeadlineV1[];
  headline_overflow: number;
  runners: FrontRunnerV1[];
};

/** 경주면 묶음 (getRaceSlice) — 그 경주 하나 + 이전/다음용 경주 번호 목록. */
export type RaceSlice = {
  edition: EditionMetaV1;
  rules: RuleDefV1[];
  race: RaceV1;
  race_nos: number[];
};

export type FinishRow = {
  horse_no: string;
  chul_no: number | null;
  rank: number | null;
  time_tenths: number | null;
};

export type OutcomeStatus = "official" | "race_void";

/** racing_form_race_outcomes 한 행 (경주별 정산). 행이 없으면 대기. */
export type OutcomeRow = {
  race_no: number;
  status: OutcomeStatus;
  starters: number;
  finish: FinishRow[];
  winners: string[];
  placed: string[];
  non_starters: string[];
  extra_starters: string[];
  favorites: string[];
  pop_ranks: Record<string, number>;
  is_final: boolean;
  first_settled_at: string;
  settled_at: string;
  finalized_at: string | null;
};

/** 지금 출전표 기준 실제 기수 — btrim(COALESCE(기수변경 after, 출전표 기수)), 빈 값은 null. */
export type CurrentJockeyRow = {
  race_no: number;
  horse_no: string;
  chul_no: number | null;
  jockey_name: string | null;
  reason: string | null;
};

export type FormNoticeKind = "missed" | "erratum" | "withdrawn" | "result_changed" | "paused";

/** 공개 공지 (publish_failed 는 내부용이라 읽지 않는다). detail 은 필요한 값만 꺼낸다. */
export type FormNotice = {
  id: number;
  /** paused 는 시작일 */
  race_date: string;
  /** null = 모든 경마장 */
  meet: string | null;
  edition_id: number | null;
  kind: FormNoticeKind;
  public_text: string;
  /** paused 종료일(포함) — detail.until */
  until: string | null;
  /** withdrawn 법적 사유 — detail.hide_picks = true 일 때만 예상을 숨긴다 (집계는 유지) */
  hide_picks: boolean;
  /** result_changed 경주 — detail.race_no */
  race_no: number | null;
  noticed_at: string;
};

export type RuleSetRow = {
  rules_version: string;
  /** 크롤러 definitions 의 정렬 JSON (version·rules·backtest_extra_rules·params) */
  definition: unknown;
  definition_sha256: string;
  registered_at: string;
};

export type PublicBacktest = {
  id: number;
  candidate_version: string;
  definition_sha256: string;
  label: "dev" | "holdout";
  period_from: string;
  period_to: string;
  meets: string[];
  /** 보고서 JSON — 형식은 크롤러 backtest 가 정한다 */
  report: unknown;
  code_rev: string | null;
  computed_at: string;
};

/**
 * 기록 셀 — 기준 × 기호 (주목마는 mark 1 만). 확정(is_final) 정산만 센다.
 * n = 무효를 뺀 경주 수(분모). random_* · fav_* 는 **같은 경주 집합**의 기대 적중 수(소수).
 */
export type RuleRecordCell = {
  rule_key: RecordKey;
  mark: Mark;
  n: number;
  wins: number;
  top3: number;
  voids: number;
  /** Σ(1착 두수 / 출주 두수) */
  random_win: number;
  /** Σ(3착 이내 두수 / 출주 두수) */
  random_top3: number;
  /** n 중 1번 인기(확정 단승 최저)가 있는 경주 수 */
  fav_races: number;
  /** Σ(|1번 인기 ∩ 1착| / |1번 인기|) */
  fav_win: number;
  /** Σ(|1번 인기 ∩ 3착 이내| / |1번 인기|) */
  fav_top3: number;
  /** 인기 순위가 있는 표시 수 */
  pop_n: number;
  avg_pop_rank: number | null;
};

/** 기준 단위 — 참여율·◎○△ 중 1착마 포함률 분자·분모. */
export type RuleRecordRule = {
  rule_key: RecordKey;
  /** 예상을 낸(표시가 있는) 경주 수 */
  races_picked: number;
  /** 그중 무효가 아닌 표시가 하나라도 있는 경주 수 */
  races_n: number;
  /** 표시한 말 중 1착마가 있는 경주 수 */
  races_any_win: number;
};

export type RuleRecord = {
  /** 확정 정산 경주 수 (race_void 포함) */
  races: number;
  races_void: number;
  editions: number;
  first_date: string | null;
  last_date: string | null;
  cells: RuleRecordCell[];
  rules: RuleRecordRule[];
};

/** 호 하나의 결산 (mark 1 만). n = settled − voids. */
export type EditionTallyRule = {
  rule_key: RecordKey;
  picks: number;
  settled: number;
  voids: number;
  n: number;
  wins: number;
  top3: number;
};

export type EditionTally = {
  edition_id: number;
  races_settled: number;
  races_final: number;
  races_void: number;
  rules: EditionTallyRule[];
};

// ============================================================================
// 3. payload 파서 — 모르는 schema_version · 형식 오류 → null
// ============================================================================

class PayloadShapeError extends Error {}

type Obj = Record<string, unknown>;
/** 형식 오류 경로를 받는 콜백 (server 로그용). */
export type ParseErrorHandler = (path: string) => void;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const RULE_KEYS: readonly RuleKey[] = ["rating", "form", "course", "jockey", "trainer"];
const CONSENSUS_STATUSES: readonly ConsensusStatus[] = ["picked", "split", "insufficient", "small_field"];

function bad(path: string): never {
  throw new PayloadShapeError(path);
}

function obj(v: unknown, p: string): Obj {
  if (typeof v !== "object" || v === null || Array.isArray(v)) bad(p);
  return v as Obj;
}

function arr(v: unknown, p: string): unknown[] {
  if (!Array.isArray(v)) bad(p);
  return v;
}

function str(v: unknown, p: string): string {
  if (typeof v !== "string") bad(p);
  return v;
}

function strN(v: unknown, p: string): string | null {
  return v === null || v === undefined ? null : str(v, p);
}

function int(v: unknown, p: string): number {
  if (typeof v !== "number" || !Number.isSafeInteger(v)) bad(p);
  return v;
}

function intN(v: unknown, p: string): number | null {
  return v === null || v === undefined ? null : int(v, p);
}

function bool(v: unknown, p: string): boolean {
  if (typeof v !== "boolean") bad(p);
  return v;
}

function ymd(v: unknown, p: string): string {
  const s = str(v, p);
  if (!DATE_RE.test(s)) bad(p);
  return s;
}

function ymdN(v: unknown, p: string): string | null {
  return v === null || v === undefined ? null : ymd(v, p);
}

function oneOf<T extends string | number>(v: unknown, options: readonly T[], p: string): T {
  if (!(options as readonly unknown[]).includes(v)) bad(p);
  return v as T;
}

function strList(v: unknown, p: string): string[] {
  return arr(v, p).map((x, i) => str(x, `${p}[${i}]`));
}

function pMarks(v: unknown, p: string): MarkMap {
  const o = obj(v, p);
  const out: MarkMap = {};
  for (const k of Object.keys(o)) {
    const key = oneOf(k, RULE_KEYS, `${p}.${k}`);
    out[key] = oneOf(o[k], [1, 2, 3] as const, `${p}.${k}`);
  }
  return out;
}

function pRuleDef(v: unknown, p: string): RuleDefV1 {
  const o = obj(v, p);
  return {
    key: oneOf(o.key, RULE_KEYS, `${p}.key`),
    label: str(o.label, `${p}.label`),
    definition: str(o.definition, `${p}.definition`),
  };
}

function pPick(v: unknown, p: string): PickV1 {
  const o = obj(v, p);
  return {
    mark: oneOf(o.mark, [1, 2, 3] as const, `${p}.mark`),
    horse_no: str(o.horse_no, `${p}.horse_no`),
    chul_no: int(o.chul_no, `${p}.chul_no`),
    reason: str(o.reason, `${p}.reason`),
  };
}

function pRuleResult(v: unknown, p: string): RuleResultV1 {
  const o = obj(v, p);
  const key = oneOf(o.key, RULE_KEYS, `${p}.key`);
  if (o.status === "picked") {
    return {
      key,
      status: "picked",
      picks: arr(o.picks, `${p}.picks`).map((x, i) => pPick(x, `${p}.picks[${i}]`)),
    };
  }
  if (o.status === "no_pick") {
    return {
      key,
      status: "no_pick",
      reason_code: str(o.reason_code, `${p}.reason_code`),
      reason: str(o.reason, `${p}.reason`),
    };
  }
  return bad(`${p}.status`);
}

function pConsensusPick(v: unknown, p: string): ConsensusPickV1 {
  const o = obj(v, p);
  return {
    mark: oneOf(o.mark, [1, 2] as const, `${p}.mark`),
    horse_no: str(o.horse_no, `${p}.horse_no`),
    chul_no: int(o.chul_no, `${p}.chul_no`),
    votes: int(o.votes, `${p}.votes`),
    marks: pMarks(o.marks, `${p}.marks`),
    reasons: strList(o.reasons, `${p}.reasons`),
    reasons_more: int(o.reasons_more, `${p}.reasons_more`),
  };
}

function pConsensus(v: unknown, p: string): ConsensusV1 {
  const o = obj(v, p);
  return {
    status: oneOf(o.status, CONSENSUS_STATUSES, `${p}.status`),
    active_rules: int(o.active_rules, `${p}.active_rules`),
    min_votes: int(o.min_votes, `${p}.min_votes`),
    picks: arr(o.picks, `${p}.picks`).map((x, i) => pConsensusPick(x, `${p}.picks[${i}]`)),
  };
}

function pJockeyChange(v: unknown, p: string): JockeyChangeV1 | null {
  if (v === null || v === undefined) return null;
  const o = obj(v, p);
  return {
    before: strN(o.before, `${p}.before`),
    after: strN(o.after, `${p}.after`),
    reason: strN(o.reason, `${p}.reason`),
    weight_before_tenths: intN(o.weight_before_tenths, `${p}.weight_before_tenths`),
    weight_after_tenths: intN(o.weight_after_tenths, `${p}.weight_after_tenths`),
  };
}

function pStart(v: unknown, p: string): StartV1 {
  const o = obj(v, p);
  return {
    race_date: ymd(o.race_date, `${p}.race_date`),
    meet: str(o.meet, `${p}.meet`),
    race_no: int(o.race_no, `${p}.race_no`),
    rank: intN(o.rank, `${p}.rank`),
    distance: intN(o.distance, `${p}.distance`),
    field_size: intN(o.field_size, `${p}.field_size`),
  };
}

function pBadge(v: unknown, p: string): BadgeV1 {
  const o = obj(v, p);
  const badge: BadgeV1 = { kind: str(o.kind, `${p}.kind`), text: str(o.text, `${p}.text`) };
  if (o.delta !== undefined && o.delta !== null) badge.delta = int(o.delta, `${p}.delta`);
  return badge;
}

function pRunner(v: unknown, p: string): RunnerV1 {
  const o = obj(v, p);
  const career = obj(o.career, `${p}.career`);
  let lastStart: RunnerV1["last_start"] = null;
  if (o.last_start !== null && o.last_start !== undefined) {
    const ls = obj(o.last_start, `${p}.last_start`);
    lastStart = {
      race_date: ymd(ls.race_date, `${p}.last_start.race_date`),
      rank: intN(ls.rank, `${p}.last_start.rank`),
    };
  }
  let course: RunnerV1["course"] = null;
  if (o.course !== null && o.course !== undefined) {
    const c = obj(o.course, `${p}.course`);
    course = {
      meet: str(c.meet, `${p}.course.meet`),
      distance: int(c.distance, `${p}.course.distance`),
      starts: int(c.starts, `${p}.course.starts`),
      wins: int(c.wins, `${p}.course.wins`),
      top3: int(c.top3, `${p}.course.top3`),
    };
  }
  let bestTime: RunnerV1["best_time"] = null;
  if (o.best_time !== null && o.best_time !== undefined) {
    const b = obj(o.best_time, `${p}.best_time`);
    bestTime = {
      time_tenths: int(b.time_tenths, `${p}.best_time.time_tenths`),
      race_date: ymd(b.race_date, `${p}.best_time.race_date`),
      track_condition: strN(b.track_condition, `${p}.best_time.track_condition`),
    };
  }
  const cm = o.consensus_mark;
  return {
    horse_no: str(o.horse_no, `${p}.horse_no`),
    chul_no: int(o.chul_no, `${p}.chul_no`),
    horse_name: str(o.horse_name, `${p}.horse_name`),
    sex: strN(o.sex, `${p}.sex`),
    age: strN(o.age, `${p}.age`),
    rating: intN(o.rating, `${p}.rating`),
    rating_prev: intN(o.rating_prev, `${p}.rating_prev`),
    budam_tenths: intN(o.budam_tenths, `${p}.budam_tenths`),
    jockey_name: strN(o.jockey_name, `${p}.jockey_name`),
    jockey_change: pJockeyChange(o.jockey_change, `${p}.jockey_change`),
    trainer_name: strN(o.trainer_name, `${p}.trainer_name`),
    marks: pMarks(o.marks, `${p}.marks`),
    consensus_mark:
      cm === null || cm === undefined ? null : oneOf(cm, [1, 2] as const, `${p}.consensus_mark`),
    career: {
      starts: int(career.starts, `${p}.career.starts`),
      wins: int(career.wins, `${p}.career.wins`),
      top3: int(career.top3, `${p}.career.top3`),
    },
    last5: arr(o.last5, `${p}.last5`).map((x, i) => pStart(x, `${p}.last5[${i}]`)),
    days_since_last: intN(o.days_since_last, `${p}.days_since_last`),
    last_start: lastStart,
    course,
    best_time: bestTime,
    badges: arr(o.badges, `${p}.badges`).map((x, i) => pBadge(x, `${p}.badges[${i}]`)),
  };
}

function pStakes(v: unknown, p: string): StakesV1 | null {
  if (v === null || v === undefined) return null;
  const o = obj(v, p);
  return { name: str(o.name, `${p}.name`), grade: strN(o.grade, `${p}.grade`) };
}

function pFrontRace(v: unknown, p: string): FrontRaceV1 {
  const o = obj(v, p);
  return {
    race_no: int(o.race_no, `${p}.race_no`),
    race_name: strN(o.race_name, `${p}.race_name`),
    distance: intN(o.distance, `${p}.distance`),
    grade: strN(o.grade, `${p}.grade`),
    track_type: strN(o.track_type, `${p}.track_type`),
    start_time: strN(o.start_time, `${p}.start_time`),
    field_size: int(o.field_size, `${p}.field_size`),
    status: oneOf(o.status, ["ok", "small_field"] as const, `${p}.status`),
    stakes: pStakes(o.stakes, `${p}.stakes`),
    consensus: pConsensus(o.consensus, `${p}.consensus`),
  };
}

function pRace(v: unknown, p: string): RaceV1 {
  const o = obj(v, p);
  const front = pFrontRace(o, p);
  return {
    race_no: front.race_no,
    race_name: front.race_name,
    distance: front.distance,
    grade: front.grade,
    track_type: front.track_type,
    start_time: front.start_time,
    field_size: front.field_size,
    status: front.status,
    stakes: front.stakes,
    rules: arr(o.rules, `${p}.rules`).map((x, i) => pRuleResult(x, `${p}.rules[${i}]`)),
    consensus: front.consensus,
    runners: arr(o.runners, `${p}.runners`).map((x, i) => pRunner(x, `${p}.runners[${i}]`)),
  };
}

function pHeadline(v: unknown, p: string): HeadlineV1 {
  const o = obj(v, p);
  return {
    kind: str(o.kind, `${p}.kind`),
    race_no: intN(o.race_no, `${p}.race_no`),
    chul_no: intN(o.chul_no, `${p}.chul_no`),
    horse_no: strN(o.horse_no, `${p}.horse_no`),
    text: str(o.text, `${p}.text`),
  };
}

function pEditionMeta(v: unknown, p: string): EditionMetaV1 {
  const o = obj(v, p);
  return {
    race_date: ymd(o.race_date, `${p}.race_date`),
    meet: str(o.meet, `${p}.meet`),
    rules_version: str(o.rules_version, `${p}.rules_version`),
    history_before: ymd(o.history_before, `${p}.history_before`),
    results_through: ymdN(o.results_through, `${p}.results_through`),
    entries_batch_at: strN(o.entries_batch_at, `${p}.entries_batch_at`),
    freeze_at: str(o.freeze_at, `${p}.freeze_at`),
    warnings: strList(o.warnings, `${p}.warnings`),
  };
}

function pSummaryRace(v: unknown, p: string): SummaryRaceV1 {
  const o = obj(v, p);
  const c = obj(o.consensus, `${p}.consensus`);
  let pick: SummaryRaceV1["consensus"]["pick"] = null;
  if (c.pick !== null && c.pick !== undefined) {
    const k = obj(c.pick, `${p}.consensus.pick`);
    pick = {
      chul_no: int(k.chul_no, `${p}.consensus.pick.chul_no`),
      horse_no: str(k.horse_no, `${p}.consensus.pick.horse_no`),
      horse_name: str(k.horse_name, `${p}.consensus.pick.horse_name`),
      votes: int(k.votes, `${p}.consensus.pick.votes`),
    };
  }
  return {
    race_no: int(o.race_no, `${p}.race_no`),
    race_name: strN(o.race_name, `${p}.race_name`),
    start_time: strN(o.start_time, `${p}.start_time`),
    distance: intN(o.distance, `${p}.distance`),
    field_size: int(o.field_size, `${p}.field_size`),
    stakes: bool(o.stakes, `${p}.stakes`),
    consensus: {
      status: oneOf(c.status, CONSENSUS_STATUSES, `${p}.consensus.status`),
      active_rules: int(c.active_rules, `${p}.consensus.active_rules`),
      pick,
    },
  };
}

function pSummary(v: unknown, p: string): SummaryV1 {
  const o = obj(v, p);
  if (o.schema_version !== SCHEMA_VERSION) bad(`${p}.schema_version`);
  const counts = obj(o.counts, `${p}.counts`);
  return {
    schema_version: SCHEMA_VERSION,
    race_date: ymd(o.race_date, `${p}.race_date`),
    meet: str(o.meet, `${p}.meet`),
    rules_version: str(o.rules_version, `${p}.rules_version`),
    race_count: int(o.race_count, `${p}.race_count`),
    runner_count: int(o.runner_count, `${p}.runner_count`),
    races: arr(o.races, `${p}.races`).map((x, i) => pSummaryRace(x, `${p}.races[${i}]`)),
    counts: {
      headlines: int(counts.headlines, `${p}.counts.headlines`),
      jockey_changes: int(counts.jockey_changes, `${p}.counts.jockey_changes`),
      debuts: int(counts.debuts, `${p}.counts.debuts`),
      class_changes: int(counts.class_changes, `${p}.counts.class_changes`),
    },
  };
}

function pFrontRunner(v: unknown, p: string): FrontRunnerV1 {
  const o = obj(v, p);
  return {
    race_no: int(o.race_no, `${p}.race_no`),
    horse_no: str(o.horse_no, `${p}.horse_no`),
    chul_no: int(o.chul_no, `${p}.chul_no`),
    horse_name: str(o.horse_name, `${p}.horse_name`),
    jockey_name: strN(o.jockey_name, `${p}.jockey_name`),
  };
}

function attempt<T>(fn: () => T, onError?: ParseErrorHandler): T | null {
  try {
    return fn();
  } catch (e) {
    if (e instanceof PayloadShapeError) {
      onError?.(e.message);
      return null;
    }
    throw e;
  }
}

/** payload 전체 → PayloadV1. schema_version ≠ 1 이거나 형식이 어긋나면 null. */
export function parseEditionPayload(v: unknown, onError?: ParseErrorHandler): PayloadV1 | null {
  return attempt(() => {
    const o = obj(v, "$");
    if (o.schema_version !== SCHEMA_VERSION) bad("$.schema_version");
    return {
      schema_version: SCHEMA_VERSION,
      edition: pEditionMeta(o.edition, "$.edition"),
      rules: arr(o.rules, "$.rules").map((x, i) => pRuleDef(x, `$.rules[${i}]`)),
      races: arr(o.races, "$.races").map((x, i) => pRace(x, `$.races[${i}]`)),
      headlines: arr(o.headlines, "$.headlines").map((x, i) => pHeadline(x, `$.headlines[${i}]`)),
      headline_overflow: int(o.headline_overflow, "$.headline_overflow"),
      summary: pSummary(o.summary, "$.summary"),
    };
  }, onError);
}

/** editions.summary (= payload.summary) → SummaryV1. 모르는 schema 면 null. */
export function parseEditionSummary(v: unknown, onError?: ParseErrorHandler): SummaryV1 | null {
  return attempt(() => pSummary(v, "$summary"), onError);
}

/** payload.races[] 의 한 경주. */
export function parseRaceV1(v: unknown, onError?: ParseErrorHandler): RaceV1 | null {
  return attempt(() => pRace(v, "$race"), onError);
}

export function parseEditionMetaV1(v: unknown, onError?: ParseErrorHandler): EditionMetaV1 | null {
  return attempt(() => pEditionMeta(v, "$edition"), onError);
}

export function parseRuleDefsV1(v: unknown, onError?: ParseErrorHandler): RuleDefV1[] | null {
  return attempt(
    () => arr(v, "$rules").map((x, i) => pRuleDef(x, `$rules[${i}]`)),
    onError,
  );
}

export function parseHeadlinesV1(v: unknown, onError?: ParseErrorHandler): HeadlineV1[] | null {
  return attempt(
    () => arr(v, "$headlines").map((x, i) => pHeadline(x, `$headlines[${i}]`)),
    onError,
  );
}

/** 1면 SQL(EDITION_FRONT_SQL) 이 잘라 온 조각들 → EditionFront. */
export function parseEditionFront(
  parts: {
    edition: unknown;
    rules: unknown;
    races: unknown;
    headlines: unknown;
    headline_overflow: unknown;
    runners: unknown;
  },
  onError?: ParseErrorHandler,
): EditionFront | null {
  return attempt(
    () => ({
      edition: pEditionMeta(parts.edition, "$.edition"),
      rules: arr(parts.rules, "$.rules").map((x, i) => pRuleDef(x, `$.rules[${i}]`)),
      races: arr(parts.races, "$.races").map((x, i) => pFrontRace(x, `$.races[${i}]`)),
      headlines: arr(parts.headlines, "$.headlines").map((x, i) =>
        pHeadline(x, `$.headlines[${i}]`),
      ),
      headline_overflow: int(parts.headline_overflow, "$.headline_overflow"),
      runners: arr(parts.runners, "$.runners").map((x, i) => pFrontRunner(x, `$.runners[${i}]`)),
    }),
    onError,
  );
}

/** 경주면 SQL(RACE_SLICE_SQL) 조각들 → RaceSlice. 경주가 없으면(null) null. */
export function parseRaceSlice(
  parts: { edition: unknown; rules: unknown; race: unknown; race_nos: unknown },
  onError?: ParseErrorHandler,
): RaceSlice | null {
  if (parts.race === null || parts.race === undefined) return null;
  return attempt(
    () => ({
      edition: pEditionMeta(parts.edition, "$.edition"),
      rules: arr(parts.rules, "$.rules").map((x, i) => pRuleDef(x, `$.rules[${i}]`)),
      race: pRace(parts.race, "$.race"),
      race_nos: arr(parts.race_nos, "$.race_nos").map((x, i) => int(x, `$.race_nos[${i}]`)),
    }),
    onError,
  );
}

/** finish JSONB → FinishRow[] (형식이 어긋난 행은 버린다). */
export function parseFinish(v: unknown): FinishRow[] {
  if (!Array.isArray(v)) return [];
  const out: FinishRow[] = [];
  for (const x of v) {
    const row = attempt(() => {
      const o = obj(x, "$finish");
      return {
        horse_no: str(o.horse_no, "$finish.horse_no"),
        chul_no: intN(o.chul_no, "$finish.chul_no"),
        rank: intN(o.rank, "$finish.rank"),
        time_tenths: intN(o.time_tenths, "$finish.time_tenths"),
      };
    });
    if (row) out.push(row);
  }
  return out;
}

// ============================================================================
// 4. 경마장 slug · 경로 (계약 §0, 계획 4.4)
// ============================================================================

/** MEET_ORDER(서울 → 제주 → 부경) 순. `yeongcheon` 은 예약(아직 없음 → 404). */
export const FORM_MEETS: readonly { meet: FormMeet; slug: FormMeetSlug }[] = [
  { meet: "서울", slug: "seoul" },
  { meet: "제주", slug: "jeju" },
  { meet: "부경", slug: "busan" },
];

/** DB 값(한글) — MEET_ORDER 순. SQL 파라미터로 넘긴다. */
export const FORM_MEET_LABELS: readonly FormMeet[] = FORM_MEETS.map((m) => m.meet);

export function isFormMeet(v: unknown): v is FormMeet {
  return FORM_MEETS.some((m) => m.meet === v);
}

/** URL slug → DB 경마장 라벨. 모르는 값(대문자·한글·yeongcheon 포함)은 null. */
export function meetFromSlug(slug: unknown): FormMeet | null {
  return FORM_MEETS.find((m) => m.slug === slug)?.meet ?? null;
}

/** DB 경마장 라벨 → slug. '부산경남' 원문도 busan. 모르는 값은 null. */
export function slugFromMeet(meet: unknown): FormMeetSlug | null {
  const label = meet === "부산경남" ? "부경" : meet;
  return FORM_MEETS.find((m) => m.meet === label)?.slug ?? null;
}

/** 라벨 또는 slug → slug (경로 함수용). */
function toSlug(meet: string): FormMeetSlug | null {
  return slugFromMeet(meet) ?? (FORM_MEETS.some((m) => m.slug === meet) ? (meet as FormMeetSlug) : null);
}

/** 정렬용 MEET_ORDER 위치 (모르는 경마장은 뒤). */
export function meetOrder(meet: string): number {
  const label = meet === "부산경남" ? "부경" : meet;
  const i = FORM_MEET_LABELS.indexOf(label as FormMeet);
  return i < 0 ? FORM_MEET_LABELS.length : i;
}

export const FORM_HUB_PATH = "/form";
export const FORM_RECORD_PATH = "/form/record";

export function formHubPath(): string {
  return FORM_HUB_PATH;
}

/** /form/{date} — 그날 첫 경마장으로 redirect 하는 경로. */
export function formDatePath(date: string): string {
  return `${FORM_HUB_PATH}/${date}`;
}

/** 1면 /form/{date}/{slug}. meet 는 한글 라벨 또는 slug. 모르는 경마장이면 날짜 경로. */
export function formEditionPath(date: string, meet: string): string {
  const slug = toSlug(meet);
  return slug ? `${FORM_HUB_PATH}/${date}/${slug}` : formDatePath(date);
}

/** 경주면 /form/{date}/{slug}/{raceNo}. */
export function formRacePath(date: string, meet: string, raceNo: number): string {
  const slug = toSlug(meet);
  return slug ? `${FORM_HUB_PATH}/${date}/${slug}/${raceNo}` : formDatePath(date);
}

/** 기록 페이지. ?meet= 는 slug (canonical 은 쿼리 없는 FORM_RECORD_PATH 고정). */
export function formRecordPath(meet?: string | null): string {
  const slug = meet ? toSlug(meet) : null;
  return slug ? `${FORM_RECORD_PATH}?meet=${slug}` : FORM_RECORD_PATH;
}

/** 경주면 출전마 카드 앵커 id (1면 헤드라인 링크의 #fragment). */
export function runnerAnchorId(chulNo: number): string {
  return `chul-${chulNo}`;
}

/** 날짜 slug 검증 — YYYY-MM-DD + 달력상 실재하는 날짜만 (race-seo 와 같은 규칙). */
export const normalizeFormDate = normalizeRaceDate;

/** 경주번호 slug 검증 — 1~30 (DB CHECK ck_rf_picks_race_no 와 같음). "03" 은 3. */
export function normalizeFormRaceNo(v: unknown): number | null {
  const s = (Array.isArray(v) ? v[0] : v) as unknown;
  if (typeof s !== "string" || !/^\d{1,2}$/.test(s.trim())) return null;
  const n = Number(s.trim());
  return n >= 1 && n <= 30 ? n : null;
}

// ============================================================================
// 5. 기준·기호 라벨
// ============================================================================

/** 기준 고정 순서 — crawler definitions.RULE_KEYS 와 같다 (trainer 는 과거 시험 전용 예비). */
export const RULE_ORDER: readonly RuleKey[] = ["rating", "form", "course", "jockey", "trainer"];

/** 기준 라벨 — crawler definitions.RULE_LABELS · payload.rules[].label 과 같아야 한다 (vitest 대조). */
export const RULE_LABEL: Readonly<Record<RuleKey, string>> = {
  rating: "레이팅",
  form: "최근 성적",
  course: "거리 적성",
  jockey: "기수",
  trainer: "조교사",
};

export const CONSENSUS_KEY = "consensus" as const;
export const CONSENSUS_LABEL = "주목마";

/** 기록 키 라벨 (기준 + 주목마). */
export function recordKeyLabel(key: RecordKey): string {
  return key === CONSENSUS_KEY ? CONSENSUS_LABEL : RULE_LABEL[key];
}

/** 기호 slot → 읽는 말 (aria-label·범례). */
export const MARK_LABEL: Readonly<Record<Mark, string>> = { 1: "1순위", 2: "2순위", 3: "3순위" };

/** 기호 slot → 글리프. **aria·일반 텍스트 전용** — 화면 기호는 PickMark SVG 가 그린다 (DESIGN.md). */
export const MARK_TEXT: Readonly<Record<Mark, string>> = { 1: "◎", 2: "○", 3: "△" };

// ============================================================================
// 6. 일정 (crawler schedule.py 미러, r1 수치) — 프로세스 TZ 무관
// ============================================================================

/** r1 일정 수치 — definitions.RULE_SETS["r1"].params 의 history·schedule·settle 과 같다. */
export const FORM_SCHEDULE = {
  historyOffsetDays: 1,
  freezeMin: 18 * 60,
  deadlineMin: 8 * 60,
  firstPostMarginMin: 60,
  lateAfterMin: 60,
  finalizeAfterMin: 13 * 60,
  raceVoidAllNullAfterMin: 12 * 60 + 30,
  voidAfterDays: 7,
} as const;

/** 경주면 결과 줄 — 발주 시각을 모를 때 기준 시각 (D 10:00). */
export const RESULT_FALLBACK_POST_MIN = 10 * 60;

const MIN_MS = 60_000;
const DAY_MS = 86_400_000;
const KST_OFFSET_MS = 9 * 60 * MIN_MS;
const OFFSET_SUFFIX_RE = /(?:Z|[+-]\d{2}:?\d{2})$/;
/** 오프셋이 붙은 ISO8601 — 소수 초는 µs 까지 읽는다 (그 아래 자리는 버림, Python datetime 과 같음). */
const ISO_INSTANT_RE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(?:(Z)|([+-])(\d{2})(?::?(\d{2}))?)$/;

/** 시각 입력 — Date · epoch ms · 오프셋이 붙은 ISO 문자열. */
export type Instant = Date | number | string;

/**
 * 오프셋 ISO 문자열 → epoch µs. DB 는 µs 까지 저장하고(racing_form.ts 가 `.US` 로 꺼냄) 크롤러
 * schedule.is_late 도 µs 로 비교하므로, Date.parse(ms 에서 잘림) 대신 직접 읽는다.
 * epoch µs 는 2255년까지 Number 안전 정수 범위 안이다.
 */
function parseIsoUs(s: string): number {
  const m = ISO_INSTANT_RE.exec(s);
  if (!m) {
    // ISO 가 아닌 오프셋 표기(RFC 2822 등)는 엔진 파서에 맡긴다 (ms 정밀도)
    return OFFSET_SUFFIX_RE.test(s) ? Date.parse(s) * 1000 : Number.NaN;
  }
  const [y, mo, d, h, mi] = [m[1], m[2], m[3], m[4], m[5]].map(Number);
  const sec = m[6] === undefined ? 0 : Number(m[6]);
  const offH = m[10] === undefined ? 0 : Number(m[10]);
  const offM = m[11] === undefined ? 0 : Number(m[11]);
  if (h > 23 || mi > 59 || sec > 59 || offH > 23 || offM > 59) return Number.NaN;
  const base = Date.UTC(y, mo - 1, d, h, mi, sec);
  const dt = new Date(base);
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) {
    return Number.NaN; // 2월 30일 같은 없는 날짜
  }
  const offsetMin = m[8] === "Z" ? 0 : (m[9] === "-" ? -1 : 1) * (offH * 60 + offM);
  const fracUs = m[7] === undefined ? 0 : Number(`${m[7]}000000`.slice(0, 6));
  return (base - offsetMin * MIN_MS) * 1000 + fracUs;
}

/** 시각 → epoch µs. 비교는 모두 이 값으로 한다 (크롤러와 같은 µs 정밀도). */
function toUs(t: Instant): number {
  let us: number;
  if (t instanceof Date) us = t.getTime() * 1000;
  else if (typeof t === "number") us = t * 1000;
  else us = parseIsoUs(t.trim()); // 오프셋 없는 문자열은 프로세스 TZ 로 해석되므로 받지 않는다 (NaN)
  if (!Number.isFinite(us)) throw new RangeError(`racing_form: 시각 형식 오류 ${String(t)}`);
  return us;
}

/** 시각 → epoch ms (µs 아래는 버림) — 표기·Date 생성용. */
function toMs(t: Instant): number {
  return Math.floor(toUs(t) / 1000);
}

/** a < b (µs). */
function before(a: Instant, b: Instant): boolean {
  return toUs(a) < toUs(b);
}

/** "YYYY-MM-DD" → 그 날짜 00:00 UTC 의 epoch ms (실재하지 않는 날짜는 RangeError). */
function dayMs(date: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) throw new RangeError(`racing_form: 날짜 형식 오류 ${date}`);
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const ms = Date.UTC(y, mo - 1, d);
  const dt = new Date(ms);
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) {
    throw new RangeError(`racing_form: 없는 날짜 ${date}`);
  }
  return ms;
}

export function addDays(date: string, days: number): string {
  return new Date(dayMs(date) + days * DAY_MS).toISOString().slice(0, 10);
}

/** date 의 00:00 KST 로부터 minutes 분 뒤. */
export function atKst(date: string, minutes: number): Date {
  return new Date(dayMs(date) - KST_OFFSET_MS + minutes * MIN_MS);
}

/** 그 시각의 KST 날짜 "YYYY-MM-DD". */
export function kstDateOf(t: Instant): string {
  return new Date(toMs(t) + KST_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * KST ISO 문자열 "2026-11-13T18:00:00.000+09:00" (ms — 여기서 계산한 시각용).
 * DB 읽기 결과(racing_form.ts)는 µs "…T18:00:00.000000+09:00" 이고, 둘 다 이 모듈의 함수가 받는다.
 */
export function isoKst(t: Instant): string {
  return new Date(toMs(t) + KST_OFFSET_MS).toISOString().replace("Z", "+09:00");
}

/** '10:35' · '1035' · '10:35:00' · ' 8:30 ' → 자정 기준 분. 이상하면 null (schedule.parse_hhmm). */
export function parseHhmm(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const m = /^\s*(\d{1,2}):?(\d{2})(?::\d{2})?\s*$/.exec(String(value));
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

/** 발주 시각 표기 — '9:30' · '0930' · '9:30:00' → "09:30" (crawler parse.fmt_hhmm). 이상하면 null. */
export function formatHhmm(value: string | null | undefined): string | null {
  const m = parseHhmm(value);
  return m === null ? null : `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
}

/** H — 과거 성적은 race_date < H. */
export function historyBefore(raceDate: string): string {
  return addDays(raceDate, -FORM_SCHEDULE.historyOffsetDays);
}

/** 동결·발행 = (D−1) 18:00 KST. */
export function freezeAt(raceDate: string): Date {
  return atKst(addDays(raceDate, -1), FORM_SCHEDULE.freezeMin);
}

/** 마감 = min(D 08:00, 첫 발주 − 60분). 첫 발주를 모르면 08:00. */
export function deadlineAt(raceDate: string, firstPost: string | null | undefined): Date {
  const base = atKst(raceDate, FORM_SCHEDULE.deadlineMin);
  const fp = parseHhmm(firstPost);
  if (fp === null) return base;
  const cand = atKst(raceDate, fp - FORM_SCHEDULE.firstPostMarginMin);
  return cand.getTime() < base.getTime() ? cand : base;
}

/** '늦게 발행' 경계 = freeze + 60분 (이 시각을 넘기면 늦게 발행). */
export function lateLimitAt(raceDate: string): Date {
  return new Date(freezeAt(raceDate).getTime() + FORM_SCHEDULE.lateAfterMin * MIN_MS);
}

/** 판정용 예약 시각 — 초 이하를 버린다 (KST 오프셋이 정시 단위라 UTC 에서 잘라도 같다). */
export function scheduledMinute(now: Instant): Date {
  return new Date(Math.floor(toMs(now) / MIN_MS) * MIN_MS);
}

/** 발행 창 [freeze_at, deadline_at) — 분 단위로 자른 예약 시각으로 판정. */
export function inWindow(now: Instant, raceDate: string, firstPost: string | null | undefined): boolean {
  const t = scheduledMinute(now).getTime();
  return freezeAt(raceDate).getTime() <= t && t < deadlineAt(raceDate, firstPost).getTime();
}

export function isPastDeadline(
  now: Instant,
  raceDate: string,
  firstPost: string | null | undefined,
): boolean {
  return scheduledMinute(now).getTime() >= deadlineAt(raceDate, firstPost).getTime();
}

/** 늦게 발행 = published_at > freeze_at + 60분 (µs 단위로 비교 — 19:00:00.000400 은 늦게 발행). */
export function isLate(publishedAt: Instant, raceDate: string): boolean {
  return before(lateLimitAt(raceDate), publishedAt);
}

/** 정산 확정 = (D+1) 13:00 KST. */
export function finalizeAt(raceDate: string): Date {
  return atKst(addDays(raceDate, 1), FORM_SCHEDULE.finalizeAfterMin);
}

/** 결과 행이 전부 rank NULL 인 경주의 무효 판정 시각 = (D+1) 12:30 KST. */
export function raceVoidAllNullAfter(raceDate: string): Date {
  return atKst(addDays(raceDate, 1), FORM_SCHEDULE.raceVoidAllNullAfterMin);
}

/** 이 날짜(KST) 이후 정산에서 결과가 없는 경주를 무효로 확정 (D+7). */
export function voidAfter(raceDate: string): string {
  return addDays(raceDate, FORM_SCHEDULE.voidAfterDays);
}

// ============================================================================
// 7. 날짜·시각 표기 — "11월 8일(일)" 한 형식 (계획 4.5)
// ============================================================================

const WEEKDAY_KO = ["일", "월", "화", "수", "목", "금", "토"] as const;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** "2026-11-14" → "11월 14일" */
export function mdKo(date: string): string {
  const d = new Date(dayMs(date));
  return `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일`;
}

/** "2026-11-14" → "11월 14일(토)" */
export function dateKo(date: string): string {
  const d = new Date(dayMs(date));
  return `${mdKo(date)}(${WEEKDAY_KO[d.getUTCDay()]})`;
}

function kstClock(t: Instant): { date: string; hour: number; minute: number } {
  const d = new Date(toMs(t) + KST_OFFSET_MS);
  return { date: d.toISOString().slice(0, 10), hour: d.getUTCHours(), minute: d.getUTCMinutes() };
}

/** 18:05 → "오후 6시 5분", 12:00 → "오후 12시", 00:30 → "오전 12시 30분" (12시간제). */
export function clockKo(hour: number, minute: number): string {
  const ampm = hour < 12 ? "오전" : "오후";
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return minute === 0 ? `${ampm} ${h12}시` : `${ampm} ${h12}시 ${minute}분`;
}

/** 발행 도장 — "11월 13일(금) 오후 6시" (분이 0 이 아니면 "오후 6시 5분"). 초는 버린다. */
export function publishStampKo(t: Instant): string {
  const c = kstClock(t);
  return `${dateKo(c.date)} ${clockKo(c.hour, c.minute)}`;
}

/** 출전표 갱신 도장 — "11월 13일(금) 15:00". */
export function dateTimeKo(t: Instant): string {
  const c = kstClock(t);
  return `${dateKo(c.date)} ${pad2(c.hour)}:${pad2(c.minute)}`;
}

/** "11월 14일(토) 서울 경마지" (h1·title). */
export function editionTitleKo(raceDate: string, meet: string): string {
  return `${dateKo(raceDate)} ${meet} 경마지`;
}

/** "제3호" */
export function issueLabel(issueNo: number): string {
  return `제${issueNo}호`;
}

// ============================================================================
// 8. 화면 상태 editionState (계약 §8)
// ============================================================================

export type EditionStateInput = {
  /**
   * Q0 달력 행 (그날 그 경마장에 출전표가 있는 경주가 있음). FormCalendarRow 를 그대로 넘기면 된다
   * — meet 는 비교에만 쓰므로 string 으로 받는다 (발행본 머리 EditionHead.meet 와 같은 타입).
   */
  planned: { race_date: string; meet: string; first_post: string | null } | null;
  edition: Pick<
    EditionHead,
    "id" | "race_date" | "meet" | "freeze_at" | "deadline_at" | "published_at"
  > | null;
  /** 공개 공지 — 다른 호·날짜 것이 섞여 있어도 된다 (여기서 거른다) */
  notices: readonly FormNotice[];
  now: Instant;
  /** MIN(rule_sets.registered_at) — 없으면 출시 전 */
  launchAt: string | null;
};

type StateBase = {
  raceDate: string;
  meet: string;
  /** KST ISO */
  freezeAt: string;
  /** KST ISO */
  deadlineAt: string;
};

export type EditionState =
  /** 계획 없음 → 404 */
  | { state: "none"; notFound: true; indexable: false }
  /** 발행됨 (늦게 발행 포함) — 고정본 + 발행 후 변경 */
  | (StateBase & {
      state: "published";
      notFound: false;
      indexable: true;
      late: boolean;
      publishedAt: string;
      errata: FormNotice[];
    })
  /** 철회 — 예상은 그대로 + 배너. hidePicks(법적 사유)일 때만 예상을 숨긴다. 집계는 유지 */
  | (StateBase & {
      state: "withdrawn";
      notFound: false;
      indexable: false;
      late: boolean;
      publishedAt: string;
      errata: FormNotice[];
      withdrawnNotice: FormNotice;
      hidePicks: boolean;
    })
  /** 출시 전 → 404 (허브는 "준비 중") */
  | (StateBase & { state: "prelaunch"; notFound: true; indexable: false })
  /** 쉼 — "이번 주는 쉽니다 — {사유}" */
  | (StateBase & {
      state: "paused";
      notFound: false;
      indexable: false;
      pausedReason: string | null;
      pausedNotice: FormNotice;
    })
  /** 발행 예정 — now < freeze_at */
  | (StateBase & { state: "planned"; notFound: false; indexable: false })
  /** 발행 준비 중 — freeze_at ≤ now < deadline_at */
  | (StateBase & { state: "delayed"; notFound: false; indexable: false })
  /** 미발행 — now ≥ deadline_at (missed 공지가 없어도). 사유가 없으면 "확인 중" */
  | (StateBase & {
      state: "missed";
      notFound: false;
      indexable: false;
      missedReason: string | null;
      missedNotice: FormNotice | null;
    });

export type EditionStateName = EditionState["state"];

function sameMeet(a: string | null, b: string): boolean {
  if (a === null) return true; // 공지 meet NULL = 모든 경마장
  const n = (x: string) => (x === "부산경남" ? "부경" : x);
  return n(a) === n(b);
}

function byNoticed(a: FormNotice, b: FormNotice): number {
  return toUs(a.noticed_at) - toUs(b.noticed_at) || a.id - b.id;
}

function textOrNull(s: string | null | undefined): string | null {
  const t = s?.trim();
  return t ? t : null;
}

function noticeOfEdition(
  n: FormNotice,
  ed: { id: number; race_date: string; meet: string },
): boolean {
  if (n.edition_id !== null) return n.edition_id === ed.id;
  return n.race_date === ed.race_date && sameMeet(n.meet, ed.meet);
}

/** paused 공지 기간 [race_date, until] 에 date 가 들어가는지 (until 없으면 그날 하루). */
function pausedCovers(n: FormNotice, date: string): boolean {
  return n.race_date <= date && (n.until ?? n.race_date) >= date;
}

/** missed 공지 public_text 의 머리 — crawler jobs.MISSED_TEMPLATE "이번 호는 발행하지 않았습니다 — {사유}". */
export const MISSED_HEAD = "이번 호는 발행하지 않았습니다";
const MISSED_PREFIX_RE = /^이번 호는 발행하지 않았습니다\s*(?:—|-)?\s*/;

/** missed 공지 → 사유만 ("출전표 자료를 확인하지 못했습니다"). 템플릿 머리는 뗀다, 비면 null. */
export function missedReasonOf(publicText: string | null | undefined): string | null {
  const t = textOrNull(publicText);
  return t === null ? null : textOrNull(t.replace(MISSED_PREFIX_RE, ""));
}

/** 쉼 화면 문구의 머리 — "이번 주는 쉽니다 — {사유}". */
export const PAUSED_HEAD = "이번 주는 쉽니다";
const PAUSED_PREFIX_RE = /^이번 주는 쉽니다\s*(?:—|-)?\s*/;

/** paused 공지(운영자 문구 = 사유) → 사유만. 운영자가 머리까지 적었으면 떼어 두 번 나오지 않게. */
export function pausedReasonOf(publicText: string | null | undefined): string | null {
  const t = textOrNull(publicText);
  return t === null ? null : textOrNull(t.replace(PAUSED_PREFIX_RE, ""));
}

/** 계약 §8 판정 순서: published(withdrawn) → none → prelaunch → paused → planned → delayed → missed. */
export function editionState(input: EditionStateInput): EditionState {
  const { planned, edition, notices, launchAt } = input;

  if (edition) {
    const mine = notices.filter((n) => noticeOfEdition(n, edition));
    const errata = mine.filter((n) => n.kind === "erratum").sort(byNoticed);
    const withdrawn = mine.filter((n) => n.kind === "withdrawn").sort(byNoticed);
    const base = {
      raceDate: edition.race_date,
      meet: edition.meet,
      freezeAt: edition.freeze_at,
      deadlineAt: edition.deadline_at,
      late: isLate(edition.published_at, edition.race_date),
      publishedAt: edition.published_at,
      errata,
    };
    if (withdrawn.length > 0) {
      return {
        ...base,
        state: "withdrawn",
        notFound: false,
        indexable: false,
        withdrawnNotice: withdrawn[0],
        hidePicks: withdrawn.some((n) => n.hide_picks),
      };
    }
    return { ...base, state: "published", notFound: false, indexable: true };
  }

  if (!planned) return { state: "none", notFound: true, indexable: false };

  const freeze = freezeAt(planned.race_date);
  const deadline = deadlineAt(planned.race_date, planned.first_post);
  const base: StateBase = {
    raceDate: planned.race_date,
    meet: planned.meet,
    freezeAt: isoKst(freeze),
    deadlineAt: isoKst(deadline),
  };

  // 크롤러 missed 판정(freeze_at ≥ launchAt 인 호만)과 같은 경계 — µs 로 비교
  if (launchAt === null || before(freeze, launchAt)) {
    return { ...base, state: "prelaunch", notFound: true, indexable: false };
  }

  const pausedAll = notices
    .filter(
      (n) =>
        n.kind === "paused" && sameMeet(n.meet, planned.meet) && pausedCovers(n, planned.race_date),
    )
    .sort(byNoticed);
  // 기간이 겹치면 가장 최근 공지의 사유 (Array.prototype.at 은 구형 Safari 에 없어 쓰지 않음)
  const paused = pausedAll.length > 0 ? pausedAll[pausedAll.length - 1] : undefined;
  if (paused) {
    return {
      ...base,
      state: "paused",
      notFound: false,
      indexable: false,
      pausedReason: pausedReasonOf(paused.public_text),
      pausedNotice: paused,
    };
  }

  // freeze·deadline 은 분 단위 시각이라 now 를 분으로 자른 판정(크롤러 in_window)과 결과가 같다
  if (before(input.now, freeze)) {
    return { ...base, state: "planned", notFound: false, indexable: false };
  }
  if (before(input.now, deadline)) {
    return { ...base, state: "delayed", notFound: false, indexable: false };
  }

  const missed =
    notices
      .filter(
        (n) =>
          n.kind === "missed" &&
          n.race_date === planned.race_date &&
          sameMeet(n.meet, planned.meet),
      )
      .sort(byNoticed)[0] ?? null;
  return {
    ...base,
    state: "missed",
    notFound: false,
    indexable: false,
    missedReason: missed ? missedReasonOf(missed.public_text) : null,
    missedNotice: missed,
  };
}

/**
 * 상태 안내 한 줄 — 계획 4.3 표의 화면 문구. 404 상태(none·prelaunch)와 제때 발행된 호는 null.
 *  - planned   "11월 14일(토) 서울 경마지 — 11월 13일(금) 오후 6시 발행 예정"
 *  - delayed   "발행이 늦어지고 있습니다 — 오전 8시까지 다시 시도합니다" (마감 시각)
 *  - missed    "이번 호는 발행하지 않았습니다 — {사유 | 확인 중}"
 *  - paused    "이번 주는 쉽니다 — {사유}"
 *  - withdrawn "철회됨 — 기록에 포함 ({공지 시각}·{사유})"
 *  - published(late) "늦게 발행 — {실제 발행 시각}"
 */
export function editionStateText(s: EditionState): string | null {
  switch (s.state) {
    case "planned":
      return `${editionTitleKo(s.raceDate, s.meet)} — ${publishStampKo(s.freezeAt)} 발행 예정`;
    case "delayed": {
      const c = kstClock(s.deadlineAt);
      return `발행이 늦어지고 있습니다 — ${clockKo(c.hour, c.minute)}까지 다시 시도합니다`;
    }
    case "missed":
      return `${MISSED_HEAD} — ${s.missedReason ?? "확인 중"}`;
    case "paused":
      return s.pausedReason ? `${PAUSED_HEAD} — ${s.pausedReason}` : PAUSED_HEAD;
    case "withdrawn": {
      const reason = textOrNull(s.withdrawnNotice.public_text);
      const when = publishStampKo(s.withdrawnNotice.noticed_at);
      return `철회됨 — 기록에 포함 (${reason ? `${when}·${reason}` : when})`;
    }
    case "published":
      return s.late ? `늦게 발행 — ${publishStampKo(s.publishedAt)}` : null;
    case "prelaunch":
    case "none":
      return null;
  }
}

// ============================================================================
// 9. 결과·판정 (계약 §6.1, §8 결과 줄)
// ============================================================================

export type RaceResultState = "result" | "before_post" | "settling";

/** 경주면 결과 줄: 정산 행 있음 → result, 없고 now < 발주(모르면 D 10:00) → before_post, 그 밖 settling. */
export function raceResultState(args: {
  outcome: unknown;
  raceDate: string;
  /** 지금 races.start_time (덧씌움) 또는 payload start_time */
  startTime: string | null | undefined;
  now: Instant;
}): RaceResultState {
  if (args.outcome !== null && args.outcome !== undefined) return "result";
  const post = parseHhmm(args.startTime) ?? RESULT_FALLBACK_POST_MIN;
  return before(args.now, atKst(args.raceDate, post)) ? "before_post" : "settling";
}

export type PickOutcome = "pending" | "void" | "win" | "top3" | "miss";

export const PICK_OUTCOME_LABEL: Readonly<Record<PickOutcome, string>> = {
  pending: "결과 전",
  void: "무효",
  win: "1착",
  top3: "3착 이내",
  miss: "빗나감",
};

export type OutcomeLike = {
  status: string;
  winners: readonly string[];
  placed: readonly string[];
  non_starters: readonly string[];
};

/** 표시 판정 (§6.1): 행 없음 pending · race_void 또는 non_starters → void · winners → win · placed → top3 · miss. */
export function pickOutcome(horseNo: string, outcome: OutcomeLike | null | undefined): PickOutcome {
  if (!outcome || outcome.status === "pending") return "pending";
  if (outcome.status === "race_void" || outcome.non_starters.includes(horseNo)) return "void";
  if (outcome.winners.includes(horseNo)) return "win";
  if (outcome.placed.includes(horseNo)) return "top3";
  return "miss";
}

/** 정산의 착순 (RankBadge 용). 결과 행이 없거나 순위 없음이면 null. */
export function finishRankOf(outcome: Pick<OutcomeRow, "finish"> | null | undefined, horseNo: string): number | null {
  return outcome?.finish.find((f) => f.horse_no === horseNo)?.rank ?? null;
}

// ============================================================================
// 10. 발행 후 기수 변경 (계획 4.7) — 이름 내용 비교, 시각은 보지 않는다
// ============================================================================

export type PublishedJockey = {
  /** 있으면 (race_no, horse_no) 로, 없으면 horse_no 로만 맞춘다 */
  race_no?: number;
  horse_no: string;
  chul_no: number;
  jockey_name: string | null;
};

export type JockeyDiff = {
  race_no: number;
  horse_no: string;
  chul_no: number;
  /** 발행본(payload) 기수 */
  before: string | null;
  /** 지금 실제 기수 */
  after: string;
  /** 지금 기수변경 행의 사유 */
  reason: string | null;
};

function normName(v: string | null | undefined): string | null {
  const t = v?.trim();
  return t ? t : null;
}

/**
 * 발행 시점 기수변경 행의 전·후 이름이 같은지 (정규화 이름, 둘 다 있을 때만) — crawler
 * news.is_same_jockey 와 같다. "A→A" 는 교체가 아니다 (크롤러는 배지·헤드라인을 내지 않고
 * payload 의 runner.jockey_change 객체만 남긴다 — 계약 §3).
 */
export function isSameJockey(jc: Pick<JockeyChangeV1, "before" | "after">): boolean {
  const b = normName(jc.before);
  const a = normName(jc.after);
  return b !== null && a !== null && b === a;
}

/** 출전마 카드의 "기수 교체" 표시용 — 발행 시점 기수변경이 없거나 "A→A" 면 null. */
export function shownJockeyChange(runner: Pick<RunnerV1, "jockey_change">): JockeyChangeV1 | null {
  const jc = runner.jockey_change;
  return jc !== null && !isSameJockey(jc) ? jc : null;
}

/** payload races → 비교용 목록 (1면: EditionFront.runners 를 그대로 써도 된다). race_no 는 늘 채운다. */
export function publishedJockeys(
  races: ReadonlyArray<{
    race_no: number;
    runners: ReadonlyArray<{ horse_no: string; chul_no: number; jockey_name: string | null }>;
  }>,
): (PublishedJockey & { race_no: number })[] {
  return races.flatMap((r) =>
    r.runners.map((u) => ({
      race_no: r.race_no,
      horse_no: u.horse_no,
      chul_no: u.chul_no,
      jockey_name: u.jockey_name,
    })),
  );
}

/**
 * 발행본 기수 vs 지금 실제 기수 (trim 비교). 다르면 "※ 발행 후 기수 변경 {before}→{after} ({reason})".
 * 재변경 A→B→C 는 before = 발행본 A, after = 지금 C 한 건. 되돌아온 A→B→A 는 변경 없음.
 * 지금 출전표에 없는 말(빠짐)·지금 기수 이름이 비어 있는 말은 기수 변경이 아니라 건너뛴다.
 */
export function diffJockeys(
  published: readonly PublishedJockey[],
  current: readonly CurrentJockeyRow[],
): JockeyDiff[] {
  const byRaceHorse = new Map<string, CurrentJockeyRow>();
  const byHorse = new Map<string, CurrentJockeyRow>();
  for (const c of current) {
    const h = c.horse_no.trim();
    const k = `${c.race_no}|${h}`;
    if (!byRaceHorse.has(k)) byRaceHorse.set(k, c);
    if (!byHorse.has(h)) byHorse.set(h, c);
  }
  const out: JockeyDiff[] = [];
  for (const p of published) {
    const h = p.horse_no.trim();
    const c = p.race_no === undefined ? byHorse.get(h) : byRaceHorse.get(`${p.race_no}|${h}`);
    if (!c) continue;
    const before = normName(p.jockey_name);
    const after = normName(c.jockey_name);
    if (after === null || before === after) continue;
    out.push({
      race_no: p.race_no ?? c.race_no,
      horse_no: p.horse_no,
      chul_no: p.chul_no,
      before,
      after,
      reason: normName(c.reason),
    });
  }
  return out.sort((a, b) => a.race_no - b.race_no || a.chul_no - b.chul_no);
}

// ============================================================================
// 11. 기록 표기 (계획 7.5) — 분수 상시, n<30 % 숨김, n<100 안내, 무작위 대비 ▲▼
// ============================================================================

/** 이 경주 수 미만이면 % 를 내지 않는다. */
export const RECORD_MIN_PCT_N = 30;
/** 이 경주 수 미만이면 "숫자가 크게 흔들립니다" 안내. */
export const RECORD_STABLE_N = 100;

/** 정수 퍼센트 (100·w + n//2)//n — crawler parse.pct 와 같다. n ≤ 0 이면 null. */
export function pct(w: number, n: number): number | null {
  if (!(n > 0)) return null;
  return Math.floor((100 * w + Math.floor(n / 2)) / n);
}

/** 소수 분자(기대값) 용 퍼센트 — 반올림. */
function pctReal(x: number, n: number): number | null {
  if (!(n > 0)) return null;
  return Math.floor((100 * x) / n + 0.5);
}

/** 분수 표기 — 정수는 그대로, 소수(동착·동률 기대값)는 소수 첫째 자리. */
function fracNum(x: number): string {
  return Number.isInteger(x) ? String(x) : (Math.round(x * 10) / 10).toFixed(1);
}

export type SampleNote = { kind: "too_few" | "few"; text: string };

/** n<30: "% 는 아직 내지 않습니다 (n경주)", n<100: "숫자가 크게 흔들립니다". 그 이상 null. */
export function sampleNote(n: number): SampleNote | null {
  if (n < RECORD_MIN_PCT_N) {
    return {
      kind: "too_few",
      text: `경주 수가 ${RECORD_MIN_PCT_N} 미만이라 %는 아직 내지 않습니다 (${n}경주)`,
    };
  }
  if (n < RECORD_STABLE_N) return { kind: "few", text: "경주 수가 적어 숫자가 크게 흔들립니다" };
  return null;
}

export type RecordStat = {
  hits: number;
  n: number;
  /** "19/80" */
  fraction: string;
  /** n < 30 이면 null */
  pct: number | null;
  /** "19/80 (24%)" 또는 "19/80" */
  text: string;
  /** 95% Wilson 흔들림 폭(정수 %) — <details> 안에만. n < 30 이면 null */
  ci: { lo: number; hi: number } | null;
};

/** 95% Wilson 구간 (정수 %, 내림·올림). */
export function wilsonInterval(hits: number, n: number): { lo: number; hi: number } | null {
  if (!(n > 0)) return null;
  const z = 1.96;
  const p = hits / n;
  const den = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / den;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / den;
  return {
    lo: Math.max(0, Math.floor((center - half) * 100)),
    hi: Math.min(100, Math.ceil((center + half) * 100)),
  };
}

export function recordStat(hits: number, n: number): RecordStat {
  const shown = n >= RECORD_MIN_PCT_N;
  const p = shown ? (Number.isInteger(hits) ? pct(hits, n) : pctReal(hits, n)) : null;
  const fraction = `${fracNum(hits)}/${n}`;
  return {
    hits,
    n,
    fraction,
    pct: p,
    text: p === null ? fraction : `${fraction} (${p}%)`,
    ci: shown && Number.isInteger(hits) ? wilsonInterval(hits, n) : null,
  };
}

export type RecordMarkRow = {
  mark: Mark;
  /** 무효를 뺀 경주 수 */
  n: number;
  voids: number;
  win: RecordStat;
  top3: RecordStat;
  /** 같은 경주 무작위 1착 % (n<30 이면 null) */
  randomWinPct: number | null;
  randomTop3Pct: number | null;
  /** win.pct − randomWinPct (부호 있는 정수, ▲▼ 용). 어느 쪽이든 null 이면 null */
  winDelta: number | null;
  top3Delta: number | null;
  /** 경주 후 1번 인기 1착 (확정 배당 기준 — 발행 때는 알 수 없던 정보). 배당 있는 경주만 */
  favorite: RecordStat | null;
  /** 평균 인기 순위 (소수 첫째 자리) — 기록 페이지 ◎ 에만 표시 */
  avgPopRank: number | null;
  note: SampleNote | null;
};

export type RecordRuleRow = {
  key: RecordKey;
  label: string;
  /** 참여율(주목마는 선정률) = 예상을 낸 경주 / 확정 경주 */
  participation: RecordStat;
  /** ◎○△ 중 1착마 포함 = 1착마를 표시한 경주 / 무효 아닌 표시가 있는 경주 (주목마는 null) */
  anyWin: RecordStat | null;
  /** mark 1·2·3 (주목마는 1 만) */
  marks: RecordMarkRow[];
};

function emptyCell(key: RecordKey, mark: Mark): RuleRecordCell {
  return {
    rule_key: key,
    mark,
    n: 0,
    wins: 0,
    top3: 0,
    voids: 0,
    random_win: 0,
    random_top3: 0,
    fav_races: 0,
    fav_win: 0,
    fav_top3: 0,
    pop_n: 0,
    avg_pop_rank: null,
  };
}

function delta(a: number | null, b: number | null): number | null {
  return a === null || b === null ? null : a - b;
}

function markRow(c: RuleRecordCell): RecordMarkRow {
  const win = recordStat(c.wins, c.n);
  const top3 = recordStat(c.top3, c.n);
  const shown = c.n >= RECORD_MIN_PCT_N;
  const randomWinPct = shown ? pctReal(c.random_win, c.n) : null;
  const randomTop3Pct = shown ? pctReal(c.random_top3, c.n) : null;
  return {
    mark: c.mark,
    n: c.n,
    voids: c.voids,
    win,
    top3,
    randomWinPct,
    randomTop3Pct,
    winDelta: delta(win.pct, randomWinPct),
    top3Delta: delta(top3.pct, randomTop3Pct),
    favorite: c.fav_races > 0 ? recordStat(c.fav_win, c.fav_races) : null,
    avgPopRank: c.avg_pop_rank === null ? null : Math.round(c.avg_pop_rank * 10) / 10,
    note: sampleNote(c.n),
  };
}

/**
 * 기록 → 화면 행. 고정 순서(RULE_ORDER, 주목마는 끝), '최고 기준' 강조 없음.
 * r1 발행 기준 4개는 표시가 없어도 0 으로 채우고, trainer 는 데이터가 있을 때만 싣는다.
 */
export function recordRows(record: RuleRecord): RecordRuleRow[] {
  const keys: RecordKey[] = [
    ...RULE_ORDER.filter(
      (k) =>
        k !== "trainer" ||
        record.cells.some((c) => c.rule_key === k) ||
        record.rules.some((r) => r.rule_key === k),
    ),
    CONSENSUS_KEY,
  ];
  return keys.map((key) => {
    const marks: Mark[] = key === CONSENSUS_KEY ? [1] : [1, 2, 3];
    const rule = record.rules.find((r) => r.rule_key === key);
    return {
      key,
      label: recordKeyLabel(key),
      participation: recordStat(rule?.races_picked ?? 0, record.races),
      anyWin: key === CONSENSUS_KEY ? null : recordStat(rule?.races_any_win ?? 0, rule?.races_n ?? 0),
      marks: marks.map((m) =>
        markRow(record.cells.find((c) => c.rule_key === key && c.mark === m) ?? emptyCell(key, m)),
      ),
    };
  });
}

/** 기록 페이지 고정 문구. */
export const RECORD_ROI_NOTE = "적중률은 수익을 뜻하지 않습니다. 인기 많은 말일수록 배당이 낮습니다.";
export const RECORD_FAVORITE_TAG = "확정 배당 기준 — 발행 때는 알 수 없던 정보";

// ============================================================================
// 12. 주목마 한 줄 (계획 5.3)
// ============================================================================

/** r1 consensus.min_active_rules — "기준 3개 이상이 예상해야" */
export const CONSENSUS_MIN_ACTIVE_RULES = 3;
/** r1 consensus.min_votes */
export const CONSENSUS_MIN_VOTES = 3;
/** r1 field.min_active — 이 두수 미만이면 모든 기준 예상 안 함 */
export const FIELD_MIN_ACTIVE = 5;

/**
 * 주목마 문구 — 분모는 항상 A(예상을 낸 기준 수).
 * picked: votes 는 그 주목마를 고른 기준 수 / small_field: field_size 는 활성 출전마 수.
 */
export function consensusLine(c: {
  status: ConsensusStatus;
  active_rules: number;
  votes?: number | null;
  field_size?: number | null;
}): string {
  switch (c.status) {
    case "picked":
      if (c.votes === null || c.votes === undefined) {
        return `예상을 낸 기준 ${c.active_rules}개 중 ${CONSENSUS_MIN_VOTES}개 이상이 고름`;
      }
      return c.votes === c.active_rules
        ? `예상을 낸 기준 ${c.active_rules}개가 모두 고름`
        : `예상을 낸 기준 ${c.active_rules}개 중 ${c.votes}개가 고름`;
    case "split":
      return "혼전 — 기준마다 고른 말이 다릅니다";
    case "insufficient":
      return `주목마 없음 — 기준 ${CONSENSUS_MIN_ACTIVE_RULES}개 이상이 예상해야 고릅니다 (이번엔 ${c.active_rules}개)`;
    case "small_field":
      return c.field_size === null || c.field_size === undefined
        ? `예상 안 함 — 출전 ${FIELD_MIN_ACTIVE}두 미만`
        : `예상 안 함 — 출전 ${c.field_size}두`;
  }
}

/** 1면 경주 한 줄용 — summary 경주에서 바로. */
export function summaryConsensusLine(r: SummaryRaceV1): string {
  return consensusLine({
    status: r.consensus.status,
    active_rules: r.consensus.active_rules,
    votes: r.consensus.pick?.votes,
    field_size: r.field_size,
  });
}

// ============================================================================
// 13. 경주 후 결산 한 줄 (계획 4.8)
// ============================================================================

export type SettlementLine = {
  /** "오늘 서울 12경주" / "11월 14일(토) 서울 12경주" */
  head: string;
  /** "주목마 9경주 중 1착 3/9 · 3착 이내 6/9 · 무효 0" 또는 "주목마 없음" */
  consensus: string;
  /** "1착: 레이팅 3/12 · 최근 성적 2/11 · …" — 화면은 앞에 PickMark(◎)를 그린다. 기준 표시가 없으면 null */
  marks: string | null;
  /** "잠정 — 내일 오후 1시 확정" · "잠정"(확정 시각이 지났는데 남은 경주) · null(확정) */
  provisional: string | null;
  /** 평문 한 줄 (aria·설명용 — ◎ 글리프 포함) */
  text: string;
};

/**
 * 경주 후 결산 한 줄 — "오늘 서울 12경주 — 주목마 9경주 중 1착 3/9 · 3착 이내 6/9 · 무효 0 /
 * ◎ 1착: 레이팅 3/12 · 최근 성적 2/11 · … (잠정 — 내일 오후 1시 확정)".
 * 분모는 정산됐고 무효가 아닌 표시 수. 정산된 경주가 없으면 null. 고정 순서, 강조 없음.
 */
export function settlementLine(args: {
  tally: EditionTally;
  raceDate: string;
  meet: string;
  raceCount: number;
  now: Instant;
}): SettlementLine | null {
  const { tally, raceDate, meet, raceCount } = args;
  if (tally.races_settled <= 0) return null;
  const today = kstDateOf(args.now);
  const head = `${today === raceDate ? "오늘" : dateKo(raceDate)} ${meet} ${raceCount}경주`;

  const cons = tally.rules.find((r) => r.rule_key === CONSENSUS_KEY);
  const consensus =
    cons && cons.picks > 0
      ? `주목마 ${cons.n}경주 중 1착 ${cons.wins}/${cons.n} · 3착 이내 ${cons.top3}/${cons.n} · 무효 ${cons.voids}`
      : "주목마 없음";

  const ruleParts = RULE_ORDER.map((k) => tally.rules.find((r) => r.rule_key === k))
    .filter((r): r is EditionTallyRule => !!r && r.picks > 0)
    .map((r) => `${recordKeyLabel(r.rule_key)} ${r.wins}/${r.n}`);
  const marks = ruleParts.length > 0 ? `1착: ${ruleParts.join(" · ")}` : null;

  let provisional: string | null = null;
  const allFinal = tally.races_final >= tally.races_settled && tally.races_settled >= raceCount;
  if (!allFinal) {
    const fin = finalizeAt(raceDate);
    if (before(args.now, fin)) {
      const finDate = kstDateOf(fin);
      const when =
        finDate === addDays(today, 1) ? "내일" : finDate === today ? "오늘" : dateKo(finDate);
      const c = kstClock(fin);
      provisional = `잠정 — ${when} ${clockKo(c.hour, c.minute)} 확정`;
    } else {
      provisional = "잠정";
    }
  }
  const text =
    `${head} — ${consensus}` +
    (marks ? ` / ${MARK_TEXT[1]} ${marks}` : "") +
    (provisional ? ` (${provisional})` : "");
  return { head, consensus, marks, provisional, text };
}

// ============================================================================
// 14. 금지어 · 기능 스위치 · 메타데이터
// ============================================================================

/**
 * 근거·소식 문장에 쓰지 않는 평가어·권유어 — crawler/src/racing_form/data/forbidden_words.json 과
 * 같아야 한다 (vitest 대조). 고지문("보장하지 않습니다" 등)에는 적용하지 않는다.
 */
export const FORBIDDEN_WORDS: readonly string[] = [
  "강추",
  "강력",
  "고배당",
  "구매",
  "노려",
  "대박",
  "마권",
  "무조건",
  "배팅",
  "베팅",
  "보장",
  "보증",
  "복병",
  "상승세",
  "수익",
  "유력",
  "축마",
  "추천",
  "컨디션",
  "필승",
  "하락세",
  "확실",
];

/** 근거·소식 문장에 쓰지 않는 기호 글리프 (▲▼ 는 증감 부호라 허용). */
export const FORBIDDEN_GLYPHS: readonly string[] = ["◎", "○", "△"];

/** 문장에 들어 있는 금지어·글리프 (없으면 []). */
export function findForbidden(text: string): string[] {
  return [...FORBIDDEN_WORDS, ...FORBIDDEN_GLYPHS].filter((w) => text.includes(w));
}

/** "출전표에서 빠짐" 표시 — stale ≠ 실제 취소라 감사(②) 통과 전에는 끈다. */
export const SHOW_SCRATCH_HINT: boolean = false;

/**
 * /form 색인 허용 — PR-3(메뉴·sitemap 연결) 전에는 false: 모든 /form 페이지 noindex,
 * getFormSitemapUrlsSafe 는 [].
 */
export const FORM_INDEXABLE: boolean = false;

const SITE_SUFFIX_RE = /\s*·\s*mal\.kr\s*$/;

/**
 * /form 페이지 메타데이터. canonical 을 늘 직접 지정한다 (레이아웃 기본 canonical 이 "/").
 * - title 에 "· mal.kr" 를 붙이지 않는다 (layout template 가 붙임) — 들어오면 떼어 낸다.
 * - index && FORM_INDEXABLE 일 때만 색인, 그 밖에는 robots noindex,follow.
 * - openGraph/twitter 는 layout 과 얕은 병합(통째 교체)이라 부모 이미지를 받아 이어 붙인다
 *   (`const { openGraph, twitter } = await parent` → ogImages·twitterImages).
 */
export function formMetadata(opts: {
  title: string;
  description: string;
  /** canonical 경로 ("/form/…", 쿼리 없이) */
  path: string;
  index?: boolean;
  ogImages?: NonNullable<Metadata["openGraph"]>["images"];
  twitterImages?: NonNullable<Metadata["twitter"]>["images"];
}): Metadata {
  const title = opts.title.replace(SITE_SUFFIX_RE, "");
  const { description, path } = opts;
  const indexable = opts.index === true && FORM_INDEXABLE;
  const ogImages = opts.ogImages;
  const twImages = opts.twitterImages ?? ogImages;
  const hasOg = Array.isArray(ogImages) ? ogImages.length > 0 : !!ogImages;
  const hasTw = Array.isArray(twImages) ? twImages.length > 0 : !!twImages;
  return {
    title,
    description,
    alternates: { canonical: path },
    ...(indexable ? {} : { robots: { index: false, follow: true } }),
    openGraph: {
      type: "website",
      locale: "ko_KR",
      siteName: "mal.kr",
      title,
      description,
      url: path,
      ...(hasOg ? { images: ogImages } : {}),
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      ...(hasTw ? { images: twImages } : {}),
    },
  };
}
