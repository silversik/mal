import Link from "next/link";

import { parsePositiveInt } from "@/lib/params";

/** 목록 페이지 공통 크기 — 페이지당 HTML 을 가볍게 (기존 60~100개 → 450KB 안팎). */
export const LIST_PAGE_SIZE = 30;

/** ?page= 파라미터 → 1 이상 정수 (잘못된 값·과대값은 1). OFFSET 은 (page-1)*size. */
export function parseListPage(raw: string | string[] | undefined): number {
  return parsePositiveInt(raw, 10_000) ?? 1;
}

/**
 * size+1 개를 조회한 결과에서 현재 페이지 행과 다음 페이지 존재 여부를 분리.
 * 전체 COUNT 없이 "다음" 버튼만 판단 — 필터·검색 조합마다 count 쿼리를 따로 두지 않는다.
 */
export function splitPage<T>(rows: T[], size: number = LIST_PAGE_SIZE): { rows: T[]; hasNext: boolean } {
  return { rows: rows.slice(0, size), hasNext: rows.length > size };
}

/** 이전/다음 페이지 링크. 터치타깃 ≥44px (DESIGN.md), 한 페이지뿐이면 렌더하지 않는다. */
export function ListPager({
  page,
  hasNext,
  href,
}: {
  page: number;
  hasNext: boolean;
  href: (page: number) => string;
}) {
  if (page <= 1 && !hasNext) return null;

  const base =
    "inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border px-4 text-sm font-semibold transition-colors";
  const active = `${base} border-border bg-card text-foreground hover:border-primary/40 hover:text-primary`;
  const disabled = `${base} border-border/60 text-muted-foreground`;

  return (
    <nav aria-label="페이지" className="mt-6 flex items-center justify-center gap-3">
      {page > 1 ? (
        <Link href={href(page - 1)} className={active} rel="prev">
          ‹ 이전
        </Link>
      ) : (
        <span className={disabled} aria-disabled="true">
          ‹ 이전
        </span>
      )}
      <span className="font-mono text-sm tabular-nums text-muted-foreground" aria-current="page">
        {page} 페이지
      </span>
      {hasNext ? (
        <Link href={href(page + 1)} className={active} rel="next">
          다음 ›
        </Link>
      ) : (
        <span className={disabled} aria-disabled="true">
          다음 ›
        </span>
      )}
    </nav>
  );
}
