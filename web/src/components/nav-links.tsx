"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_LINKS = [
  { href: "/races", label: "경기" },
  { href: "/horses", label: "마필" },
  { href: "/jockeys", label: "기수" },
  { href: "/board", label: "커뮤니티" },
] as const;

const ANALYSIS_LINKS = [
  { href: "/rankings", label: "랭킹" },
  { href: "/records", label: "코스 레코드" },
  { href: "/compare", label: "마필 비교" },
] as const;

export function NavLinks() {
  const pathname = usePathname();
  const analysisActive = ANALYSIS_LINKS.some((l) => pathname.startsWith(l.href));

  return (
    <nav className="hidden items-center gap-2 md:flex">
      {NAV_LINKS.map(({ href, label }) => {
        const active = pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={`px-3 py-2 text-sm font-semibold transition-all duration-200 ${
              active
                ? "text-primary border-b-2 border-primary"
                : "text-slate-grey hover:text-primary"
            }`}
          >
            {label}
          </Link>
        );
      })}

      <AnalysisMenu active={analysisActive} pathname={pathname} />
    </nav>
  );
}

function AnalysisMenu({ active, pathname }: { active: boolean; pathname: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className="relative"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={`flex items-center gap-1 px-3 py-2 text-sm font-semibold transition-all duration-200 ${
          active
            ? "text-primary border-b-2 border-primary"
            : "text-slate-grey hover:text-primary"
        }`}
      >
        분석
        <svg
          width="10"
          height="10"
          viewBox="0 0 12 12"
          aria-hidden="true"
          className={`transition-transform ${open ? "rotate-180" : ""}`}
        >
          <path d="M2 4 L6 8 L10 4" stroke="currentColor" strokeWidth="1.6" fill="none" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-full z-30 mt-1 min-w-[140px] rounded-md border bg-white shadow-lg">
          {ANALYSIS_LINKS.map((l) => {
            const itemActive = pathname.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className={`block px-3 py-2 text-sm font-semibold transition ${
                  itemActive
                    ? "bg-primary/5 text-primary"
                    : "text-slate-grey hover:bg-muted hover:text-primary"
                }`}
              >
                {l.label}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
