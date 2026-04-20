"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_LINKS = [
  { href: "/races", label: "경기" },
  { href: "/horses", label: "마필" },
  { href: "/jockeys", label: "기수" },
  { href: "/news", label: "뉴스" },
] as const;

export function Navbar() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40 w-full border-b border-primary/10 bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-6">
        <div className="flex items-center gap-8">
          {/* Logo */}
          <Link
            href="/"
            className="font-serif text-2xl font-bold tracking-tight transition hover:opacity-80"
          >
            <span className="text-primary">MAL</span>.KR
          </Link>

          {/* Nav links */}
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
        </div>
        
        <div className="flex items-center gap-4">
          <button className="btn-outline text-xs py-1.5 px-4">MEMBERSHIP</button>
          <button className="btn-cta text-xs py-1.5 px-4 shadow-sm">LOGIN</button>
        </div>
      </div>
    </header>
  );
}
