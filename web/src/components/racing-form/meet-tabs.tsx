import Link from "next/link";

import { formEditionPath, type FormMeet } from "@/lib/racing_form-shared";
import { cn } from "@/lib/utils";

import { TAP } from "./format";

const TAB =
  "-mb-px flex items-center whitespace-nowrap border-b-2 px-4 text-base font-semibold transition-colors";

/**
 * 1면 머리의 경마장 탭 — 같은 날 다른 경마장 호로 옮겨 간다 (MEET_ORDER 순, 44px).
 * 버튼(칩) 대신 탭 — '경기' 서브탭(RacesSubnav)과 같은 문법: 밑줄 하나, 활성 = brown 밑줄 +
 * aria-current (DESIGN.md Decisions Log 2026-11-27). 지금 보는 경마장은 링크가 아니다.
 */
export function MeetTabs({
  date,
  meets,
  current,
}: {
  date: string;
  /** 그날 계획된 경마장 (MEET_ORDER 순) */
  meets: readonly FormMeet[];
  current: FormMeet;
}) {
  const list = meets.includes(current) ? meets : [current, ...meets];
  return (
    <nav aria-label="같은 날 경마장" className="border-b border-border">
      <ul className="flex gap-1 overflow-x-auto scrollbar-hide">
        {list.map((m) => (
          <li key={m} className="shrink-0">
            {m === current ? (
              <span aria-current="page" className={cn(TAB, TAP, "border-brown text-foreground")}>
                {m}
              </span>
            ) : (
              <Link
                href={formEditionPath(date, m)}
                className={cn(
                  TAB,
                  TAP,
                  "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {m}
                <span className="sr-only"> 경마지로 이동</span>
              </Link>
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
}
