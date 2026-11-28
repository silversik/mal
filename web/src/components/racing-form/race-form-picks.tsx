import { GateNum } from "@/components/race-detail-ui";
import { RankBadge } from "@/components/rank-badge";
import type { RaceFormPicksData } from "@/lib/racing_form";
import { formRacePath, issueLabel } from "@/lib/racing_form-shared";
import { cn } from "@/lib/utils";

import { FocusLabel } from "./focus-label";
import { buildRaceRows, type RacePickView } from "./race-list";

const TAP = "min-h-[max(44px,2.75rem)]";

function Result({ pick }: { pick: RacePickView }) {
  const r = pick.result;
  if (!r) return null;
  return (
    <span className="ml-auto inline-flex shrink-0 items-center gap-1.5">
      <span aria-hidden="true" className="text-muted-foreground">
        →
      </span>
      {r.kind === "void" ? (
        <span className="text-sm font-semibold text-muted-foreground">무효</span>
      ) : r.rank === null ? (
        <span className="text-sm font-semibold text-muted-foreground">순위 없음</span>
      ) : (
        <>
          <span className="sr-only">결과 {r.rank}착</span>
          <span aria-hidden="true" className="inline-flex">
            <RankBadge rank={r.rank} size="sm" rest="chip" />
          </span>
        </>
      )}
    </span>
  );
}

/**
 * 경기 일람 경주 상세의 "이 경주 경마지 주목마" (DESIGN.md Decisions Log 2026-11-28) — 복식 배당 위.
 * 발행된 호에서 이 경주의 주목마(최대 2두)와 고른 기준·근거, 결과가 나왔으면 착순. 주목마가 없으면 그리지 않는다.
 * "경마지 전체 보기" 는 새 창(경주면). 예전의 "이 경주 경마지 예상 보기 ›" 링크를 대신한다.
 */
export function RaceFormPicks({
  data,
  date,
  meet,
  raceNo,
}: {
  data: RaceFormPicksData | null;
  date: string;
  meet: string;
  raceNo: number;
}) {
  if (!data) return null;
  const race = data.slice.race;
  const [row] = buildRaceRows({
    date,
    meet,
    races: [race],
    runners: race.runners.map((u) => ({
      race_no: race.race_no,
      horse_no: u.horse_no,
      chul_no: u.chul_no,
      horse_name: u.horse_name,
      jockey_name: u.jockey_name,
    })),
    outcomes: data.outcomes,
    hidePicks: false,
  });
  if (!row || row.picks.length === 0) return null;
  return (
    <section aria-labelledby="race-form-picks-title" className="mt-6 space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 id="race-form-picks-title" className="text-sm font-semibold text-muted-foreground">
          경마지 주목마{" "}
          <span className="font-mono tabular-nums">{issueLabel(data.head.issue_no)}</span>
        </h3>
        <a
          href={formRacePath(date, meet, raceNo)}
          target="_blank"
          rel="noopener"
          className={cn(
            "inline-flex items-center gap-1 text-base font-semibold text-foreground underline-offset-4 hover:underline",
            TAP,
          )}
        >
          경마지 전체 보기
          <span aria-hidden="true">↗</span>
          <span className="sr-only"> (새 창)</span>
        </a>
      </div>
      <ul className="grid gap-3 md:grid-cols-2">
        {row.picks.map((p) => (
          <li key={p.chulNo} className="space-y-2 rounded-xl border border-border bg-card px-4 py-3">
            <div className="flex items-center gap-2">
              <GateNum n={p.chulNo} size={24} />
              <span className="sr-only">번</span>
              <span className="min-w-0 break-words text-lg font-bold text-foreground">{p.horseName}</span>
              {p.strong ? <FocusLabel tip={`고른 기준 ${p.criteria.length}개`} /> : null}
              <Result pick={p} />
            </div>
            {p.criteria.length > 0 ? (
              <ul className="divide-y divide-border border-t border-border">
                {p.criteria.map((c) => (
                  <li key={c.rule} className="py-1.5 text-sm leading-relaxed text-foreground">
                    <span className="font-semibold">
                      {c.rule} {c.mark}
                    </span>
                    <span className="block text-muted-foreground">{c.reason}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
