import {
  dateKo,
  dateTimeKo,
  publishStampKo,
  type EditionHead,
} from "@/lib/racing_form-shared";

/**
 * 1면 발행 도장 두 줄 (계획 4.5-1).
 *  ① "11월 13일(금) 오후 6시 발행 · 발행 후 고치지 않음" (+ 늦게 발행이면 표시)
 *  ② "성적 반영 11월 8일(일) 경주까지 (전날 경주는 정정 전이라 제외) · 출전표 11월 13일(금) 15:00 갱신분"
 * 시각은 실제 발행 시각(published_at) — 초는 버린다.
 */
export function EditionStamp({
  head,
  late,
}: {
  head: Pick<EditionHead, "published_at" | "freeze_at" | "results_through" | "entries_batch_at">;
  late: boolean;
}) {
  return (
    <div className="space-y-1 text-sm leading-relaxed text-muted-foreground">
      <p>
        <span className="font-semibold text-foreground">{publishStampKo(head.published_at)} 발행</span>
        {late ? (
          <>
            {" · "}
            <span className="font-semibold text-foreground">늦게 발행</span>
            {` (예정 ${publishStampKo(head.freeze_at)})`}
          </>
        ) : null}
        {" · 발행 후 고치지 않음"}
      </p>
      <p>
        {head.results_through
          ? `성적 반영 ${dateKo(head.results_through)} 경주까지`
          : "성적 반영 — 반영할 지난 경주 기록이 없습니다"}
        {" (전날 경주는 정정 전이라 제외)"}
        {head.entries_batch_at ? ` · 출전표 ${dateTimeKo(head.entries_batch_at)} 갱신분` : null}
      </p>
    </div>
  );
}
