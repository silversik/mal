import Link from "next/link";

import { RankBadge } from "@/components/rank-badge";
import {
  dateKo,
  editionResult,
  editionResultLine,
  formEditionPath,
  issueLabel,
  publishStampKo,
  settlementLine,
  type EditionHead,
  type EditionResult,
  type EditionResultRow,
  type EditionTally,
  type OutcomeRow,
  type SettlementLine,
} from "@/lib/racing_form-shared";
import { cn } from "@/lib/utils";

import { FormNum } from "./form-num";
import { TAP } from "./format";
import { NumText } from "./num-text";
import { PickMark } from "./pick-mark";

export type EditionCardData = {
  key: string;
  href: string;
  /** 경주일 "YYYY-MM-DD" — 묶음(경주 전 / 결과)을 나눌 때 쓴다 */
  date: string;
  /** "11월 14일(토) 서울" */
  title: string;
  /** 발행본이 있으면 호 번호 */
  issue: string | null;
  /** 상태 한 줄 — 발행 시각 또는 editionStateText */
  status: string;
  /** 보조 한 줄 (주목마 n경주 · 주요 소식 n건 등) */
  sub: string | null;
  /** 정산이 시작된 호의 "예상 ↔ 실제" (없으면 아직 경주 전) */
  result: EditionResult | null;
  /** "잠정 — 내일 오후 1시 확정" · "잠정" · null(확정 또는 결과 없음) */
  provisional: string | null;
};

/**
 * 허브 카드 보조 줄 "12경주 · 주목마 7경주 · 주요 소식 6건". summary.counts.headlines 는 1면 머리기사 수
 * (최대 6, "외 n건" 은 빼고 센다 — 계약 §4)라 "말 소식"(전체)이 아니라 "주요 소식" 이라 부른다. 0 이면 뺀다.
 */
