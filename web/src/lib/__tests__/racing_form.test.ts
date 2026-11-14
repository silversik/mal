import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  FORBIDDEN_GLYPHS,
  FORBIDDEN_WORDS,
  FORM_INDEXABLE,
  FORM_MEETS,
  MARK_LABEL,
  MARK_TEXT,
  RULE_LABEL,
  RULE_ORDER,
  SHOW_SCRATCH_HINT,
  consensusLine,
  dateKo,
  dateTimeKo,
  deadlineAt,
  diffJockeys,
  editionState,
  editionTitleKo,
  finalizeAt,
  findForbidden,
  formDatePath,
  formEditionPath,
  formHubPath,
  formMetadata,
  formRacePath,
  formRecordPath,
  freezeAt,
  historyBefore,
  inWindow,
  isLate,
  isPastDeadline,
  isoKst,
  issueLabel,
  kstDateOf,
  lateLimitAt,
  mdKo,
  meetFromSlug,
  normalizeFormDate,
  normalizeFormRaceNo,
  parseEditionFront,
  parseEditionPayload,
  parseEditionSummary,
  parseHhmm,
  parseRaceSlice,
  parseRaceV1,
  pickOutcome,
  publishStampKo,
  publishedJockeys,
  raceResultState,
  raceVoidAllNullAfter,
  recordRows,
  runnerAnchorId,
  settlementLine,
  slugFromMeet,
  summaryConsensusLine,
  voidAfter,
  type CurrentJockeyRow,
  type EditionTally,
  type FormNotice,
  type PayloadV1,
  type RuleRecord,
  type RuleRecordCell,
} from "../racing_form-shared";

// 크롤러와 함께 쓰는 정본 파일 (web/src/lib/__tests__ → 저장소 루트)
const REPO = new URL("../../../../", import.meta.url);
const readText = (rel: string) => readFileSync(fileURLToPath(new URL(rel, REPO)), "utf8");
const readJson = <T = unknown>(rel: string): T => JSON.parse(readText(rel)) as T;

type Vectors = {
  dates: {
    race_date: string;
    history_before: string;
    freeze_at: string;
    finalize_at: string;
    race_void_all_null_after: string;
    void_after: string;
    late_limit: string;
  }[];
  deadlines: { race_date: string; first_post: string | null; deadline_at: string }[];
  windows: {
    race_date: string;
    first_post: string | null;
    now: string;
    in_window: boolean;
    past_deadline: boolean;
  }[];
  late: { race_date: string; published_at: string; late: boolean }[];
};

const VECTORS = readJson<Vectors>("crawler/tests/fixtures/racing_form/schedule_vectors.json");
const GOLDEN = readJson<PayloadV1>("crawler/tests/fixtures/racing_form/payload_v1.golden.json");
const FORBIDDEN = readJson<{ words: string[]; glyphs: string[] }>(
  "crawler/src/racing_form/data/forbidden_words.json",
);
const DEFINITIONS_PY = readText("crawler/src/racing_form/definitions.py");

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const ms = (iso: string) => Date.parse(iso);

const ORIGINAL_TZ = process.env.TZ;
function withTz(tz: string, fn: () => void) {
  process.env.TZ = tz;
  try {
    fn();
  } finally {
    if (ORIGINAL_TZ === undefined) delete process.env.TZ;
    else process.env.TZ = ORIGINAL_TZ;
  }
}
const TZS = ["UTC", "Asia/Seoul", "America/Los_Angeles"] as const;

// ---------------------------------------------------------------------------
// 일정 — crawler schedule.py 와 같은 벡터
// ---------------------------------------------------------------------------

describe("일정 — schedule_vectors.json (crawler schedule.py 와 같은 결과)", () => {
  it.each(TZS)("프로세스 TZ=%s 에서도 같다", (tz) => {
    withTz(tz, () => {
      // TZ 가 실제로 바뀌었는지 (바뀌지 않으면 이 테스트는 의미가 없다)
      const offset = new Date(2026, 0, 1).getTimezoneOffset();
      expect(offset).toBe({ UTC: 0, "Asia/Seoul": -540, "America/Los_Angeles": 480 }[tz]);

      for (const v of VECTORS.dates) {
        expect(historyBefore(v.race_date)).toBe(v.history_before);
        expect(freezeAt(v.race_date).getTime()).toBe(ms(v.freeze_at));
        expect(finalizeAt(v.race_date).getTime()).toBe(ms(v.finalize_at));
        expect(raceVoidAllNullAfter(v.race_date).getTime()).toBe(ms(v.race_void_all_null_after));
        expect(voidAfter(v.race_date)).toBe(v.void_after);
        expect(lateLimitAt(v.race_date).getTime()).toBe(ms(v.late_limit));
        expect(isoKst(freezeAt(v.race_date))).toBe(v.freeze_at.replace("+09:00", ".000+09:00"));
      }
      for (const v of VECTORS.deadlines) {
        expect(deadlineAt(v.race_date, v.first_post).getTime(), JSON.stringify(v)).toBe(
          ms(v.deadline_at),
        );
      }
      for (const v of VECTORS.windows) {
        expect(inWindow(v.now, v.race_date, v.first_post), JSON.stringify(v)).toBe(v.in_window);
        expect(isPastDeadline(v.now, v.race_date, v.first_post), JSON.stringify(v)).toBe(
          v.past_deadline,
        );
      }
      for (const v of VECTORS.late) {
        expect(isLate(v.published_at, v.race_date), JSON.stringify(v)).toBe(v.late);
      }
    });
  });

  it("벡터 밖 경계 — 일요일·첫 발주 자정 직후·오프셋 없는 시각 거부", () => {
    expect(historyBefore("2026-11-15")).toBe("2026-11-14");
    expect(isoKst(freezeAt("2026-11-15"))).toBe("2026-11-14T18:00:00.000+09:00");
    // 첫 발주 00:30 → 마감 = 전날 23:30 (Python: at_kst(d, fp) − 60분)
    expect(isoKst(deadlineAt("2026-11-14", "00:30"))).toBe("2026-11-13T23:30:00.000+09:00");
    expect(parseHhmm("1035")).toBe(635);
    expect(parseHhmm(" 9:30 ")).toBe(570);
    expect(parseHhmm("24:00")).toBeNull();
    expect(parseHhmm("10:60")).toBeNull();
    expect(parseHhmm(null)).toBeNull();
    expect(() => isLate("2026-11-13T19:00:00", "2026-11-14")).toThrow(RangeError);
    expect(() => freezeAt("2026-02-30")).toThrow(RangeError);
    expect(kstDateOf("2026-11-13T15:30:00Z")).toBe("2026-11-14");
    expect(kstDateOf("2026-11-13T14:59:59.999Z")).toBe("2026-11-13");
  });
});

