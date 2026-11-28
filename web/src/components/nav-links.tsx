"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// 데이터베이스 영역 — /database 클릭 시 종합 대시보드로 이동. 호버 드롭다운 없음.
const DATABASE_PATHS = [
  "/database",
  "/horses",
  "/horse/",
  "/jockeys",
  "/jockey/",
  "/trainer",
  "/owner",
] as const;

// 분석 영역 — /analysis 클릭 시 종합 대시보드로 이동. 호버 드롭다운 없음.
const ANALYSIS_PATHS = ["/analysis", "/rankings", "/records", "/compare"] as const;

// 경마지(/form)는 데스크톱 메뉴에 따로 둔다 (docs/feature/racing-form.md 4.4).
// 모바일은 '더보기'·경기 일람·홈의 경마지 섹션에서 들어간다 ('경기' 서브탭은 2026-11-27 에 뺐다).
const NAV_ITEMS = [
  { href: "/races", label: "경기", paths: ["/races"] },
  { href: "/paper", label: "경마지", paths: ["/paper"] },
  { href: "/database", label: "데이터베이스", paths: DATABASE_PATHS },
  { href: "/analysis", label: "분석", paths: ANALYSIS_PATHS },
];

export function NavLinks() {
  const pathname = usePathname();
  return (
    <nav className="hidden items-center gap-2 md:flex">
      {NAV_ITEMS.map((it) => {
        const active = it.paths.some((p) => pathname.startsWith(p));
        return (
          <Link
            key={it.href}
            href={it.href}
            className={`inline-flex min-h-11 items-center px-3 text-base font-semibold transition-colors ${
              active
                ? "border-b-2 border-primary text-primary"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {it.label}
          </Link>
        );
      })}
    </nav>
  );
}
