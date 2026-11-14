import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { beforeEach, describe, expect, it, vi } from "vitest";

// SQL 과 파라미터만 본다 — DB 는 mock (kst_year_callers.test.ts 패턴).
const queryMock = vi.fn<(sql: string, params?: unknown[]) => Promise<unknown[]>>(async () => []);
vi.mock("../db", () => ({
  query: (sql: string, params?: unknown[]) => queryMock(sql, params),
}));
// next/cache 는 Next 런타임 밖에서 incrementalCache 가 없어 던진다 → 감싸지 않고 그대로 실행.
vi.mock("next/cache", () => ({
  unstable_cache: <T>(fn: T) => fn,
}));

import * as rf from "../racing_form";
import { editionState, type PayloadV1 } from "../racing_form-shared";

const GOLDEN = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL("../../../../crawler/tests/fixtures/racing_form/payload_v1.golden.json", import.meta.url),
    ),
    "utf8",
  ),
) as PayloadV1;

// 모듈 export 는 함수·SQL 리터럴 타입이 섞인 유니온이라 unknown 으로 넓힌 뒤 거른다.
const SQL_CONSTANTS = Object.entries(rf as Record<string, unknown>).filter(
  (e): e is [string, string] => e[0].endsWith("_SQL") && typeof e[1] === "string",
);

const HANGUL = /[가-힣]/;
const DATE_LITERAL = /\d{4}-\d{2}-\d{2}/;

function lastCall(): { sql: string; params: unknown[] } {
  const c = queryMock.mock.calls.at(-1);
  if (!c) throw new Error("query 가 호출되지 않음");
  return { sql: c[0], params: c[1] ?? [] };
}

/** 사용자 입력·경마장 라벨이 SQL 문자열에 끼어들지 않았는지 + 상수 그대로인지. */
function expectParamOnly(sqlConst: string, params: unknown[]) {
  const { sql, params: got } = lastCall();
  expect(sql).toBe(sqlConst);
  expect(got).toEqual(params);
  for (const p of params.flat()) {
    if (typeof p === "string") expect(sql).not.toContain(p);
  }
}

beforeEach(() => {
  queryMock.mockReset();
  queryMock.mockImplementation(async () => []);
});

describe("SQL 상수 — e2e 가 글자 그대로 복사해 실행할 수 있는 형태", () => {
  it("상수 19개", () => {
    expect(SQL_CONSTANTS.map(([k]) => k).sort()).toEqual(
      [
        "CURRENT_JOCKEYS_SQL",
        "EDITION_FRONT_SQL",
        "EDITION_HEAD_SQL",
        "EDITION_INDEX_SQL",
        "EDITION_MEETS_SQL",
        "EDITION_TALLY_PICKS_SQL",
        "EDITION_TALLY_RACES_SQL",
        "FORM_CALENDAR_SQL",
        "FORM_SITEMAP_SQL",
        "LAUNCH_AT_SQL",
        "NOTICES_BETWEEN_SQL",
        "NOTICES_SQL",
        "OUTCOMES_SQL",
        "PUBLIC_BACKTEST_SQL",
        "RACE_SLICE_SQL",
        "RULE_RECORD_RULES_SQL",
        "RULE_RECORD_SQL",
        "RULE_RECORD_TOTALS_SQL",
        "RULE_SET_SQL",
      ].sort(),
    );
  });

  it.each(SQL_CONSTANTS)("%s — 한글·날짜 리터럴·백슬래시·쓰기 없음", (_name, sql) => {
    expect(sql).not.toMatch(HANGUL);
    expect(sql).not.toMatch(DATE_LITERAL);
    expect(sql).not.toContain("\\"); // 템플릿 문자열에서 \d 가 d 로 바뀌는 사고 방지
    expect(sql).not.toContain("${");
    expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER|CREATE)\b/i);
    expect(sql).not.toMatch(/\bNOW\(\)|CURRENT_DATE|CURRENT_TIMESTAMP/i); // 시각은 파라미터로만
    // KST 시각은 µs 까지 (.MS 는 µs 를 버려 '늦게 발행'·출시 경계가 크롤러와 어긋난다)
    expect(sql).not.toContain(".MS");
    for (const fmt of sql.match(/'YYYY-MM-DD"T"[^']*'/g) ?? []) {
      expect([`'YYYY-MM-DD"T"HH24:MI:SS.US"+09:00"'`, `'YYYY-MM-DD"T"HH24:MI:SS"Z"'`]).toContain(fmt);
    }
  });
});

