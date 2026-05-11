import type { HorseRatingPoint } from "@/lib/horse_ratings";
import { RatingSparkline } from "@/components/rating-sparkline";
import { IconArrowUp, IconArrowDown } from "@/components/profile-ui";

/**
 * 디자인 시안의 우측 인라인 레이팅 박스 — gold-tinted bg + 큰 숫자 + delta + sparkline.
 * Horse profile 카드의 우측 280px 슬롯에 들어간다.
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
      className="rounded-[10px] border bg-[linear-gradient(180deg,rgba(252,223,104,0.25),rgba(252,223,104,0.06))] px-3.5 py-2.5"
      style={{ borderColor: "rgba(251, 212, 54, 0.55)", width }}
    >
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-gold-ink)]">
          레이팅 추이 · {points.length}점
        </span>
        <span className="inline-flex items-baseline gap-1.5 font-mono text-base font-extrabold tabular-nums text-primary">
          {r4}
          {delta != null && delta !== 0 && (
            <span
              className={`inline-flex items-center gap-0.5 text-[11px] font-bold ${
                delta > 0 ? "text-emerald-700" : "text-destructive"
              }`}
            >
              {delta > 0 ? <IconArrowUp size={11} /> : <IconArrowDown size={11} />}
              {Math.abs(delta)}
            </span>
          )}
        </span>
      </div>
      <RatingSparkline points={points} width={width - 16} height={48} />
    </div>
  );
}
