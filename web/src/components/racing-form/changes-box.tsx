import { GateNum } from "@/components/race-detail-ui";
import { publishStampKo, type FormNotice, type JockeyDiff } from "@/lib/racing_form-shared";

import { changeText, JOCKEY_CHANGE_SOURCE_NOTE } from "./status-block";

/**
 * 경주면 "이 경주의 발행 후 변경" 상자 (계획 4.6-3 · 4.7) — 덧씌움만, 고정본은 그대로.
 *  - 발행 후 기수 변경: payload 기수 vs 지금 실제 기수 (내용 비교)
 *  - 그 호의 정정 공지
 *  - 없으면 "발행 후 바뀐 것 없음" (변경이 없다는 것도 알린다)
 * "출전표에서 빠짐" 은 SHOW_SCRATCH_HINT 가 꺼져 있어 싣지 않는다 (감사 통과 전).
 */
export function ChangesBox({
  diffs,
  errata,
  horseName,
}: {
  /** 이 경주의 발행 후 기수 변경 */
  diffs: readonly JockeyDiff[];
  errata: readonly FormNotice[];
  horseName: (horseNo: string) => string;
}) {
  const none = diffs.length === 0 && errata.length === 0;
  return (
    <section
      aria-labelledby="changes-title"
      className="rounded-xl border border-border bg-card px-4 py-3"
    >
      <h2 id="changes-title" className="text-base font-bold text-foreground">
        이 경주의 발행 후 변경
      </h2>
      {none ? (
        <p className="mt-1 text-base text-foreground">발행 후 바뀐 것 없음</p>
      ) : (
        <ul className="mt-1 space-y-2">
          {diffs.map((d) => (
            <li
              key={`jc-${d.horse_no}`}
              className="flex flex-wrap items-center gap-x-2 gap-y-1 text-base text-foreground"
            >
              <span aria-hidden="true">※</span>
              <span>발행 후 기수 변경</span>
              <GateNum n={d.chul_no} size={22} />
              <span className="sr-only">번</span>
              <span className="font-semibold">{horseName(d.horse_no)}</span>
              <span>{changeText(d)}</span>
            </li>
          ))}
          {errata.map((n) => (
            <li key={`n-${n.id}`} className="text-base leading-relaxed text-foreground">
              <span className="font-semibold">정정</span>{" "}
              <span className="text-sm text-muted-foreground">({publishStampKo(n.noticed_at)})</span>{" "}
              {n.public_text}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-small text-muted-foreground">
        {JOCKEY_CHANGE_SOURCE_NOTE} 예상과 판정은 발행한 그대로 셉니다. 출전·기수 변경은 한국마사회
        발표가 우선합니다.
      </p>
    </section>
  );
}
