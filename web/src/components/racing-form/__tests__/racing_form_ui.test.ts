import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type {
  EditionHead,
  FormNotice,
  SummaryRaceV1,
  FrontRaceV1,
  FrontRunnerV1,
  HeadlineV1,
  OutcomeRow,
  PublicBacktest,
} from "@/lib/racing_form-shared";
import { recordRows } from "@/lib/racing_form-shared";

import {
  NOTICE_COMPACT_TEXT,
  NOTICE_FULL_ITEMS,
  ResponsibleGamblingNotice,
} from "../../responsible-gambling-notice";
import { parseBacktest } from "../backtest-section";
import { ChangesBox } from "../changes-box";
import { editionCardSub, SettlementText } from "../edition-card";
import { ErrataList } from "../edition-notices";
import { NumText } from "../num-text";
import { deltaText, kgText, racesDayPath, rankText, timeText } from "../format";
import { buildHeadlineItems } from "../headlines";
import { PickMark } from "../pick-mark";
import { buildHistory } from "../publication-history";
import { buildRaceRows } from "../race-list";

describe("format — payload 정수 → 표기 (계산 없음)", () => {
  it("부담 0.1kg · 기록 0.1초", () => {
    expect(kgText(525)).toBe("52.5kg");
    expect(kgText(540)).toBe("54.0kg");
    expect(kgText(null)).toBeNull();
    expect(timeText(735)).toBe("1:13.5");
    expect(timeText(598)).toBe("59.8");
    expect(timeText(600)).toBe("1:00.0");
    expect(timeText(1207)).toBe("2:00.7");
  });
  it("착순 · 증감 부호(▲▼ 는 색과 함께 쓰는 곳에서만)", () => {
    expect(rankText(3)).toBe("3착");
    expect(rankText(null)).toBe("순위 없음");
    expect(deltaText(4)).toEqual({ text: "▲4", sign: 1 });
    expect(deltaText(-2, "%p")).toEqual({ text: "▼2%p", sign: -1 });
    expect(deltaText(0)).toEqual({ text: "±0", sign: 0 });
  });
  it("경기 일람 경로 — 경마장은 URL 인코딩", () => {
    expect(racesDayPath("2026-11-14", "서울")).toBe(
      `/races?date=2026-11-14&venue=${encodeURIComponent("서울")}`,
    );
  });
});

describe("PickMark — 인라인 SVG (◎ 이중원 · ○ 원 · △ 빈 삼각형), 원형 칩 아님", () => {
  const html = (mark: 1 | 2 | 3, decorative = false) =>
    renderToStaticMarkup(createElement(PickMark, { mark, decorative }));

  it("기호 모양과 aria-label", () => {
    expect(html(1).match(/<circle/g)?.length).toBe(2);
    expect(html(2).match(/<circle/g)?.length).toBe(1);
    expect(html(3)).toContain("<path");
    expect(html(3)).not.toContain("<circle");
    expect(html(1)).toContain('role="img"');
    expect(html(1)).toContain('aria-label="1순위"');
    expect(html(2)).toContain('aria-label="2순위"');
    expect(html(3)).toContain('aria-label="3순위"');
  });
  it("ink 단색·채움 없음·1.125em — 글리프·배경 칩을 쓰지 않는다", () => {
    for (const m of [1, 2, 3] as const) {
      const h = html(m);
      expect(h).toContain('fill="none"');
      expect(h).toContain('stroke="currentColor"');
      expect(h).toContain("h-[1.125em]");
      expect(h).not.toMatch(/[◎○△▲]/);
      expect(h).not.toContain("rounded-full");
      expect(h).not.toContain("bg-");
    }
  });
  it("옆에 같은 뜻의 글자가 있으면 decorative — 스크린리더 중복 없음", () => {
    const h = html(1, true);
    expect(h).toContain('aria-hidden="true"');
    expect(h).not.toContain("aria-label");
  });
});

