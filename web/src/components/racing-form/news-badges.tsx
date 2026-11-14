import type { BadgeV1 } from "@/lib/racing_form-shared";
import { cn } from "@/lib/utils";

import { TAP } from "./format";
import { SUMMARY_RESET } from "./rule-list";

/** 말 배지 앞쪽 몇 개를 바로 보여 줄지 (계획 6.2 — 최대 3 + <details>). */
export const BADGES_SHOWN = 3;

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

/** payload 배지(우선순위 순 전체) → 앞 3개 + "소식 n개 더" <details>. 없으면 그리지 않는다. */
export function NewsBadges({ badges }: { badges: readonly BadgeV1[] }) {
  if (badges.length === 0) return null;
  const shown = badges.slice(0, BADGES_SHOWN);
  const rest = badges.slice(BADGES_SHOWN);
  return (
    <div className="space-y-1">
      <ul className="flex flex-wrap gap-1.5" aria-label="말 소식">
        {shown.map((b, i) => (
          <li key={`${i}-${b.kind}`}>
            <NewsBadge badge={b} />
          </li>
        ))}
      </ul>
      {rest.length > 0 ? (
        <details className="group">
          <summary
            className={cn(
              SUMMARY_RESET,
              "inline-flex items-center gap-1 rounded-md text-sm font-semibold text-foreground",
              TAP,
            )}
          >
            소식 {rest.length}개 더 보기
            <span aria-hidden="true" className="inline-block transition-transform group-open:rotate-90">
              ›
            </span>
          </summary>
          <ul className="flex flex-wrap gap-1.5 pb-1">
            {rest.map((b, i) => (
              <li key={`${i}-${b.kind}`}>
                <NewsBadge badge={b} />
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
