import { describe, expect, it } from "vitest";

import { activeRacesSubnav, RACES_SUBNAV_ITEMS } from "../races-subnav";

describe("'경기' 서브탭 — 경기 일람 | 경마지 | 대상경주 일정", () => {
  it("탭 순서·경로", () => {
    expect(RACES_SUBNAV_ITEMS.map((i) => [i.href, i.label])).toEqual([
      ["/races", "경기 일람"],
      ["/form", "경마지"],
      ["/races/schedule", "대상경주 일정"],
    ]);
  });

  it("활성 탭 — /races/schedule 은 /races 보다 먼저, /form 하위 전부 경마지", () => {
    expect(activeRacesSubnav("/races")).toBe("/races");
    expect(activeRacesSubnav("/races/schedule")).toBe("/races/schedule");
    expect(activeRacesSubnav("/form")).toBe("/form");
    expect(activeRacesSubnav("/form/2026-11-27/busan/3")).toBe("/form");
    expect(activeRacesSubnav("/form/record")).toBe("/form");
  });

  it("접두어만 같은 다른 경로는 활성 아님", () => {
    expect(activeRacesSubnav("/")).toBeNull();
    expect(activeRacesSubnav("/formula")).toBeNull();
    expect(activeRacesSubnav("/races-old")).toBeNull();
  });
});