describe("파라미터 — 한글 경마장·날짜는 $n 으로만", () => {
  it("getFormCalendar — 날짜 2개 + 경마장 라벨 배열(MEET_ORDER)", async () => {
    await rf.getFormCalendar("2026-11-13", "2026-11-15");
    expectParamOnly(rf.FORM_CALENDAR_SQL, ["2026-11-13", "2026-11-15", ["서울", "제주", "부경"]]);
    expect(rf.FORM_CALENDAR_SQL).toContain("= ANY($3::text[])");
  });

  it("getEditionIndex / getEditionHead", async () => {
    await rf.getEditionIndex("2026-11-01", "2026-11-30");
    expectParamOnly(rf.EDITION_INDEX_SQL, ["2026-11-01", "2026-11-30", ["서울", "제주", "부경"]]);
    await rf.getEditionHead("2026-11-15", "부경");
    expectParamOnly(rf.EDITION_HEAD_SQL, ["2026-11-15", "부경"]);
  });

  it("getCurrentJockeys / getNotices / getNoticesBetween", async () => {
    await rf.getCurrentJockeys("2026-11-15", "서울");
    expectParamOnly(rf.CURRENT_JOCKEYS_SQL, ["2026-11-15", "서울"]);
    await rf.getNotices("2026-11-15", "제주");
    expectParamOnly(rf.NOTICES_SQL, ["2026-11-15", "제주"]);
    await rf.getNoticesBetween("2026-11-09", "2026-11-15");
    expectParamOnly(rf.NOTICES_BETWEEN_SQL, ["2026-11-09", "2026-11-15"]);
  });

  it("edition id · 경주번호 · 버전", async () => {
    await rf.getEditionRaces(12);
    expectParamOnly(rf.EDITION_FRONT_SQL, [12]);
    await rf.getRaceSlice(12, 7);
    expectParamOnly(rf.RACE_SLICE_SQL, [12, 7]);
    await rf.getOutcomes(12);
    expectParamOnly(rf.OUTCOMES_SQL, [12]);
    await rf.getRuleSet("r1");
    expectParamOnly(rf.RULE_SET_SQL, ["r1"]);
    await rf.getPublicBacktest();
    expect(lastCall().sql).toBe(rf.PUBLIC_BACKTEST_SQL);
    await rf.getLaunchAt();
    expect(lastCall().sql).toBe(rf.LAUNCH_AT_SQL);
    await rf.getEditionMeetsSafe("2026-11-15");
    expectParamOnly(rf.EDITION_MEETS_SQL, ["2026-11-15"]);
  });

  it("getEditionTallies — 중복·잘못된 id 를 걸러 bigint 배열 하나로", async () => {
    await rf.getEditionTallies([3, 3, 0, -1, 4, 1.5]);
    const calls = queryMock.mock.calls.map(([sql, params]) => [sql, params]);
    expect(calls).toEqual([
      [rf.EDITION_TALLY_PICKS_SQL, [[3, 4]]],
      [rf.EDITION_TALLY_RACES_SQL, [[3, 4]]],
    ]);
    expect(rf.EDITION_TALLY_PICKS_SQL).toContain("= ANY($1::bigint[])");
  });

  it("getRuleRecord — 같은 파라미터로 3개 SQL, 모르는 경마장·이상한 날짜는 NULL", async () => {
    await rf.getRuleRecord({ meet: "서울", period: { from: "2026-11-01", to: "2026-11-30" }, version: "r1" });
    const calls = queryMock.mock.calls.map(([sql, params]) => [sql, params]);
    const p = ["서울", "2026-11-01", "2026-11-30", "r1"];
    expect(calls).toEqual([
      [rf.RULE_RECORD_SQL, p],
      [rf.RULE_RECORD_RULES_SQL, p],
      [rf.RULE_RECORD_TOTALS_SQL, p],
    ]);
    for (const [sql] of calls) for (const v of p) expect(sql).not.toContain(v);

    queryMock.mockClear();
    await rf.getRuleRecord({ meet: "seoul", period: { from: "2026-13-01" }, version: "r1; DROP" });
    expect(queryMock.mock.calls.map((c) => c[1])).toEqual([
      [null, null, null, null],
      [null, null, null, null],
      [null, null, null, null],
    ]);
  });
});

