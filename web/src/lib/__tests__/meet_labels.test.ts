import { beforeEach, describe, expect, it, vi } from "vitest";

// 부경은 DB 에 '부경'·'부산경남' 두 라벨로 저장돼 있다 (테이블·시기마다 다름).
// 라벨 그대로 비교하면 /races 의 부경 경주에 결과·출전표가 붙지 않는다 (2026-08 ~ 11 사고).
// 여기서는 경주를 찾는 쿼리가 저장 라벨 후보 전부로 찾는지를 SQL·파라미터로 고정한다.

const queryMock = vi.fn();
vi.mock("../db", () => ({
  query: (sql: string, params?: unknown[]) => queryMock(sql, params),
}));

import { resolveEntityName } from "../comments";
import { canonicalMeet, normMeetSql, storedMeetLabels } from "../meets";
import { getRaceComboDividends } from "../race_combo_dividends";
import { getRaceCorner } from "../race_corners";
import { getRacePoolSales, getRaceTotalSales } from "../race_pool_sales";
import { normalizeRaceParams } from "../race-seo";
import {
  getNextRaceDayRaces,
  getRaceDataSyncedAt,
  getRaceEntries,
  getRacesByDate,
  getRecentRaceDaysRaces,
  getRecentTopFinishers,
} from "../races";
import { getRaceVideo, getVideosForRaces } from "../videos";

const BUSAN = ["부경", "부산경남"];
const D = "2026-11-27";

type Call = { sql: string; params: unknown[] };

function calls(): Call[] {
  return queryMock.mock.calls.map(([sql, params]) => ({
    sql: String(sql),
    params: (params ?? []) as unknown[],
  }));
}

/** 라벨을 파라미터 그대로(=) 비교하는 흔적 — `meet = $2` · `a.meet = b.meet`. */
const RAW_LABEL_COMPARE = /\bmeet\s*=\s*(\$\d+(?!::text\[\])\b|[a-z_]+\.meet\b)/;

beforeEach(() => {
  queryMock.mockReset();
  queryMock.mockResolvedValue([]);
});

describe("meets — 저장 라벨 헬퍼", () => {
  it("저장 라벨을 정규 라벨로 바꾼다", () => {
    expect(canonicalMeet("부산경남")).toBe("부경");
    expect(canonicalMeet("부경")).toBe("부경");
    expect(canonicalMeet("서울")).toBe("서울");
    expect(canonicalMeet("없는곳")).toBe("없는곳");
  });

  it("저장 라벨 후보는 정규 라벨이 맨 앞이고, 별칭으로 물어도 같다", () => {
    expect(storedMeetLabels("부경")).toEqual(BUSAN);
    expect(storedMeetLabels("부산경남")).toEqual(BUSAN);
    expect(storedMeetLabels("제주")).toEqual(["제주"]);
  });

  it("SQL 정규화 식은 별칭만 바꾸고 나머지는 그대로 둔다", () => {
    expect(normMeetSql("r.meet")).toBe(
      "(CASE r.meet WHEN '부산경남' THEN '부경' ELSE r.meet END)",
    );
  });

  it("/races 는 저장 라벨로 들어온 venue 도 정규 라벨로 받는다", () => {
    expect(normalizeRaceParams({ date: D, venue: "부산경남", race: "3" })).toEqual({
      date: D,
      venue: "부경",
      race: 3,
    });
    expect(normalizeRaceParams({ date: D, venue: "없는곳", race: "3" }).venue).toBeNull();
  });
});

