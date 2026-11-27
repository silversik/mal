import { cn } from "@/lib/utils";

/**
 * "주목" 표시 — 별 아이콘 (DESIGN.md Decisions Log 2026-11-27, 글자 뱃지 "주목" 을 대신한다).
 * 예상을 낸 기준이 **모두** 고른 말에만 붙인다 (그 밖의 주목마는 표시 없이).
 * ink 단색 채움 — 갈색·강조색을 쓰지 않는다 (액센트는 1차 액션·활성 상태 전용, 색으로 밀면 권유처럼 읽힌다).
 * ◎ 와도 다른 모양이다 (◎ 는 기준 하나의 1순위, 별은 기준 사이의 일치). 이름은 aria-label "주목".
 */
export function FocusLabel({
  size = "md",
  className,
}: {
  /** sm — 주목마 버튼 안에 넣는 작은 별 */
  size?: "md" | "sm";
  className?: string;
}) {
  return (
    <svg
      role="img"
      aria-label="주목"
      viewBox="0 0 24 24"
      fill="currentColor"
      className={cn(
        "inline-block shrink-0 text-foreground",
        size === "sm" ? "h-[1.125rem] w-[1.125rem]" : "h-[1.375rem] w-[1.375rem]",
        className,
      )}
    >
      <path d="M12 2.6l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.4l-5.8 3.1 1.1-6.5L2.6 9.4l6.5-.9L12 2.6z" />
    </svg>
  );
}
