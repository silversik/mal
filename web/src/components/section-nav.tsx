"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type SectionNavItem = {
  href: string;
  label: string;
  Icon: React.ComponentType<{ size?: number }>;
  exact?: boolean;
};

/**
 * 섹션(분석 대시보드 · 데이터베이스) 하위 내비 — **단일 반응형 트리**(DESIGN 원칙 3).
 * 모바일: 본문 위 가로 탭바(가로 스크롤). md+: 좌측 sticky 세로 목록.
 * sticky top 은 navbar(h-16) 아래로 — top-20.
 */
export function SectionNav({
  title,
  items,
}: {
  title: string;
  items: SectionNavItem[];
}) {
  const pathname = usePathname();
  return (
    <nav
      aria-label={title}
      className="-mx-4 border-b border-border px-4 md:sticky md:top-20 md:mx-0 md:self-start md:border-b-0 md:px-0"
    >
      <p className="mb-2 hidden px-3 text-small font-semibold text-muted-foreground md:block">
        {title}
      </p>
      <ul className="flex gap-1 overflow-x-auto scrollbar-hide md:flex-col md:gap-0.5 md:overflow-visible">
        {items.map(({ href, label, Icon, exact }) => {
          const active = exact ? pathname === href : pathname.startsWith(href);
          return (
            <li key={href} className="shrink-0">
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={`-mb-px flex min-h-11 items-center gap-2 whitespace-nowrap border-b-2 px-3 text-base font-semibold transition-colors md:mb-0 md:rounded-md md:border-b-0 ${
                  active
                    ? "border-brown text-foreground md:bg-primary md:text-primary-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground md:hover:bg-muted"
                }`}
              >
                <Icon size={16} />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
