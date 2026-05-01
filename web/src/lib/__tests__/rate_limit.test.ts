import { beforeEach, describe, expect, it } from "vitest";

import { createRateLimiter } from "../rate_limit";

describe("createRateLimiter", () => {
  describe("min gap (per-second)", () => {
    const rl = createRateLimiter({ windowMs: 60_000, maxPerWindow: 30, minGapMs: 1_000 });
    beforeEach(() => rl._reset());

    it("같은 키 1초 이내 두 번째 호출은 차단", () => {
      expect(rl.check("u1", 0)).toBe("OK");
      expect(rl.check("u1", 999)).toBe("RATE_LIMITED");
    });

    it("정확히 1000ms 후는 통과", () => {
      expect(rl.check("u1", 0)).toBe("OK");
      expect(rl.check("u1", 1000)).toBe("OK");
    });

    it("다른 키는 영향 없음", () => {
      expect(rl.check("u1", 0)).toBe("OK");
      expect(rl.check("u2", 100)).toBe("OK");
    });
  });

  describe("window cap (per-minute)", () => {
    const rl = createRateLimiter({ windowMs: 60_000, maxPerWindow: 3, minGapMs: 0 });
    beforeEach(() => rl._reset());

    it("윈도우 내 max 도달 시 차단, 윈도우 통과 후 회복", () => {
      expect(rl.check("u1", 0)).toBe("OK");
      expect(rl.check("u1", 100)).toBe("OK");
      expect(rl.check("u1", 200)).toBe("OK");
      expect(rl.check("u1", 300)).toBe("RATE_LIMITED");
      // 첫 호출이 윈도우 밖으로 나가면 한 슬롯 회복
      expect(rl.check("u1", 60_001)).toBe("OK");
    });
  });
});
