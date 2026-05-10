/**
 * 최근 N전 착순 mini-strip — netkeiba 의 "近5走" 스타일.
 * 1착=금, 2-3착=실버/브론즈, 4-5착=흐림, 6+=회색, null="-".
 * 왼쪽이 오래된 경기, 오른쪽이 최신.
 */
export function RecentFormStrip({
  finishes,
  size = "sm",
}: {
  finishes: (number | null)[];
  size?: "sm" | "md";
}) {
  if (finishes.length === 0) return <span className="text-muted-foreground text-xs">기록 없음</span>;

  const cls = size === "md" ? "h-7 w-7 text-sm" : "h-5 w-5 text-[10px]";
  return (
    <div className="inline-flex items-center gap-1" aria-label="최근 착순">
      {finishes.map((r, i) => (
        <RankChip key={i} rank={r} className={cls} />
      ))}
    </div>
  );
}

function RankChip({ rank, className }: { rank: number | null; className: string }) {
  const style =
    rank === null
      ? "bg-muted text-muted-foreground"
      : rank === 1
        ? "bg-champagne-gold text-primary"
        : rank === 2
          ? "bg-slate-300 text-slate-900"
          : rank === 3
            ? "bg-amber-700 text-white"
            : rank <= 5
              ? "bg-slate-100 text-slate-700"
              : "bg-slate-200 text-slate-500";

  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded font-mono font-bold tabular-nums ${style} ${className}`}
      title={rank === null ? "기록 없음" : `${rank}착`}
    >
      {rank === null ? "-" : rank > 9 ? "9+" : rank}
    </span>
  );
}
