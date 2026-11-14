import {
  dateKo,
  publishStampKo,
  type Mark,
  type PublicBacktest,
  type RecordKey,
  type RuleRecord,
  type RuleRecordCell,
  type RuleRecordRule,
} from "@/lib/racing_form-shared";
import { cn } from "@/lib/utils";

import { TAP } from "./format";
import { RecordTable } from "./record-table";
import { SUMMARY_RESET } from "./rule-list";

/** 과거 시험 보고서 v1 (계약 §10) 중 화면이 쓰는 부분. */
export type BacktestView = {
  label: "dev" | "holdout";
  candidateVersion: string;
  definitionSha: string;
  from: string;
  to: string;
  meets: string[];
  editions: number;
  races: number;
  record: RuleRecord;
  computedAt: string;
  codeRev: string | null;
};

type Obj = Record<string, unknown>;

const KEYS: readonly RecordKey[] = ["rating", "form", "course", "jockey", "trainer", "consensus"];

function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** [분자, 분모] → 소수 (분모 0 이면 0). */
function frac(v: unknown): number | null {
  if (!Array.isArray(v) || v.length !== 2) return null;
  const a = num(v[0]);
  const b = num(v[1]);
  if (a === null || b === null) return null;
  return b === 0 ? 0 : a / b;
}

