"use client";

import { useRouter } from "next/navigation";
import type { HorseAgeBucket, HorseSort } from "@/lib/horses";

const AGE_OPTIONS: { value: HorseAgeBucket; label: string }[] = [
  { value: "under5",  label: "5세 이하" },
  { value: "under10", label: "10세 이하" },
  { value: "over11",  label: "11세 이상" },
];

export function AgeSelect({
  activeAge,
  activeSort,
}: {
  activeAge: HorseAgeBucket;
  activeSort: HorseSort;
}) {
  const router = useRouter();
  return (
    <select
      aria-label="나이 필터"
      value={activeAge}
      onChange={(e) =>
        router.push(`/horses?sort=${activeSort}&age=${e.target.value}`)
      }
      className="h-[34px] rounded-lg border border-primary/10 bg-white px-3 text-sm font-semibold text-slate-grey transition hover:text-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
    >
      {AGE_OPTIONS.map(({ value, label }) => (
        <option key={value} value={value}>
          {label}
        </option>
      ))}
    </select>
  );
}
