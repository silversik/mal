import {
  dateKo,
  dateTimeKo,
  publishStampKo,
  type EditionHead,
} from "@/lib/racing_form-shared";

/**
 * 1면 발행 도장 (2026-11-27 정리) — 제호 아래 오른쪽 정렬.
 *  ① "11월 13일(금) 오후 6시 발행" (+ 늦게 발행이면 표시). "발행 후 고치지 않음" 같은 문구는 싣지 않는다.
 *  ② 발행 뒤 덧붙은 것(정정·기수 변경…)이 있으면 "최종 업데이트 11월 14일(토) 09:40" — 아래 '업데이트' 섹션으로.
 * 시각은 실제 발행 시각(published_at) — 초는 버린다.
 */
export function EditionStamp({
  head,
  late,
  updatedAt = null,
  updatesHref = "#updates",
}: {
  head: Pick<EditionHead, "published_at" | "freeze_at">;
  late: boolean;
  /** lastUpdatedAt() — 없으면 둘째 줄을 그리지 않는다 */
  updatedAt?: string | null;
  updatesHref?: string;
}) {
  return (
    <div className="space-y-0.5 text-right text-sm leading-relaxed text-muted-foreground">
      <p>
        <span className="font-semibold text-foreground">{publishStampKo(head.published_at)} 발행</span>
        {late ? (
          <>
            {" · "}
            <span className="font-semibold text-foreground">늦게 발행</span>
            {` (예정 ${publishStampKo(head.freeze_at)})`}
          </>
        ) : null}
      </p>
      {updatedAt ? (
        <p>
          <a href={updatesHref} className="underline underline-offset-4 hover:text-foreground">
            최종 업데이트 {dateTimeKo(updatedAt)}
          </a>
        </p>
      ) : null}
    </div>
  );
}

/** "성적 반영 11월 8일(일) 경주까지 · 출전표 11월 13일(금) 15:00 갱신분" — 발행 기준 (업데이트 섹션 맨 아래). */
export function editionBasisText(
  head: Pick<EditionHead, "results_through" | "entries_batch_at">,
): string {
  return [
    head.results_through
      ? `성적 반영 ${dateKo(head.results_through)} 경주까지`
      : "성적 반영 — 반영할 지난 경주 기록이 없습니다",
    head.entries_batch_at ? `출전표 ${dateTimeKo(head.entries_batch_at)} 갱신분` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}
