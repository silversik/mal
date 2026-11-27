"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";

import { cn } from "@/lib/utils";

const TAP = "min-h-[max(44px,2.75rem)]";
const CHIP =
  "inline-flex min-w-10 shrink-0 items-center justify-center rounded-md px-2 text-base font-bold transition-colors";

/**
 * 호(지면)를 넘기는 하단 플로팅 막대 (DESIGN.md Decisions Log 2026-11-27).
 * "부경 | ‹ [요약] 1R 2R 3R … ›" — 첫 장은 요약(1면), 다음 장부터 라운드(경주면). 지금 장은 brown 채움 +
 * aria-current, 길면 가로 스크롤(지금 장이 보이게 맞춘다). ‹ › 는 앞·뒤 장.
 * 모바일은 하단 탭바(h-16) 바로 위, 데스크톱은 화면 아래 가운데. 지면 레이아웃이 이 높이만큼 아래 여백을 둔다.
 */
export function EditionPager({
  meet,
  summaryHref,
  rounds,
  current,
}: {
  /** 경마장 — 어느 지면인지 (표시만) */
  meet: string;
  /** 첫 장 (요약 · 1면) */
  summaryHref: string;
  /** 그 호의 라운드 — 번호 오름차순 */
  rounds: readonly { raceNo: number; href: string }[];
  current: "summary" | number;
}) {
  const currentRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [current]);

  const pages: { key: "summary" | number; label: string; href: string }[] = [
    { key: "summary", label: "요약", href: summaryHref },
    ...rounds.map((r) => ({ key: r.raceNo, label: `${r.raceNo}R`, href: r.href })),
  ];
  const i = pages.findIndex((p) => p.key === current);
  const prev = i > 0 ? pages[i - 1] : null;
  const next = i >= 0 && i < pages.length - 1 ? pages[i + 1] : null;
  const arrow = cn(CHIP, TAP, "border border-border bg-card text-foreground hover:bg-muted");
  const arrowOff = cn(CHIP, TAP, "border border-border bg-muted text-muted-foreground");

  return (
    <nav
      aria-label="지면 넘기기"
      className="theme-v2 fixed inset-x-0 bottom-16 z-30 border-t border-border bg-background/95 backdrop-blur-md md:inset-x-auto md:bottom-4 md:left-1/2 md:w-[min(92vw,44rem)] md:-translate-x-1/2 md:rounded-xl md:border md:shadow-lg"
    >
      <div className="flex items-center gap-2 px-3 py-1.5">
        <span className="shrink-0 text-base font-bold text-foreground">{meet}</span>
        {prev ? (
          <Link href={prev.href} aria-label={`앞 장 — ${prev.label}`} className={arrow}>
            ‹
          </Link>
        ) : (
          <span aria-hidden="true" className={arrowOff}>
            ‹
          </span>
        )}
        <ol className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto scrollbar-hide">
          {pages.map((p) => (
            <li key={p.key} className="shrink-0">
              {p.key === current ? (
                <span
                  ref={currentRef}
                  aria-current="page"
                  className={cn(
                    CHIP,
                    TAP,
                    "bg-brown text-[var(--brown-fg)]",
                    p.key === "summary" ? "" : "font-mono tabular-nums",
                  )}
                >
                  {p.label}
                </span>
              ) : (
                <Link
                  href={p.href}
                  className={cn(
                    CHIP,
                    TAP,
                    "text-foreground hover:bg-muted",
                    p.key === "summary" ? "" : "font-mono tabular-nums",
                  )}
                >
                  {p.label}
                </Link>
              )}
            </li>
          ))}
        </ol>
        {next ? (
          <Link href={next.href} aria-label={`다음 장 — ${next.label}`} className={arrow}>
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
