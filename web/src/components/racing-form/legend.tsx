import { MARK_LABEL, type Mark } from "@/lib/racing_form-shared";
import { cn } from "@/lib/utils";

import { PickMark } from "./pick-mark";

const MARKS: readonly Mark[] = [1, 2, 3];

/**
 * 기호 범례 "◎ 1순위 ○ 2순위 △ 3순위" — 화면에 ◎ 가 처음 나오기 전에, 항상 보이게 둔다
 * (계획 4.5-3 · 4.6-4). 기호는 그림, 뜻은 글자로 함께 쓴다.
 */
export function PickLegend({ className }: { className?: string }) {
  return (
    <p
      className={cn(
        "flex flex-wrap items-center gap-x-4 gap-y-1 text-base text-foreground",
        className,
      )}
    >
      <span className="sr-only">기호 뜻:</span>
      {MARKS.map((m) => (
        <span key={m} className="inline-flex items-center gap-1.5">
          <PickMark mark={m} decorative />
          <span>{MARK_LABEL[m]}</span>
        </span>
      ))}
      <span className="text-sm text-muted-foreground">— 기준 하나가 고른 순위</span>
    </p>
  );
}
