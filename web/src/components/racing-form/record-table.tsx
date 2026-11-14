import type { ReactNode } from "react";

import {
  CONSENSUS_KEY,
  recordRows,
  recordStat,
  type Mark,
  type RecordMarkRow,
  type RecordRuleRow,
  type RuleRecord,
} from "@/lib/racing_form-shared";
import { cn } from "@/lib/utils";

import { deltaClass, deltaText, TAP } from "./format";
import { PickMark } from "./pick-mark";
import { SUMMARY_RESET } from "./rule-list";

/**
 * lg 이상에서는 한 줄 표(머리줄 + 열), 그 아래는 같은 DOM 이 "라벨 값" 쌍으로 줄바꿈되어 흐른다
 * (단일 반응형 트리 — 모바일용 DOM 을 따로 두지 않는다).
 */
const GRID =
  "lg:grid-cols-[6.5rem_4.5rem_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_6rem_minmax(0,1.3fr)_3.5rem]";

const HEADERS = ["기호", "표시", "1착", "3착 이내", "무작위 1착", "무작위 대비", "1번 인기 1착", "무효"];

function Cell({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex min-w-0 items-baseline gap-1.5 lg:block", className)}>
      <span className="shrink-0 text-sm text-muted-foreground lg:sr-only">{label}</span>
      <span className="min-w-0 text-base text-foreground lg:text-sm">{children}</span>
    </span>
  );
}

function MarkCell({ mark, consensus }: { mark: Mark; consensus: boolean }) {
  if (consensus) return <span className="font-semibold">1순위</span>;
  return (
    <span className="inline-flex items-center gap-1.5 font-semibold">
      <PickMark mark={mark} decorative />
      {mark}순위
    </span>
  );
}

function MarkRow({
  m,
  rawRandomWin,
  consensus,
}: {
  m: RecordMarkRow;
  /** 같은 경주 집합의 무작위 1착 기대값 (소수) */
  rawRandomWin: number;
  consensus: boolean;
}) {
  const random = recordStat(rawRandomWin, m.n);
  const d = m.winDelta === null ? null : deltaText(m.winDelta, "%p");
  return (
    <li
      className={cn(
        "flex flex-wrap items-baseline gap-x-4 gap-y-1 px-4 py-3 lg:grid lg:items-center lg:gap-y-0",
        GRID,
      )}
    >
      <span className="basis-full text-base text-foreground lg:basis-auto">
        <MarkCell mark={m.mark} consensus={consensus} />
      </span>
      <Cell label="표시">
        <span className="font-mono tabular-nums">{m.n}</span>
      </Cell>
      <Cell label="1착">
        <span className="font-mono font-semibold tabular-nums">{m.win.text}</span>
      </Cell>
      <Cell label="3착 이내">
        <span className="font-mono font-semibold tabular-nums">{m.top3.text}</span>
      </Cell>
      <Cell label="무작위 1착">
        <span className="font-mono tabular-nums">{m.n > 0 ? random.text : "-"}</span>
      </Cell>
      {/* 차이는 30경주 이상일 때만 — 값이 없으면 좁은 화면에서는 칸째 생략 */}
      <Cell label="무작위 대비" className={d ? undefined : "hidden lg:block"}>
        {d ? (
          <span className={cn("font-mono font-semibold tabular-nums", deltaClass(d.sign))}>{d.text}</span>
        ) : (
          <span className="text-muted-foreground">-</span>
        )}
      </Cell>
      <Cell label="1번 인기 1착">
        {m.favorite ? (
          <span>
            <span className="font-mono tabular-nums">{m.favorite.text}</span>
            {m.favorite.n < m.n ? (
              <span className="text-sm text-muted-foreground lg:block"> (배당 있는 {m.favorite.n}경주)</span>
            ) : null}
          </span>
        ) : (
          <span className="text-muted-foreground">-</span>
        )}
      </Cell>
      <Cell label="무효">
        <span className="font-mono tabular-nums">{m.voids}</span>
      </Cell>
    </li>
  );
}

