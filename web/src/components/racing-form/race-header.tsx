import Link from "next/link";

import { raceDetailPath } from "@/lib/race-seo";
import {
  editionTitleKo,
  formEditionPath,
  formRacePath,
  issueLabel,
  type RaceV1,
} from "@/lib/racing_form-shared";
import { cn } from "@/lib/utils";

import { TAP } from "./format";

const NAV_BTN =
  "inline-flex items-center justify-center rounded-md border px-3 text-base font-semibold transition-colors";

/** "‹ 이전 · 목록 · 다음 ›" — 경주면 위·아래에 같은 모양으로 둔다 (44px). */
export function RaceNav({
  date,
  meet,
  raceNo,
  raceNos,
}: {
  date: string;
  meet: string;
  raceNo: number;
  /** 그 호의 경주 번호 (payload 순서) */
  raceNos: readonly number[];
}) {
  const sorted = [...raceNos].sort((a, b) => a - b);
  const i = sorted.indexOf(raceNo);
  const prev = i > 0 ? sorted[i - 1] : null;
  const next = i >= 0 && i < sorted.length - 1 ? sorted[i + 1] : null;
  return (
    <nav aria-label="경주 이동" className="grid grid-cols-3 gap-2">
      {prev !== null ? (
        <Link
          href={formRacePath(date, meet, prev)}
          className={cn(NAV_BTN, TAP, "border-border bg-card text-foreground hover:bg-muted")}
        >
          ‹ <span className="ml-1 font-mono tabular-nums">{prev}R</span>
          <span className="sr-only"> 이전 경주</span>
        </Link>
      ) : (
        <span
          aria-disabled="true"
          className={cn(NAV_BTN, TAP, "border-border bg-muted text-muted-foreground")}
        >
          처음
        </span>
      )}
      <Link
        href={formEditionPath(date, meet)}
        className={cn(NAV_BTN, TAP, "border-border bg-card text-foreground hover:bg-muted")}
      >
        목록
      </Link>
      {next !== null ? (
        <Link
          href={formRacePath(date, meet, next)}
          className={cn(NAV_BTN, TAP, "border-border bg-card text-foreground hover:bg-muted")}
        >
          <span className="mr-1 font-mono tabular-nums">{next}R</span> ›
          <span className="sr-only"> 다음 경주</span>
        </Link>
      ) : (
        <span
          aria-disabled="true"
          className={cn(NAV_BTN, TAP, "border-border bg-muted text-muted-foreground")}
        >
          마지막
        </span>
      )}
    </nav>
  );
}

/**
 * 경주면 머리 (계획 4.6-1) — "3R · 14:30 · 1200m · 국6 · 12두" + 경주명,
 * 이전·목록·다음, "출전표·결과 원본(경기 일람) ›".
 */
export function RaceHeader({
  date,
  meet,
  issueNo,
  race,
  startTime,
  raceNos,
}: {
  date: string;
  meet: string;
  issueNo: number;
  race: Pick<RaceV1, "race_no" | "race_name" | "distance" | "grade" | "field_size" | "stakes">;
  /** 표시용 "14:30" (덧씌움 → 발행 시점) 또는 null */
  startTime: string | null;
  raceNos: readonly number[];
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
      <RaceNav date={date} meet={meet} raceNo={race.race_no} raceNos={raceNos} />
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
