import { cn } from "@/lib/utils";

/**
 * 경마지 출전번호 — 색 없는 중립 칩 (DESIGN.md Decisions Log 2026-11-27).
 * 경마지에서는 게이트 색(GateNum)을 쓰지 않는다 — 한 화면에 색이 너무 많아 주목마·결과가 묻힌다.
 * 글씨는 하한 13px(0.8125rem — `text-small` 은 cn/tailwind-merge 가 색 클래스로 보고 `text-foreground`
 * 와 합치며 지워서 rem 리터럴로 쓴다), 칩은 rem 이라 글씨 크기 축과 함께 커진다.
 */
export function FormNum({
  n,
  plain = false,
  className,
}: {
  n: number;
  /** 테두리·배경 없이 숫자만 — 이미 테두리가 있는 버튼 안에서 (테두리가 겹치지 않게) */
  plain?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center font-mono text-[0.8125rem] font-bold tabular-nums text-foreground",
        plain ? "min-w-4" : "h-6 min-w-6 rounded-md border border-border bg-card px-1",
        className,
      )}
    >
      {n}
    </span>
  );
}