describe("책임 고지 — 계획 §8.3 문구", () => {
  it("compact 한 줄 + ☎1336 tel 링크", () => {
    expect(NOTICE_COMPACT_TEXT).toBe(
      "참고용 데이터 정리입니다 · 적중을 보장하지 않고 마권 구매를 권하지 않습니다 · 청소년은 마권을 살 수 없습니다 · 도박 문제 상담",
    );
    const h = renderToStaticMarkup(createElement(ResponsibleGamblingNotice, { variant: "compact" }));
    expect(h).toContain('href="tel:1336"');
    expect(h).toContain("☎1336");
    expect(h).toContain("min-h-[max(44px,2.75rem)]");
  });
  it("full 6항목 — '공식' 은 부정문에서만, 기호 글리프·구매처 링크 없음", () => {
    expect(NOTICE_FULL_ITEMS).toHaveLength(6);
    for (const it of NOTICE_FULL_ITEMS) {
      if (it.text.includes("공식")) expect(it.text).toMatch(/공식 [^.]*아니며/);
      expect(it.text).not.toMatch(/[◎○△]/);
    }
    const h = renderToStaticMarkup(createElement(ResponsibleGamblingNotice, { variant: "full" }));
    expect(h).toContain("만 19세");
    expect(h).toContain("만 21세");
    expect(h).toContain("국번 없이 · 24시간 무료");
    // 링크는 tel:1336 하나뿐
    expect(h.match(/<a /g)?.length).toBe(1);
    expect(h).toContain('href="tel:1336"');
  });
});

const ofs = (t: string) => `2026-11-14T${t}.000000+09:00`;

function outcome(over: Partial<OutcomeRow>): OutcomeRow {
  return {
    race_no: 1,
    status: "official",
    starters: 10,
    finish: [],
    winners: [],
    placed: [],
    non_starters: [],
    extra_starters: [],
    favorites: [],
    pop_ranks: {},
    is_final: false,
    first_settled_at: ofs("17:45:00"),
    settled_at: ofs("17:45:00"),
    finalized_at: null,
    ...over,
  };
}

function race(no: number, over: Partial<FrontRaceV1> = {}): FrontRaceV1 {
  return {
    race_no: no,
    race_name: null,
    distance: 1200,
    grade: "국6",
    track_type: null,
    start_time: "11:00",
    field_size: 10,
    status: "ok",
    stakes: null,
    consensus: { status: "split", active_rules: 4, min_votes: 3, picks: [] },
    ...over,
  };
}

describe("buildRaceRows — 1면 경주 한 줄", () => {
  const runners: FrontRunnerV1[] = [
    { race_no: 1, horse_no: "H1", chul_no: 3, horse_name: "솔빛물결", jockey_name: "갑" },
    { race_no: 2, horse_no: "H2", chul_no: 5, horse_name: "새벽", jockey_name: "을" },
  ];
  const races = [
    race(1, {
      consensus: {
        status: "picked",
        active_rules: 4,
        min_votes: 3,
        picks: [
          { mark: 1, horse_no: "H1", chul_no: 3, votes: 3, marks: {}, reasons: [], reasons_more: 0 },
          { mark: 2, horse_no: "H9", chul_no: 9, votes: 3, marks: {}, reasons: [], reasons_more: 0 },
        ],
      },
    }),
    race(2, {
      start_time: null,
      consensus: {
        status: "picked",
        active_rules: 3,
        min_votes: 3,
        picks: [{ mark: 1, horse_no: "H2", chul_no: 5, votes: 3, marks: {}, reasons: [], reasons_more: 0 }],
      },
    }),
    race(3, { field_size: 4, status: "small_field", consensus: { status: "small_field", active_rules: 0, min_votes: 3, picks: [] } }),
    race(4, { stakes: { name: "가람컵", grade: "G3" } }),
  ];

  it("주목마 1순위 · 문구 분모 A · 2순위 수 · 대상경주 이름 · 발주 시각 덧씌움", () => {
    const rows = buildRaceRows({
      date: "2026-11-14",
      meet: "부경",
      races,
      runners,
      outcomes: [],
      startTimes: new Map([
        [1, "9:50"],
        [2, null],
      ]),
      hidePicks: false,
    });
    expect(rows.map((r) => r.href)).toEqual([
      "/form/2026-11-14/busan/1",
      "/form/2026-11-14/busan/2",
      "/form/2026-11-14/busan/3",
      "/form/2026-11-14/busan/4",
    ]);
    expect(rows[0]).toMatchObject({
      time: "09:50", // 지금 races.start_time 이 발행 시점 값보다 우선
      pick: { chulNo: 3, horseName: "솔빛물결" },
      morePicks: 1,
      line: "예상을 낸 기준 4개 중 3개가 고름",
      result: null,
    });
    expect(rows[1]).toMatchObject({ time: null, line: "예상을 낸 기준 3개가 모두 고름" });
    expect(rows[2]).toMatchObject({ pick: null, line: "예상 안 함 — 출전 4두" });
    expect(rows[3]).toMatchObject({ stakes: "가람컵 (G3)", line: "혼전 — 기준마다 고른 말이 다릅니다" });
  });

  it("결과: 착순 · 무효(결과 행 없음) · 경주 무효 · 행 없으면 표시 안 함", () => {
    const base = { date: "2026-11-08", meet: "서울", races: races.slice(0, 2), runners, startTimes: new Map() };
    const rows = buildRaceRows({
      ...base,
      hidePicks: false,
      outcomes: [
        outcome({
          race_no: 1,
          finish: [{ horse_no: "H1", chul_no: 3, rank: 2, time_tenths: 730 }],
          winners: ["HX"],
          placed: ["HX", "H1"],
        }),
        outcome({ race_no: 2, non_starters: ["H2"] }),
      ],
    });
    expect(rows[0].result).toEqual({ kind: "rank", rank: 2 });
    expect(rows[1].result).toEqual({ kind: "void" });
    const voidRace = buildRaceRows({
      ...base,
      hidePicks: false,
      outcomes: [outcome({ race_no: 1, status: "race_void" })],
    });
    expect(voidRace[0].result).toEqual({ kind: "void" });
  });

  it("철회(법적 사유) — 예상을 숨긴다", () => {
    const rows = buildRaceRows({
      date: "2026-11-14",
      meet: "서울",
      races: races.slice(0, 1),
      runners,
      outcomes: [outcome({ race_no: 1, winners: ["H1"], placed: ["H1"] })],
      startTimes: new Map(),
      hidePicks: true,
    });
    expect(rows[0]).toMatchObject({ pick: null, morePicks: 0, result: null });
    expect(rows[0].line).toContain("숨긴");
  });
});