describe("입력 검증 — 이상한 값은 DB 에 보내지 않는다", () => {
  it("날짜·경마장·id·경주번호", async () => {
    expect(await rf.getFormCalendar("2026-02-30", "2026-03-01")).toEqual([]);
    expect(await rf.getEditionIndex("x", "2026-03-01")).toEqual([]);
    expect(await rf.getEditionHead("2026-11-15", "seoul")).toBeNull();
    expect(await rf.getEditionHead("2026-11-15'; --", "서울")).toBeNull();
    expect(await rf.getCurrentJockeys("2026-11-15", "영천")).toEqual([]);
    expect(await rf.getNotices("2026/11/15", "서울")).toEqual([]);
    expect(await rf.getNoticesBetween("2026-11-15", "nope")).toEqual([]);
    expect(await rf.getEditionRaces(0)).toBeNull();
    expect(await rf.getRaceSlice(1, 31)).toBeNull();
    expect(await rf.getRaceSlice(1, 0)).toBeNull();
    expect(await rf.getOutcomes(-5)).toEqual([]);
    expect(await rf.getRuleSet("r1' OR '1'='1")).toBeNull();
    expect(await rf.getEditionTallies([])).toEqual([]);
    expect(await rf.getEditionMeetsSafe("bad")).toEqual([]);
    expect(queryMock).not.toHaveBeenCalled();
  });
});

