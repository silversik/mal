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

export function AnalysisSidebar() {
  const pathname = usePathname();
  return (
    <aside className="md:sticky md:top-4 md:self-start">
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
  );
}
