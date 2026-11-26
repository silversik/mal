"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { activeRacesSubnav, RACES_SUBNAV_ITEMS } from "@/lib/races-subnav";

/**
 * '경기' 영역 서브탭 — 경기 일람 | 경마지 | 대상경주 일정.
 * /races · /form/** · /races/schedule 이 함께 쓴다. 단일 DOM 가로 탭(좁으면 가로 스크롤),
 * 터치 44px(글씨 축과 함께 커짐). 활성 표시는 SectionNav 와 같은 brown 밑줄 + aria-current.
 */
export function RacesSubnav({ className }: { className?: string }) {
  const active = activeRacesSubnav(usePathname());
  return (
    <nav
      aria-label="경기 메뉴"
      className={`-mx-4 border-b border-border px-4 md:mx-0 md:px-0 ${className ?? ""}`}
    >
      <ul className="flex gap-1 overflow-x-auto scrollbar-hide">
        {RACES_SUBNAV_ITEMS.map(({ href, label }) => {
          const on = active === href;
          return (
            <li key={href} className="shrink-0">
              <Link
                href={href}
                aria-current={on ? "page" : undefined}
                className={`-mb-px flex min-h-[max(44px,2.75rem)] items-center whitespace-nowrap border-b-2 px-3 text-base font-semibold transition-colors ${
                  on
                    ? "border-brown text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