describe("결과 매핑", () => {
  it("getFormCalendar — 모르는 경마장 행은 버린다", async () => {
    queryMock.mockResolvedValueOnce([
      { race_date: "2026-11-15", meet: "서울", race_count: 11, first_post: "10:35" },
      { race_date: "2026-11-15", meet: "영천", race_count: 6, first_post: null },
    ]);
    expect(await rf.getFormCalendar("2026-11-15", "2026-11-15")).toEqual([
      { race_date: "2026-11-15", meet: "서울", race_count: 11, first_post: "10:35" },
    ]);
  });

  const headRow = (schema_version: number, summary: unknown) => ({
    id: 3,
    race_date: "2026-11-15",
    meet: "서울",
    issue_no: 2,
    rules_version: "r1",
    schema_version,
    history_before: "2026-11-14",
    results_through: "2026-11-09",
    entries_batch_at: "2026-11-14T15:00:00.000+09:00",
    freeze_at: "2026-11-14T18:00:00.000+09:00",
    deadline_at: "2026-11-15T08:00:00.000+09:00",
    published_at: "2026-11-14T18:00:03.120+09:00",
    race_count: 3,
    runner_count: 15,
    summary,
  });

  it("getEditionHead — summary 파싱, 모르는 schema 면 summary null", async () => {
    queryMock.mockResolvedValueOnce([headRow(1, GOLDEN.summary)]);
    const h = await rf.getEditionHead("2026-11-15", "서울");
    expect(h?.summary).toStrictEqual(GOLDEN.summary);
    expect(h?.issue_no).toBe(2);
    queryMock.mockResolvedValueOnce([headRow(2, { schema_version: 2 })]);
    expect((await rf.getEditionHead("2026-11-15", "서울"))?.summary).toBeNull();
    expect(await rf.getEditionHead("2026-11-16", "서울")).toBeNull();
  });

  it("getEditionHead µs 시각 → editionState 늦게 발행 판정이 크롤러와 같다 (19:00:00.000400)", async () => {
    const at = (published_at: string) => ({
      ...headRow(1, GOLDEN.summary),
      freeze_at: "2026-11-14T18:00:00.000000+09:00",
      deadline_at: "2026-11-15T08:00:00.000000+09:00",
      published_at,
    });
    const stateOf = async (published_at: string) => {
      queryMock.mockResolvedValueOnce([at(published_at)]);
      const head = await rf.getEditionHead("2026-11-15", "서울");
      return editionState({
        planned: null,
        edition: head,
        notices: [],
        now: "2026-11-15T09:00:00+09:00",
        launchAt: "2026-11-01T18:00:00.000400+09:00",
      });
    };
    expect(await stateOf("2026-11-14T19:00:00.000400+09:00")).toMatchObject({ state: "published", late: true });
    expect(await stateOf("2026-11-14T19:00:00.000000+09:00")).toMatchObject({ state: "published", late: false });
  });

  it("getEditionRaces / getRaceSlice — 모르는 schema 는 null", async () => {
    queryMock.mockResolvedValueOnce([{ schema_version: 2 }]);
    expect(await rf.getEditionRaces(3)).toBeNull();
    queryMock.mockResolvedValueOnce([
      {
        schema_version: 1,
        edition: GOLDEN.edition,
        rules: GOLDEN.rules,
        race: GOLDEN.races[2],
        race_nos: [1, 2, 3],
      },
    ]);
    const s = await rf.getRaceSlice(3, 3);
    expect(s?.race).toStrictEqual(GOLDEN.races[2]);
    queryMock.mockResolvedValueOnce([
      { schema_version: 1, edition: GOLDEN.edition, rules: GOLDEN.rules, race: null, race_nos: [1, 2, 3] },
    ]);
    expect(await rf.getRaceSlice(3, 9)).toBeNull();
  });

  it("getOutcomes — finish·pop_ranks 정리, 모르는 status 행 버림", async () => {
    queryMock.mockResolvedValueOnce([
      {
        race_no: 1,
        status: "official",
        starters: 2,
        finish: [{ horse_no: "A", chul_no: 1, rank: 1, time_tenths: 730 }, { bogus: true }],
        winners: ["A"],
        placed: ["A"],
        non_starters: [],
        extra_starters: [],
        favorites: ["A"],
        pop_ranks: { A: 1, B: "x" },
        is_final: true,
        first_settled_at: "2026-11-15T12:15:00.000+09:00",
        settled_at: "2026-11-15T12:15:00.000+09:00",
        finalized_at: "2026-11-16T13:15:00.000+09:00",
      },
      { race_no: 2, status: "pending", finish: [], winners: [], placed: [], non_starters: [] },
    ]);
    const o = await rf.getOutcomes(3);
    expect(o.length).toBe(1);
    expect(o[0].finish).toEqual([{ horse_no: "A", chul_no: 1, rank: 1, time_tenths: 730 }]);
    expect(o[0].pop_ranks).toEqual({ A: 1 });
  });

  it("getNotices — 공개 kind 만", async () => {
    queryMock.mockResolvedValueOnce([
      { id: 1, kind: "erratum", race_date: "2026-11-15", meet: "서울", edition_id: 3, public_text: "정정" },
      { id: 2, kind: "publish_failed", race_date: "2026-11-15", meet: "서울", edition_id: null, public_text: "x" },
    ]);
    expect((await rf.getNotices("2026-11-15", "서울")).map((n) => n.id)).toEqual([1]);
    expect(rf.NOTICES_SQL).not.toContain("publish_failed");
  });

  it("getEditionTallies — n = settled − voids, 정산 없는 호도 0 으로", async () => {
    queryMock
      .mockResolvedValueOnce([
        { edition_id: 3, rule_key: "rating", picks: 12, settled: 10, voids: 1, wins: 3, top3: 6 },
        { edition_id: 3, rule_key: "bogus", picks: 1, settled: 1, voids: 0, wins: 0, top3: 0 },
      ])
      .mockResolvedValueOnce([{ edition_id: 3, races_settled: 10, races_final: 0, races_void: 1 }]);
    expect(await rf.getEditionTallies([3, 4])).toEqual([
      {
        edition_id: 3,
        races_settled: 10,
        races_final: 0,
        races_void: 1,
        rules: [{ rule_key: "rating", picks: 12, settled: 10, voids: 1, n: 9, wins: 3, top3: 6 }],
      },
      { edition_id: 4, races_settled: 0, races_final: 0, races_void: 0, rules: [] },
    ]);
  });
});

