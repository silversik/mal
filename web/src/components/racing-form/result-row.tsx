import { GateNum } from "@/components/race-detail-ui";
import { RankBadge } from "@/components/rank-badge";
import {
  finalizeAt,
  publishStampKo,
  type OutcomeRow,
  type RaceResultState,
  type RunnerV1,
} from "@/lib/racing_form-shared";

import { timeText } from "./format";

function nameOf(runners: readonly Pick<RunnerV1, "horse_no" | "horse_name">[], horseNo: string): string {
  return runners.find((u) => u.horse_no === horseNo)?.horse_name ?? horseNo;
}

function chulOf(runners: readonly Pick<RunnerV1, "horse_no" | "chul_no">[], horseNo: string): number | null {
  return runners.find((u) => u.horse_no === horseNo)?.chul_no ?? null;
}

/** "확정" · "잠정 — 11월 15일(일) 오후 1시 확정" · 확정 시각이 지났으면 "잠정 (확정 처리 전)". */
export function settleLabel(outcome: Pick<OutcomeRow, "is_final">, raceDate: string, now: Date): string {
  if (outcome.is_final) return "확정";
  const fin = finalizeAt(raceDate);
  return now.getTime() < fin.getTime() ? `잠정 — ${publishStampKo(fin)} 확정` : "잠정 (확정 처리 전)";
}

/**
 * 경주면 결과 줄 — 3상태 (계약 §8): 발주 전 / 결과 정리 중 / 결과.
 * 결과는 정산 행(racing_form_race_outcomes)만 쓴다. 고정본(payload)은 바꾸지 않는다.
 */
export function ResultRow({
  state,
  outcome,
  runners,
  startTime,
  raceDate,
  now,
}: {
  state: RaceResultState;
  outcome: OutcomeRow | null;
  runners: readonly Pick<RunnerV1, "horse_no" | "horse_name" | "chul_no">[];
  startTime: string | null;
  raceDate: string;
  now: Date;
}) {
  return (
    <section aria-labelledby="result-title" className="rounded-xl border border-border bg-card px-4 py-3">
      <h2 id="result-title" className="text-base font-bold text-foreground">
        결과
      </h2>
      {state === "before_post" || !outcome ? (
        <p className="mt-1 text-base text-foreground">
          {state === "before_post" ? (
            <>
              <span className="font-semibold">발주 전</span> —{" "}
              {startTime ? (
                <>
                  <span className="font-mono tabular-nums">{startTime}</span> 출발 예정.
                </>
              ) : (
                "발주 시각 미정."
              )}{" "}
              결과는 경주가 끝난 뒤 이 자리에 싣습니다.
            </>
          ) : (
            <>
              <span className="font-semibold">결과 정리 중</span> — 한국마사회 결과가 들어오면 정산해
              싣습니다.
            </>
          )}
        </p>
      ) : outcome.status === "race_void" ? (
        <div className="mt-1 space-y-1 text-base text-foreground">
          <p>
            <span className="font-semibold">경주 무효</span> — 결과가 없거나 착순이 없어 이 경주의 표시는
            모두 무효로 셉니다 (기록의 분모에서 뺍니다).
          </p>
          <p className="text-sm text-muted-foreground">{settleLabel(outcome, raceDate, now)}</p>
        </div>
      ) : (
        <div className="mt-2 space-y-2">
          <ol className="space-y-1">
            {outcome.finish
              .filter((f) => f.rank !== null && f.rank <= 3)
              .map((f) => {
                const chul = f.chul_no ?? chulOf(runners, f.horse_no);
                return (
                  <li
                    key={`${f.horse_no}-${f.rank}`}
                    className="flex flex-wrap items-center gap-x-2 gap-y-1 text-base text-foreground"
                  >
                    <RankBadge rank={f.rank} />
                    <span className="text-sm text-muted-foreground">착</span>
                    {chul !== null ? (
                      <>
                        <GateNum n={chul} size={24} />
                        <span className="sr-only">번</span>
                      </>
                    ) : null}
                    <span className="font-semibold">{nameOf(runners, f.horse_no)}</span>
                    {f.time_tenths !== null ? (
                      <span className="font-mono text-sm tabular-nums text-muted-foreground">
                        {timeText(f.time_tenths)}
                      </span>
                    ) : null}
                  </li>
                );
              })}
          </ol>
          {outcome.non_starters.length > 0 ? (
            <p className="text-sm text-foreground">
              <span className="font-semibold">결과에 없는 말 (무효)</span>:{" "}
              {outcome.non_starters
                .map((h) => {
                  const c = chulOf(runners, h);
                  return `${c !== null ? `${c}번 ` : ""}${nameOf(runners, h)}`;
                })
                .join(" · ")}
            </p>
          ) : null}
          {outcome.extra_starters.length > 0 ? (
            <p className="text-sm text-muted-foreground">
              발행 명단에 없던 출주 {outcome.extra_starters.length}두 (집계에 넣지 않음)
            </p>
          ) : null}
          <p className="text-sm text-muted-foreground">
            출주 {outcome.starters}두 · {settleLabel(outcome, raceDate, now)}
          </p>
        </div>
      )}
    </section>
  );
}
