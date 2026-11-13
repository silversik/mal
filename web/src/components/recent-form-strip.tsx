import { medalClass } from "@/components/rank-badge";

/**
 * 최근 N전 착순 mini-strip — netkeiba 의 "近5走" 스타일.
 * 1·2·3착=공용 메달, 4착 이하=중립 칩, null="-".
 * 왼쪽이 오래된 경기, 오른쪽이 최신.
 */
export function RecentFormStrip({
  finishes,
  size = "sm",
}: {
  finishes: (number | null)[];
  size?: "sm" | "md";
}) {
  if (finishes.length === 0) return <span className="text-small text-muted-foreground">기록 없음</span>;

  const cls = size === "md" ? "h-7 w-7 text-sm" : "h-6 w-6 text-small";
  return (
    <div className="inline-flex items-center gap-1" aria-label="최근 착순">
      {finishes.map((r, i) => (
        <RankChip key={i} rank={r} className={cls} />
      ))}
    </div>
  );
}

function RankChip({ rank, className }: { rank: number | null; className: string }) {
  // 1·2·3착은 사이트 공용 메달(형태+색) — components/rank-badge.tsx.
  const style = rank === null ? "bg-muted text-muted-foreground border border-border" : medalClass(rank);

  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-mono font-bold tabular-nums ${style} ${className}`}
      title={rank === null ? "기록 없음" : `${rank}착`}
    >
      {rank === null ? "-" : rank > 9 ? "9+" : rank}
    </span>
  );
}