describe("실패 처리 — 캐시 바깥 try/catch · Safe 함수", () => {
  it("getRuleRecord — DB 실패면 null, 다음 호출은 다시 조회 (실패를 캐시하지 않음)", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    queryMock.mockRejectedValue(new Error("db down"));
    expect(await rf.getRuleRecord()).toBeNull();
    queryMock.mockReset();
    queryMock.mockImplementation(async (sql: string) => {
      if (sql === rf.RULE_RECORD_TOTALS_SQL) {
        return [{ races: 4, races_void: 0, editions: 1, first_date: "2026-11-15", last_date: "2026-11-15" }];
      }
      if (sql === rf.RULE_RECORD_SQL) {
        return [
          {
            rule_key: "rating", mark: 1, n: 4, wins: 1, top3: 4, voids: 0, random_win: 4 / 3, random_top3: 3,
            fav_races: 4, fav_win: 2, fav_top3: 4, pop_n: 4, avg_pop_rank: 1.5,
          },
          { rule_key: "bogus", mark: 1, n: 1, wins: 0, top3: 0, voids: 0, random_win: 0, random_top3: 0, fav_races: 0, fav_win: 0, fav_top3: 0, pop_n: 0, avg_pop_rank: null },
        ];
      }
      return [{ rule_key: "rating", races_picked: 4, races_n: 4, races_any_win: 4 }];
    });
    const rec = await rf.getRuleRecord();
    expect(rec?.races).toBe(4);
    expect(rec?.cells.map((c) => [c.rule_key, c.mark, c.wins])).toEqual([["rating", 1, 1]]);
    expect(rec?.rules).toEqual([{ rule_key: "rating", races_picked: 4, races_n: 4, races_any_win: 4 }]);
    err.mockRestore();
  });

  it("getEditionMeetsSafe — 실패면 [], MEET_ORDER 정렬·모르는 경마장 제외", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    queryMock.mockRejectedValueOnce(new Error('relation "racing_form_editions" does not exist'));
    expect(await rf.getEditionMeetsSafe("2026-11-15")).toEqual([]);
    queryMock.mockResolvedValueOnce([{ meet: "부경" }, { meet: "영천" }, { meet: "서울" }]);
    expect(await rf.getEditionMeetsSafe("2026-11-15")).toEqual(["서울", "부경"]);
    err.mockRestore();
  });

  it("getFormSitemapUrlsSafe — FORM_INDEXABLE=false(PR-3 전)면 조회도 하지 않고 []", async () => {
    expect(await rf.getFormSitemapUrlsSafe()).toEqual([]);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("formSitemapUrls — 1면 URL·UTC lastmod, 모르는 경마장 제외", () => {
    expect(
      rf.formSitemapUrls([
        { race_date: "2026-11-15", meet: "부경", lastmod: "2026-11-16T04:20:00Z" },
        { race_date: "2026-11-15", meet: "영천", lastmod: "2026-11-16T04:20:00Z" },
        { race_date: "2026-11-14", meet: "제주", lastmod: null },
      ]),
    ).toEqual([
      { loc: "https://mal.kr/form/2026-11-15/busan", lastmod: "2026-11-16T04:20:00Z", changefreq: "weekly", priority: 0.6 },
      { loc: "https://mal.kr/form/2026-11-14/jeju", changefreq: "weekly", priority: 0.6 },
    ]);
    expect(rf.FORM_SITEMAP_SQL).toContain(`AT TIME ZONE 'UTC'`);
    expect(rf.FORM_SITEMAP_SQL).toContain(`'YYYY-MM-DD"T"HH24:MI:SS"Z"'`);
    expect(rf.FORM_SITEMAP_SQL).toContain("GROUP BY e.id");
  });
});
