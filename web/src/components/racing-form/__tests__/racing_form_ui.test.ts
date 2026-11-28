import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// EditionSwitcher 의 useRouter — 앱 라우터 밖(정적 렌더)에서는 던지므로 빈 라우터로 바꾼다.
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }) }));

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
import {
  editionPickerGroups,
  editionResult,
  editionResultLine,
  lastUpdatedAt,
  recordRows,
} from "@/lib/racing_form-shared";

import {
  NOTICE_COMPACT_TEXT,
  NOTICE_FULL_ITEMS,
  ResponsibleGamblingNotice,
} from "../../responsible-gambling-notice";
import { parseBacktest } from "../backtest-section";
import { ChangesBox } from "../changes-box";
import {
  EditionCardGroups,
  editionCardSub,
  SettlementText,
  type EditionCardData,
} from "../edition-card";
import { ErrataList } from "../edition-notices";
import { NumText } from "../num-text";
import { deltaText, kgText, racesDayPath, rankText, timeText } from "../format";
import { buildHeadlineItems } from "../headlines";
import { PickMark } from "../pick-mark";
import { buildHistory } from "../publication-history";
import { buildRaceRows, RaceList } from "../race-list";
import { FormNum } from "../form-num";
import { EditionPager } from "../edition-pager";
import { EditionPicker } from "../edition-picker";
import { editionBasisText, EditionStamp } from "../edition-stamp";
import { PaperMasthead, PaperSheet, paperTitleKo } from "../paper-sheet";
import { RaceFormPicks } from "../race-form-picks";
import { ChangeList, StatusBlock } from "../status-block";
import { UpdatesSection } from "../updates-section";
import { BetaBadge } from "../beta-notice";

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
  it("full 3줄 (2026-11-27) — 제목 없이 보장 없음 · 판매·권유·보상 없음 · 한국마사회 발표 우선", () => {
    expect(NOTICE_FULL_ITEMS.map((it) => it.text)).toEqual([
      "예상 기호는 과거 기록을 기계적으로 정리한 것이며, 적중이나 수익을 보장하지 않습니다.",
      "mal.kr 은 마권을 팔거나 대신 사 주지 않고, 마권 구매를 권하지 않으며, 적중에 대한 보상도 하지 않습니다.",
      "출전·기수 변경·경주 결과는 한국마사회 발표가 우선합니다.",
    ]);
    for (const it of NOTICE_FULL_ITEMS) {
      expect(it.text).not.toMatch(/[◎○△]/);
      expect(it.text).not.toContain("공식");
    }
    const h = renderToStaticMarkup(createElement(ResponsibleGamblingNotice, { variant: "full" }));
    expect(h).not.toContain("꼭 읽어 주세요");
    expect(h).not.toContain("<h2");
    expect(h.match(/<li/g)?.length).toBe(3);
    // 구매처·배당·영상 링크 없음 (상담 전화 줄은 뺐다 — 사이트 푸터와 경주면 compact 에 남는다)
    expect(h).not.toContain("<a ");
    expect(h).not.toContain("24시간");
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
    rules: [],
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
      rules: [
        {
          key: "trainer",
          status: "picked",
          picks: [
            { mark: 1, horse_no: "H9", chul_no: 9, reason: "조교사 최근 90일 40전 8승" },
            { mark: 2, horse_no: "H1", chul_no: 3, reason: "조교사 최근 90일 30전 5승" },
          ],
        },
        {
          key: "rating",
          status: "picked",
          picks: [{ mark: 1, horse_no: "H1", chul_no: 3, reason: "레이팅 62 (출전마 중 1위)" }],
        },
        { key: "form", status: "no_pick", reason_code: "few_starts", reason: "최근 성적 부족" },
        {
          key: "jockey",
          status: "picked",
          picks: [{ mark: 3, horse_no: "H1", chul_no: 3, reason: "기수 최근 90일 18전 4승" }],
        },
      ],
      consensus: {
        status: "picked",
        active_rules: 4,
        min_votes: 3,
        picks: [
          {
            mark: 1,
            horse_no: "H1",
            chul_no: 3,
            votes: 3,
            marks: { trainer: 2, rating: 1, jockey: 3 },
            reasons: ["레이팅 62 (출전마 중 1위)", "기수 최근 90일 18전 4승"],
            reasons_more: 1,
          },
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

  it("주목마 버튼 재료 — 모두 고른 말만 strong, 고른 기준은 글자로, 주목마 없으면 빈 행", () => {
    const rows = buildRaceRows({
      date: "2026-11-14",
      meet: "부경",
      races,
      runners,
      outcomes: [],
      hidePicks: false,
    });
    expect(rows.map((r) => r.href)).toEqual([
      "/form/2026-11-14/busan/1",
      "/form/2026-11-14/busan/2",
      "/form/2026-11-14/busan/3",
      "/form/2026-11-14/busan/4",
    ]);
    // 1R — 기준 4개 중 3개: 별 없음(strong=false). 고른 기준은 줄이지 않고 전부 —
    // 고정 순서(RULE_ORDER)·글자("1순위")·기준마다 근거 한 줄. 고르지 않은 기준(최근 성적)은 싣지 않는다
    expect(rows[0].picks).toHaveLength(2);
    expect(rows[0].picks[0]).toEqual({
      chulNo: 3,
      horseName: "솔빛물결",
      strong: false,
      criteria: [
        { rule: "레이팅", mark: "1순위", reason: "레이팅 62 (출전마 중 1위)" },
        { rule: "기수", mark: "3순위", reason: "기수 최근 90일 18전 4승" },
        { rule: "조교사", mark: "2순위", reason: "조교사 최근 90일 30전 5승" },
      ],
      result: null,
    });
    expect(rows[0].picks[1].criteria).toEqual([
      { rule: "조교사", mark: "1순위", reason: "조교사 최근 90일 40전 8승" },
    ]);
    expect(rows[0].picks[1]).toMatchObject({ chulNo: 9, horseName: "H9", strong: false });
    // 2R — 기준 3개가 모두 고름: "주목" 뱃지
    expect(rows[1].picks).toHaveLength(1);
    expect(rows[1].picks[0]).toMatchObject({ chulNo: 5, horseName: "새벽", strong: true });
    // 3R(소두수)·4R(혼전) — 설명 없이 비운다. 대상경주 이름은 남긴다
    expect(rows[2]).toMatchObject({ picks: [], stakes: null });
    expect(rows[3]).toMatchObject({ picks: [], stakes: "가람컵 (G3)" });
    // 발주 시각·"기준 n개 중 m개" 문구는 행에 싣지 않는다
    for (const r of rows) {
      expect(Object.keys(r).sort()).toEqual(["href", "picks", "raceNo", "stakes"]);
      expect(JSON.stringify(r)).not.toMatch(/[◎○△]|추천|강력/);
    }
  });

  it("결과: 착순 · 무효(결과 행 없음) · 경주 무효 · 행 없으면 표시 안 함", () => {
    const base = { date: "2026-11-08", meet: "서울", races: races.slice(0, 2), runners };
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
    expect(rows[0].picks[0].result).toEqual({ kind: "rank", rank: 2 });
    // 2순위 주목마(H9)는 결과 행이 없다 → 순위 없음
    expect(rows[0].picks[1].result).toEqual({ kind: "rank", rank: null });
    expect(rows[1].picks[0].result).toEqual({ kind: "void" });
    const voidRace = buildRaceRows({
      ...base,
      hidePicks: false,
      outcomes: [outcome({ race_no: 1, status: "race_void" })],
    });
    expect(voidRace[0].picks[0].result).toEqual({ kind: "void" });
  });

  it("철회(법적 사유) — 예상을 숨긴다", () => {
    const rows = buildRaceRows({
      date: "2026-11-14",
      meet: "서울",
      races: races.slice(0, 1),
      runners,
      outcomes: [outcome({ race_no: 1, winners: ["H1"], placed: ["H1"] })],
      hidePicks: true,
    });
    expect(rows[0].picks).toEqual([]);
  });
});

describe("1면 단순화 (2026-11-27) — 탭 · 색 없는 출전번호 · 주목마 버튼 · 빈 상태는 비운다", () => {
  const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);

  it("FormNum — 색 없는 중립 칩, 글씨는 하한 13px", () => {
    const h = html(createElement(FormNum, { n: 7 }));
    expect(h).toContain(">7<");
    expect(h).toContain("text-[0.8125rem]");
    expect(h).toContain("border-border");
    // 게이트 색(GateNum 의 inline style) 을 쓰지 않는다
    expect(h).not.toContain("style=");
  });

  it("StatusBlock 은 결산·다음 경주만 — 발행 후 기수 변경은 ChangeList('업데이트' 섹션)로", () => {
    expect(html(createElement(StatusBlock, { settlement: null, next: null }))).toBe("");
    expect(html(createElement(ChangeList, { changes: [] }))).toBe("");
    const one = html(
      createElement(ChangeList, {
        changes: [
          {
            key: "1-H1",
            href: "/form/2026-11-27/busan/1#chul-3",
            raceNo: 1,
            chulNo: 3,
            horseName: "솔빛물결",
            before: "갑",
            after: "을",
            reason: null,
          },
        ],
      }),
    );
    expect(one).toContain("발행 후 기수 변경");
    expect(one).toContain("솔빛물결");
    expect(one).toContain("갑→을");
  });

  it("RaceList — 라운드 + 주목마 버튼(전부), 별(주목)은 모두 고른 말만 버튼 안에, 없으면 빈 행", () => {
    const pick = (chulNo: number, horseName: string, strong: boolean) => ({
      chulNo,
      horseName,
      strong,
      criteria: [{ rule: "레이팅", mark: "1순위", reason: "레이팅 62" }],
      result: null,
    });
    const h = html(
      createElement(RaceList, {
        rows: [
          { raceNo: 1, href: "/form/2026-11-27/busan/1", stakes: null, picks: [] },
          { raceNo: 4, href: "/form/2026-11-27/busan/4", stakes: null, picks: [pick(3, "매직트리", true)] },
          {
            raceNo: 5,
            href: "/form/2026-11-27/busan/5",
            stakes: null,
            picks: [pick(1, "판타스틱밸류", false), pick(14, "라온포레스트", false)],
          },
        ],
      }),
    );
    const rows = h.split("<li").slice(1);
    expect(rows).toHaveLength(3);
    // 1R — 주목마 없음: 라운드(경주면 링크)만, 설명 문구 없음
    expect(rows[0]).toContain('href="/form/2026-11-27/busan/1"');
    expect(rows[0]).toContain("1R");
    expect(rows[0]).not.toContain("<button");
    expect(rows[0]).not.toMatch(/주목마 없음|혼전|예상 안 함/);
    // 4R — 버튼 하나, "주목" 은 별 아이콘으로 버튼 안에. 마번은 테두리 없이
    expect(rows[1].match(/<button/g)?.length).toBe(1);
    expect(rows[1]).toMatch(
      /<button[^>]*aria-haspopup="dialog"[^>]*>.*매직트리.*<svg role="img" aria-label="주목 — 고른 기준 1개"[^>]*><title>고른 기준 1개<\/title>.*<\/svg><\/button>/,
    );
    expect(rows[1]).not.toContain(">주목<"); // 글자 뱃지는 없다
    expect(rows[1]).toMatch(/<button[^>]*><span class="[^"]*font-mono[^"]*">3<\/span>/);
    expect(rows[1]).not.toMatch(/<button[^>]*><span class="[^"]*border-border/);
    // 5R — 주목마 2두 모두 버튼 (뱃지 없음), "외 n두" 로 줄이지 않는다
    expect(rows[2].match(/<button/g)?.length).toBe(2);
    expect(rows[2]).toContain("판타스틱밸류");
    expect(rows[2]).toContain("라온포레스트");
    expect(rows[2]).not.toContain('aria-label="주목');
    // "고른 기준 n개" 는 본문 글자가 아니라 별의 설명(title)으로만
    expect(h.replace(/<title>[^<]*<\/title>/g, "").replace(/aria-label="[^"]*"/g, "")).not.toContain("고른 기준");
    expect(rows[2]).not.toMatch(/외 \d+두/);
    // 버튼은 보이는 높이를 줄이되(36px) 누르는 영역은 ::before 로 넓힌다
    expect(rows[2]).toContain("min-h-9");
    expect(rows[2]).toContain("before:-inset-y-1");
    // 발주 시각·"기준 n개" 문구·게이트 색·팝업 본문(닫힌 상태)은 없다
    expect(h).not.toMatch(/\d{2}:\d{2}/);
    expect(h).not.toContain("예상을 낸 기준");
    expect(h).not.toContain("style=");
    expect(h).not.toContain("경주면 전체 보기");
  });
});

describe("지면 — 호 한 부를 종이 한 장에, 요약 → 라운드로 넘긴다 (2026-11-27)", () => {
  it("paperTitleKo — 경마장 · 날짜 · 호 · '경마지' (발행 전이면 호 없이)", () => {
    expect(paperTitleKo("2026-11-28", "서울", 1)).toBe("서울 11월 28일(토) 제1호 경마지");
    expect(paperTitleKo("2026-11-27", "부경", 12)).toBe("부경 11월 27일(금) 제12호 경마지");
    expect(paperTitleKo("2026-11-29", "서울", null)).toBe("서울 11월 29일(일) 경마지");
  });

  it("PaperSheet 는 틀만 — 제호는 PaperMasthead (1면 h1 · 경주면은 요약 장 링크)", () => {
    const sheet = renderToStaticMarkup(
      createElement(PaperSheet, {} as Parameters<typeof PaperSheet>[0], "본문"),
    );
    expect(sheet).toContain("본문");
    expect(sheet).toContain("relative"); // 바깥 드롭다운의 기준
    expect(sheet).not.toMatch(/<h1|mal\.kr|gradient|style=/);

    const title = "서울 11월 28일(토) 제1호 경마지";
    const front = renderToStaticMarkup(createElement(PaperMasthead, { title }));
    expect(front).toMatch(/<h1[^>]*>서울 11월 28일\(토\) 제1호 경마지<\/h1>/);
    expect(front).toContain("border-double");
    expect(front).not.toContain("<a ");
    const race = renderToStaticMarkup(
      createElement(PaperMasthead, { title, as: "p", href: "/form/2026-11-28/seoul" }),
    );
    expect(race).not.toContain("<h1");
    expect(race).toMatch(/<a[^>]*href="\/form\/2026-11-28\/seoul"[^>]*>서울 11월 28일\(토\) 제1호 경마지<\/a>/);
  });

  it("editionPickerGroups — 호 번호로 묶고(경마장 섞임) 그 안에서 날짜 → 경마장 순, 발행 전은 맨 뒤", () => {
    const groups = editionPickerGroups(
      [
        { race_date: "2026-11-28", meet: "제주", issue_no: 2 },
        { race_date: "2026-11-28", meet: "서울", issue_no: 1 },
        { race_date: "2026-11-27", meet: "부경", issue_no: 1 },
        { race_date: "2026-11-27", meet: "제주", issue_no: 1 },
        { race_date: "2026-11-22", meet: "영천", issue_no: 1 }, // 다루지 않는 경마장은 뺀다
      ],
      [
        { race_date: "2026-11-29", meet: "서울" },
        { race_date: "2026-11-28", meet: "서울" }, // 이미 발행됨 → 예정에서 뺀다
      ],
    );
    expect(groups.map((g) => [g.key, g.label])).toEqual([
      ["i1", "제1호"],
      ["i2", "제2호"],
      ["planned", "발행 예정"],
    ]);
    expect(groups[0].items).toEqual([
      { href: "/form/2026-11-27/jeju", date: "2026-11-27", label: "11월 27일(금) 제주" },
      { href: "/form/2026-11-27/busan", date: "2026-11-27", label: "11월 27일(금) 부경" },
      { href: "/form/2026-11-28/seoul", date: "2026-11-28", label: "11월 28일(토) 서울" },
    ]);
    expect(groups[1].items.map((x) => x.label)).toEqual(["11월 28일(토) 제주"]);
    expect(groups[2].items.map((x) => x.href)).toEqual(["/form/2026-11-29/seoul"]);
    expect(editionPickerGroups([], [])).toEqual([]);
  });

  it("EditionPicker — 닫힌 상태에는 '경마지 선택' 버튼만 (팝업 본문은 열 때 그린다)", () => {
    const h = renderToStaticMarkup(
      createElement(EditionPicker, {
        groups: editionPickerGroups([{ race_date: "2026-11-28", meet: "서울", issue_no: 1 }], []),
        currentHref: "/form/2026-11-28/seoul",
        hubHref: "/form",
      }),
    );
    expect(h).toMatch(/<button[^>]*aria-haspopup="dialog"[^>]*>경마지 선택<\/button>/);
    expect(h).toContain("min-h-[max(44px,2.75rem)]");
    expect(h).not.toContain("<select");
    expect(h).not.toContain("다른 경마지");
  });

  it("BetaBadge — 지면 위 줄에는 라벨만, 설명은 title·스크린리더로. 베타 기간이 아니면 없음", () => {
    const h = renderToStaticMarkup(createElement(BetaBadge, { date: "2026-11-28" }));
    expect(h).toContain("베타 테스트");
    expect(h).toContain('title="2026년은 베타 테스트 기간입니다.');
    expect(h).toContain("sr-only");
    expect(renderToStaticMarkup(createElement(BetaBadge, { date: "2027-01-02" }))).toBe("");
  });

  it("EditionStamp — 오른쪽 정렬, 발행 시각만. 수정이 있었으면 '최종 업데이트' 한 줄", () => {
    const head = {
      published_at: "2026-11-27T18:00:03.000000+09:00",
      freeze_at: "2026-11-27T18:00:00.000000+09:00",
    };
    const plain = renderToStaticMarkup(createElement(EditionStamp, { head, late: false }));
    expect(plain).toContain("text-right");
    expect(plain).toContain("11월 27일(금) 오후 6시 발행");
    expect(plain).not.toContain("고치지 않음");
    expect(plain).not.toContain("성적 반영");
    expect(plain).not.toContain("최종 업데이트");
    const upd = renderToStaticMarkup(
      createElement(EditionStamp, { head, late: false, updatedAt: "2026-11-28T09:40:12.000000+09:00" }),
    );
    expect(upd).toMatch(/<a href="#updates"[^>]*>최종 업데이트 11월 28일\(토\) 09:40<\/a>/);
    expect(
      editionBasisText({ results_through: "2026-11-22", entries_batch_at: "2026-11-27T17:25:00.000000+09:00" }),
    ).toBe("성적 반영 11월 22일(일) 경주까지 · 출전표 11월 27일(금) 17:25 갱신분");
  });

  it("lastUpdatedAt — 정정·철회·결과 변경 공지와 기수 변경 가운데 가장 늦은 시각, 없으면 null", () => {
    expect(lastUpdatedAt({ notices: [], jockeyDiffs: [] })).toBeNull();
    // 미발행·쉼 공지와 시각 모르는 기수 변경은 세지 않는다
    expect(
      lastUpdatedAt({
        notices: [{ kind: "missed", noticed_at: "2026-11-28T08:00:00.000000+09:00" }],
        jockeyDiffs: [{}],
      }),
    ).toBeNull();
    expect(
      lastUpdatedAt({
        notices: [
          { kind: "erratum", noticed_at: "2026-11-28T09:10:00.000000+09:00" },
          { kind: "result_changed", noticed_at: "2026-11-28T14:00:00.000000+09:00" },
        ],
        jockeyDiffs: [{ changed_at: "2026-11-28T09:40:00.000000+09:00" }],
      }),
    ).toBe("2026-11-28T14:00:00.000000+09:00");
    expect(
      lastUpdatedAt({ notices: [], jockeyDiffs: [{ changed_at: "2026-11-28T09:40:00.000000+09:00" }] }),
    ).toBe("2026-11-28T09:40:00.000000+09:00");
  });

  it("UpdatesSection — 수정된 것(있을 때만) · 예정 · 발행 기준", () => {
    const basis = "성적 반영 11월 22일(일) 경주까지 · 출전표 11월 27일(금) 17:25 갱신분";
    const quiet = renderToStaticMarkup(
      createElement(UpdatesSection, { errata: [], changes: [], scheduled: ["결과 확정 — 11월 29일(일) 13:00"], basis }),
    );
    expect(quiet).not.toContain("수정된 것");
    expect(quiet).toContain("예정");
    expect(quiet).toContain("결과 확정 — 11월 29일(일) 13:00");
    expect(quiet).toContain(`발행 기준 — ${basis}`);
    const changed = renderToStaticMarkup(
      createElement(UpdatesSection, {
        errata: [],
        changes: [
          {
            key: "2-H5",
            href: "/form/2026-11-28/seoul/2#chul-5",
            raceNo: 2,
            chulNo: 5,
            horseName: "새벽",
            before: "갑",
            after: "을",
            reason: "기수부상",
          },
        ],
        scheduled: [],
        basis,
      }),
    );
    expect(changed).toContain("수정된 것");
    expect(changed).toContain("발행 후 기수 변경");
    expect(changed).toContain("새벽");
    expect(changed).not.toContain(">예정<");
  });

  const rounds = [1, 2, 3].map((n) => ({ raceNo: n, href: `/form/2026-11-27/busan/${n}` }));
  const pager = (current: "summary" | number) =>
    renderToStaticMarkup(
      createElement(EditionPager, { summaryHref: "/form/2026-11-27/busan", rounds, current }),
    );

  it("EditionPager — 첫 장은 요약: 앞 장 없음, 다음 장은 1R", () => {
    const h = pager("summary");
    expect(h).toContain('aria-label="지면 넘기기"');
    // 경마장은 제호에 있다 — 막대에는 싣지 않는다
    expect(h).not.toContain("부경");
    // 첫 장은 글자 대신 집 아이콘 (이름은 aria-label)
    expect(h).toMatch(/<span aria-current="page" aria-label="요약 \(첫 장\)"[^>]*><svg/);
    expect(h).not.toContain(">요약<");
    expect(h).not.toContain('aria-label="앞 장');
    expect(h).toContain('aria-label="다음 장 — 1R" class=');
    expect(h).toMatch(/href="\/form\/2026-11-27\/busan\/1"[^>]*aria-label="다음 장 — 1R"|aria-label="다음 장 — 1R"[^>]*href="\/form\/2026-11-27\/busan\/1"/);
    // 전체 라운드가 한 줄에
    for (const n of [1, 2, 3]) expect(h).toContain(`>${n}R<`);
  });

  it("EditionPager — 라운드 장: 앞 장은 요약 또는 앞 라운드, 마지막 장은 다음 없음", () => {
    const first = pager(1);
    expect(first).toMatch(/<span aria-current="page"[^>]*>1R<\/span>/);
    expect(first).toContain('aria-label="앞 장 — 요약"');
    expect(first).toContain('aria-label="다음 장 — 2R"');
    // 요약 장으로 돌아가는 링크
    expect(first).toMatch(/<a[^>]*aria-label="요약 \(첫 장\)"[^>]*href="\/form\/2026-11-27\/busan"[^>]*><svg|<a[^>]*href="\/form\/2026-11-27\/busan"[^>]*aria-label="요약 \(첫 장\)"[^>]*><svg/);
    const last = pager(3);
    expect(last).toContain('aria-label="앞 장 — 2R"');
    expect(last).not.toContain('aria-label="다음 장');
  });
});

describe("호 카드 — 경주 전 / 결과 구분, 결과는 예상 ↔ 실제 (2026-11-27)", () => {
  const sRace = (
    no: number,
    pick: { chul_no: number; horse_no: string; horse_name: string } | null,
    status: SummaryRaceV1["consensus"]["status"] = pick ? "picked" : "split",
  ): SummaryRaceV1 => ({
    race_no: no,
    race_name: null,
    start_time: null,
    distance: 1200,
    field_size: 10,
    stakes: false,
    consensus: { status, active_rules: 4, pick: pick ? { ...pick, votes: 3 } : null },
  });
  const summary = {
    races: [
      sRace(1, null),
      sRace(4, { chul_no: 3, horse_no: "H3", horse_name: "매직트리" }),
      sRace(5, { chul_no: 1, horse_no: "H1", horse_name: "판타스틱밸류" }),
      sRace(7, { chul_no: 11, horse_no: "H11", horse_name: "미스터선샤인" }),
      sRace(9, { chul_no: 2, horse_no: "H2", horse_name: "늦은말" }),
      sRace(10, { chul_no: 5, horse_no: "H5", horse_name: "닥터에이트" }),
    ],
  };
  const fin = (rows: [string, number, number][]) =>
    rows.map(([horse_no, chul_no, rank]) => ({ horse_no, chul_no, rank, time_tenths: 700 + rank }));
  const outcomes = [
    outcome({ race_no: 1, finish: fin([["HX", 7, 1]]), winners: ["HX"], placed: ["HX"] }),
    // 4R — 주목마 4착, 1착은 8번
    outcome({
      race_no: 4,
      finish: fin([["H8", 8, 1], ["H4", 4, 2], ["H6", 6, 3], ["H3", 3, 4]]),
      winners: ["H8"],
      placed: ["H8", "H4", "H6"],
    }),
    // 5R — 주목마 3착, 1착은 14번
    outcome({
      race_no: 5,
      finish: fin([["H14", 14, 1], ["H12", 12, 2], ["H1", 1, 3]]),
      winners: ["H14"],
      placed: ["H14", "H12", "H1"],
    }),
    // 7R — 주목마 1착
    outcome({ race_no: 7, finish: fin([["H11", 11, 1]]), winners: ["H11"], placed: ["H11"] }),
    // 9R — 주목마 출전 제외(무효)
    outcome({ race_no: 9, finish: fin([["H9", 9, 1]]), winners: ["H9"], placed: ["H9"], non_starters: ["H2"] }),
    // 10R — 아직 정산 전 (행 없음)
  ];

  it("editionResult — 주목마가 실제로 몇 착 했는지, 빗나가면 실제 1착 번호", () => {
    expect(editionResult(summary, [])).toBeNull(); // 정산 전 = 아직 "경주 전"
    expect(editionResult(null, outcomes)).toBeNull();
    const res = editionResult(summary, outcomes)!;
    expect(res.rows.map((r) => [r.race_no, r.chul_no, r.outcome, r.rank, r.winner_chul_nos])).toEqual([
      [4, 3, "miss", 4, [8]],
      [5, 1, "top3", 3, [14]],
      [7, 11, "win", 1, []],
      [9, 2, "void", null, []],
      [10, 5, "pending", null, []],
    ]);
    expect(res).toMatchObject({ races_settled: 5, wins: 1, placed: 1, misses: 1, voids: 1, pending: 1 });
    expect(editionResultLine(res)).toBe("주목마 5경주 — 1착 1 · 2~3착 1 · 빗나감 1 · 무효 1 · 결과 전 1");
    // 주목마가 하나도 없던 호
    const none = editionResult({ races: [sRace(1, null)] }, outcomes)!;
    expect(none.rows).toEqual([]);
    expect(editionResultLine(none)).toBe("주목마 없음");
  });

  it("EditionCardGroups — '경주 전' 먼저, '경주 결과' 는 예상 ↔ 실제 줄. 빈 묶음은 그리지 않는다", () => {
    const base = { issue: "제1호", sub: "10경주 · 주목마 5경주", provisional: null, disabled: false };
    const cards: EditionCardData[] = [
      {
        ...base,
        key: "a",
        href: "/form/2026-11-27/busan",
        date: "2026-11-27",
        title: "부경 11월 27일(금)",
        status: "11월 26일(목) 오후 6시 발행",
        result: editionResult(summary, outcomes),
        provisional: "잠정 — 내일 오후 1시 확정",
        picks: [],
      },
      {
        ...base,
        key: "b",
        href: "/form/2026-11-28/seoul",
        date: "2026-11-28",
        title: "서울 11월 28일(토)",
        status: "11월 27일(금) 오후 6시 발행",
        result: null,
        picks: [
          { race_no: 3, chul_no: 8, horse_name: "선라이즈킹", strong: true },
          { race_no: 5, chul_no: 11, horse_name: "영광의스카이", strong: false },
        ],
      },
      // 발행 예정 — 누를 수 없는 흐린 카드
      {
        key: "d",
        href: "/form/2026-11-29/seoul",
        date: "2026-11-29",
        title: "서울 11월 29일(일)",
        issue: null,
        status: "11월 28일(토) 오후 6시 발행 예정",
        sub: null,
        result: null,
        provisional: null,
        picks: null,
        disabled: true,
      },
      // 지난 날짜의 미발행 — 결과는 없지만 "경주 전" 은 아니다
      {
        key: "c",
        href: "/form/2026-11-26/jeju",
        date: "2026-11-26",
        title: "제주 11월 26일(목)",
        issue: null,
        status: "미발행 — 출전표 없음",
        sub: null,
        result: null,
        provisional: null,
        picks: null,
        disabled: false,
      },
    ];
    const h = renderToStaticMarkup(
      createElement(EditionCardGroups, { cards, today: "2026-11-27", showPicks: true }),
    );
    // 묶음 제목은 화면에 없고(스크린리더 이름만) 구분선 하나로 나눈다
    expect(h).not.toMatch(/<h3[^>]*>경주/);
    expect(h.match(/<hr/g)?.length).toBe(1);
    const [upcoming, result] = h.split('aria-label="경주 이후"');
    expect(upcoming).toContain('aria-label="경주 이전"');
    expect(upcoming).toContain("서울 11월 28일(토)");
    expect(upcoming).not.toContain("부경");
    // 경주 전 카드 — 발행 시각 대신 라운드별 주목마 (모두 고른 말은 별)
    expect(upcoming).not.toContain("11월 27일(금) 오후 6시 발행");
    expect(upcoming).toContain("선라이즈킹");
    expect(upcoming).toContain("영광의스카이");
    expect(upcoming.match(/aria-label="주목"/g)?.length).toBe(1);
    // 발행 예정 — 링크가 아니다
    expect(upcoming).toMatch(/<div aria-disabled="true"[^>]*>.*서울 11월 29일\(일\).*발행 예정/);
    expect(upcoming).not.toContain('href="/form/2026-11-29/seoul"');
    expect(result).toContain("부경 11월 27일(금)");
    expect(result).toContain("제주 11월 26일(목)");
    expect(result).toContain("잠정 — 내일 오후 1시 확정");
    expect(result).toContain("매직트리");
    expect(result).toContain("(1착 <span");
    expect(result).toContain("결과 대기");
    expect(result).toContain("무효");
    // "주목마 n경주 — 1착 n · …" 집계 줄은 싣지 않는다
    expect(result).not.toContain("주목마 5경주");
    // 결과 카드는 발행 시각·건수 줄 대신 결과를 싣는다
    expect(result).not.toContain("11월 26일(목) 오후 6시 발행");
    // 예상 기호 글리프·권유어 없음, 마번은 색 없이
    expect(h).not.toMatch(/[◎○△]|추천|강력/);
    expect(h).not.toContain("style=");

    // 홈(showPicks 없음) — 경주 전 카드에 주목마 이름을 싣지 않는다
    const home = renderToStaticMarkup(createElement(EditionCardGroups, { cards, today: "2026-11-27" }));
    expect(home.split('aria-label="경주 이후"')[0]).not.toContain("선라이즈킹");
    expect(home.split('aria-label="경주 이후"')[0]).toContain("10경주 · 주목마 5경주");

    // 경주일이 됐는데 결과가 하나도 없으면 "결과 대기 중" (줄마다 결과 대기)
    const waiting = renderToStaticMarkup(
      createElement(EditionCardGroups, {
        cards: [{ ...cards[0], result: editionResult(summary, [], { raceDayStarted: true }), provisional: null }],
        today: "2026-11-27",
      }),
    );
    expect(waiting).toContain("결과 대기 중");
    expect(waiting).not.toContain("<hr");
    expect(waiting.match(/결과 대기</g)?.length).toBe(5);

    const only = renderToStaticMarkup(createElement(EditionCardGroups, { cards: [cards[1]], today: "2026-11-27" }));
    expect(only).toContain('aria-label="경주 이전"');
    expect(only).not.toContain('aria-label="경주 이후"');
    expect(only).not.toContain("<hr");
  });
});

describe("RaceFormPicks — 경기 일람 경주 상세의 경마지 주목마 (2026-11-28)", () => {
  const golden = JSON.parse(
    readFileSync(
      fileURLToPath(
        new URL("../../../../../crawler/tests/fixtures/racing_form/payload_v1.golden.json", import.meta.url),
      ),
      "utf8",
    ),
  );
  const data = (raceIdx: number) => ({
    head: { issue_no: 3 } as EditionHead,
    slice: { edition: golden.edition, rules: golden.rules, race: golden.races[raceIdx], race_nos: [1, 2, 3] },
    outcomes: [],
  });

  it("주목마가 있으면 카드 + 고른 기준, '경마지 전체 보기' 는 새 창", () => {
    const h = renderToStaticMarkup(
      createElement(RaceFormPicks, { data: data(0), date: "2026-11-15", meet: "서울", raceNo: 1 }),
    );
    expect(h).toContain("경마지 주목마");
    expect(h).toContain("제3호");
    expect(h).toMatch(/<a href="\/form\/2026-11-15\/seoul\/1" target="_blank" rel="noopener"/);
    expect(h).toContain("(새 창)");
    expect(h.match(/<li class="space-y-2/g)?.length).toBe(golden.races[0].consensus.picks.length);
    expect(h).not.toMatch(/[◎○△]|추천|강력/);
    // 예전 링크 문구는 없다
    expect(h).not.toContain("예상 보기");
  });

  it("주목마가 없거나 데이터가 없으면 그리지 않는다", () => {
    expect(
      renderToStaticMarkup(
        createElement(RaceFormPicks, { data: data(1), date: "2026-11-15", meet: "서울", raceNo: 2 }),
      ),
    ).toBe("");
    expect(
      renderToStaticMarkup(
        createElement(RaceFormPicks, { data: null, date: "2026-11-15", meet: "서울", raceNo: 1 }),
      ),
    ).toBe("");
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

  it("ChangesBox 는 이 경주의 기수 변경만 — 없으면 상자째 그리지 않는다", () => {
    const none = renderToStaticMarkup(createElement(ChangesBox, { diffs: [], horseName: name }));
    expect(none).toBe("");
    const one = renderToStaticMarkup(
      createElement(ChangesBox, {
        diffs: [{ race_no: 1, horse_no: "0041002", chul_no: 2, before: "갑기수", after: "을기수", reason: "부상" }],
        horseName: name,
      }),
    );
    expect(one).toContain("발행 후 기수 변경");
    expect(one).toContain("이 경주의 발행 후 변경");
    expect(one).toContain("녹색신호");
    expect(one).not.toContain("정정");
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
