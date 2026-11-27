import { FORM_BETA_TEXT, isFormBeta } from "@/lib/racing_form-shared";
import { cn } from "@/lib/utils";

/**
 * 베타 테스트 안내 — 2026년은 경마지 베타 테스트 기간 (소유자 결정 2026-11-26, 제1호부터).
 *  - date(YYYY-MM-DD)가 베타 기간이면 보이고, 아니면 아무것도 그리지 않는다.
 *    호·경주면은 그 호의 경주일(2026년 발행분에는 계속 남는다), 허브·기록은 오늘(KST).
 *  - 라벨은 '주목' 과 같은 중립 테두리 — 갈색·강조색을 쓰지 않는다 (DESIGN.md: 액센트는 1차 액션 전용).
 */
export function BetaNotice({ date, className }: { date: string; className?: string }) {
  if (!isFormBeta(date)) return null;
  return (
    <p
      className={cn(
        "flex flex-wrap items-center gap-x-2 gap-y-1 text-sm leading-relaxed text-foreground",
        className,
      )}
    >
      <span className="inline-flex h-7 shrink-0 items-center rounded-md border border-muted-foreground bg-card px-2 text-sm font-bold text-foreground">
        베타 테스트
      </span>
      <span>{FORM_BETA_TEXT}</span>
    </p>
  );
}

/**
 * 지면 위 줄(드롭다운과 같은 선)에 놓는 베타 뱃지 — 라벨만 보이고 설명은 title·스크린리더로 (2026-11-27).
 * 지면 안의 BetaNotice 문장을 대신한다. 베타 기간이 아니면 그리지 않는다.
 */
export function BetaBadge({ date }: { date: string }) {
  if (!isFormBeta(date)) return null;
  return (
    <span
      title={FORM_BETA_TEXT}
      className="inline-flex h-7 shrink-0 items-center rounded-md border border-muted-foreground bg-card px-2 text-sm font-bold text-foreground"
    >
      베타 테스트
      <span className="sr-only"> — {FORM_BETA_TEXT}</span>
    </span>
  );
}
