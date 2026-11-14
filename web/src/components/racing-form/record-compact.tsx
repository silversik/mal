import Link from "next/link";

import {
  CONSENSUS_KEY,
  dateKo,
  FORM_RECORD_PATH,
  RECORD_MIN_PCT_N,
  recordRows,
  sampleNote,
  type RecordRuleRow,
  type RuleRecord,
} from "@/lib/racing_form-shared";
import { cn } from "@/lib/utils";

import { TAP } from "./format";
import { PickMark } from "./pick-mark";

/** ◎ 1착 (주목마는 1순위 1착) — "3/12 (25%)" · n<30 이면 분수만. */
function honmei(row: RecordRuleRow) {
  return row.marks[0];
}

function RecordLink({ href = FORM_RECORD_PATH, label = "기록 전체 보기" }: { href?: string; label?: string }) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex items-center text-base font-semibold text-foreground underline-offset-4 transition-colors hover:underline",
        TAP,
      )}
    >
      {label} ›
    </Link>
  );
}

function emptyText(record: RuleRecord | null): string | null {
  if (record === null) return "기록을 불러오지 못했습니다. 잠시 뒤 다시 확인해 주세요.";
  if (record.races === 0) {
    return "아직 확정된 경주가 없습니다 — 정산은 경주 다음 날 오후 1시에 확정합니다.";
  }
  return null;
}

/** 기간 표기 "11월 8일(일)~11월 14일(토) · 확정 24경주" */
function scopeText(record: RuleRecord): string {
  const span =
    record.first_date && record.last_date
      ? record.first_date === record.last_date
        ? dateKo(record.first_date)
        : `${dateKo(record.first_date)}~${dateKo(record.last_date)}`
      : null;
  return [span, `확정 ${record.races}경주`, `${record.editions}호`].filter(Boolean).join(" · ");
}

/**
 * 실전 기준 성적 — 고정 순서, '최고 기준' 강조 없음 (계획 4.5-6 · 7.5).
 *  - block (1면): 기준마다 "◎ 1착 19/80 (24%) · 같은 경주 무작위 10%" + 주목마 1순위.
 *  - line (허브): 한 줄 요약.
 * 30경주 미만이면 % 를 내지 않고 "경주 수가 30 미만이라 %는 아직 내지 않습니다 (n경주)".
 */
export function RecordCompact({
  record,
  variant = "block",
  scopeLabel,
}: {
  record: RuleRecord | null;
  variant?: "block" | "line";
  /** "전 경마장 · r1" 같은 집계 범위 설명 */
  scopeLabel?: string;
}) {
  const empty = emptyText(record);
  if (empty !== null || record === null) {
    return (
      <div className="space-y-1">
        <p className="text-base text-muted-foreground">{empty}</p>
        <RecordLink label="기록 페이지" />
      </div>
    );
  }
  const rows = recordRows(record);
  const rules = rows.filter((r) => r.key !== CONSENSUS_KEY);
  const cons = rows.find((r) => r.key === CONSENSUS_KEY) ?? null;

  if (variant === "line") {
    const parts = rules.map((r) => `${r.label} ${honmei(r).win.text}`);
    return (
      <div className="space-y-1">
        <p className="text-base leading-relaxed text-foreground">
          <span className="text-muted-foreground">{scopeText(record)}</span>
          {cons ? <> — 주목마 1착 {honmei(cons).win.text}</> : null}
          {parts.length > 0 ? (
            <>
              {" · "}
              <PickMark mark={1} /> 1착: {parts.join(" · ")}
            </>
          ) : null}
        </p>
        {record.races < RECORD_MIN_PCT_N ? (
          <p className="text-sm text-muted-foreground">{sampleNote(record.races)?.text}</p>
        ) : null}
        <RecordLink />
      </div>
    );
  }

  // 확정 경주가 30 미만이면 모든 기준이 % 없음 → 안내 한 번. 그 밖에는 30 미만인 줄에만.
  const blockNote = record.races < RECORD_MIN_PCT_N ? sampleNote(record.races) : null;
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">
        {scopeLabel ? `${scopeLabel} · ` : ""}
        {scopeText(record)}
      </p>
      <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
        {[...rules, ...(cons ? [cons] : [])].map((r) => {
          const m = honmei(r);
          const rowNote = blockNote ? null : m.note?.kind === "too_few" ? m.note : null;
          return (
            <li
              key={r.key}
              className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-baseline gap-x-3 px-3 py-2"
            >
              <span className="text-base font-semibold text-foreground">{r.label}</span>
              <span className="min-w-0 text-base text-foreground">
                {r.key === CONSENSUS_KEY ? (
                  <span>1순위 1착 </span>
                ) : (
                  <span>
                    <PickMark mark={1} /> 1착{" "}
                  </span>
                )}
                <span className="font-mono font-semibold tabular-nums">{m.win.text}</span>
                {m.randomWinPct !== null ? (
                  <span className="text-muted-foreground">
                    {" "}
                    · 같은 경주 무작위{" "}
                    <span className="font-mono tabular-nums">{m.randomWinPct}%</span>
                  </span>
                ) : null}
                {rowNote ? (
                  <span className="block text-sm text-muted-foreground">{rowNote.text}</span>
                ) : null}
              </span>
            </li>
          );
        })}
      </ul>
      {blockNote ? <p className="text-sm text-muted-foreground">{blockNote.text}</p> : null}
      <RecordLink />
    </div>
  );
}