describe("buildHeadlineItems — 경주·출전번호·마명은 웹이 붙인다", () => {
  const headlines: HeadlineV1[] = [
    { kind: "stakes", race_no: 9, chul_no: null, horse_no: null, text: "9R 가람컵 (G3, 1600m)" },
    { kind: "jockey_change", race_no: 2, chul_no: 1, horse_no: "H1", text: "기수 교체 갑→을" },
    { kind: "summary_debut", race_no: null, chul_no: null, horse_no: null, text: "데뷔 2두" },
  ];
  it("말 소식은 경주면 출전마 카드 앵커, 요약은 링크 없음", () => {
    const items = buildHeadlineItems({
      date: "2026-11-14",
      meet: "서울",
      headlines,
      runners: [{ race_no: 2, horse_no: "H1", chul_no: 1, horse_name: "별빛방패", jockey_name: "을" }],
    });
    expect(items[0]).toMatchObject({ href: "/form/2026-11-14/seoul/9", kind: "stakes" });
    expect(items[1]).toMatchObject({ href: "/form/2026-11-14/seoul/2#chul-1", horseName: "별빛방패" });
    expect(items[2].href).toBeNull();
    expect(new Set(items.map((i) => i.key)).size).toBe(3);
  });
});

function head(over: Partial<EditionHead>): EditionHead {
  return {
    id: 1,
    race_date: "2026-11-08",
    meet: "서울",
    issue_no: 1,
    rules_version: "r1",
    schema_version: 1,
    history_before: "2026-11-07",
    results_through: "2026-11-02",
    entries_batch_at: "2026-11-07T15:00:00.000000+09:00",
    freeze_at: "2026-11-07T18:00:00.000000+09:00",
    deadline_at: "2026-11-08T08:00:00.000000+09:00",
    published_at: "2026-11-07T18:05:00.000000+09:00",
    race_count: 12,
    runner_count: 100,
    summary: null,
    ...over,
  };
}

function notice(over: Partial<FormNotice>): FormNotice {
  return {
    id: 1,
    race_date: "2026-11-08",
    meet: "서울",
    edition_id: null,
    kind: "missed",
    public_text: "",
    until: null,
    hide_picks: false,
    race_no: null,
    noticed_at: "2026-11-08T08:00:00.000000+09:00",
    ...over,
  };
}

