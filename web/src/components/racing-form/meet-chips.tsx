import Link from "next/link";

import { formEditionPath, type FormMeet } from "@/lib/racing_form-shared";
import { cn } from "@/lib/utils";

import { TAP } from "./format";

const CHIP =
  "inline-flex items-center rounded-md border px-4 text-base font-semibold transition-colors";

/**
 * 1면 머리의 경마장 칩 — 같은 날 다른 경마장 호로 옮겨 간다 (MEET_ORDER 순, 44px).
 * 지금 보는 경마장은 링크가 아니라 aria-current 표시만 한다.
 */
export function MeetChips({
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
    <nav aria-label="같은 날 경마장" className="flex flex-wrap gap-2">
      {list.map((m) =>
        m === current ? (
          <span
            key={m}
            aria-current="page"
            className={cn(CHIP, TAP, "border-primary bg-primary text-primary-foreground")}
          >
            {m}
          </span>
        ) : (
          <Link
            key={m}
            href={formEditionPath(date, m)}
            className={cn(CHIP, TAP, "border-border bg-card text-foreground hover:bg-muted")}
          >
            {m}
            <span className="sr-only"> 경마지로 이동</span>
          </Link>
        ),
      )}
    </nav>
  );
}
