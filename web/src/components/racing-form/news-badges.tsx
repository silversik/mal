import type { BadgeV1 } from "@/lib/racing_form-shared";
import { cn } from "@/lib/utils";

/**
 * 말 소식 배지 한 개. 레이팅 증감(rating_change)만 색 + 부호(▲▼, 문장에 들어 있음)를 함께 쓴다
 * (DESIGN 색맹 대비 — 색만으로 구분하지 않는다). 그 밖은 중립.
 */
export function NewsBadge({ badge }: { badge: BadgeV1 }) {
  const sign = badge.kind === "rating_change" && badge.delta !== undefined ? Math.sign(badge.delta) : 0;
  const tone = sign > 0 ? "text-positive" : sign < 0 ? "text-negative" : "text-foreground";
  return (
    <span
      className={cn(
        "inline-flex min-h-7 items-center rounded-md border border-border bg-muted px-2 py-0.5 text-sm leading-snug",
        tone,
      )}
    >
      {badge.text}
    </span>
  );
}

/**
 * payload 배지(우선순위 순 전체)를 모두 펼쳐 보인다. 없으면 그리지 않는다.
 * (2026-11-28 — 카드를 펼친 뒤 "소식 n개 더 보기" 를 또 누르게 하지 않는다.)
 */
export function NewsBadges({ badges }: { badges: readonly BadgeV1[] }) {
  if (badges.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="말 소식">
      {badges.map((b, i) => (
        <li key={`${i}-${b.kind}`}>
          <NewsBadge badge={b} />
        </li>
      ))}
    </ul>
  );
}
