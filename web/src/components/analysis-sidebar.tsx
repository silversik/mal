"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { Card, CardContent } from "@/components/ui/card";
import {
  IconBars,
  IconTarget,
  IconTrend,
  IconTrophy,
} from "@/components/profile-ui";

const ITEMS = [
  { href: "/analysis", label: "종합", Icon: IconTrophy, exact: true },
  { href: "/rankings", label: "랭킹", Icon: IconBars },
  { href: "/records", label: "코스 레코드", Icon: IconTrend },
  { href: "/compare", label: "마필 비교", Icon: IconTarget },
];

/**
 * 모바일(md 미만): 가로 한 줄 탭바 — 4 항목이 카드 4개로 세로로 쌓이지 않도록.
 * 데스크탑(md+): 좌측 sticky 사이드바 유지.
 */
export function AnalysisSidebar() {
  const pathname = usePathname();

  return (
    <>
      {/* 모바일: 가로 탭바 (overflow-x-auto 로 좁은 화면 대응) */}
      <nav
        aria-label="분석 도구"
        className="-mx-4 flex gap-1 overflow-x-auto border-b border-border px-4 scrollbar-hide md:hidden"
      >
        {ITEMS.map(({ href, label, Icon, exact }) => {
          const active = exact ? pathname === href : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={`-mb-px inline-flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-semibold transition ${
                active
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-primary"
              }`}
            >
              <Icon size={14} />
              {label}
            </Link>
          );
        })}
      </nav>

      {/* 데스크탑: 기존 카드형 사이드바 */}
      <aside className="hidden md:sticky md:top-4 md:block md:self-start">
        <Card>
          <CardContent className="p-2">
            <nav className="flex flex-col gap-0.5">
              {ITEMS.map(({ href, label, Icon, exact }) => {
                const active = exact ? pathname === href : pathname.startsWith(href);
                return (
                  <Link
                    key={href}
                    href={href}
                    className={`flex items-center gap-2 rounded-md px-2.5 py-2 text-sm font-semibold transition ${
                      active
                        ? "bg-primary text-secondary"
                        : "text-muted-foreground hover:bg-muted hover:text-primary"
                    }`}
                  >
                    <Icon size={14} />
                    {label}
                  </Link>
                );
              })}
            </nav>
          </CardContent>
        </Card>
      </aside>
    </>
  );
}
