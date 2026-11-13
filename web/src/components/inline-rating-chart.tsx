import type { HorseRatingPoint } from "@/lib/horse_ratings";
import { RatingSparkline } from "@/components/rating-sparkline";
import { IconArrowUp, IconArrowDown } from "@/components/profile-ui";

/**
 * 인라인 레이팅 박스 — 큰 숫자 + delta(색+▲▼) + sparkline.
 * Horse profile 카드 우측 슬롯. width 는 최대 폭 — 부모가 좁으면 함께 줄어든다.
 */
export function InlineRatingChart({
  points,
  width = 256,
}: {
  points: HorseRatingPoint[];
  width?: number;
}) {
  const latest = [...points]
    .filter((p) => p.rating4 !== null)
    .sort((a, b) => b.snapshot_date.localeCompare(a.snapshot_date))[0];

  if (!latest) return null;

  // R1 → R4 흐름이므로 delta = R4 - R1 (구간 전체 변동).
  const r1 = latest.rating1 as number | null;
  const r4 = latest.rating4 as number | null;
  const delta = r1 != null && r4 != null ? r4 - r1 : null;

  return (
    <div
      className="w-full rounded-[10px] border border-border bg-card px-4 py-3"
      style={{ maxWidth: width }}
    >
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-small font-semibold text-muted-foreground">
          레이팅 추이 · {points.length}점
        </span>
        <span className="inline-flex items-baseline gap-1.5 font-mono text-base font-extrabold tabular-nums text-primary">
          {r4}
          {delta != null && delta !== 0 && (
            <span
              className={`inline-flex items-center gap-0.5 text-small font-bold ${
                delta > 0 ? "text-positive" : "text-negative"
              }`}
            >
              {delta > 0 ? <IconArrowUp size={11} /> : <IconArrowDown size={11} />}
              {Math.abs(delta)}
            </span>
          )}
        </span>
      </div>
      <RatingSparkline points={points} width={width - 32} height={48} />
    </div>
  );
}
