"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";

import { cn } from "@/lib/utils";

const TAP = "min-h-[max(44px,2.75rem)]";
const CHIP =
  "inline-flex min-w-10 shrink-0 items-center justify-center rounded-md px-2 font-mono text-base font-bold tabular-nums transition-colors";

/**
 * 경주면 하단에 떠 있는 라운드 이동 막대 (DESIGN.md Decisions Log 2026-11-27).
 * "부경 | ‹ 1R 2R [3R] 4R … ›" — 경마장(1면으로)과 그 호의 전체 라운드를 한 줄에. 지금 라운드는
 * brown 채움 + aria-current, 길면 가로 스크롤(지금 라운드가 보이게 맞춘다).
 * 모바일은 하단 탭바(h-16) 바로 위, 데스크톱은 화면 아래 가운데. 페이지는 이 높이만큼 아래 여백을 둔다.
 */
export function RaceRoundsBar({
  meet,
  editionHref,
  rounds,
  current,
}: {
  meet: string;
  /** 1면 (목록) */
  editionHref: string;
  /** 그 호의 라운드 — 번호 오름차순 */
  rounds: readonly { raceNo: number; href: string }[];
  current: number;
}) {
  const currentRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [current]);

  const i = rounds.findIndex((r) => r.raceNo === current);
  const prev = i > 0 ? rounds[i - 1] : null;
  const next = i >= 0 && i < rounds.length - 1 ? rounds[i + 1] : null;
  const arrow = cn(CHIP, TAP, "border border-border bg-card text-foreground hover:bg-muted");
  const arrowOff = cn(CHIP, TAP, "border border-border bg-muted text-muted-foreground");

  return (
    <nav
      aria-label="경주 이동"
      className="theme-v2 fixed inset-x-0 bottom-16 z-30 border-t border-border bg-background/95 backdrop-blur-md md:inset-x-auto md:bottom-4 md:left-1/2 md:w-[min(92vw,44rem)] md:-translate-x-1/2 md:rounded-xl md:border md:shadow-lg"
    >
      <div className="flex items-center gap-2 px-3 py-1.5">
        <Link
          href={editionHref}
          className={cn(
            "inline-flex shrink-0 items-center rounded-md border border-border bg-card px-3 text-base font-bold text-foreground transition-colors hover:bg-muted",
            TAP,
          )}
        >
          {meet}
          <span className="sr-only"> 경마지 1면으로</span>
        </Link>
        {prev ? (
          <Link href={prev.href} aria-label={`이전 경주 ${prev.raceNo}R`} className={arrow}>
            ‹
          </Link>
        ) : (
          <span aria-hidden="true" className={arrowOff}>
            ‹
          </span>
        )}
        <ol className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto scrollbar-hide">
          {rounds.map((r) =>
            r.raceNo === current ? (
              <li key={r.raceNo} className="shrink-0">
                <span
                  ref={currentRef}
                  aria-current="page"
                  className={cn(CHIP, TAP, "bg-brown text-[var(--brown-fg)]")}
                >
                  {r.raceNo}R
                </span>
              </li>
            ) : (
              <li key={r.raceNo} className="shrink-0">
                <Link href={r.href} className={cn(CHIP, TAP, "text-foreground hover:bg-muted")}>
                  {r.raceNo}R
                </Link>
              </li>
            ),
          )}
        </ol>
        {next ? (
          <Link href={next.href} aria-label={`다음 경주 ${next.raceNo}R`} className={arrow}>
            ›
          </Link>
        ) : (
          <span aria-hidden="true" className={arrowOff}>
            ›
          </span>
        )}
      </div>
    </nav>
  );
}
