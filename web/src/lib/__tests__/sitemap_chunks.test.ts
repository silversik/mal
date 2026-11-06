import { describe, expect, it } from "vitest";
import {
  buildSitemapIndexEntries,
  chunkIndexOfRow,
  chunkOffset,
  parseSitemapId,
  renderUrlSet,
  sitemapChunkId,
} from "../sitemap-shared";

describe("chunk 경계 — index SQL 과 chunk OFFSET 일치", () => {
  it("chunkIndexOfRow 경계값", () => {
    expect(chunkIndexOfRow(1, 5000)).toBe(0);
    expect(chunkIndexOfRow(5000, 5000)).toBe(0);
    expect(chunkIndexOfRow(5001, 5000)).toBe(1);
    expect(chunkIndexOfRow(15000, 15000)).toBe(0);
    expect(chunkIndexOfRow(42000, 15000)).toBe(2);
  });
  it("chunk k 는 정확히 row (k*size, (k+1)*size] 를 포함", () => {
    const size = 7;
    const total = 50;
    for (let rn = 1; rn <= total; rn++) {
      const k = chunkIndexOfRow(rn, size);
      const offset = chunkOffset(k, size);
      // OFFSET offset LIMIT size 가 반환하는 1-based row 범위
      expect(rn).toBeGreaterThan(offset);
      expect(rn).toBeLessThanOrEqual(offset + size);
    }
    // 마지막 chunk index + 1 == 필요한 chunk 수
    expect(chunkIndexOfRow(total, size) + 1).toBe(Math.ceil(total / size));
  });
});

describe("parseSitemapId / sitemapChunkId", () => {
  it("정적·마필·경주 chunk 해석", () => {
    expect(parseSitemapId("0.xml")).toEqual({ kind: "static" });
    expect(parseSitemapId("1.xml")).toEqual({ kind: "horse", index: 0 });
    expect(parseSitemapId("3")).toEqual({ kind: "horse", index: 2 });
    expect(parseSitemapId("races-0.xml")).toEqual({ kind: "race", index: 0 });
    expect(parseSitemapId("races-12.xml")).toEqual({ kind: "race", index: 12 });
  });
  it("불량 id 는 null(404)", () => {
    for (const bad of ["", "-1.xml", "1.5.xml", "01.xml", "abc.xml", "races-.xml", "races--1.xml", "races-01.xml", "races-1.json"]) {
      expect(parseSitemapId(bad)).toBeNull();
    }
  });
  it("id ↔ chunk 왕복", () => {
    for (const c of [
      { kind: "static" as const },
      { kind: "horse" as const, index: 0 },
      { kind: "horse" as const, index: 4 },
      { kind: "race" as const, index: 0 },
      { kind: "race" as const, index: 9 },
    ]) {
      expect(parseSitemapId(`${sitemapChunkId(c)}.xml`)).toEqual(c);
    }
  });
});

describe("buildSitemapIndexEntries", () => {
  it("정적 → 마필 → 경주 순, lastmod 는 데이터 값 그대로", () => {
    expect(
      buildSitemapIndexEntries(
        ["2026-11-01T00:00:00Z", "2026-11-02T00:00:00Z"],
        ["2015-03-01", "2026-11-01"],
      ),
    ).toEqual([
      { id: "0" },
      { id: "1", lastmod: "2026-11-01T00:00:00Z" },
      { id: "2", lastmod: "2026-11-02T00:00:00Z" },
      { id: "races-0", lastmod: "2015-03-01" },
      { id: "races-1", lastmod: "2026-11-01" },
    ]);
  });
  it("경주 0건이면 경주 chunk 없음", () => {
    expect(buildSitemapIndexEntries([undefined], []).map((e) => e.id)).toEqual(["0", "1"]);
  });
});

describe("renderUrlSet", () => {
  it("lastmod 없으면 태그 생략, loc 의 & 이스케이프", () => {
    const xml = renderUrlSet([
      { loc: "https://mal.kr/about", changefreq: "yearly", priority: 0.5 },
      {
        loc: "https://mal.kr/races?date=2026-11-01&venue=%EC%84%9C%EC%9A%B8&race=3",
        lastmod: "2026-11-01",
        changefreq: "monthly",
        priority: 0.6,
      },
    ]);
    expect(xml.match(/<lastmod>/g)?.length).toBe(1);
    expect(xml).toContain("<lastmod>2026-11-01</lastmod>");
    expect(xml).toContain(
      "<loc>https://mal.kr/races?date=2026-11-01&amp;venue=%EC%84%9C%EC%9A%B8&amp;race=3</loc>",
    );
  });
});
