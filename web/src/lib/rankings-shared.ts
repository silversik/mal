// 랭킹 연도 폴백 판단 — DB 의존 없는 순수 로직 (단위테스트 대상).
// 1월 초처럼 올해 경주가 아직 적어 랭킹이 비면 직전 연도로 보여준다.

export type YearFallbackResult<T> = {
  rows: T[];
  /** 실제로 보여주는 연도. */
  year: number;
  /** 원래 요청한 연도 (폴백 시 year 와 다름). */
  requestedYear: number;
  fellBack: boolean;
};

/**
 * 폴백 여부 — 자동(사용자가 연도를 고르지 않은) 조회 + 통산이 아님 + 결과 0건일 때만.
 * 사용자가 명시한 ?year= 은 비어 있어도 그대로 존중한다.
 */
export function shouldFallbackToPrevYear(opts: {
  scope: "year" | "ytd" | "all";
  rowCount: number;
  explicit: boolean;
}): boolean {
  return !opts.explicit && opts.scope !== "all" && opts.rowCount === 0;
}

/**
 * year 로 조회 → 비었고 폴백 허용이면 year-1 재조회.
 * 직전 연도도 비면 폴백하지 않고 원래 연도(빈 결과)를 그대로 돌려준다.
 */
export async function withPrevYearFallback<T>(
  fetchYear: (year: number) => Promise<T[]>,
  opts: { scope: "year" | "ytd" | "all"; year: number; explicit: boolean },
): Promise<YearFallbackResult<T>> {
  const rows = await fetchYear(opts.year);
  const base = { rows, year: opts.year, requestedYear: opts.year, fellBack: false };
  if (!shouldFallbackToPrevYear({ scope: opts.scope, rowCount: rows.length, explicit: opts.explicit })) {
    return base;
  }
  const prevYear = opts.year - 1;
  const prevRows = await fetchYear(prevYear);
  if (prevRows.length === 0) return base;
  return { rows: prevRows, year: prevYear, requestedYear: opts.year, fellBack: true };
}

/** 폴백 시 라벨 접미사 — 예: "2026 (2027 집계 전)". */
export function rankingYearLabel(r: { year: number; requestedYear: number; fellBack: boolean }): string {
  return r.fellBack ? `${r.year} (${r.requestedYear} 집계 전)` : `${r.year}`;
}
