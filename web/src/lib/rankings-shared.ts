// 랭킹 연도 폴백 판단 — DB 의존 없는 순수 로직 (단위테스트 대상).
// 1월 초처럼 올해 경주가 아직 적어 랭킹이 비면(또는 거의 비면) 직전 연도로 보여준다.
//
// 폴백 규칙 (화면별 minRows):
//   - /rankings (50행 표):    올해 0건일 때만 폴백 (minRows = 1). 1건이라도 있으면 올해 그대로.
//   - /analysis TOP 카드(5행): 올해 3건 미만이면 폴백 (minRows = 3). 연초엔 HAVING 최소 출전수
//     때문에 1~2행만 남아 "TOP 5" 카드가 사실상 비어 보이므로.
//   공통: 사용자가 연도/기간을 직접 고른 조회(explicit)·통산(all) 은 폴백하지 않고,
//   직전 연도 결과가 올해보다 많지 않으면(둘 다 빈 경우 포함) 올해 결과를 그대로 둔다.

export type RankingScopeKey = "year" | "ytd" | "all";
export type RankingEntityKey = "horse" | "jockey" | "trainer";

export type YearFallbackResult<T> = {
  rows: T[];
  /** 실제로 보여주는 연도. */
  year: number;
  /** 원래 요청한 연도 (폴백 시 year 와 다름). */
  requestedYear: number;
  fellBack: boolean;
};

export type FallbackOptions = {
  /** 사용자가 연도/기간을 직접 골랐으면 true — 폴백 안 함. */
  explicit?: boolean;
  /** 올해 결과가 이 개수 미만이면 폴백 후보. 기본 1 (= 0건일 때만). */
  minRows?: number;
};

/**
 * 폴백 여부 — 자동(사용자가 연도를 고르지 않은) 조회 + 통산이 아님 + 결과 < minRows.
 * 사용자가 명시한 ?year= 은 비어 있어도 그대로 존중한다.
 */
export function shouldFallbackToPrevYear(opts: {
  scope: RankingScopeKey;
  rowCount: number;
  explicit: boolean;
  minRows?: number;
}): boolean {
  const minRows = Math.max(1, opts.minRows ?? 1);
  return !opts.explicit && opts.scope !== "all" && opts.rowCount < minRows;
}

/**
 * year 로 조회 → 폴백 조건이면 year-1 재조회.
 * 직전 연도 결과가 올해보다 많지 않으면 원래 연도 결과를 그대로 돌려준다.
 */
export async function withPrevYearFallback<T>(
  fetchYear: (year: number) => Promise<T[]>,
  opts: { scope: RankingScopeKey; year: number } & FallbackOptions,
): Promise<YearFallbackResult<T>> {
  const rows = await fetchYear(opts.year);
  const base = { rows, year: opts.year, requestedYear: opts.year, fellBack: false };
  if (
    !shouldFallbackToPrevYear({
      scope: opts.scope,
      rowCount: rows.length,
      explicit: opts.explicit ?? false,
      minRows: opts.minRows,
    })
  ) {
    return base;
  }
  const prevYear = opts.year - 1;
  const prevRows = await fetchYear(prevYear);
  if (prevRows.length <= rows.length) return base;
  return { rows: prevRows, year: prevYear, requestedYear: opts.year, fellBack: true };
}

/**
 * /rankings 링크. omitPeriod 면 scope/year 를 빼고 entity 만 — 폴백으로 보여준 화면에서
 * 대상 탭을 바꿀 때 직전 연도를 "명시 선택"으로 고정하지 않고, 새 대상마다 폴백 판단을 다시 하게.
 */
export function buildRankingsHref(
  next: { entity: RankingEntityKey; scope: RankingScopeKey; year: number },
  opts: { omitPeriod?: boolean } = {},
): string {
  const params = new URLSearchParams();
  params.set("entity", next.entity);
  if (!opts.omitPeriod) {
    params.set("scope", next.scope);
    if (next.scope === "year") params.set("year", String(next.year));
  }
  return `/rankings?${params.toString()}`;
}
