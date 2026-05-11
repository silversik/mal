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

const NAV_ITEMS = [
  { href: "/races", label: "경기", paths: ["/races"] },
  { href: "/database", label: "데이터베이스", paths: DATABASE_PATHS },
  { href: "/board", label: "커뮤니티", paths: ["/board"] },
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
            className={`px-3 py-2 text-sm font-semibold transition-all duration-200 ${
              active
                ? "border-b-2 border-primary text-primary"
                : "text-slate-grey hover:text-primary"
            }`}
          >
            {it.label}
          </Link>
        );
      })}
    </nav>
  );
}
