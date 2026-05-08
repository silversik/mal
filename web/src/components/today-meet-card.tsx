"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { VenueIcon } from "@/components/venue-icon";
import type { RaceInfo, RaceCardEntry } from "@/lib/races";

interface TodayMeetCardProps {
  meet: string;
  date: string;
  races: RaceInfo[];
  byRace: Record<string, RaceCardEntry[]>;
  phase: "pre" | "post";
}

export function TodayMeetCard({ meet, date, races, byRace, phase }: TodayMeetCardProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [activeIdx, setActiveIdx] = useState(0);

  // 첫 entries 가 들어있는 경주로 시작 정렬 (이전 accordion 의 default expand 와 동일 동작).
  useLayoutEffect(() => {
    const startIdx = races.findIndex(
      (r) => (byRace[String(r.race_no)]?.length ?? 0) > 0,
    );
    if (startIdx > 0 && scrollerRef.current) {
      scrollerRef.current.scrollLeft = startIdx * scrollerRef.current.clientWidth;
      setActiveIdx(startIdx);
    }
  }, [races, byRace]);

  // 스크롤 위치 → activeIdx 동기화 (좌우 swipe / arrow / dot 모두 한 곳에서 갱신)
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (!el.clientWidth) return;
        setActiveIdx(Math.round(el.scrollLeft / el.clientWidth));
      });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);

  function scrollToIdx(i: number) {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTo({ left: i * el.clientWidth, behavior: "smooth" });
  }

  return (
    <div className="royal-card overflow-hidden">
      {/* Card header */}
      <div className="flex items-center justify-between border-b border-primary/10 bg-primary/5 px-5 py-3">
        <div className="flex items-center gap-2">
          <VenueIcon meet={meet} size={16} />
          <span className="text-sm font-semibold">{meet}</span>
          <span className="text-xs text-slate-grey">{races.length}경주</span>
        </div>
        <Badge
          variant="outline"
          className={`border text-[11px] ${
            phase === "post"
              ? "border-primary/20 bg-muted text-slate-grey"
              : "border-champagne-gold/40 bg-champagne-gold/10 text-gold-ink"
          }`}
        >
          {phase === "post" ? "결과" : "출전표"}
        </Badge>
      </div>

      {/* Horizontal swipe carousel — 라운드별 모두 펼침, 좌우 슬라이드 */}
      <div className="relative">
        <NavArrow
          direction="prev"
          disabled={activeIdx <= 0}
          onClick={() => scrollToIdx(Math.max(0, activeIdx - 1))}
        />
        <NavArrow
          direction="next"
          disabled={activeIdx >= races.length - 1}
          onClick={() => scrollToIdx(Math.min(races.length - 1, activeIdx + 1))}
        />

        <div
          ref={scrollerRef}
          className="flex snap-x snap-mandatory overflow-x-auto scrollbar-hide"
          style={{ scrollBehavior: "smooth" }}
        >
          {races.map((race) => {
            const entries = byRace[String(race.race_no)] ?? [];
            const href = `/races?date=${date}&venue=${encodeURIComponent(meet)}&race=${race.race_no}`;
            return (
              <RaceTile
                key={race.race_no}
                race={race}
                entries={entries}
                href={href}
                phase={phase}
              />
            );
          })}
        </div>
      </div>

      {/* Pagination dots */}
      {races.length > 1 && (
        <div
          className="flex justify-center gap-1.5 border-t border-primary/5 py-2.5"
          role="tablist"
          aria-label={`${meet} 라운드 선택`}
        >
          {races.map((r, i) => {
            const active = i === activeIdx;
            return (
              <button
                key={r.race_no}
                type="button"
                role="tab"
                aria-selected={active}
                aria-label={`${r.race_no}R 로 이동`}
                onClick={() => scrollToIdx(i)}
                className={`h-1.5 rounded-full transition-all ${
                  active ? "w-5 bg-primary" : "w-1.5 bg-primary/20 hover:bg-primary/40"
                }`}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ── 단일 라운드 타일 ────────────────────────────────────── */

function RaceTile({
  race,
  entries,
  href,
  phase,
}: {
  race: RaceInfo;
  entries: RaceCardEntry[];
  href: string;
  phase: "pre" | "post";
}) {
  return (
    <div className="flex w-full shrink-0 snap-start flex-col">
      {/* Race header */}
      <div className="flex items-center gap-2 border-b border-primary/5 bg-muted/20 px-4 py-2.5">
        <Link
          href={href}
          className="flex h-7 w-11 shrink-0 items-center justify-center rounded bg-primary/10 text-xs font-bold text-primary tabular-nums hover:bg-primary/20"
        >
          {race.race_no}R
        </Link>
        {race.race_name && (
          <span className="min-w-0 flex-1 truncate text-xs font-medium text-muted-foreground">
            {race.race_name}
          </span>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {race.distance && (
            <span className="font-mono text-[11px] text-muted-foreground">
              {race.distance}m
            </span>
          )}
          <span className="text-[11px] text-muted-foreground">{entries.length}두</span>
        </div>
      </div>

      {/* Entry table */}
      {entries.length === 0 ? (
        <p className="px-4 py-6 text-center text-xs text-muted-foreground">출전 정보 없음</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-primary/5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
              <th className="w-14 px-3 py-2.5 text-center">{phase === "post" ? "착순" : "#"}</th>
              <th className="px-3 py-2.5 text-center">마명</th>
              <th className="px-3 py-2.5 text-center">기수</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e, i) => (
              <tr
                key={i}
                className={i % 2 === 0 ? "" : "bg-muted/30"}
              >
                <td className="px-3 py-2 text-center font-mono font-bold tabular-nums text-muted-foreground">
                  {phase === "post"
                    ? e.rank != null
                      ? e.rank <= 3
                        ? (
                          <span className={e.rank === 1 ? "font-bold text-primary" : ""}>
                            {e.rank}
                          </span>
                        )
                        : <span>{e.rank}</span>
                      : "-"
                    : (e.chul_no ?? "-")}
                </td>
                <td className="px-3 py-2 text-center font-medium">
                  <Link
                    href={`/horse/${e.horse_no}`}
                    className="hover:text-primary hover:underline"
                  >
                    {e.horse_name}
                  </Link>
                </td>
                <td className="px-3 py-2 text-center text-muted-foreground">
                  {e.jockey_name ?? "-"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/* ── 좌우 화살표 (데스크탑 hover 시 노출) ─────────────────── */

function NavArrow({
  direction,
  disabled,
  onClick,
}: {
  direction: "prev" | "next";
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={direction === "prev" ? "이전 경주" : "다음 경주"}
      className={`absolute top-1/2 z-10 hidden h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-primary shadow-md ring-1 ring-primary/10 backdrop-blur-sm transition-opacity hover:bg-white disabled:cursor-not-allowed disabled:opacity-30 sm:flex ${
        direction === "prev" ? "left-2" : "right-2"
      }`}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {direction === "prev" ? (
          <polyline points="15 18 9 12 15 6" />
        ) : (
          <polyline points="9 18 15 12 9 6" />
        )}
      </svg>
    </button>
  );
}
