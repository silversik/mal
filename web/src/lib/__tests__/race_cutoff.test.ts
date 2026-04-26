import { describe, expect, it } from "vitest";

import { computeCutoffMs } from "../race_cutoff";

describe("computeCutoffMs", () => {
  it("start_time 있으면 KST 해당 시각의 epoch ms", () => {
    // 2026-04-26 15:30 KST = 06:30 UTC
    const ms = computeCutoffMs("2026-04-26", "15:30");
    expect(new Date(ms).toISOString()).toBe("2026-04-26T06:30:00.000Z");
  });

  it("start_time 없으면 race_date 다음 자정 KST", () => {
    // 2026-04-26 자정(다음날) KST = 2026-04-26 15:00 UTC
    const ms = computeCutoffMs("2026-04-26", null);
    expect(new Date(ms).toISOString()).toBe("2026-04-26T15:00:00.000Z");
  });

  it("KST 고정 +09:00 — 호스트 timezone 무관", () => {
    // 2026-01-01 09:00 KST = 2026-01-01 00:00 UTC (winter, DST 없음)
    const ms = computeCutoffMs("2026-01-01", "09:00");
    expect(new Date(ms).toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });
});
