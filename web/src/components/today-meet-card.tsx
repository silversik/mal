"use client";

import { useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { VenueIcon } from "@/components/venue-icon";
import { WinRateBar } from "@/components/win-rate-bar";
import type { RaceInfo, RaceCardEntry } from "@/lib/races";

interface TodayMeetCardProps {
  meet: string;
  date: string;
  races: RaceInfo[];
  byRace: Record<string, RaceCardEntry[]>;
  phase: "pre" | "post";
}

export function TodayMeetCard({ meet, date, races, byRace, phase }: TodayMeetCardProps) {
  const [expandedRace, setExpandedRace] = useState<number | null>(
    // Auto-expand first race that has entries.
    races.find((r) => (byRace[String(r.race_no)]?.length ?? 0) > 0)?.race_no ?? null,
  );

  function toggle(raceNo: number) {
    setExpandedRace((prev) => (prev === raceNo ? null : raceNo));
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
              : "border-champagne-gold/40 bg-champagne-gold/10 text-champagne-gold"
          }`}
        >
          {phase === "post" ? "결과" : "출전표"}
        </Badge>
      </div>

      {/* Race accordion rows */}
      <div className="divide-y divide-primary/5">
        {races.map((race) => {
          const entries = byRace[String(race.race_no)] ?? [];
          const isExpanded = expandedRace === race.race_no;
          const href = `/races?date=${date}&venue=${encodeURIComponent(meet)}&race=${race.race_no}`;

          return (
            <div key={race.race_no}>
              {/* Race header — clickable toggle */}
              <button
                type="button"
                onClick={() => toggle(race.race_no)}
                className="flex w-full items-center gap-2 px-4 py-2.5 text-left transition-colors hover:bg-muted/30"
              >
                <Link
                  href={href}
                  onClick={(e) => e.stopPropagation()}
                  className="flex h-6 w-9 shrink-0 items-center justify-center rounded bg-primary/10 text-[11px] font-bold text-primary tabular-nums hover:bg-primary/20"
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
                  {entries.length > 0 && (
                    <span className="text-[11px] text-muted-foreground">
                      {entries.length}두
                    </span>
                  )}
                  {/* Chevron */}
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className={`text-muted-foreground/60 transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`}
                    aria-hidden="true"
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </div>
              </button>

              {/* Expandable entry table */}
              {isExpanded && (
                <div className="px-4 pb-3">
                  {entries.length === 0 ? (
                    <p className="text-xs text-muted-foreground">출전 정보 없음</p>
                  ) : (
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                          <th className="w-6 pb-1 text-center">#</th>
                          <th className="pb-1 pl-1.5 text-left">마명</th>
                          <th className="pb-1 pl-1 text-left">기수</th>
                          <th className="pb-1 pl-1 text-right">단승률</th>
                        </tr>
                      </thead>
                      <tbody>
                        {entries.map((e, i) => (
                          <tr key={i} className={i % 2 === 0 ? "" : "bg-muted/30"}>
                            <td className="w-6 py-0.5 text-center font-mono font-bold tabular-nums text-muted-foreground">
                              {phase === "post"
                                ? e.rank != null
                                  ? e.rank <= 3
                                    ? <span className={e.rank === 1 ? "text-primary font-bold" : ""}>{e.rank}</span>
                                    : <span>{e.rank}</span>
                                  : "-"
                                : (e.chul_no ?? "-")}
                            </td>
                            <td className="py-0.5 pl-1.5 font-medium">
                              <Link
                                href={`/horse/${e.horse_no}`}
                                className="hover:text-primary hover:underline"
                              >
                                {e.horse_name}
                              </Link>
                            </td>
                            <td className="py-0.5 pl-1 text-muted-foreground">
                              {e.jockey_name ?? "-"}
                            </td>
                            <td className="py-0.5 pl-1">
                              <WinRateBar rate={e.win_rate} layout="inline" height={2} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
