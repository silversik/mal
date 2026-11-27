import { GateNum } from "@/components/race-detail-ui";
import {
  consensusLine,
  RULE_LABEL,
  RULE_ORDER,
  runnerAnchorId,
  type MarkMap,
  type RaceV1,
} from "@/lib/racing_form-shared";
import { cn } from "@/lib/utils";

import { FocusLabel } from "./focus-label";
import { TAP } from "./format";
import { PickMark } from "./pick-mark";

/** 받은 기호 — 기준 고정 순서로 "PickMark 레이팅 · PickMark 조교사". */
export function MarksReceived({ marks, className }: { marks: MarkMap; className?: string }) {
  const got = RULE_ORDER.flatMap((k) => {
    const m = marks[k];
    return m === undefined ? [] : [{ key: k, mark: m }];
  });
  if (got.length === 0) return null;
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-x-3 gap-y-1", className)}>
      {got.map((g) => (
        <span key={g.key} className="inline-flex items-center gap-1">
          <PickMark mark={g.mark} />
          <span>{RULE_LABEL[g.key]}</span>
        </span>
      ))}
    </span>
  );
}

/**
 * 경주면 주목마 상자 (계획 4.6-4) — 최대 2두. 문구의 분모는 늘 A(예상을 낸 기준 수).
 * 근거는 2개까지, 나머지는 "외 n". 기호 범례(PickLegend)는 이 상자 앞에 둔다.
 * "주목" 뱃지는 예상을 낸 기준이 모두 고른 말에만 붙인다 (2026-11-27).
 */
export function ConsensusBox({
  race,
  horseName,
}: {
  race: Pick<RaceV1, "consensus" | "field_size">;
  horseName: (horseNo: string) => string;
}) {
  const c = race.consensus;
  return (
    <section
      aria-labelledby="consensus-title"
      className="rounded-xl border border-border bg-card px-4 py-3"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id="consensus-title" className="text-base font-bold text-foreground">
          주목마
        </h2>
        <p className="text-sm text-muted-foreground">
          예상을 낸 기준 {c.min_votes}개 이상이 함께 고른 말 · 경주당 최대 2두
        </p>
      </div>
      {c.status !== "picked" || c.picks.length === 0 ? (
        <p className="mt-2 text-base text-foreground">
          {consensusLine({ status: c.status, active_rules: c.active_rules, field_size: race.field_size })}
        </p>
      ) : (
        <ul className="mt-2 space-y-3">
          {[...c.picks]
            .sort((a, b) => a.mark - b.mark)
            .map((p) => (
              <li key={p.horse_no} className="space-y-1.5 rounded-lg border border-border px-3 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <a
                    href={`#${runnerAnchorId(p.chul_no)}`}
                    className={cn(
                      "inline-flex items-center gap-2 rounded-md text-lg font-bold text-foreground underline-offset-4 hover:underline",
                      TAP,
                    )}
                  >
                    <GateNum n={p.chul_no} size={22} />
                    <span className="sr-only">번</span>
                    <span>{horseName(p.horse_no)}</span>
                  </a>
                  {/* "주목" 뱃지는 예상을 낸 기준이 모두 고른 말에만 (1면·팝업과 같은 뜻) */}
                  {p.votes === c.active_rules ? <FocusLabel /> : null}
                </div>
                <p className="text-base text-foreground">
                  {consensusLine({ status: "picked", active_rules: c.active_rules, votes: p.votes })}
                </p>
                <p className="text-sm text-foreground">
                  <span className="text-muted-foreground">받은 기호 </span>
                  <MarksReceived marks={p.marks} />
                </p>
                {p.reasons.length > 0 ? (
                  <ul className="space-y-0.5 text-sm text-foreground">
                    {p.reasons.map((r) => (
                      <li key={r} className="leading-relaxed">
                        · {r}
                      </li>
                    ))}
                    {p.reasons_more > 0 ? (
                      <li className="text-muted-foreground">외 {p.reasons_more}</li>
                    ) : null}
                  </ul>
                ) : null}
              </li>
            ))}
        </ul>
      )}
    </section>
  );
}
