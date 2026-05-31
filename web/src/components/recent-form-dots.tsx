interface RecentFormDotsProps {
  /** 최근 → 과거 순으로 정렬된 착순 배열 (null = 미완주) */
  ranks: (number | null | undefined)[];
  /** 표시할 최근 N경주 (기본 10) */
  count?: number;
}

// 1착=accent brown, 2착=muted neutral, 3착=brown-pale, 기타/미완주=hairline.
const RANK_COLOR: Record<string, { bg: string; border?: string }> = {
  "1": { bg: "var(--brown)", border: "var(--brown-deep)" },
  "2": { bg: "var(--muted-ink)" },
  "3": { bg: "var(--brown-pale)", border: "var(--brown-deep)" },
};
const RANK_OTHER: { bg: string; border?: string } = { bg: "var(--hairline)" };
const RANK_MISS: { bg: string; border?: string } = { bg: "var(--hairline)" };

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
          const tok =
            r == null ? RANK_MISS : (RANK_COLOR[String(r)] ?? RANK_OTHER);
          const title = r == null ? "미완주" : `${r}착`;
          return (
            <span
              key={i}
              title={title}
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{
                background: tok.bg,
                border: tok.border ? `1px solid ${tok.border}` : "none",
              }}
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
