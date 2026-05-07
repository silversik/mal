"use client";

import Link from "next/link";
import { useState } from "react";
import type { RaceEntry } from "@/lib/races";

type SortKey = "chul" | "rating";

export function EntryCards({ entries }: { entries: RaceEntry[] }) {
  const [sort, setSort] = useState<SortKey>("chul");

  const sorted = [...entries].sort((a, b) => {
    if (sort === "chul") return (a.chul_no ?? 999) - (b.chul_no ?? 999);
    // 레이팅 내림차순
    return (b.hr_rating ?? 0) - (a.hr_rating ?? 0);
  });

  const sortOptions: { key: SortKey; label: string }[] = [
    { key: "chul", label: "출전순" },
    { key: "rating", label: "레이팅순" },
  ];

  return (
    <div>
      {/* 정렬 토글 */}
      <div className="mb-3 flex gap-2">
        {sortOptions.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setSort(key)}
            className={[
              "rounded-full border px-3 py-1.5 text-xs font-semibold transition",
              sort === key
                ? "border-primary bg-primary text-white"
                : "border-border bg-card text-muted-foreground hover:bg-muted",
            ].join(" ")}
          >
            {label}
          </button>
        ))}
      </div>

      {/* 출전마 카드 리스트 */}
      <div className="flex flex-col gap-2">
        {sorted.map((e) => (
          <div
            key={e.chul_no ?? e.horse_no}
            className="grid items-center gap-3 rounded-xl border bg-card p-3 shadow-sm"
            style={{ gridTemplateColumns: "auto 1fr auto" }}
          >
            {/* 출전번호 */}
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted text-sm font-extrabold tabular-nums">
              {e.chul_no ?? "-"}
            </div>

            {/* 마명 + 기수/조교사/마체중 */}
            <div className="min-w-0">
              <Link
                href={`/horse/${e.horse_no}`}
                className="block truncate font-extrabold text-primary"
              >
                {e.horse_name}
              </Link>
              <div className="mt-0.5 flex flex-wrap gap-x-3 text-[11px] text-muted-foreground">
                {e.jockey_name && <span>👤 {e.jockey_name}</span>}
                {e.trainer_name && <span>🎓 {e.trainer_name}</span>}
                {e.weight && <span className="tabular-nums">{e.weight}kg</span>}
              </div>
            </div>

            {/* 레이팅 */}
            <div className="shrink-0 text-right">
              {e.hr_rating != null ? (
                <>
                  <p className="font-mono text-base font-extrabold tabular-nums">
                    {e.hr_rating}
                  </p>
                  <p className="text-[10px] text-muted-foreground">레이팅</p>
                </>
              ) : (
                <span className="text-xs text-muted-foreground">-</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
