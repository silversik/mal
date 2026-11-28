import Link from "next/link";

import { RankBadge } from "@/components/rank-badge";
import {
  dateKo,
  editionResult,
  formEditionPath,
  issueLabel,
  kstDateOf,
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

import { FocusLabel } from "./focus-label";
import { FormNum } from "./form-num";
import { TAP } from "./format";
import { NumText } from "./num-text";
import { PickMark } from "./pick-mark";

export type EditionCardData = {
  key: string;
  href: string;
  /** 경주일 "YYYY-MM-DD" — 묶음(경주 전 / 경주 결과)을 나눌 때 쓴다 */
  date: string;
  /** "서울 11월 14일(토)" — 경마장이 앞 */
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
  /** 경주 전 발행본의 라운드별 주목마 (1순위) — 발행본이 아니면 null */
  picks: EditionCardPick[] | null;
  /** 발행 예정 — 아직 볼 것이 없어 누를 수 없는 카드 */
  disabled: boolean;
};

export type EditionCardPick = {
  race_no: number;
  chul_no: number;
  horse_name: string;
  /** 예상을 낸 기준이 모두 고름 → 별 */
  strong: boolean;
};

/** 카드 제목 — "서울 11월 28일(토)" (경마장이 앞). */
export function editionCardTitle(date: string, meet: string): string {
  return `${meet} ${dateKo(date)}`;
}

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
    title: editionCardTitle(e.race_date, e.meet),
    issue: issueLabel(e.issue_no),
    status: `${publishStampKo(e.published_at)} 발행${args.late ? " · 늦게 발행" : ""}`,
    sub: editionCardSub(e),
    // 경주일이 되면 정산 전이어도 "예상 ↔ 실제" 줄을 만든다 (모두 결과 대기)
    result: editionResult(e.summary, args.outcomes, {
      raceDayStarted: e.race_date <= kstDateOf(args.now),
    }),
    provisional: line?.provisional ?? null,
    picks: e.summary
      ? [...e.summary.races]
          .sort((a, b) => a.race_no - b.race_no)
          .flatMap((r) => {
            const pick = r.consensus.status === "picked" ? r.consensus.pick : null;
            return pick
              ? [
                  {
                    race_no: r.race_no,
                    chul_no: pick.chul_no,
                    horse_name: pick.horse_name,
                    strong: pick.votes === r.consensus.active_rules,
                  },
                ]
              : [];
          })
      : null,
    disabled: false,
  };
}

