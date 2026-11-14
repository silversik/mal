import type { ReactNode } from "react";

import { GateNum, SexBullet } from "@/components/race-detail-ui";
import { RecentFormStrip } from "@/components/recent-form-strip";
import {
  runnerAnchorId,
  shownJockeyChange,
  type RunnerV1,
} from "@/lib/racing_form-shared";
import { cn } from "@/lib/utils";

import { MarksReceived, FocusLabel } from "./consensus-box";
import { deltaClass, deltaText, kgText, rankText, shortDate, TAP, timeText } from "./format";
import { NewsBadges } from "./news-badges";
import { SUMMARY_RESET } from "./rule-list";

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] items-baseline gap-x-2">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-base text-foreground">{children}</dd>
    </div>
  );
}

function Num({ children }: { children: ReactNode }) {
  return <span className="font-mono font-semibold tabular-nums">{children}</span>;
}

function RatingValue({ rating, prev }: { rating: number | null; prev: number | null }) {
  if (rating === null) return <span className="text-muted-foreground">없음 (평가 전)</span>;
  if (prev === null) return <Num>{rating}</Num>;
  if (rating === prev) {
    return (
      <span>
        <Num>{rating}</Num> <span className="text-sm text-muted-foreground">(직전과 같음)</span>
      </span>
    );
  }
  const d = deltaText(rating - prev);
  return (
    <span>
      <Num>{rating}</Num>{" "}
      <span className={cn("font-mono font-semibold tabular-nums", deltaClass(d.sign))}>{d.text}</span>{" "}
      <span className="text-sm text-muted-foreground">
        (직전 <span className="font-mono tabular-nums">{prev}</span>)
      </span>
    </span>
  );
}

function JockeyValue({ runner }: { runner: RunnerV1 }) {
  const jc = shownJockeyChange(runner);
  const wb = jc?.weight_before_tenths ?? null;
  const wa = jc?.weight_after_tenths ?? null;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      <span>{runner.jockey_name ?? "-"}</span>
      {jc ? (
        <span className="inline-flex min-h-7 flex-wrap items-center gap-x-1 rounded-md border border-foreground px-2 text-sm font-semibold">
          교체 {jc.before ?? "-"}→{jc.after ?? "-"}
          {jc.reason ? <span className="font-normal">({jc.reason})</span> : null}
          {wb !== null && wa !== null && wb !== wa ? (
            <span className="font-normal">
              · 부담 <span className="font-mono tabular-nums">{kgText(wb)}→{kgText(wa)}</span>
            </span>
          ) : null}
        </span>
      ) : null}
    </span>
  );
}

/**
 * 기수·조교사 줄에 바로 붙여 보이는 소식은 배지 줄에서 빼서 같은 사실을 두 번 싣지 않는다.
 * 기수 교체는 줄에 실제로 보일 때만 뺀다 ("A→A" 는 교체가 아니라 줄에도 배지에도 없다).
 */
function stripInlineBadges(runner: RunnerV1): RunnerV1["badges"] {
  const jockeyInline = shownJockeyChange(runner) !== null;
  return runner.badges.filter(
    (b) => b.kind !== "trainer_change" && !(b.kind === "jockey_change" && jockeyInline),
  );
}

function TrainerValue({ runner }: { runner: RunnerV1 }) {
  const change = runner.badges.find((b) => b.kind === "trainer_change") ?? null;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      <span>{runner.trainer_name ?? "-"}</span>
      {change ? (
        <span className="inline-flex min-h-7 items-center rounded-md border border-foreground px-2 text-sm font-semibold">
          {change.text}
        </span>
      ) : null}
    </span>
  );
}

function intervalText(r: RunnerV1): string {
  if (r.days_since_last !== null && r.last_start) {
    return `${r.days_since_last}일 만 (직전 ${shortDate(r.last_start.race_date)} ${rankText(r.last_start.rank)})`;
  }
  return r.career.starts === 0 ? "첫 출전 (mal.kr 수집 기록 기준)" : "-";
}

function courseText(r: RunnerV1): string {
  const c = r.course;
  if (!c) return "거리 정보 없음";
  if (c.starts === 0) return `${c.meet} ${c.distance}m 첫 출전`;
  return `${c.meet} ${c.distance}m ${c.starts}전 · 1착 ${c.wins}번 · 3착 이내 ${c.top3}번`;
}

/**
 * 출전마 카드 (계획 4.6-6) — **payload 에서만** 읽는다 (경주 시점 고정, as-of). 출전번호 순으로 부모가 나열.
 * 받은 기호 · 레이팅(▲▼+색) · 부담 · 기수·조교사(+교체) · 최근 5전 숫자 칩(왼쪽 = 과거) ·
 * "28일 만 (직전 10월 18일 2착)" · 같은 경마장·거리 전적 · 최고기록과 주로 상태 · 배지 3 + <details> · 지난 5경주.
 */
