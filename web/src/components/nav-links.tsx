"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_LINKS = [
  { href: "/races", label: "경기" },
  { href: "/horses", label: "마필" },
  { href: "/jockeys", label: "기수" },
  { href: "/news", label: "뉴스" },
] as const;

export function NavLinks() {
  const pathname = usePathname();

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
    </nav>
  );
}