// ---------------------------------------------------------------------------
// payload v1 — golden 파일 (Python 이 만들고 vitest 가 읽음)
// ---------------------------------------------------------------------------

describe("payload v1 파싱 — payload_v1.golden.json", () => {
  it("golden payload 를 그대로 읽는다 (아는 키 = v1 키 전부, 값 왕복)", () => {
    const p = parseEditionPayload(GOLDEN);
    expect(p).not.toBeNull();
    expect(p).toStrictEqual(GOLDEN);
  });

  it("핵심 필드", () => {
    const p = parseEditionPayload(GOLDEN)!;
    expect(p.edition).toMatchObject({
      race_date: "2026-11-15",
      meet: "서울",
      rules_version: "r1",
      history_before: "2026-11-14",
      freeze_at: "2026-11-14T18:00:00+09:00",
    });
    expect(p.races.map((r) => r.race_no)).toEqual([1, 2, 3]);
    expect(p.races.map((r) => r.consensus.status)).toEqual(["picked", "insufficient", "small_field"]);
    const r1 = p.races[0];
    expect(r1.runners.map((u) => u.chul_no)).toEqual([...r1.runners.map((u) => u.chul_no)].sort((a, b) => a - b));
    expect(r1.consensus.picks[0]).toMatchObject({ mark: 1, horse_no: "0041003", chul_no: 3, votes: 4 });
    const rating = r1.rules[0];
    expect(rating.status === "picked" && rating.picks.map((k) => k.mark)).toEqual([1, 2, 3]);
    const course2 = p.races[1].rules[2];
    expect(course2).toMatchObject({ key: "course", status: "no_pick", reason_code: "course_no_pick_eligible" });
    const u1 = r1.runners[0];
    expect(u1.badges.find((b) => b.kind === "rating_change")?.delta).toBe(10);
    expect("delta" in u1.badges[0]).toBe(false);
    expect(p.races[1].stakes).toEqual({ name: "서울마주협회장배", grade: "L" });
    expect(p.headlines.length).toBe(6);
    expect(p.headline_overflow).toBe(2);
    expect(p.summary).toStrictEqual(GOLDEN.summary);
  });

  it("summary · 경주 하나 · 1면/경주면 조각 파서", () => {
    expect(parseEditionSummary(GOLDEN.summary)).toStrictEqual(GOLDEN.summary);
    expect(parseRaceV1(GOLDEN.races[1])).toStrictEqual(GOLDEN.races[1]);

    // EDITION_FRONT_SQL 이 돌려주는 모양을 흉내 (runners·rules 를 뺀 경주 + 출전마 축약)
    const front = parseEditionFront({
      edition: GOLDEN.edition,
      rules: GOLDEN.rules,
      races: GOLDEN.races.map((r) => {
        const c: Record<string, unknown> = { ...r };
        delete c.runners;
        delete c.rules;
        return c;
      }),
      headlines: GOLDEN.headlines,
      headline_overflow: GOLDEN.headline_overflow,
      runners: GOLDEN.races.flatMap((r) =>
        r.runners.map((u) => ({
          race_no: r.race_no,
          horse_no: u.horse_no,
          chul_no: u.chul_no,
          horse_name: u.horse_name,
          jockey_name: u.jockey_name,
        })),
      ),
    });
    expect(front).not.toBeNull();
    expect(front!.races.map((r) => r.race_no)).toEqual([1, 2, 3]);
    expect(front!.runners.length).toBe(15);
    expect(front!.runners.find((u) => u.horse_no === "0042001")?.jockey_name).toBe("서다솜");

    const slice = parseRaceSlice({
      edition: GOLDEN.edition,
      rules: GOLDEN.rules,
      race: GOLDEN.races[0],
      race_nos: [1, 2, 3],
    });
    expect(slice?.race).toStrictEqual(GOLDEN.races[0]);
    expect(slice?.race_nos).toEqual([1, 2, 3]);
    expect(parseRaceSlice({ edition: GOLDEN.edition, rules: GOLDEN.rules, race: null, race_nos: [] })).toBeNull();
  });

  it("모르는 schema_version → null (화면은 '새 형식' 안내)", () => {
    expect(parseEditionPayload({ ...clone(GOLDEN), schema_version: 2 })).toBeNull();
    expect(parseEditionSummary({ ...clone(GOLDEN.summary), schema_version: 2 })).toBeNull();
    expect(parseEditionPayload(null)).toBeNull();
    expect(parseEditionPayload([])).toBeNull();
    expect(parseEditionPayload("x")).toBeNull();
  });

  it("형식 오류 → null + 경로 보고, v1 키 추가는 허용(무시)", () => {
    const broken = clone(GOLDEN) as unknown as { races: { runners: { chul_no: unknown }[] }[] };
    broken.races[0].runners[0].chul_no = "1";
    const errors: string[] = [];
    expect(parseEditionPayload(broken, (p) => errors.push(p))).toBeNull();
    expect(errors).toEqual(["$.races[0].runners[0].chul_no"]);

    const float = clone(GOLDEN) as unknown as { races: { runners: { budam_tenths: unknown }[] }[] };
    float.races[0].runners[0].budam_tenths = 54.5;
    expect(parseEditionPayload(float)).toBeNull();

    const added = clone(GOLDEN) as unknown as Record<string, unknown> & {
      races: Record<string, unknown>[];
    };
    added.future_key = { any: 1 };
    added.races[0].future_key = "x";
    const p = parseEditionPayload(added);
    expect(p).not.toBeNull();
    expect(p).toStrictEqual(GOLDEN);
  });
});