describe("buildHistory — 발행 이력은 빠진 호도 숨기지 않는다", () => {
  it("늦게 발행·철회·정정·결과 변경·미발행·쉼을 세고 최근 경주일 먼저", () => {
    const { items, counts } = buildHistory(
      [
        head({ id: 1 }),
        // 19:00:00.000400 — µs 경계에서 늦게 발행
        head({
          id: 2,
          race_date: "2026-11-14",
          meet: "제주",
          freeze_at: "2026-11-13T18:00:00.000000+09:00",
          published_at: "2026-11-13T19:00:00.000400+09:00",
        }),
      ],
      [
        notice({ id: 10, kind: "erratum", edition_id: 1, public_text: "정정 문구" }),
        notice({ id: 11, kind: "withdrawn", edition_id: 2, race_date: "2026-11-14", meet: "제주", public_text: "철회 사유" }),
        notice({ id: 12, kind: "result_changed", edition_id: 1, race_no: 3, public_text: "3R 결과가 바뀜" }),
        notice({ id: 13, kind: "missed", race_date: "2026-11-14", meet: "부경", public_text: "이번 호는 발행하지 않았습니다 — 출전표 자료를 확인하지 못했습니다" }),
        notice({ id: 14, kind: "paused", race_date: "2026-11-15", meet: null, until: "2026-11-16", public_text: "시설 점검" }),
      ],
    );
    expect(counts).toEqual({
      editions: 2,
      late: 1,
      missed: 1,
      withdrawn: 1,
      errata: 1,
      resultChanged: 1,
      paused: 1,
    });
    expect(items.map((i) => `${i.kind}:${i.date}:${i.meet ?? "*"}`)).toEqual([
      "paused:2026-11-15:*",
      "edition:2026-11-14:제주",
      "missed:2026-11-14:부경",
      "edition:2026-11-08:서울",
    ]);
    const missed = items.find((i) => i.kind === "missed");
    expect(missed && missed.kind === "missed" ? missed.reason : null).toBe("출전표 자료를 확인하지 못했습니다");
  });
});

describe("parseBacktest — 과거 시험 보고서 v1 (계약 §10) → 기록 표 재료", () => {
  const report = {
    report_version: 1,
    label: "holdout",
    period: { from: "2026-09-20", to: "2026-11-08" },
    meets: ["서울", "부경", "제주"],
    overall: {
      editions: 44,
      races: 434,
      races_void: 0,
      first_date: "2026-09-20",
      last_date: "2026-11-08",
      cells: [
        {
          rule_key: "rating",
          mark: 1,
          n: 430,
          wins: 53,
          top3: 161,
          voids: 0,
          random_win: [9937, 220],
          random_top3: [89213, 660],
          fav_races: 429,
          fav_win: [181, 2],
          fav_top3: [1307, 6],
          pop_n: 429,
          pop_sum: 1645,
        },
      ],
      rules: [{ rule_key: "rating", races_picked: 430, races_n: 430, races_any_win: 154, participation: [430, 434] }],
    },
  };
  const row = (r: unknown): PublicBacktest => ({
    id: 1,
    candidate_version: "r1",
    definition_sha256: "a".repeat(64),
    label: "holdout",
    period_from: "2026-09-20",
    period_to: "2026-11-08",
    meets: ["서울", "부경", "제주"],
    report: r,
    code_rev: null,
    computed_at: "2026-11-14T14:30:00.000000+09:00",
  });

  it("분수 쌍은 소수로, 평균 인기 = pop_sum / pop_n — 실전 기록과 같은 표로 그린다", () => {
    const v = parseBacktest(row(report));
    expect(v).not.toBeNull();
    const cell = v!.record.cells[0];
    expect(cell.random_win).toBeCloseTo(9937 / 220, 10);
    expect(cell.fav_win).toBe(90.5);
    expect(cell.avg_pop_rank).toBeCloseTo(1645 / 429, 10);
    expect(v!.record.races).toBe(434);
    const rating = recordRows(v!.record).find((r) => r.key === "rating")!;
    expect(rating.marks[0].win.text).toBe("53/430 (12%)");
    expect(rating.marks[0].randomWinPct).toBe(11);
    expect(rating.marks[0].winDelta).toBe(1);
    expect(rating.participation.text).toBe("430/434 (99%)");
  });

  it("모르는 형식·없음 → null (섹션은 '아직 공개하지 않았습니다')", () => {
    expect(parseBacktest(null)).toBeNull();
    expect(parseBacktest(row({ ...report, report_version: 2 }))).toBeNull();
    expect(parseBacktest(row({ ...report, overall: { ...report.overall, cells: [{ rule_key: "x" }] } }))).toBeNull();
    expect(parseBacktest(row("not an object"))).toBeNull();
  });
});

