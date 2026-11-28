import { cn } from "@/lib/utils";

/**
 * "주목" 표시 — 별 아이콘 (DESIGN.md Decisions Log 2026-11-27, 글자 뱃지 "주목" 을 대신한다).
 * 예상을 낸 기준이 **모두** 고른 말에만 붙인다 (그 밖의 주목마는 표시 없이).
 * 금색(`--star`, 별 전용 토큰) 채움 — 2026-11-28 소유자 결정으로 ink 단색에서 바꿈. brown 액센트(1차 액션·1착 메달)와
 * 겹치지 않게 별도 색이고, 글자에는 쓰지 않는다. 이름 바로 옆에 붙도록 왼쪽 여백을 4px 당긴다(-ml-1).
 * ◎ 와도 다른 모양이다 (◎ 는 기준 하나의 1순위, 별은 기준 사이의 일치). 이름은 aria-label "주목".
 */
export function FocusLabel({
  size = "md",
  tip,
  decorative = false,
  className,
}: {
  /** sm — 주목마 버튼 안에 넣는 작은 별 */
  size?: "md" | "sm";
  /** 마우스를 올리면 뜨는 설명 (SVG <title>) — "고른 기준 3개" */
  tip?: string;
  /** 바깥 버튼이 이름을 갖고 있을 때 — 스크린리더에서 숨긴다 */
  decorative?: boolean;
  className?: string;
}) {
  return (
    <svg
      {...(decorative
        ? { "aria-hidden": true }
        : { role: "img", "aria-label": tip ? `주목 — ${tip}` : "주목" })}
      viewBox="0 0 24 24"
      fill="currentColor"
      className={cn(
        "-ml-1 inline-block shrink-0 text-star",
        size === "sm" ? "h-[1.125rem] w-[1.125rem]" : "h-[1.375rem] w-[1.375rem]",
        className,
      )}
    >
      {tip && !decorative ? <title>{tip}</title> : null}
      <path d="M12 2.6l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.4l-5.8 3.1 1.1-6.5L2.6 9.4l6.5-.9L12 2.6z" />
    </svg>
  );
}
