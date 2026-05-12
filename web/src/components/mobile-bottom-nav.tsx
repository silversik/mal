"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

type NavItem = {
  href: string;
  label: string;
  icon: React.ReactNode;
  exact?: boolean;
  activePaths?: string[];
};

import React from "react";

const ANALYSIS_PATHS = ["/analysis", "/rankings", "/records", "/compare"];

const PRIMARY_ITEMS: NavItem[] = [
  {
    href: "/races",
    label: "경기",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
        <line x1="4" y1="22" x2="4" y2="15" />
      </svg>
    ),
  },
  {
    href: "/database",
    label: "DB",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <ellipse cx="12" cy="5" rx="8" ry="3" />
        <path d="M4 5v6c0 1.66 3.58 3 8 3s8-1.34 8-3V5" />
        <path d="M4 11v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6" />
      </svg>
    ),
    activePaths: ["/database", "/horses", "/horse/", "/jockeys", "/jockey/", "/trainer", "/owner"],
  },
  {
    href: "/",
    label: "홈",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        <polyline points="9 22 9 12 15 12 15 22" />
      </svg>
    ),
    exact: true,
  },
  {
    href: "/analysis",
    label: "분석",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3" y="13" width="4" height="8" rx="1" />
        <rect x="10" y="9" width="4" height="12" rx="1" />
        <rect x="17" y="5" width="4" height="16" rx="1" />
      </svg>
    ),
    activePaths: ANALYSIS_PATHS,
  },
];

const MORE_ITEMS = [
  { href: "/board", label: "커뮤니티" },
  { href: "/notifications", label: "알림" },
  { href: "/me", label: "마이페이지" },
];

export function MobileBottomNav() {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);

  function isActive(href: string, opts?: { exact?: boolean; activePaths?: string[] }): boolean {
    if (opts?.exact) return pathname === href;
    if (opts?.activePaths) return opts.activePaths.some((p) => pathname.startsWith(p));
    return pathname.startsWith(href);
  }

  const openMore = () => setMoreOpen((v) => !v);
  const closeAll = () => setMoreOpen(false);

  return (
    <>
      {moreOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          onClick={closeAll}
          aria-hidden="true"
        />
      )}

      {/* 더보기 패널 */}
      <div
        className={`fixed bottom-16 left-0 right-0 z-50 border-t border-primary/10 bg-background/95 backdrop-blur-md transition-transform duration-200 md:hidden ${
          moreOpen ? "translate-y-0" : "translate-y-full"
        }`}
      >
        <div className="grid grid-cols-3 divide-x divide-border">
          {MORE_ITEMS.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              onClick={closeAll}
              className={`flex flex-col items-center gap-1 py-4 text-xs font-medium transition ${
                isActive(href)
                  ? "text-primary"
                  : "text-muted-foreground hover:text-primary"
              }`}
            >
              {label}
            </Link>
          ))}
        </div>
      </div>

      {/* 바텀 네비바 */}
      <nav
        className="fixed bottom-0 left-0 right-0 z-50 h-16 border-t border-primary/10 bg-background/95 backdrop-blur-md md:hidden"
        aria-label="모바일 네비게이션"
      >
        <div className="flex h-full items-stretch">
          {PRIMARY_ITEMS.map((it) => {
            const active = isActive(it.href, { exact: it.exact, activePaths: it.activePaths });
            return (
              <Link
                key={it.href}
                href={it.href}
                onClick={closeAll}
                className={`flex flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition ${
                  active ? "text-primary" : "text-muted-foreground"
                }`}
              >
                <span className={active ? "text-primary" : ""}>{it.icon}</span>
                {it.label}
              </Link>
            );
          })}

          {/* 더보기 버튼 */}
          <button
            type="button"
            onClick={openMore}
            className={`flex flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition ${
              moreOpen ? "text-primary" : "text-muted-foreground"
            }`}
            aria-expanded={moreOpen}
            aria-label="더보기 메뉴"
          >
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
            더보기
          </button>
        </div>
      </nav>
    </>
  );
}
