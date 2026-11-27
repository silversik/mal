import { cn } from "@/lib/utils";

/**
 * "주목" 뱃지 — 중립 테두리 (DESIGN.md Decisions Log 2026-11-13). 갈색·강조색·◎ 를 쓰지 않는다
 * (◎ 는 기준 하나의 1순위, 주목마는 기준 사이의 일치라 다른 개념).
 * 2026-11-27 부터: 1면·팝업에서는 예상을 낸 기준이 **모두** 고른 말에만 붙인다 (그 밖의 주목마는 뱃지 없이).
 */
export function FocusLabel({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-7 shrink-0 items-center rounded-md border border-muted-foreground bg-card px-2 text-sm font-bold text-foreground",
        className,
      )}
    >
      주목
    </span>
  );
}