/** 주목마의 실제 결과 — 1~3착은 RankBadge, 그 밖은 글자. */
function Actual({ row }: { row: EditionResultRow }) {
  if (row.outcome === "pending") {
    return <span className="text-sm text-muted-foreground">결과 대기</span>;
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

/** 경주 전 발행본의 라운드별 주목마 한 줄 — "3R 8 선라이즈킹 ★" (결과 카드와 같은 틀, 결과 칸만 없다). */
function PickRows({ picks }: { picks: readonly EditionCardPick[] }) {
  return (
    <span className="block divide-y divide-border border-y border-border">
      {picks.map((r) => (
        <span
          key={r.race_no}
          className="grid grid-cols-[2.5rem_minmax(0,1fr)] items-center gap-x-2 py-1.5 text-sm text-foreground"
        >
          <span className="font-mono font-bold tabular-nums">{r.race_no}R</span>
          <span className="flex min-w-0 items-center gap-1.5">
            <FormNum n={r.chul_no} plain />
            <span className="sr-only">번</span>
            <span className="min-w-0 truncate font-semibold">{r.horse_name}</span>
            {r.strong ? <FocusLabel size="sm" /> : null}
          </span>
        </span>
      ))}
    </span>
  );
}

/**
 * 호 카드 (허브 · 홈) — 제목은 "서울 11월 28일(토)" + 오른쪽에 호 번호.
 *  - 경주 결과가 나온 호: 주목마가 실제로 몇 착 했는지 경주별로 (예상 ↔ 실제).
 *  - 경주 전 발행본: showPicks 면 라운드별 주목마를 같은 틀로 (발행 시각은 싣지 않는다),
 *    아니면(홈) 건수 한 줄만 — 홈에는 경주 전 주목마 이름을 싣지 않는다 (2026-11-26 결정).
 *  - 발행 예정(disabled): 링크가 아니다 — 흐리게, "발행 예정" 한 줄만.
 *  - 미발행·쉼·철회: 상태 한 줄.
 */
export function EditionCard({ card, showPicks = false }: { card: EditionCardData; showPicks?: boolean }) {
  const res = card.result;
  const head = (
    <span className="flex flex-wrap items-baseline justify-between gap-x-3">
      <span className="text-lg font-bold">{card.title}</span>
      {card.issue ? (
        <span className="font-mono text-base font-semibold tabular-nums">{card.issue}</span>
      ) : null}
    </span>
  );
  if (card.disabled) {
    return (
      <div
        aria-disabled="true"
        className="block space-y-1.5 rounded-xl border border-dashed border-border bg-muted px-4 py-3 text-muted-foreground"
      >
        {head}
        <span className="block text-base">{card.status}</span>
      </div>
    );
  }
  return (
    <Link
      href={card.href}
      className={cn(
        "block space-y-1.5 rounded-xl border border-border bg-card px-4 py-3 text-foreground transition-colors hover:bg-muted",
        TAP,
      )}
    >
      {head}
      {res ? (
        // 경주 이후 — 1착 몇 번 같은 집계 줄은 싣지 않는다 (2026-11-28). 결과가 하나도 없으면 "결과 대기 중"
        <>
          {res.pending >= res.rows.length ? (
            <span className="block text-base text-foreground">결과 대기 중</span>
          ) : card.provisional ? (
            <span className="block text-sm text-muted-foreground">{card.provisional}</span>
          ) : null}
          {res.rows.length > 0 ? <ResultRows rows={res.rows} /> : null}
        </>
      ) : card.picks !== null ? (
        // 경주 전 발행본
        <>
          {card.sub ? <span className="block text-sm text-muted-foreground">{card.sub}</span> : null}
          {showPicks && card.picks.length > 0 ? <PickRows picks={card.picks} /> : null}
        </>
      ) : (
        // 미발행·쉼·철회
        <>
          <span className="block text-base text-foreground">{card.status}</span>
          {card.sub ? <span className="block text-sm text-muted-foreground">{card.sub}</span> : null}
        </>
      )}
    </Link>
  );
}

/**
 * 호 카드 묶음 (허브 · 홈) — 경주 이전 호들을 먼저, 구분선 하나, 경주일이 된 호들 (2026-11-28: 묶음 제목 없이 구분선만).
 * 경주일이 된 호 = 정산이 시작됐거나(result) 경주일이 오늘 이전(미발행·철회 포함). 한쪽이 비면 구분선도 없다.
 */
export function EditionCardGroups({
  cards,
  today,
  showPicks = false,
}: {
  cards: readonly EditionCardData[];
  /** 오늘 (KST) "YYYY-MM-DD" */
  today: string;
  /** 경주 전 카드에 라운드별 주목마를 싣는다 (허브). 홈은 싣지 않는다 */
  showPicks?: boolean;
}) {
  const done = (c: EditionCardData) => c.result !== null || c.date < today;
  const groups = [
    { key: "upcoming", label: "경주 이전", items: cards.filter((c) => !done(c)) },
    { key: "after", label: "경주 이후", items: cards.filter(done) },
  ].filter((g) => g.items.length > 0);
  return (
    <div className="space-y-4">
      {groups.map((g, i) => (
        <div key={g.key} className="space-y-4">
          {i > 0 ? <hr className="border-border" /> : null}
          {/* 제목은 화면에 싣지 않는다 — 스크린리더에만 묶음 이름 */}
          <ul aria-label={g.label} className="grid gap-3 md:grid-cols-2">
            {g.items.map((c) => (
              <li key={c.key}>
                <EditionCard card={c} showPicks={showPicks} />
              </li>
            ))}
          </ul>
        </div>
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