describe("경주 목록 — 두 라벨 행을 한 경주로 합친다", () => {
  it("getRacesByDate 는 정규 라벨로 묶고, meet 필터는 저장 라벨 후보 전부", async () => {
    await getRacesByDate(D, "부경");
    await getRacesByDate(D);
    const [withMeet, all] = calls();
    expect(withMeet.params).toEqual([D, BUSAN]);
    expect(withMeet.sql).toContain("r.meet = ANY($2::text[])");
    expect(all.params).toEqual([D]);
    for (const c of [withMeet, all]) {
      expect(c.sql).toContain(`GROUP BY r.race_date, ${normMeetSql("r.meet")}, r.race_no`);
      // 결과 유무도 라벨을 정규화해 맞춘다 ('부경' 경주 ↔ '부산경남' 결과)
      expect(c.sql).toContain(`${normMeetSql("rr.meet")} = m.meet`);
      expect(c.sql).not.toMatch(RAW_LABEL_COMPARE);
    }
  });

  it("홈 목록(다음 개최일·최근 개최일·입상마)도 정규 라벨로 내보낸다", async () => {
    await getNextRaceDayRaces();
    await getRecentRaceDaysRaces(2);
    await getRecentTopFinishers(4);
    const [next, recent, top] = calls();
    for (const c of [next, recent]) {
      expect(c.sql).toContain(`${normMeetSql("r.meet")} AS meet`);
      expect(c.sql).not.toMatch(RAW_LABEL_COMPARE);
    }
    expect(top.sql).toContain(`${normMeetSql("r.meet")} AS meet`);
    expect(top.sql).toContain("DISTINCT ON");
  });
});

describe("경주 상세 — 저장 라벨 후보 전부로 찾는다", () => {
  it("getRaceEntries: 결과·출전표 모두 text[] 로 찾고 말 한 마리는 한 줄", async () => {
    const out = await getRaceEntries(D, "부경", 1);
    expect(out).toEqual({ phase: "pre", entries: [] });
    const [post, pre] = calls();
    for (const c of [post, pre]) {
      expect(c.params).toEqual([D, BUSAN, 1]);
      expect(c.sql).toContain("meet = ANY($2::text[])");
      expect(c.sql).toMatch(/DISTINCT ON \([re]\.horse_no\)/);
      expect(c.sql).not.toMatch(RAW_LABEL_COMPARE);
    }
    // 배당·기수변경은 라벨을 정규화해 맞춘다 (결과 '부산경남' ↔ 기수변경 '부경')
    expect(post.sql).toContain(`${normMeetSql("d.meet")} = ${normMeetSql("r.meet")}`);
    expect(post.sql).toContain(`${normMeetSql("c.meet")} = ${normMeetSql("r.meet")}`);
    expect(pre.sql).toContain(`${normMeetSql("c.meet")} = ${normMeetSql("e.meet")}`);
  });

  it("별칭으로 물어도 같은 파라미터", async () => {
    await getRaceEntries(D, "부산경남", 1);
    expect(calls()[0].params).toEqual([D, BUSAN, 1]);
  });

  it("복식 배당·매출·구간기록·영상·수집시각·댓글 대상 확인", async () => {
    await getRaceComboDividends(D, "부경", 1);
    await getRacePoolSales(D, "부경", 1);
    await getRaceTotalSales(D, "부경", 1);
    await getRaceVideo(D, "부경", 1);
    await getRaceDataSyncedAt(D, "부경", 1);
    await resolveEntityName("race", `${D}_부경_1`);
    const all = calls();
    expect(all).toHaveLength(6);
    for (const c of all) {
      expect(c.params[1]).toEqual(BUSAN);
      expect(c.sql).toContain("meet = ANY($2::text[])");
      expect(c.sql).not.toMatch(RAW_LABEL_COMPARE);
    }
    // 같은 풀·조합이 두 라벨로 겹쳐도 한 번만 (매출 합계가 두 배가 되지 않게)
    expect(all[0].sql).toContain("DISTINCT ON (c.pool, c.combo_key)");
    expect(all[1].sql).toContain("DISTINCT ON (pool)");
    expect(all[2].sql).toContain("DISTINCT ON (pool)");
  });

  it("구간기록은 테이블 확인 뒤 저장 라벨 후보로 한 행", async () => {
    queryMock.mockResolvedValueOnce([{ exists: true }]);
    await getRaceCorner(D, "부경", 1);
    const [, rows] = calls();
    expect(rows.params).toEqual([D, BUSAN, 1]);
    expect(rows.sql).toContain("meet = ANY($2::text[])");
    expect(rows.sql).toContain("LIMIT 1");
  });

  it("영상 일괄 조회는 라벨을 정규화해 맞추고 호출자 라벨로 돌려준다", async () => {
    await getVideosForRaces([{ race_date: D, meet: "부경", race_no: 1 }]);
    const [c] = calls();
    expect(c.sql).toContain(`${normMeetSql("v.meet")} = ${normMeetSql("t.m")}`);
    expect(c.sql).toContain("t.m AS meet");
  });
});