// ---------------------------------------------------------------------------
// 경마장 slug · 경로
// ---------------------------------------------------------------------------

describe("경마장 slug · 경로", () => {
  it("slug ↔ 한글 라벨 왕복 (MEET_ORDER 서울 → 제주 → 부경)", () => {
    expect(FORM_MEETS.map((m) => m.meet)).toEqual(["서울", "제주", "부경"]);
    expect(FORM_MEETS.map((m) => m.slug)).toEqual(["seoul", "jeju", "busan"]);
    for (const { meet, slug } of FORM_MEETS) {
      expect(slugFromMeet(meet)).toBe(slug);
      expect(meetFromSlug(slug)).toBe(meet);
      expect(meetFromSlug(slugFromMeet(meet))).toBe(meet);
    }
    expect(slugFromMeet("부산경남")).toBe("busan");
    expect(meetFromSlug("yeongcheon")).toBeNull();
    expect(meetFromSlug("Seoul")).toBeNull();
    expect(meetFromSlug("서울")).toBeNull();
    expect(slugFromMeet("영천")).toBeNull();
    expect(slugFromMeet(undefined)).toBeNull();
  });

  it("경로 함수", () => {
    expect(formHubPath()).toBe("/form");
    expect(formDatePath("2026-11-15")).toBe("/form/2026-11-15");
    expect(formEditionPath("2026-11-15", "서울")).toBe("/form/2026-11-15/seoul");
    expect(formEditionPath("2026-11-15", "busan")).toBe("/form/2026-11-15/busan");
    expect(formEditionPath("2026-11-15", "부산경남")).toBe("/form/2026-11-15/busan");
    expect(formEditionPath("2026-11-15", "영천")).toBe("/form/2026-11-15");
    expect(formRacePath("2026-11-15", "제주", 7)).toBe("/form/2026-11-15/jeju/7");
    expect(formRecordPath()).toBe("/form/record");
    expect(formRecordPath("부경")).toBe("/form/record?meet=busan");
    expect(runnerAnchorId(3)).toBe("chul-3");
  });

  it("날짜·경주번호 slug 검증", () => {
    expect(normalizeFormDate("2026-11-15")).toBe("2026-11-15");
    expect(normalizeFormDate("2026-02-30")).toBeNull();
    expect(normalizeFormDate("20261115")).toBeNull();
    expect(normalizeFormRaceNo("1")).toBe(1);
    expect(normalizeFormRaceNo("03")).toBe(3);
    expect(normalizeFormRaceNo("30")).toBe(30);
    expect(normalizeFormRaceNo("31")).toBeNull();
    expect(normalizeFormRaceNo("0")).toBeNull();
    expect(normalizeFormRaceNo("1e1")).toBeNull();
    expect(normalizeFormRaceNo(["5", "6"])).toBe(5);
    expect(normalizeFormRaceNo(undefined)).toBeNull();
    expect(normalizeFormRaceNo(5)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 날짜·시각 표기
// ---------------------------------------------------------------------------

describe("publishStampKo · 날짜 표기 — 가짜 타이머 · 프로세스 TZ 무관", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each(TZS)("TZ=%s", (tz) => {
    withTz(tz, () => {
      vi.useFakeTimers();
      // 현재 시각은 결과에 영향이 없어야 한다
      for (const sys of ["2026-11-13T09:00:00Z", "2030-06-30T23:59:59Z"]) {
        vi.setSystemTime(new Date(sys));
        expect(publishStampKo("2026-11-13T18:00:00.000+09:00")).toBe("11월 13일(금) 오후 6시");
        expect(publishStampKo("2026-11-13T09:05:42Z")).toBe("11월 13일(금) 오후 6시 5분");
        expect(publishStampKo("2026-11-14T07:59:00+09:00")).toBe("11월 14일(토) 오전 7시 59분");
        expect(publishStampKo("2026-11-14T12:00:59+09:00")).toBe("11월 14일(토) 오후 12시");
        expect(publishStampKo("2026-11-14T00:30:00+09:00")).toBe("11월 14일(토) 오전 12시 30분");
        // UTC 15:00 = KST 다음날 0시
        expect(publishStampKo("2026-11-13T15:00:00Z")).toBe("11월 14일(토) 오전 12시");
        expect(publishStampKo(new Date("2026-11-13T10:00:00Z"))).toBe("11월 13일(금) 오후 7시");
        expect(dateTimeKo("2026-11-13T06:00:00Z")).toBe("11월 13일(금) 15:00");
        expect(dateKo("2026-11-14")).toBe("11월 14일(토)");
        expect(dateKo("2026-11-08")).toBe("11월 8일(일)");
        expect(mdKo("2026-11-01")).toBe("11월 1일");
        expect(editionTitleKo("2026-11-14", "서울")).toBe("11월 14일(토) 서울 경마지");
      }
    });
  });

  it("호수 표기", () => {
    expect(issueLabel(3)).toBe("제3호");
  });
});

// ---------------------------------------------------------------------------
// editionState — 계약 §8 판정 순서
// ---------------------------------------------------------------------------

const D = "2026-11-14";
const PLANNED = { race_date: D, meet: "서울", first_post: "10:35" };
const LAUNCH = "2026-11-01T18:00:00.000+09:00";
const EDITION = {
  id: 7,
  race_date: D,
  meet: "서울",
  freeze_at: "2026-11-13T18:00:00.000+09:00",
  deadline_at: "2026-11-14T08:00:00.000+09:00",
  published_at: "2026-11-13T18:00:01.250+09:00",
};

let nextNoticeId = 1;
function notice(p: Partial<FormNotice> & Pick<FormNotice, "kind">): FormNotice {
  return {
    id: nextNoticeId++,
    race_date: D,
    meet: "서울",
    edition_id: null,
    public_text: "",
    until: null,
    hide_picks: false,
    race_no: null,
    noticed_at: "2026-11-13T20:00:00.000+09:00",
    ...p,
  };
}

describe("editionState — 8 상태", () => {
  const at = (iso: string) => ({ now: iso, launchAt: LAUNCH });

  it("published — 발행본 있음 (시각·계획과 무관), 늦게 발행 표시", () => {
    const s = editionState({ planned: PLANNED, edition: EDITION, notices: [], ...at("2026-11-20T00:00:00+09:00") });
    expect(s).toMatchObject({ state: "published", late: false, notFound: false, indexable: true });
    // 계획이 사라져도(출전표 삭제 등) 발행본이 있으면 발행됨
    const late = editionState({
      planned: null,
      edition: { ...EDITION, published_at: "2026-11-13T19:00:00.400+09:00" },
      notices: [],
      ...at("2026-11-13T19:30:00+09:00"),
    });
    expect(late).toMatchObject({ state: "published", late: true, publishedAt: "2026-11-13T19:00:00.400+09:00" });
    const onTime = editionState({
      planned: null,
      edition: { ...EDITION, published_at: "2026-11-13T19:00:00.000+09:00" },
      notices: [],
      ...at("2026-11-13T19:30:00+09:00"),
    });
    expect(onTime).toMatchObject({ state: "published", late: false });
  });

  it("withdrawn — 철회 공지(그 호), 법적 사유만 예상 숨김. 정정은 errata", () => {
    const errata = notice({ kind: "erratum", edition_id: 7, public_text: "정정", noticed_at: "2026-11-13T19:00:00.000+09:00" });
    const w1 = notice({ kind: "withdrawn", edition_id: 7, public_text: "명단 오류", noticed_at: "2026-11-13T21:00:00.000+09:00" });
    const w2 = notice({ kind: "withdrawn", edition_id: 7, public_text: "법적 사유", hide_picks: true, noticed_at: "2026-11-13T22:00:00.000+09:00" });
    const other = notice({ kind: "withdrawn", edition_id: 8 });
    const s = editionState({ planned: PLANNED, edition: EDITION, notices: [w2, other, errata, w1], ...at("2026-11-14T09:00:00+09:00") });
    expect(s.state).toBe("withdrawn");
    if (s.state !== "withdrawn") throw new Error("unreachable");
    expect(s.withdrawnNotice.public_text).toBe("명단 오류");
    expect(s.hidePicks).toBe(true);
    expect(s.indexable).toBe(false);
    expect(s.errata.map((n) => n.public_text)).toEqual(["정정"]);

    const onlyOther = editionState({ planned: PLANNED, edition: EDITION, notices: [other], ...at("2026-11-14T09:00:00+09:00") });
    expect(onlyOther.state).toBe("published");
    const soft = editionState({ planned: PLANNED, edition: EDITION, notices: [w1], ...at("2026-11-14T09:00:00+09:00") });
    expect(soft).toMatchObject({ state: "withdrawn", hidePicks: false });
  });

  it("none — 계획도 발행본도 없음 → 404", () => {
    expect(editionState({ planned: null, edition: null, notices: [], ...at("2026-11-13T18:00:00+09:00") })).toEqual({
      state: "none",
      notFound: true,
      indexable: false,
    });
  });

  it("prelaunch — launchAt 없음 또는 freeze_at < launchAt → 404", () => {
    const base = { planned: PLANNED, edition: null, notices: [], now: "2026-11-14T09:00:00+09:00" };
    expect(editionState({ ...base, launchAt: null })).toMatchObject({ state: "prelaunch", notFound: true });
    expect(editionState({ ...base, launchAt: "2026-11-13T18:00:00.001+09:00" }).state).toBe("prelaunch");
    // freeze_at == launchAt 는 출시 후
    expect(editionState({ ...base, launchAt: "2026-11-13T18:00:00.000+09:00" }).state).toBe("missed");
  });

  it("paused — 기간에 D 포함 (meet 일치 또는 전체), 시각보다 먼저", () => {
    const all = notice({ kind: "paused", race_date: "2026-11-10", meet: null, until: "2026-11-16", public_text: "시스템 점검" });
    const s = editionState({ planned: PLANNED, edition: null, notices: [all], ...at("2026-11-14T09:00:00+09:00") });
    expect(s).toMatchObject({ state: "paused", pausedReason: "시스템 점검", notFound: false, indexable: false });
    const busanOnly = notice({ kind: "paused", race_date: "2026-11-10", meet: "부경", until: "2026-11-16" });
    expect(editionState({ planned: PLANNED, edition: null, notices: [busanOnly], ...at("2026-11-14T09:00:00+09:00") }).state).toBe("missed");
    const ended = notice({ kind: "paused", race_date: "2026-11-01", meet: null, until: "2026-11-13" });
    expect(editionState({ planned: PLANNED, edition: null, notices: [ended], ...at("2026-11-12T09:00:00+09:00") }).state).toBe("planned");
    const lastDay = notice({ kind: "paused", race_date: "2026-11-14", meet: "서울", until: "2026-11-14", public_text: " " });
    expect(editionState({ planned: PLANNED, edition: null, notices: [lastDay], ...at("2026-11-12T09:00:00+09:00") })).toMatchObject({
      state: "paused",
      pausedReason: null,
    });
    // 발행본이 있으면 쉼 공지가 있어도 발행됨
    expect(editionState({ planned: PLANNED, edition: EDITION, notices: [all], ...at("2026-11-14T09:00:00+09:00") }).state).toBe("published");
  });

  it("planned → delayed → missed — 창 [freeze_at, deadline_at) (벡터와 같은 경계)", () => {
    const st = (now: string, planned = PLANNED, notices: FormNotice[] = []) =>
      editionState({ planned, edition: null, notices, now, launchAt: LAUNCH });
    const p = st("2026-11-13T17:59:59.999+09:00");
    expect(p).toMatchObject({
      state: "planned",
      freezeAt: "2026-11-13T18:00:00.000+09:00",
      deadlineAt: "2026-11-14T08:00:00.000+09:00",
    });
    expect(st("2026-11-13T18:00:00+09:00").state).toBe("delayed");
    expect(st("2026-11-14T07:59:59+09:00").state).toBe("delayed");
    const m = st("2026-11-14T08:00:00+09:00");
    expect(m).toMatchObject({ state: "missed", missedReason: null, missedNotice: null });
    // 첫 발주 08:30 → 마감 07:30
    expect(st("2026-11-14T07:30:00+09:00", { ...PLANNED, first_post: "08:30" }).state).toBe("missed");
    expect(st("2026-11-14T07:29:59+09:00", { ...PLANNED, first_post: "08:30" }).state).toBe("delayed");
    // missed 공지가 있으면 사유 (다른 경마장·날짜 공지는 무시)
    const reason = notice({ kind: "missed", public_text: "출전표 수집 지연" });
    const otherMeet = notice({ kind: "missed", meet: "제주", public_text: "x" });
    const otherDay = notice({ kind: "missed", race_date: "2026-11-15", public_text: "y" });
    expect(st("2026-11-14T09:00:00+09:00", PLANNED, [otherMeet, otherDay, reason])).toMatchObject({
      state: "missed",
      missedReason: "출전표 수집 지연",
    });
  });
});

// ---------------------------------------------------------------------------
// 결과 줄 · 표시 판정
// ---------------------------------------------------------------------------

describe("raceResultState — 발주 전 / 결과 정리 중 / 결과", () => {
  it("정산 행 → result, 없으면 발주 시각(모르면 D 10:00) 기준", () => {
    const base = { raceDate: "2026-11-15", startTime: "14:30" };
    expect(raceResultState({ ...base, outcome: { race_no: 3 }, now: "2026-11-15T09:00:00+09:00" })).toBe("result");
    expect(raceResultState({ ...base, outcome: null, now: "2026-11-15T14:29:59+09:00" })).toBe("before_post");
    expect(raceResultState({ ...base, outcome: null, now: "2026-11-15T14:30:00+09:00" })).toBe("settling");
    expect(raceResultState({ ...base, startTime: null, outcome: undefined, now: "2026-11-15T09:59:59+09:00" })).toBe("before_post");
    expect(raceResultState({ ...base, startTime: "", outcome: null, now: "2026-11-15T10:00:00+09:00" })).toBe("settling");
    expect(raceResultState({ ...base, startTime: "9:05", outcome: null, now: "2026-11-15T00:05:00Z" })).toBe("settling");
  });
});

describe("pickOutcome — 5 상태 (계약 §6.1)", () => {
  const o = { status: "official", winners: ["A"], placed: ["A", "B", "C"], non_starters: ["D"] };
  it("pending · void · win · top3 · miss", () => {
    expect(pickOutcome("A", null)).toBe("pending");
    expect(pickOutcome("A", undefined)).toBe("pending");
    expect(pickOutcome("A", { ...o, status: "pending" })).toBe("pending");
    expect(pickOutcome("D", o)).toBe("void");
    expect(pickOutcome("A", { ...o, status: "race_void" })).toBe("void");
    expect(pickOutcome("A", o)).toBe("win");
    expect(pickOutcome("B", o)).toBe("top3");
    expect(pickOutcome("C", o)).toBe("top3");
    expect(pickOutcome("E", o)).toBe("miss");
  });
  it("동착 — 하나만 맞혀도 적중", () => {
    const tie = { ...o, winners: ["A", "B"], placed: ["A", "B", "C"] };
    expect(pickOutcome("B", tie)).toBe("win");
  });
});

// ---------------------------------------------------------------------------
// 발행 후 기수 변경
// ---------------------------------------------------------------------------

describe("diffJockeys — 이름 내용 비교 (시각 아님)", () => {
  const cur = (race_no: number, horse_no: string, jockey_name: string | null, reason: string | null = null, chul_no = 1): CurrentJockeyRow => ({
    race_no,
    horse_no,
    chul_no,
    jockey_name,
    reason,
  });

  it("재변경 A→B→C 는 발행본 A → 지금 C 한 건, 되돌아온 A→B→A 는 없음", () => {
    const published = [
      { race_no: 2, horse_no: "H1", chul_no: 4, jockey_name: "가기수" },
      { race_no: 2, horse_no: "H2", chul_no: 5, jockey_name: "나기수" },
    ];
    const current = [cur(2, "H1", "다기수", "기수 부상", 4), cur(2, "H2", "나기수", "되돌림", 5)];
    expect(diffJockeys(published, current)).toEqual([
      { race_no: 2, horse_no: "H1", chul_no: 4, before: "가기수", after: "다기수", reason: "기수 부상" },
    ]);
  });

  it("공백 차이·빠진 말·지금 이름 없음은 변경 아님, 발행본 이름 없음 → before null", () => {
    const published = [
      { race_no: 1, horse_no: "H1", chul_no: 1, jockey_name: "김가람" },
      { race_no: 1, horse_no: "H2", chul_no: 2, jockey_name: "이나래" },
      { race_no: 1, horse_no: "H3", chul_no: 3, jockey_name: "박다온" },
      { race_no: 1, horse_no: "H4", chul_no: 4, jockey_name: null },
    ];
    const current = [cur(1, "H1", " 김가람 "), cur(1, "H3", null), cur(1, "H4", "정마루", " ")];
    expect(diffJockeys(published, current)).toEqual([
      { race_no: 1, horse_no: "H4", chul_no: 4, before: null, after: "정마루", reason: null },
    ]);
  });

  it("(race_no, horse_no) 로 맞춘다 — 다른 경주 행은 쓰지 않음. race_no 가 없으면 horse_no 로", () => {
    const published = [{ race_no: 3, horse_no: "H1", chul_no: 2, jockey_name: "A" }];
    expect(diffJockeys(published, [cur(5, "H1", "B")])).toEqual([]);
    const loose = [{ horse_no: "H1", chul_no: 2, jockey_name: "A" }];
    expect(diffJockeys(loose, [cur(5, "H1", "B")])).toEqual([
      { race_no: 5, horse_no: "H1", chul_no: 2, before: "A", after: "B", reason: null },
    ]);
  });

  it("publishedJockeys + 정렬 (경주 → 출전번호)", () => {
    const pubs = publishedJockeys(GOLDEN.races);
    expect(pubs.length).toBe(15);
    const changed = pubs.map((p) => cur(p.race_no, p.horse_no, `${p.jockey_name ?? "무명"}2`, null, p.chul_no));
    const d = diffJockeys(pubs, [...changed].reverse());
    expect(d.length).toBe(15);
    expect(d.map((x) => [x.race_no, x.chul_no])).toEqual(pubs.map((p) => [p.race_no, p.chul_no]));
  });
});

// ---------------------------------------------------------------------------
// 기록 표기
// ---------------------------------------------------------------------------

function cell(p: Partial<RuleRecordCell> & Pick<RuleRecordCell, "rule_key" | "mark">): RuleRecordCell {
  return {
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
    ...p,
  };
}

function record(cells: RuleRecordCell[], extra: Partial<RuleRecord> = {}): RuleRecord {
  return { races: 40, races_void: 0, editions: 4, first_date: null, last_date: null, cells, rules: [], ...extra };
}

describe("recordRows — 분수 상시, n<30 % 숨김, n<100 안내, 무작위 대비 ▲▼", () => {
  const ratingOf = (c: RuleRecordCell) => recordRows(record([c]))[0].marks[0];

  it("29 / 30 경계 — % 와 무작위 비교", () => {
    const r29 = ratingOf(cell({ rule_key: "rating", mark: 1, n: 29, wins: 7, top3: 15, random_win: 2.4 }));
    expect(r29.win).toMatchObject({ fraction: "7/29", pct: null, text: "7/29", ci: null });
    expect(r29.randomWinPct).toBeNull();
    expect(r29.winDelta).toBeNull();
    expect(r29.note).toEqual({ kind: "too_few", text: "경주 수가 30 미만이라 %는 아직 내지 않습니다 (29경주)" });

    const r30 = ratingOf(cell({ rule_key: "rating", mark: 1, n: 30, wins: 7, top3: 15, random_win: 2.5, random_top3: 7.5 }));
    expect(r30.win).toMatchObject({ fraction: "7/30", pct: 23, text: "7/30 (23%)" });
    expect(r30.top3.text).toBe("15/30 (50%)");
    expect(r30.randomWinPct).toBe(8);
    expect(r30.winDelta).toBe(15);
    expect(r30.top3Delta).toBe(25);
    expect(r30.win.ci).toEqual({ lo: 11, hi: 41 }); // 95% Wilson ≈ [0.118, 0.409]
    expect(r30.note?.kind).toBe("few");
  });

  it("99 / 100 경계 — 흔들림 안내", () => {
    const r99 = ratingOf(cell({ rule_key: "rating", mark: 1, n: 99, wins: 9 }));
    expect(r99.note).toEqual({ kind: "few", text: "경주 수가 적어 숫자가 크게 흔들립니다" });
    const r100 = ratingOf(cell({ rule_key: "rating", mark: 1, n: 100, wins: 9 }));
    expect(r100.note).toBeNull();
    expect(r100.win.text).toBe("9/100 (9%)");
  });

  it("무작위보다 낮으면 음수, 1번 인기 소수 분자, 평균 인기", () => {
    const r = ratingOf(
      cell({ rule_key: "rating", mark: 1, n: 30, wins: 1, random_win: 3, fav_races: 30, fav_win: 9.5, avg_pop_rank: 3.25, pop_n: 30 }),
    );
    expect(r.win.pct).toBe(3);
    expect(r.randomWinPct).toBe(10);
    expect(r.winDelta).toBe(-7);
    expect(r.favorite).toMatchObject({ fraction: "9.5/30", pct: 32, text: "9.5/30 (32%)" });
    expect(r.avgPopRank).toBe(3.3);
    expect(ratingOf(cell({ rule_key: "rating", mark: 1, n: 30 })).favorite).toBeNull();
  });

  it("고정 순서 · 0 채움 · 주목마는 1순위만 · 참여율·1착마 포함률", () => {
    const rows = recordRows(
      record([cell({ rule_key: "form", mark: 2, n: 3, wins: 1 }), cell({ rule_key: "consensus", mark: 1, n: 5, wins: 2 })], {
        rules: [
          { rule_key: "rating", races_picked: 35, races_n: 33, races_any_win: 12 },
          { rule_key: "consensus", races_picked: 6, races_n: 5, races_any_win: 2 },
        ],
      }),
    );
    expect(rows.map((r) => r.key)).toEqual(["rating", "form", "course", "jockey", "consensus"]);
    expect(rows.map((r) => r.label)).toEqual(["레이팅", "최근 성적", "거리 적성", "기수", "주목마"]);
    expect(rows[0].participation.text).toBe("35/40 (88%)");
    expect(rows[0].anyWin?.text).toBe("12/33 (36%)");
    expect(rows[0].marks.map((m) => m.mark)).toEqual([1, 2, 3]);
    expect(rows[0].marks[0].win.text).toBe("0/0");
    expect(rows[1].marks[1].win.text).toBe("1/3");
    expect(rows[4].marks.map((m) => m.mark)).toEqual([1]);
    expect(rows[4].anyWin).toBeNull();
    expect(rows[4].participation.text).toBe("6/40 (15%)");
    // 예비 trainer 는 데이터가 있을 때만
    const withTrainer = recordRows(record([cell({ rule_key: "trainer", mark: 1, n: 1 })]));
    expect(withTrainer.map((r) => r.key)).toEqual(["rating", "form", "course", "jockey", "trainer", "consensus"]);
  });
});

// ---------------------------------------------------------------------------
// 주목마 문구 · 결산 한 줄
// ---------------------------------------------------------------------------

describe("consensusLine — 분모는 항상 A", () => {
  it("상태별 문구", () => {
    expect(consensusLine({ status: "picked", active_rules: 4, votes: 3 })).toBe("예상을 낸 기준 4개 중 3개가 고름");
    expect(consensusLine({ status: "picked", active_rules: 4, votes: 4 })).toBe("예상을 낸 기준 4개가 모두 고름");
    expect(consensusLine({ status: "picked", active_rules: 3, votes: 3 })).toBe("예상을 낸 기준 3개가 모두 고름");
    expect(consensusLine({ status: "split", active_rules: 4 })).toBe("혼전 — 기준마다 고른 말이 다릅니다");
    expect(consensusLine({ status: "insufficient", active_rules: 2 })).toBe(
      "주목마 없음 — 기준 3개 이상이 예상해야 고릅니다 (이번엔 2개)",
    );
    expect(consensusLine({ status: "small_field", active_rules: 0, field_size: 4 })).toBe("예상 안 함 — 출전 4두");
  });
  it("golden summary 경주 한 줄", () => {
    expect(GOLDEN.summary.races.map(summaryConsensusLine)).toEqual([
      "예상을 낸 기준 4개가 모두 고름",
      "주목마 없음 — 기준 3개 이상이 예상해야 고릅니다 (이번엔 2개)",
      "예상 안 함 — 출전 4두",
    ]);
  });
});

describe("settlementLine — 결산 한 줄 (계획 4.8)", () => {
  const tally = (p: Partial<EditionTally> = {}): EditionTally => ({
    edition_id: 1,
    races_settled: 12,
    races_final: 0,
    races_void: 0,
    rules: [
      { rule_key: "rating", picks: 12, settled: 12, voids: 0, n: 12, wins: 3, top3: 6 },
      { rule_key: "form", picks: 11, settled: 11, voids: 0, n: 11, wins: 2, top3: 5 },
      { rule_key: "course", picks: 7, settled: 7, voids: 0, n: 7, wins: 1, top3: 3 },
      { rule_key: "jockey", picks: 12, settled: 12, voids: 0, n: 12, wins: 2, top3: 7 },
      { rule_key: "consensus", picks: 9, settled: 9, voids: 0, n: 9, wins: 3, top3: 6 },
    ],
    ...p,
  });
  const base = { raceDate: "2026-11-14", meet: "서울", raceCount: 12 };

  it("경주일 저녁 — 계획 예시 문장과 같다", () => {
    const line = settlementLine({ ...base, tally: tally(), now: "2026-11-14T18:00:00+09:00" });
    expect(line?.text).toBe(
      "오늘 서울 12경주 — 주목마 9경주 중 1착 3/9 · 3착 이내 6/9 · 무효 0 / ◎ 1착: 레이팅 3/12 · 최근 성적 2/11 · 거리 적성 1/7 · 기수 2/12 (잠정 — 내일 오후 1시 확정)",
    );
    expect(line?.marks).toBe("1착: 레이팅 3/12 · 최근 성적 2/11 · 거리 적성 1/7 · 기수 2/12");
    expect(findForbidden(line!.marks!)).toEqual([]);
  });

  it("다음 날 오전·확정 뒤·확정 시각이 지났는데 남은 경주·정산 전", () => {
    expect(settlementLine({ ...base, tally: tally(), now: "2026-11-15T09:00:00+09:00" })?.text).toMatch(
      /^11월 14일\(토\) 서울 12경주 — .* \(잠정 — 오늘 오후 1시 확정\)$/,
    );
    const fin = settlementLine({ ...base, tally: tally({ races_final: 12 }), now: "2026-11-15T13:10:00+09:00" });
    expect(fin?.provisional).toBeNull();
    expect(fin?.text.endsWith("기수 2/12")).toBe(true);
    const partial = settlementLine({ ...base, tally: tally({ races_settled: 11, races_final: 11 }), now: "2026-11-15T13:10:00+09:00" });
    expect(partial?.provisional).toBe("잠정");
    expect(settlementLine({ ...base, tally: tally({ races_settled: 0 }), now: "2026-11-14T12:00:00+09:00" })).toBeNull();
    const noCons = settlementLine({
      ...base,
      tally: tally({ rules: [{ rule_key: "rating", picks: 2, settled: 2, voids: 1, n: 1, wins: 1, top3: 1 }] }),
      now: "2026-11-14T18:00:00+09:00",
    });
    expect(noCons?.consensus).toBe("주목마 없음");
    expect(noCons?.marks).toBe("1착: 레이팅 1/1");
  });
});

// ---------------------------------------------------------------------------
// 크롤러 정본과 대조 — 금지어 · 기준 라벨 · 기호
// ---------------------------------------------------------------------------

describe("크롤러 정본과 같은 값", () => {
  it("FORBIDDEN_WORDS = forbidden_words.json", () => {
    expect([...FORBIDDEN_WORDS]).toEqual(FORBIDDEN.words);
    expect([...FORBIDDEN_GLYPHS]).toEqual(FORBIDDEN.glyphs);
    expect(findForbidden("레이팅 75 · 출전 6두 중 1위")).toEqual([]);
    expect(findForbidden("강력 추천 ◎")).toEqual(["강력", "추천", "◎"]);
  });

  it("golden payload 근거·소식 문장에 금지어·기호 글리프 없음 (▲▼ 는 허용)", () => {
    const texts = [
      ...GOLDEN.headlines.map((h) => h.text),
      ...GOLDEN.races.flatMap((r) => [
        ...r.rules.flatMap((k) => (k.status === "picked" ? k.picks.map((x) => x.reason) : [k.reason])),
        ...r.consensus.picks.flatMap((x) => x.reasons),
        ...r.runners.flatMap((u) => u.badges.map((b) => b.text)),
      ]),
    ];
    expect(texts.length).toBeGreaterThan(50);
    expect(texts.filter((t) => findForbidden(t).length > 0)).toEqual([]);
  });

  it("RULE_LABEL = payload.rules 라벨 = definitions.RULE_LABELS, 순서 = RULE_ORDER", () => {
    for (const r of GOLDEN.rules) expect(RULE_LABEL[r.key]).toBe(r.label);
    expect(GOLDEN.rules.map((r) => r.label)).toEqual(["레이팅", "최근 성적", "거리 적성", "기수"]);
    const keys = GOLDEN.rules.map((r) => r.key);
    expect(RULE_ORDER.filter((k) => keys.includes(k))).toEqual(keys);

    const block = /RULE_LABELS: dict\[str, str\] = \{([\s\S]*?)\n\}/.exec(DEFINITIONS_PY);
    expect(block).not.toBeNull();
    const py = Object.fromEntries([...block![1].matchAll(/"(\w+)": "([^"]+)"/g)].map((m) => [m[1], m[2]]));
    expect(py).toEqual({ ...RULE_LABEL });
    const keysBlock = /RULE_KEYS: tuple\[str, \.\.\.\] = \(([^)]*)\)/.exec(DEFINITIONS_PY);
    expect([...keysBlock![1].matchAll(/"(\w+)"/g)].map((m) => m[1])).toEqual([...RULE_ORDER]);
  });

  it("기호 slot 라벨 (화면 기호는 PickMark SVG — 글리프는 aria·평문 전용)", () => {
    expect(MARK_LABEL).toEqual({ 1: "1순위", 2: "2순위", 3: "3순위" });
    expect(MARK_TEXT).toEqual({ 1: "◎", 2: "○", 3: "△" });
  });
});

// ---------------------------------------------------------------------------
// 메타데이터 · 기능 스위치
// ---------------------------------------------------------------------------

describe("formMetadata — canonical 직접 지정, PR-3 전 noindex", () => {
  it("PR-1 스위치", () => {
    expect(FORM_INDEXABLE).toBe(false);
    expect(SHOW_SCRATCH_HINT).toBe(false);
  });

  it("canonical · robots noindex 기본 · title 에 mal.kr 없음", () => {
    const m = formMetadata({
      title: "11월 14일(토) 서울 경마지",
      description: "설명",
      path: "/form/2026-11-14/seoul",
    });
    expect(m.alternates?.canonical).toBe("/form/2026-11-14/seoul");
    expect(m.robots).toEqual({ index: false, follow: true });
    expect(m.title).toBe("11월 14일(토) 서울 경마지");
    expect(m.openGraph).toMatchObject({ url: "/form/2026-11-14/seoul", title: "11월 14일(토) 서울 경마지", locale: "ko_KR" });
    expect(m.openGraph && "images" in m.openGraph).toBe(false);
  });

  it("index:true 여도 FORM_INDEXABLE=false 면 noindex, '· mal.kr' 은 떼어 냄, 부모 OG 이미지 이어 붙임", () => {
    const m = formMetadata({
      title: "경마지 기록 · mal.kr",
      description: "d",
      path: "/form/record",
      index: true,
      ogImages: ["/opengraph-image"],
    });
    expect(m.robots).toEqual({ index: false, follow: true });
    expect(m.title).toBe("경마지 기록");
    expect(m.openGraph).toMatchObject({ images: ["/opengraph-image"] });
    expect(m.twitter).toMatchObject({ card: "summary_large_image", images: ["/opengraph-image"] });
  });
});
