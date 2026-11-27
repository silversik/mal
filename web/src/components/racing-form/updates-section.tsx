import type { FormNotice } from "@/lib/racing_form-shared";

import { ErrataList } from "./edition-notices";
import { ChangeList, type StatusChange } from "./status-block";

/**
 * 1면 '업데이트' 섹션 본문 (DESIGN.md Decisions Log 2026-11-27) — "새로운 소식" 아래.
 * 발행본은 고치지 않으므로, 발행 뒤에 달라진 것과 앞으로 달라질 것은 모두 여기에 모은다.
 *  - 수정된 것: 정정 공지 · 발행 후 기수 변경
 *  - 예정: 결과 확정 시각 · 기수 변경 수집 시각 등 (페이지가 문장으로 넘긴다)
 *  - 발행 기준: 성적 반영 기준일 · 출전표 갱신분 (머리에서 옮겨 옴)
 * 머리의 "최종 업데이트" 줄이 이 섹션(#updates)으로 온다.
 */
export function UpdatesSection({
  errata,
  changes,
  scheduled,
  basis,
}: {
  errata: readonly FormNotice[];
  changes: readonly StatusChange[];
  /** 업데이트 예정 — 한 줄씩 */
  scheduled: readonly string[];
  /** 발행 기준 한 줄 (editionBasisText) */
  basis: string;
}) {
  const changed = errata.length > 0 || changes.length > 0;
  return (
    <div className="space-y-4">
      {changed ? (
        <div className="space-y-2">
          <h3 className="text-base font-bold text-foreground">수정된 것</h3>
          <ErrataList errata={errata} />
          <ChangeList changes={changes} />
        </div>
      ) : null}
      {scheduled.length > 0 ? (
        <div className="space-y-1">
          <h3 className="text-base font-bold text-foreground">예정</h3>
          <ul className="list-disc space-y-1 pl-5 text-base leading-relaxed text-foreground">
            {scheduled.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <p className="text-sm leading-relaxed text-muted-foreground">발행 기준 — {basis}</p>
    </div>
  );
}
