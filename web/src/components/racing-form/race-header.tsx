import Link from "next/link";

import { raceDetailPath } from "@/lib/race-seo";
import {
  editionTitleKo,
  formEditionPath,
  issueLabel,
  type RaceV1,
} from "@/lib/racing_form-shared";
import { cn } from "@/lib/utils";

import { TAP } from "./format";

/**
 * 경주면 머리 (계획 4.6-1) — "3R · 14:30 · 1200m · 국6 · 12두" + 경주명,
 * "출전표·결과 원본(경기 일람) ›". 라운드 이동은 하단에 떠 있는 EditionPager 가 맡는다.
 */
export function RaceHeader({
  date,
  meet,
  issueNo,
  race,
  startTime,
}: {
  date: string;
  meet: string;
  issueNo: number;
  race: Pick<RaceV1, "race_no" | "race_name" | "distance" | "grade" | "field_size" | "stakes">;
  /** 표시용 "14:30" (덧씌움 → 발행 시점) 또는 null */
  startTime: string | null;
}) {
  const facts = [
    startTime ?? "발주 시각 미정",
    race.distance ? `${race.distance}m` : null,
    race.grade,
    `${race.field_size}두`,
  ].filter((x): x is string => !!x);
  const name = race.stakes?.name ?? race.race_name;
  return (
    <header className="space-y-3">
      <Link
        href={formEditionPath(date, meet)}
        className={cn(
          "inline-flex items-center text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground",
          TAP,
        )}
      >
        ‹ {editionTitleKo(date, meet)} · {issueLabel(issueNo)}
      </Link>
      <div className="space-y-1">
        <h1 className="text-2xl font-extrabold tracking-tight text-balance text-foreground sm:text-3xl">
          <span className="font-mono tabular-nums">{race.race_no}R</span>
          {name ? <span> {name}</span> : null}
        </h1>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-base text-foreground">
          {facts.map((f, i) => (
            <span key={`${i}-${f}`} className="inline-flex items-center gap-2">
              {i > 0 ? (
                <span aria-hidden="true" className="text-muted-foreground">
                  ·
                </span>
              ) : null}
              <span className="font-mono tabular-nums">{f}</span>
            </span>
          ))}
          {race.stakes ? (
            <span className="inline-flex h-7 items-center rounded-md border border-border px-2 text-sm font-semibold text-foreground">
              대상경주{race.stakes.grade ? ` ${race.stakes.grade}` : ""}
            </span>
          ) : null}
        </p>
      </div>
      <Link
        href={raceDetailPath(date, meet, race.race_no)}
        className={cn(
          "inline-flex items-center text-base font-semibold text-foreground underline-offset-4 transition-colors hover:underline",
          TAP,
        )}
      >
        출전표·결과 원본(경기 일람) ›
      </Link>
    </header>
  );
}
