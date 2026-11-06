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

// 댓글 전용 인스턴스 — 3초 1건 + 60초 10건 (홈 최신 댓글 피드 도배 방지)
export const commentRateLimiter = createRateLimiter({
  windowMs: 60_000,
  maxPerWindow: 10,
  minGapMs: 3_000,
});

// 문의 게시판 전용 인스턴스 — 10초 1건 + 5분 3건
export const contactRateLimiter = createRateLimiter({
  windowMs: 300_000,
  maxPerWindow: 3,
  minGapMs: 10_000,
});

/**
 * rate limit 키용 클라이언트 IP — `X-Forwarded-For` 의 **가장 오른쪽** 값.
 * nginx 가 `$proxy_add_x_forwarded_for` 로 붙이든 `$remote_addr` 로 덮어쓰든, 맨 오른쪽은
 * 단일 프록시(nginx)가 직접 본 주소라 클라이언트가 위조할 수 없다. (헤더 문자열 전체를
 * 키로 쓰면 클라이언트가 앞쪽 값을 매번 바꿔 제한을 우회할 수 있었다.)
 * nginx 가 XFF 를 아예 안 붙이는 구성이면 클라이언트 값이 그대로지만, 이전보다 나빠지진 않는다.
 */
export function clientIpFromXff(xff: string | null | undefined): string {
  const last = (xff ?? "").split(",").map((s) => s.trim()).filter(Boolean).pop();
  return last && last.length <= 64 ? last : "unknown";
}