describe("경주면 변경 상자 · 호 정정 — 정정은 호 단위라 경주의 변경으로 세지 않는다", () => {
  const name = (h: string) => (h === "0041002" ? "녹색신호" : h);
  const erratum = notice({
    id: 21,
    kind: "erratum",
    edition_id: 1,
    public_text: "3R 출전마 카드의 거리 표기가 잘못되었습니다",
    noticed_at: "2026-11-08T09:10:00.000000+09:00",
  });

  it("ChangesBox 는 이 경주의 기수 변경만 — 없으면 '발행 후 바뀐 것 없음'", () => {
    const none = renderToStaticMarkup(createElement(ChangesBox, { diffs: [], horseName: name }));
    expect(none).toContain("이 경주의 발행 후 변경");
    expect(none).toContain("발행 후 바뀐 것 없음");
    expect(none).not.toContain("정정");
    const one = renderToStaticMarkup(
      createElement(ChangesBox, {
        diffs: [{ race_no: 1, horse_no: "0041002", chul_no: 2, before: "갑기수", after: "을기수", reason: "부상" }],
        horseName: name,
      }),
    );
    expect(one).toContain("발행 후 기수 변경");
    expect(one).toContain("녹색신호");
    expect(one).not.toContain("발행 후 바뀐 것 없음");
  });

  it("ErrataList — 경주면은 '이 호의 정정 n건', 1면은 '정정 n건', 없으면 그리지 않음", () => {
    const race = renderToStaticMarkup(
      createElement(ErrataList, { errata: [erratum], label: "이 호의 정정" }),
    );
    expect(race).toContain("이 호의 정정 <span");
    expect(race.replace(/<[^>]+>/g, "")).toContain("이 호의 정정 1건 — 발행본은 고치지 않고 공지로만 알립니다");
    expect(race).toContain("3R 출전마 카드의 거리 표기가 잘못되었습니다");
    const front = renderToStaticMarkup(createElement(ErrataList, { errata: [erratum] }));
    expect(front.replace(/<[^>]+>/g, "")).toContain("정정 1건 — 발행본은 고치지 않고 공지로만 알립니다");
    expect(renderToStaticMarkup(createElement(ErrataList, { errata: [] }))).toBe("");
  });
});

describe("숫자 글꼴 — 문장 안 숫자도 Geist Mono tabular-nums (DESIGN.md Data/Numbers)", () => {
  const mono = (html: string) =>
    [...html.matchAll(/<span class="font-mono tabular-nums">([^<]*)<\/span>/g)].map((m) => m[1]);

  it("NumText — 정수·분수·소수·시각·% 만 감싸고 글자는 그대로", () => {
    const html = renderToStaticMarkup(
      createElement(NumText, { text: "주목마 9경주 중 1착 3/9 · 3착 이내 6/9 · 무효 0 · 52.5kg 14:30 25%" }),
    );
    expect(mono(html)).toEqual(["9", "1", "3/9", "3", "6/9", "0", "52.5", "14:30", "25%"]);
    expect(html.replace(/<[^>]+>/g, "")).toBe(
      "주목마 9경주 중 1착 3/9 · 3착 이내 6/9 · 무효 0 · 52.5kg 14:30 25%",
    );
    expect(renderToStaticMarkup(createElement(NumText, { text: "주목마 없음" }))).toBe("주목마 없음");
  });

  it("결산 한 줄 — 분수가 mono, 문장은 그대로", () => {
    const html = renderToStaticMarkup(
      createElement(SettlementText, {
        line: {
          head: "오늘 서울 12경주",
          consensus: "주목마 6경주 중 1착 0/6 · 3착 이내 2/6 · 무효 0",
          marks: "1착: 레이팅 1/11 · 최근 성적 0/11",
          provisional: null,
          text: "",
        },
      }),
    );
    expect(mono(html)).toEqual(["6", "1", "0/6", "3", "2/6", "0", "1", "1/11", "0/11"]);
    expect(html.replace(/<[^>]+>/g, "")).toContain("주목마 6경주 중 1착 0/6 · 3착 이내 2/6 · 무효 0 / ");
  });
});

describe("editionCardSub — 허브 카드 보조 줄", () => {
  const race = (status: SummaryRaceV1["consensus"]["status"], no: number): SummaryRaceV1 => ({
    race_no: no,
    race_name: null,
    start_time: null,
    distance: null,
    field_size: 10,
    stakes: false,
    consensus: { status, active_rules: 4, pick: null },
  });
  const summary = (headlines: number) => ({
    schema_version: 1 as const,
    race_date: "2026-11-14",
    meet: "서울",
    rules_version: "r1",
    race_count: 3,
    runner_count: 30,
    races: [race("picked", 1), race("picked", 2), race("split", 3)],
    counts: { headlines, jockey_changes: 0, debuts: 0, class_changes: 0 },
  });

  it("counts.headlines 는 1면 머리기사 수('외 n건' 제외) — '주요 소식' 으로, 0 이면 뺀다", () => {
    expect(editionCardSub({ race_count: 3, summary: summary(6) })).toBe(
      "3경주 · 주목마 2경주 · 주요 소식 6건",
    );
    expect(editionCardSub({ race_count: 3, summary: summary(0) })).toBe("3경주 · 주목마 2경주");
    expect(editionCardSub({ race_count: 3, summary: null })).toBeNull();
  });
});
