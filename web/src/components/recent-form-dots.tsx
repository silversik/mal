interface RecentFormDotsProps {
  /** 최근 → 과거 순으로 정렬된 착순 배열 (null = 미완주) */
  ranks: (number | null | undefined)[];
  /** 표시할 최근 N경주 (기본 10) */
  count?: number;
}

const RANK_COLOR: Record<string, string> = {
  "1": "bg-yellow-400",
  "2": "bg-zinc-400",
  "3": "bg-amber-700",
};

export function RecentFormDots({ ranks, count = 10 }: RecentFormDotsProps) {
  const recent = ranks.slice(0, count);
  if (recent.length === 0) {
    return <span className="text-xs text-muted-foreground">-</span>;
  }
  const c1 = recent.filter((r) => r === 1).length;
  const c23 = recent.filter((r) => r === 2 || r === 3).length;

  return (
    <div className="flex items-center gap-2">
      <div className="flex gap-1">
        {recent.map((r, i) => {
          const cls = r == null ? "bg-zinc-200" : RANK_COLOR[String(r)] ?? "bg-zinc-300";
          const title =
            r == null
              ? "미완주"
              : `${r}착`;
          return (
            <span
              key={i}
              title={title}
              className={`inline-block h-2.5 w-2.5 rounded-full ${cls}`}
            />
          );
        })}
      </div>
      <span className="text-xs text-muted-foreground tabular-nums">
        최근 {recent.length}경주 · 1착 {c1} · 입상 {c1 + c23}
      </span>
    </div>
  );
}
