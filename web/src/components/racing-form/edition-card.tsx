import Link from "next/link";

import type { EditionHead, SettlementLine } from "@/lib/racing_form-shared";
import { cn } from "@/lib/utils";

import { TAP } from "./format";
import { NumText } from "./num-text";
import { PickMark } from "./pick-mark";

export type EditionCardData = {
  key: string;
  href: string;
  /** "11월 14일(토) 서울" */
  title: string;
  /** 발행본이 있으면 호 번호 */
  issue: string | null;
  /** 상태 한 줄 — 발행 시각 또는 editionStateText */
  status: string;
  /** 보조 한 줄 (주목마 n경주 · 주요 소식 n건 등) */
  sub: string | null;
  settlement: SettlementLine | null;
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

/** 허브 "이번 주" 호 카드 — 카드 전체가 1면 링크. */
export function EditionCard({ card }: { card: EditionCardData }) {
  return (
    <Link
      href={card.href}
      className={cn(
        "block space-y-1 rounded-xl border border-border bg-card px-4 py-3 transition-colors hover:bg-muted",
        TAP,
      )}
    >
      <span className="flex flex-wrap items-baseline justify-between gap-x-3">
        <span className="text-lg font-bold text-foreground">{card.title}</span>
        {card.issue ? (
          <span className="font-mono text-base font-semibold tabular-nums text-foreground">{card.issue}</span>
        ) : null}
      </span>
      <span className="block text-base text-foreground">{card.status}</span>
      {card.sub ? <span className="block text-sm text-muted-foreground">{card.sub}</span> : null}
      {card.settlement ? <SettlementText line={card.settlement} /> : null}
    </Link>
  );
}

/** 결산 한 줄 (4.8) — 허브 카드·지난 호 목록이 같이 쓴다. ◎ 는 PickMark 로 그린다. */
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
