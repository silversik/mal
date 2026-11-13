"use client";

import {
  IconBars,
  IconTarget,
  IconTrend,
  IconTrophy,
} from "@/components/profile-ui";
import { SectionNav } from "@/components/section-nav";

const ITEMS = [
  { href: "/analysis", label: "종합", Icon: IconTrophy, exact: true },
  { href: "/rankings", label: "랭킹", Icon: IconBars },
  { href: "/records", label: "코스 레코드", Icon: IconTrend },
  { href: "/compare", label: "마필 비교", Icon: IconTarget },
];

export function AnalysisSidebar() {
  return <SectionNav title="분석 대시보드" items={ITEMS} />;
}
