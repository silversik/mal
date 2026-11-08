import { describe, expect, it } from "vitest";

import { LIST_PAGE_SIZE, parseListPage, splitPage } from "@/components/list-pager";

describe("목록 페이지 나누기", () => {
  it("size+1 개 조회 결과 → 현재 페이지 행 + 다음 페이지 여부", () => {
    const rows = Array.from({ length: LIST_PAGE_SIZE + 1 }, (_, i) => i);
    expect(splitPage(rows)).toEqual({ rows: rows.slice(0, LIST_PAGE_SIZE), hasNext: true });
    expect(splitPage(rows.slice(0, LIST_PAGE_SIZE))).toEqual({
      rows: rows.slice(0, LIST_PAGE_SIZE),
      hasNext: false,
    });
    expect(splitPage([1, 2, 3], 2)).toEqual({ rows: [1, 2], hasNext: true });
  });

  it("?page= 는 1 이상 정수만, 그 외·과대값은 1", () => {
    expect(parseListPage(undefined)).toBe(1);
    expect(parseListPage("3")).toBe(3);
    expect(parseListPage(["2", "5"])).toBe(2);
    for (const bad of ["0", "-1", "abc", "1.5", "1e20", "99999999"]) {
      expect(parseListPage(bad)).toBe(1);
    }
  });
});
