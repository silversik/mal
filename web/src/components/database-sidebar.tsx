"use client";

import {
  IconCrown,
  IconHorseshoe,
  IconTrophy,
  IconUser,
  IconUserPlus,
} from "@/components/profile-ui";
import { SectionNav } from "@/components/section-nav";

const ITEMS = [
  { href: "/database", label: "종합", Icon: IconTrophy, exact: true },
  { href: "/horses", label: "마필", Icon: IconHorseshoe },
  { href: "/jockeys", label: "기수", Icon: IconUser },
  { href: "/trainer", label: "조교사", Icon: IconUserPlus },
  { href: "/owner", label: "마주", Icon: IconCrown },
];

export function DatabaseSidebar() {
  return <SectionNav title="데이터베이스" items={ITEMS} />;
}