export function RunnerCard({ runner, hidePicks }: { runner: RunnerV1; hidePicks: boolean }) {
  const id = runnerAnchorId(runner.chul_no);
  const hasMarks = Object.keys(runner.marks).length > 0;
  const recent = [...runner.last5].reverse();
  return (
    <article
      id={id}
      aria-labelledby={`${id}-name`}
      className="scroll-mt-20 space-y-3 rounded-xl border border-border bg-card px-4 py-3"
    >
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span aria-hidden="true">
          <GateNum n={runner.chul_no} size={30} />
        </span>
        <h3 id={`${id}-name`} className="text-lg font-bold text-foreground">
          <span className="sr-only">{runner.chul_no}번 </span>
          {runner.horse_name}
        </h3>
        {runner.sex || runner.age ? (
          <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
            <SexBullet sex={runner.sex} />
            {runner.age ? <span>{String(runner.age).replace(/세$/, "")}세</span> : null}
          </span>
        ) : null}
        {!hidePicks && runner.consensus_mark !== null ? <FocusLabel /> : null}
      </header>

      {!hidePicks ? (
        <p className="text-base text-foreground">
          <span className="text-sm text-muted-foreground">받은 기호 </span>
          {hasMarks ? <MarksReceived marks={runner.marks} /> : <span className="text-muted-foreground">없음</span>}
        </p>
      ) : null}

      <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 md:grid-cols-2">
        <Fact label="레이팅">
          <RatingValue rating={runner.rating} prev={runner.rating_prev} />
        </Fact>
        <Fact label="부담">
          {kgText(runner.budam_tenths) ? <Num>{kgText(runner.budam_tenths)}</Num> : "-"}
        </Fact>
        <Fact label="기수">
          <JockeyValue runner={runner} />
        </Fact>
        <Fact label="조교사">
          <TrainerValue runner={runner} />
        </Fact>
        <Fact label="최근 5전">
          <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
            <RecentFormStrip finishes={runner.last5.map((s) => s.rank)} size="md" />
            {runner.last5.length > 0 ? (
              <span className="text-sm text-muted-foreground">왼쪽이 오래된 경주</span>
            ) : null}
          </span>
        </Fact>
        <Fact label="간격">{intervalText(runner)}</Fact>
        <Fact label="같은 거리">{courseText(runner)}</Fact>
        <Fact label="최고기록">
          {runner.best_time ? (
            <span>
              <Num>{timeText(runner.best_time.time_tenths)}</Num>{" "}
              <span className="text-sm text-muted-foreground">
                ({shortDate(runner.best_time.race_date)}
                {runner.best_time.track_condition ? ` · 주로 ${runner.best_time.track_condition}` : ""})
              </span>
            </span>
          ) : (
            <span className="text-muted-foreground">같은 경마장·거리 기록 없음</span>
          )}
        </Fact>
        <Fact label="통산">
          {runner.career.starts}전 · 1착 {runner.career.wins}번 · 3착 이내 {runner.career.top3}번
          <span className="text-sm text-muted-foreground"> (수집 기록)</span>
        </Fact>
      </dl>

      <NewsBadges badges={stripInlineBadges(runner)} />

      {recent.length > 0 ? (
        <details className="group">
          <summary
            className={cn(
              SUMMARY_RESET,
              "inline-flex items-center gap-1 rounded-md text-sm font-semibold text-foreground",
              TAP,
            )}
          >
            지난 {recent.length}경주
            <span aria-hidden="true" className="inline-block transition-transform group-open:rotate-90">
              ›
            </span>
          </summary>
          <ol className="divide-y divide-border border-t border-border">
            {recent.map((s) => (
              <li
                key={`${s.race_date}-${s.meet}-${s.race_no}`}
                className="grid grid-cols-[4.75rem_minmax(0,1fr)_auto] items-baseline gap-x-3 py-1.5 text-sm"
              >
                <span className="font-mono tabular-nums text-muted-foreground">{shortDate(s.race_date)}</span>
                <span className="text-foreground">
                  {s.meet} <span className="font-mono tabular-nums">{s.race_no}R</span>
                  {s.distance ? (
                    <>
                      {" · "}
                      <span className="font-mono tabular-nums">{s.distance}m</span>
                    </>
                  ) : null}
                  {s.field_size ? <> · {s.field_size}두</> : null}
                </span>
                <span className="font-mono font-semibold tabular-nums text-foreground">{rankText(s.rank)}</span>
              </li>
            ))}
          </ol>
          <p className="pb-1 pt-1 text-small text-muted-foreground">최근 순 · 발행 때 반영한 기록까지</p>
        </details>
      ) : null}
    </article>
  );
}