function ymd(v: unknown): string | null {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

function cellOf(v: unknown): RuleRecordCell | null {
  if (!isObj(v)) return null;
  const key = v.rule_key;
  const mark = v.mark;
  if (!(KEYS as readonly unknown[]).includes(key) || (mark !== 1 && mark !== 2 && mark !== 3)) return null;
  const ints = ["n", "wins", "top3", "voids", "fav_races", "pop_n", "pop_sum"].map((k) => num(v[k]));
  const fracs = ["random_win", "random_top3", "fav_win", "fav_top3"].map((k) => frac(v[k]));
  if (ints.some((x) => x === null) || fracs.some((x) => x === null)) return null;
  const [n, wins, top3, voids, favRaces, popN, popSum] = ints as number[];
  const [randomWin, randomTop3, favWin, favTop3] = fracs as number[];
  return {
    rule_key: key as RecordKey,
    mark: mark as Mark,
    n,
    wins,
    top3,
    voids,
    random_win: randomWin,
    random_top3: randomTop3,
    fav_races: favRaces,
    fav_win: favWin,
    fav_top3: favTop3,
    pop_n: popN,
    avg_pop_rank: popN > 0 ? popSum / popN : null,
  };
}

function ruleOf(v: unknown): RuleRecordRule | null {
  if (!isObj(v) || !(KEYS as readonly unknown[]).includes(v.rule_key)) return null;
  const picked = num(v.races_picked);
  const n = num(v.races_n);
  const anyWin = num(v.races_any_win);
  if (picked === null || n === null || anyWin === null) return null;
  return { rule_key: v.rule_key as RecordKey, races_picked: picked, races_n: n, races_any_win: anyWin };
}

/** 공개 과거 시험 행 → 화면용. 모르는 형식(report_version ≠ 1 등)이면 null — 화면은 섹션을 접는다. */
export function parseBacktest(b: PublicBacktest | null): BacktestView | null {
  if (!b || !isObj(b.report)) return null;
  const r = b.report;
  if (r.report_version !== 1 || !isObj(r.overall)) return null;
  const ov = r.overall;
  const races = num(ov.races);
  const editions = num(ov.editions);
  if (races === null || editions === null || !Array.isArray(ov.cells) || !Array.isArray(ov.rules)) return null;
  const cells = ov.cells.map(cellOf);
  const rules = ov.rules.map(ruleOf);
  if (cells.some((c) => c === null) || rules.some((x) => x === null)) return null;
  const period = isObj(r.period) ? r.period : {};
  return {
    label: b.label,
    candidateVersion: b.candidate_version,
    definitionSha: b.definition_sha256,
    from: ymd(period.from) ?? b.period_from,
    to: ymd(period.to) ?? b.period_to,
    meets: Array.isArray(r.meets) ? r.meets.filter((m): m is string => typeof m === "string") : b.meets,
    editions,
    races,
    record: {
      races,
      races_void: num(ov.races_void) ?? 0,
      editions,
      first_date: ymd(ov.first_date),
      last_date: ymd(ov.last_date),
      cells: cells as RuleRecordCell[],
      rules: rules as RuleRecordRule[],
    },
    computedAt: b.computed_at,
    codeRev: b.code_rev,
  };
}

/** 과거 시험에 유리한 조건 (계획 7.4) — 실전보다 좋게 나오는 이유를 먼저 밝힌다. */
export const BACKTEST_FAVORABLE: readonly string[] = [
  "무효가 없습니다 — 실제로 뛴 말만으로 출전 명단을 만들었습니다.",
  "실제로 탄 기수와 실제 부담중량을 썼습니다 (발행 때는 그 뒤 바뀔 수 있습니다).",
  "정정이 끝난 결과로 채점했습니다.",
  "레이팅은 결과표에 실린 레이팅을 썼습니다 (발행 때 쓰는 출전표 레이팅과 다를 수 있습니다).",
];

function Body({ view }: { view: BacktestView }) {
  return (
    <div className="space-y-4">
      <p className="text-sm leading-relaxed text-muted-foreground">
        {view.label === "holdout"
          ? "기준을 정한 뒤 처음 보는 기간에 한 번만 시험한 결과입니다 (holdout)."
          : "기준을 다듬는 데 쓴 기간의 결과입니다 (dev)."}{" "}
        기간 {dateKo(view.from)}~{dateKo(view.to)} · {view.meets.join("·")} · 시험 {view.editions}호{" "}
        {view.races}경주 · 기준 버전 {view.candidateVersion}
      </p>
      <div className="rounded-xl border border-border bg-card px-4 py-3">
        <h3 className="text-base font-bold text-foreground">이 시험에 유리한 조건</h3>
        <ul className="mt-1 list-disc space-y-1 pl-5 text-sm leading-relaxed text-foreground">
          {BACKTEST_FAVORABLE.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      </div>
      <RecordTable
        record={view.record}
        idPrefix="bt"
        extraRuleNote="조교사는 과거 시험에서만 함께 본 예비 기준입니다 (발행에는 쓰지 않습니다)."
      />
      <p className="text-small text-muted-foreground">
        계산 {publishStampKo(view.computedAt)} · 정의 해시 {view.definitionSha.slice(0, 12)}
        {view.codeRev ? ` · 코드 ${view.codeRev.slice(0, 12)}` : ""}
      </p>
    </div>
  );
}

/**
 * "과거 데이터로 시험(참고)" — 실전과 합산하지 않는 별도 섹션 (계획 7.4).
 * 흐림 대신 muted 토큰 + "참고" 라벨. 실전이 100경주를 넘으면 접어 둔다.
 */
export function BacktestSection({
  view,
  folded,
}: {
  view: BacktestView | null;
  /** 실전 확정 경주가 100 을 넘으면 true */
  folded: boolean;
}) {
  if (!view) {
    return (
      <p className="text-base text-muted-foreground">
        과거 데이터로 시험한 결과는 아직 공개하지 않았습니다. 공개하면 실전 기록과 나눠서 이 자리에 싣습니다.
      </p>
    );
  }
  if (!folded) return <Body view={view} />;
  return (
    <details className="group rounded-xl border border-border bg-card px-4">
      <summary
        className={cn(
          SUMMARY_RESET,
          "flex items-center justify-between gap-2 text-base font-semibold text-foreground",
          TAP,
        )}
      >
        실전 기록이 100경주를 넘어 접어 두었습니다 — 펼쳐 보기
        <span aria-hidden="true" className="inline-block transition-transform group-open:rotate-90">
          ›
        </span>
      </summary>
      <div className="pb-4">
        <Body view={view} />
      </div>
    </details>
  );
}
