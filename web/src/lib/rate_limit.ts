// 인메모리 sliding-window rate limiter — mal-web 단일 컨테이너 (DEPLOYMENT.md §4) 가정.
// 다중 인스턴스 시 Redis 등 공유 저장소로 교체 필요.

export type RateLimitResult = "OK" | "RATE_LIMITED";

export type RateLimiter = {
  check: (key: string, now?: number) => RateLimitResult;
  // 테스트 헬퍼 — 상태 초기화
  _reset: () => void;
};

export function createRateLimiter(opts: {
  windowMs: number;
  maxPerWindow: number;
  minGapMs: number;
}): RateLimiter {
  const recent = new Map<string, number[]>();

  function check(key: string, now: number = Date.now()): RateLimitResult {
    const windowStart = now - opts.windowMs;
    const ts = (recent.get(key) ?? []).filter((t) => t > windowStart);
    if (ts.length >= opts.maxPerWindow) {
      recent.set(key, ts);
      return "RATE_LIMITED";
    }
    if (ts.length > 0 && now - ts[ts.length - 1] < opts.minGapMs) {
      recent.set(key, ts);
      return "RATE_LIMITED";
    }
    ts.push(now);
    recent.set(key, ts);
    if (recent.size > 1000 && Math.random() < 0.01) {
      for (const [k, v] of recent) {
        if (!v.some((t) => t > windowStart)) recent.delete(k);
      }
    }
    return "OK";
  }

  return {
    check,
    _reset: () => recent.clear(),
  };
}

// 베팅 전용 인스턴스 — 1초 1건 + 60초 30건
export const betRateLimiter = createRateLimiter({
  windowMs: 60_000,
  maxPerWindow: 30,
  minGapMs: 1_000,
});
