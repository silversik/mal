import { GateNum } from "@/components/race-detail-ui";
import {
  RULE_LABEL,
  recordRows,
  runnerAnchorId,
  type RaceV1,
  type RecordRuleRow,
  type RuleDefV1,
  type RuleRecord,
} from "@/lib/racing_form-shared";
import { cn } from "@/lib/utils";

import { TAP } from "./format";
import { PickMark } from "./pick-mark";

/** <summary> 기본 삼각형 표식은 숨긴다 — △(3순위)와 헷갈리지 않게. */
export const SUMMARY_RESET = "cursor-pointer list-none [&::-webkit-details-marker]:hidden";

function RuleRecordLine({ row }: { row: RecordRuleRow | undefined }) {
  if (!row || row.marks.every((m) => m.n === 0)) {
    return <p className="text-sm text-muted-foreground">실전 성적 — 아직 확정된 경주가 없습니다.</p>;
  }
  const [m1, m2, m3] = row.marks;
  return (
    <p className="text-sm leading-relaxed text-foreground">
      <span className="text-muted-foreground">실전 성적 (확정분) — </span>
      <PickMark mark={1} /> 1착 <span className="font-mono tabular-nums">{m1.win.text}</span>
      {" · "}
      <PickMark mark={1} /> 3착 이내 <span className="font-mono tabular-nums">{m1.top3.text}</span>
      {m2 ? (
        <>
          {" · "}
          <PickMark mark={2} /> 3착 이내 <span className="font-mono tabular-nums">{m2.top3.text}</span>
        </>
      ) : null}
      {m3 ? (
        <>
          {" · "}
          <PickMark mark={3} /> 3착 이내 <span className="font-mono tabular-nums">{m3.top3.text}</span>
        </>
      ) : null}
      {m1.note ? <span className="block text-muted-foreground">{m1.note.text}</span> : null}
    </p>
  );
}

/**
 * 경주면 기준별 목록 (계획 4.6-5) — payload 의 고정 순서. ◎○△ 각각 GateNum + 마명 + 근거 한 줄.
 * 예상 안 한 기준엔 사유. 기준 라벨 <details> = 정의 한 줄 + 그 기준의 실전 성적.
 */
export function RuleList({
  race,
  defs,
  record,
  horseName,
}: {
  race: Pick<RaceV1, "rules">;
  defs: readonly RuleDefV1[];
  record: RuleRecord | null;
  horseName: (horseNo: string) => string;
}) {
  const rows = record ? recordRows(record) : [];
  return (
    <ol className="space-y-3">
      {race.rules.map((rr) => {
        const def = defs.find((d) => d.key === rr.key);
        const label = def?.label ?? RULE_LABEL[rr.key];
        return (
          <li key={rr.key} className="rounded-xl border border-border bg-card px-3 py-1">
            <details className="group">
              <summary
                className={cn(
                  SUMMARY_RESET,
                  "flex items-center justify-between gap-2 rounded-md",
                  TAP,
                )}
              >
                <h3 className="text-base font-bold text-foreground">{label}</h3>
                <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
                  기준 설명·실전 성적
                  <span aria-hidden="true" className="inline-block transition-transform group-open:rotate-90">
                    ›
                  </span>
                </span>
              </summary>
              <div className="space-y-1 border-t border-border pb-2 pt-2">
                {def ? <p className="text-sm leading-relaxed text-foreground">{def.definition}</p> : null}
                <RuleRecordLine row={rows.find((r) => r.key === rr.key)} />
              </div>
            </details>
            {rr.status === "picked" ? (
              <ol className="divide-y divide-border border-t border-border">
                {[...rr.picks]
                  .sort((a, b) => a.mark - b.mark)
                  .map((p) => (
                    <li key={`${p.mark}-${p.horse_no}`}>
                      <a
                        href={`#${runnerAnchorId(p.chul_no)}`}
                        className={cn(
                          "grid grid-cols-[auto_auto_minmax(0,1fr)] items-center gap-x-2 rounded-md py-1.5 transition-colors hover:bg-muted",
                          TAP,
                        )}
                      >
                        <PickMark mark={p.mark} className="text-lg" />
                        <GateNum n={p.chul_no} size={24} />
                        <span className="min-w-0">
                          <span className="sr-only">번 </span>
                          <span className="block text-base font-semibold text-foreground">
                            {horseName(p.horse_no)}
                          </span>
                          <span className="block text-sm leading-snug text-muted-foreground">
                            {p.reason}
                          </span>
                        </span>
                      </a>
                    </li>
                  ))}
              </ol>
            ) : (
              <p className="border-t border-border py-2 text-base text-foreground">
                <span className="font-semibold">예상 안 함</span> — {rr.reason}
              </p>
            )}
          </li>
        );
      })}
    </ol>
  );
}