function RuleCard({ row, record, idPrefix }: { row: RecordRuleRow; record: RuleRecord; idPrefix: string }) {
  const consensus = row.key === CONSENSUS_KEY;
  const headingId = `${idPrefix}-${row.key}`;
  const m1 = row.marks[0];
  const cis = row.marks.filter((m) => m.win.ci !== null || m.top3.ci !== null);
  return (
    <section aria-labelledby={headingId} className="overflow-hidden rounded-xl border border-border bg-card">
      <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-border px-4 py-3">
        <h3 id={headingId} className="text-base font-bold text-foreground">
          {consensus ? "주목마 (1순위)" : row.label}
        </h3>
        <p className="text-sm text-muted-foreground">
          {consensus ? "주목마를 고른 경주" : "예상을 낸 경주"}{" "}
          <span className="font-mono tabular-nums text-foreground">{row.participation.text}</span>
          {row.anyWin ? (
            <>
              {" · "}1·2·3순위 중 1착마 포함{" "}
              <span className="font-mono tabular-nums text-foreground">{row.anyWin.text}</span>
            </>
          ) : null}
        </p>
      </header>
      <div
        aria-hidden="true"
        className={cn(
          "hidden border-b border-border bg-muted px-4 py-2 text-small font-semibold text-muted-foreground lg:grid lg:gap-x-4",
          GRID,
        )}
      >
        {HEADERS.map((h) => (
          <span key={h}>{h}</span>
        ))}
      </div>
      <ul className="divide-y divide-border">
        {row.marks.map((m) => (
          <MarkRow
            key={m.mark}
            m={m}
            consensus={consensus}
            rawRandomWin={
              record.cells.find((c) => c.rule_key === row.key && c.mark === m.mark)?.random_win ?? 0
            }
          />
        ))}
      </ul>
      <div className="space-y-1 border-t border-border px-4 py-2">
        {m1.note ? <p className="text-sm text-muted-foreground">{m1.note.text}</p> : null}
        {!consensus && m1.avgPopRank !== null ? (
          <p className="text-sm text-foreground">
            <PickMark mark={1} /> 평균 인기{" "}
            <span className="font-mono tabular-nums">{m1.avgPopRank.toFixed(1)}위</span>{" "}
            <span className="text-muted-foreground">(확정 배당 기준)</span>
          </p>
        ) : null}
        {cis.length > 0 ? (
          <details className="group">
            <summary
              className={cn(
                SUMMARY_RESET,
                "inline-flex items-center gap-1 rounded-md text-sm font-semibold text-foreground",
                TAP,
              )}
            >
              흔들림 폭 보기 (95%)
              <span aria-hidden="true" className="inline-block transition-transform group-open:rotate-90">
                ›
              </span>
            </summary>
            <ul className="space-y-0.5 pb-1 text-sm text-foreground">
              {cis.map((m) => (
                <li key={m.mark}>
                  {consensus ? "1순위" : `${m.mark}순위`} 1착{" "}
                  {m.win.ci ? (
                    <span className="font-mono tabular-nums">
                      {m.win.ci.lo}~{m.win.ci.hi}%
                    </span>
                  ) : (
                    "-"
                  )}{" "}
                  · 3착 이내{" "}
                  {m.top3.ci ? (
                    <span className="font-mono tabular-nums">
                      {m.top3.ci.lo}~{m.top3.ci.hi}%
                    </span>
                  ) : (
                    "-"
                  )}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>
    </section>
  );
}

/**
 * 기록 표 — 기준 × 기호 (주목마는 1순위). 고정 순서, '최고 기준' 강조 없음 (계획 7).
 * 분수 상시 · 30경주 미만 % 숨김 · 무작위 대비 차이만 ▲▼ + 색 · 1번 인기는 확정 배당 기준.
 */
export function RecordTable({
  record,
  extraRuleNote,
  idPrefix = "rec",
}: {
  record: RuleRecord;
  extraRuleNote?: string;
  /** 한 페이지에 표가 둘(실전·과거 시험)이면 heading id 가 겹치지 않게 */
  idPrefix?: string;
}) {
  const rows = recordRows(record);
  return (
    <div className="space-y-4">
      {rows.map((row) => (
        <RuleCard key={row.key} row={row} record={record} idPrefix={idPrefix} />
      ))}
      {extraRuleNote && rows.some((r) => r.key === "trainer") ? (
        <p className="text-sm text-muted-foreground">{extraRuleNote}</p>
      ) : null}
    </div>
  );
}