export function editionCardSub(e: Pick<EditionHead, "race_count" | "summary">): string | null {
  if (!e.summary) return null;
  const picked = e.summary.races.filter((r) => r.consensus.status === "picked").length;
  const headlines = e.summary.counts.headlines;
  return [
    `${e.race_count}경주`,
    `주목마 ${picked}경주`,
    headlines > 0 ? `주요 소식 ${headlines}건` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** 발행본 하나 → 카드 재료 (허브 "이번 주" · 홈 공용). 정산이 시작됐으면 "예상 ↔ 실제" 를 싣는다. */
export function publishedEditionCard(args: {
  head: EditionHead;
  late: boolean;
  outcomes: readonly OutcomeRow[];
  tally: EditionTally | null;
  now: Date;
}): EditionCardData {
  const e = args.head;
  const line = args.tally
    ? settlementLine({
        tally: args.tally,
        raceDate: e.race_date,
        meet: e.meet,
        raceCount: e.race_count,
        now: args.now,
      })
    : null;
  return {
    key: `${e.race_date}|${e.meet}`,
    href: formEditionPath(e.race_date, e.meet),
    date: e.race_date,
    title: `${dateKo(e.race_date)} ${e.meet}`,
    issue: issueLabel(e.issue_no),
    status: `${publishStampKo(e.published_at)} 발행${args.late ? " · 늦게 발행" : ""}`,
    sub: editionCardSub(e),
    result: editionResult(e.summary, args.outcomes),
    provisional: line?.provisional ?? null,
  };
}

/** 주목마의 실제 결과 — 1~3착은 RankBadge, 그 밖은 글자. */
function Actual({ row }: { row: EditionResultRow }) {
  if (row.outcome === "pending") {
    return <span className="text-sm text-muted-foreground">결과 전</span>;
  }
  if (row.outcome === "void") {
    return <span className="text-sm font-semibold text-muted-foreground">무효</span>;
  }
  return (
    <span className="inline-flex items-center gap-1">
      {row.rank === null ? (
        <span className="text-sm font-semibold text-muted-foreground">순위 없음</span>
      ) : (
        <>
          <RankBadge rank={row.rank} size="sm" rest="chip" />
          <span className="text-sm text-muted-foreground">착</span>
        </>
      )}
    </span>
  );
}

/** 예상(주목마) ↔ 실제 한 줄 — "4R 3 매직트리 → 4착 (1착 8번)". */
function ResultRows({ rows }: { rows: readonly EditionResultRow[] }) {
  return (
    <span className="block divide-y divide-border border-y border-border">
      {rows.map((r) => (
        <span
          key={r.race_no}
          className="grid grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-x-2 py-1.5 text-sm text-foreground"
        >
          <span className="font-mono font-bold tabular-nums">{r.race_no}R</span>
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="sr-only">예상 </span>
            <FormNum n={r.chul_no} plain />
            <span className="sr-only">번</span>
            <span className="min-w-0 truncate font-semibold">{r.horse_name}</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="sr-only">실제 </span>
            <Actual row={r} />
            {r.winner_chul_nos.length > 0 ? (
              <span className="text-sm text-muted-foreground">
                (1착 <span className="font-mono tabular-nums">{r.winner_chul_nos.join("·")}</span>번)
              </span>
            ) : null}
          </span>
        </span>
      ))}
    </span>
  );
}

/**
 * 호 카드 — 카드 전체가 1면 링크 (허브 "이번 주" · 홈).
 * 경주 전: 발행 시각 + 보조 줄. 결과가 나온 호: 주목마가 실제로 몇 착 했는지 경주별로
 * (DESIGN.md Decisions Log 2026-11-27 — 예상과 실제가 어떻게 달랐는지 카드에서 바로).
 */
export function EditionCard({ card }: { card: EditionCardData }) {
  const res = card.result;
  return (
    <Link
      href={card.href}
      className={cn(
        "block space-y-1.5 rounded-xl border border-border bg-card px-4 py-3 transition-colors hover:bg-muted",
        TAP,
      )}
    >
      <span className="flex flex-wrap items-baseline justify-between gap-x-3">
        <span className="text-lg font-bold text-foreground">{card.title}</span>
        {card.issue ? (
          <span className="font-mono text-base font-semibold tabular-nums text-foreground">{card.issue}</span>
        ) : null}
      </span>
      {res ? (
        <>
          <span className="block text-base text-foreground">
            <NumText text={editionResultLine(res)} />
            {card.provisional ? (
              <span className="text-sm text-muted-foreground"> ({card.provisional})</span>
            ) : null}
          </span>
          {res.rows.length > 0 ? <ResultRows rows={res.rows} /> : null}
        </>
      ) : (
        <>
          <span className="block text-base text-foreground">{card.status}</span>
          {card.sub ? <span className="block text-sm text-muted-foreground">{card.sub}</span> : null}
        </>
      )}
    </Link>
  );
}

/**
 * 호 카드 묶음 — "경주 전" 과 "결과" 를 나눠 보여 준다 (허브 "이번 주 경마지" · 홈).
 * 결과 = 정산이 시작됐거나 경주일이 지난 호(미발행·철회 포함). 한쪽이 비면 그 묶음은 그리지 않는다.
 */
export function EditionCardGroups({
  cards,
  today,
}: {
  cards: readonly EditionCardData[];
  /** 오늘 (KST) "YYYY-MM-DD" */
  today: string;
}) {
  const done = (c: EditionCardData) => c.result !== null || c.date < today;
  const groups = [
    { key: "upcoming", label: "경주 전", items: cards.filter((c) => !done(c)) },
    { key: "result", label: "결과", items: cards.filter(done) },
  ].filter((g) => g.items.length > 0);
  return (
    <div className="space-y-4">
      {groups.map((g) => (
        <section key={g.key} aria-label={g.label} className="space-y-2">
          <h3 className="flex items-center gap-2 text-base font-bold text-foreground">
            {g.label}
            <span className="font-mono text-sm font-semibold tabular-nums text-muted-foreground">
              {g.items.length}
            </span>
          </h3>
          <ul className="grid gap-3 md:grid-cols-2">
            {g.items.map((c) => (
              <li key={c.key}>
                <EditionCard card={c} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** 결산 한 줄 (4.8) — 지난 호 목록이 쓴다. ◎ 는 PickMark 로 그린다. */
export function SettlementText({ line, withHead = false }: { line: SettlementLine; withHead?: boolean }) {
  return (
    <span className="block text-sm leading-relaxed text-foreground">
      {withHead ? <span className="font-semibold">{line.head} — </span> : null}
      <NumText text={line.consensus} />
      {line.marks ? (
        <>
          {" / "}
          <PickMark mark={1} /> <NumText text={line.marks} />
        </>
      ) : null}
      {line.provisional ? <span className="text-muted-foreground"> ({line.provisional})</span> : null}
    </span>
  );
}
