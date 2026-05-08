"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

type NavItem = { href: string; label: string; icon: React.ReactNode; exact?: boolean };

import React from "react";
import { HorseSilhouette } from "@/components/brand/logo";

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
    href: "/horses",
    label: "마필",
    icon: <HorseSilhouette size={22} />,
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
    href: "/jockeys",
    label: "기수",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="8" r="4" />
        <path d="M6 20v-2a6 6 0 0 1 12 0v2" />
      </svg>
    ),
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

  function isActive(href: string, exact?: boolean): boolean {
    if (exact) return pathname === href;
    return pathname.startsWith(href);
  }

  return (
    <>
      {/* 더보기 오버레이 */}
      {moreOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          onClick={() => setMoreOpen(false)}
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
              onClick={() => setMoreOpen(false)}
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
          {PRIMARY_ITEMS.map(({ href, label, icon, exact }) => {
            const active = isActive(href, exact);
            return (
              <Link
                key={href}
                href={href}
                className={`flex flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition ${
                  active ? "text-primary" : "text-muted-foreground"
                }`}
              >
                <span className={active ? "text-primary" : ""}>{icon}</span>
                {label}
              </Link>
            );
          })}

          {/* 더보기 버튼 */}
          <button
            type="button"
            onClick={() => setMoreOpen((v) => !v)}
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
