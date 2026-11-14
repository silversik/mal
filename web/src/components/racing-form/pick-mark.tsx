import { MARK_LABEL, type Mark } from "@/lib/racing_form-shared";
import { cn } from "@/lib/utils";

/**
 * 경마지 예상 기호 — 인라인 SVG 하나로 그린다 (DESIGN.md Decisions Log 2026-11-13 "PickMark").
 *  1 = ◎ 이중원 · 2 = ○ 원 · 3 = △ 빈 삼각형 (▲ 는 증감 부호 전용이라 쓰지 않는다).
 * - 글꼴마다 기호 모양·크기가 달라 글리프에 기대지 않는다. ink 단색(currentColor), 채움 없음.
 * - 크기 1.125em — 글씨 축([data-scale])과 함께 커진다. RankBadge 같은 원형 칩(결과 메달)이 아니다.
 * - 기본은 의미 있는 그림(role="img" + "1순위"). 옆에 "1순위" 글자가 이미 있으면 decorative 로 숨긴다.
 */
export function PickMark({
  mark,
  decorative = false,
  className,
}: {
  mark: Mark;
  /** 바로 옆에 같은 뜻의 글자가 있을 때 (범례 등) — 스크린리더 중복 낭독 방지 */
  decorative?: boolean;
  className?: string;
}) {
  const a11y = decorative
    ? ({ "aria-hidden": true } as const)
    : ({ role: "img", "aria-label": MARK_LABEL[mark] } as const);
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      focusable="false"
      className={cn(
        "inline-block h-[1.125em] w-[1.125em] shrink-0 align-[-0.2em] text-foreground",
        className,
      )}
      {...a11y}
    >
      {mark === 1 && (
        <>
          <circle cx="10" cy="10" r="8" />
          <circle cx="10" cy="10" r="4.1" />
        </>
      )}
      {mark === 2 && <circle cx="10" cy="10" r="8" />}
      {mark === 3 && <path d="M10 2.4 18.4 17.4H1.6Z" strokeLinejoin="round" />}
    </svg>
  );
}
