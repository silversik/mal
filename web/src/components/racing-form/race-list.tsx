import Link from "next/link";

import { GateNum } from "@/components/race-detail-ui";
import { RankBadge } from "@/components/rank-badge";
import {
  consensusLine,
  finishRankOf,
  formatHhmm,
  formRacePath,
  pickOutcome,
  type FrontRaceV1,
  type FrontRunnerV1,
  type OutcomeRow,
} from "@/lib/racing_form-shared";
import { cn } from "@/lib/utils";

import { TAP } from "./format";

export type RaceRowResult =
  | { kind: "rank"; rank: number | null }
  | { kind: "void" };

export type RaceListRow = {
  raceNo: number;
  href: string;
  /** "14:30" — 지금 발주 시각(덧씌움) → 발행 시점 값 → null(미정) */
  time: string | null;
  /** 대상경주 이름 (일반 경주명은 싣지 않는다) */
  stakes: string | null;
  /** 주목마 1순위 (철회·법적 사유로 예상을 숨기면 null) */
  pick: { chulNo: number; horseName: string } | null;
  /** 주목마 2순위가 더 있으면 1 */
  morePicks: number;
  /** consensusLine — "예상을 낸 기준 4개 중 3개가 고름" · "혼전 — …" · "주목마 없음 — …" · "예상 안 함 — …" */
  line: string;
  /** 주목마 1순위의 결과 (정산 행이 있을 때만) */
  result: RaceRowResult | null;
};

/** 1면 경주 한 줄 재료 — payload(1면 조각) + 정산 + 지금 발주 시각. */
export function buildRaceRows(args: {
  date: string;
  meet: string;
  races: readonly FrontRaceV1[];
  runners: readonly FrontRunnerV1[];
  outcomes: readonly OutcomeRow[];
  /** race_no → 지금 races.start_time (원문) */
  startTimes: ReadonlyMap<number, string | null>;
  hidePicks: boolean;
}): RaceListRow[] {
  const nameOf = (raceNo: number, horseNo: string) =>
    args.runners.find((u) => u.race_no === raceNo && u.horse_no === horseNo)?.horse_name ?? horseNo;
  return args.races.map((r) => {
    const top = r.consensus.picks.find((p) => p.mark === 1) ?? null;
    const outcome = args.outcomes.find((o) => o.race_no === r.race_no) ?? null;
    let result: RaceRowResult | null = null;
    if (top && outcome && !args.hidePicks) {
      const verdict = pickOutcome(top.horse_no, outcome);
      result =
        verdict === "void" ? { kind: "void" } : { kind: "rank", rank: finishRankOf(outcome, top.horse_no) };
    }
    const time = formatHhmm(args.startTimes.get(r.race_no) ?? null) ?? formatHhmm(r.start_time);
    return {
      raceNo: r.race_no,
      href: formRacePath(args.date, args.meet, r.race_no),
      time,
      stakes: r.stakes ? `${r.stakes.name}${r.stakes.grade ? ` (${r.stakes.grade})` : ""}` : null,
      pick: top && !args.hidePicks ? { chulNo: top.chul_no, horseName: nameOf(r.race_no, top.horse_no) } : null,
      morePicks: args.hidePicks ? 0 : r.consensus.picks.filter((p) => p.mark !== 1).length,
      line: args.hidePicks
        ? "예상을 숨긴 호입니다 (철회)"
        : consensusLine({
            status: r.consensus.status,
            active_rules: r.consensus.active_rules,
            votes: top?.votes ?? null,
            field_size: r.field_size,
          }),
      result,
    };
  });
}

function ResultMark({ result }: { result: RaceRowResult }) {
  if (result.kind === "void") {
    return (
      <span className="inline-flex h-7 items-center rounded-md border border-border px-2 text-sm font-semibold text-muted-foreground">
        무효
      </span>
    );
  }
  if (result.rank === null) {
    return <span className="text-sm font-semibold text-muted-foreground">순위 없음</span>;
  }
  return (
    <span className="inline-flex items-center gap-1">
      <span className="sr-only">결과</span>
      <RankBadge rank={result.rank} rest="chip" />
      <span className="text-sm text-muted-foreground">착</span>
    </span>
  );
}

/**
 * 1면 경주별 주목마 한 줄 (계획 4.5-4) — 1R 부터, 행 전체가 경주면 링크(44px).
 * "3R 14:30 · [3] 글로벌히트 · 예상을 낸 기준 4개 중 3개가 고름" + 결과 뒤 RankBadge.
 * 단일 DOM — 좁은 화면에서는 같은 행이 두 줄로 접힌다.
 */
export function RaceList({ rows }: { rows: readonly RaceListRow[] }) {
  return (
    <ol className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
      {rows.map((r) => (
        <li key={r.raceNo}>
          <Link
            href={r.href}
            className={cn(
              "grid grid-cols-[3.25rem_minmax(0,1fr)_auto] items-center gap-x-3 px-3 py-2 transition-colors hover:bg-muted",
              TAP,
            )}
          >
            <span className="flex flex-col leading-tight">
              <span className="font-mono text-base font-bold tabular-nums text-foreground">
                {r.raceNo}R
              </span>
              <span className="font-mono text-sm tabular-nums text-muted-foreground">
                {r.time ?? "미정"}
              </span>
            </span>
            <span className="min-w-0 space-y-0.5">
              {r.pick ? (
                <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-base font-semibold text-foreground">
                  <GateNum n={r.pick.chulNo} size={24} />
                  <span className="sr-only">번</span>
                  <span className="min-w-0 break-words">{r.pick.horseName}</span>
                  {r.morePicks > 0 ? (
                    <span className="text-sm font-normal text-muted-foreground">
                      외 {r.morePicks}두
                    </span>
                  ) : null}
                </span>
              ) : null}
              <span className="block text-sm leading-snug text-muted-foreground">
                {r.stakes ? <span className="font-semibold text-foreground">{r.stakes} · </span> : null}
                {r.line}
              </span>
            </span>
            <span className="flex items-center gap-2">
              {r.result ? <ResultMark result={r.result} /> : null}
              <span aria-hidden="true" className="text-lg text-muted-foreground">
                ›
              </span>
            </span>
          </Link>
        </li>
      ))}
    </ol>
  );
}
