import Link from "next/link";

import {
  dateKo,
  formEditionPath,
  isLate,
  issueLabel,
  meetOrder,
  missedReasonOf,
  pausedReasonOf,
  publishStampKo,
  type EditionHead,
  type FormNotice,
} from "@/lib/racing_form-shared";
import { cn } from "@/lib/utils";

import { TAP } from "./format";

type EditionItem = {
  kind: "edition";
  key: string;
  date: string;
  meet: string;
  issueNo: number;
  publishedAt: string;
  late: boolean;
  withdrawn: FormNotice | null;
  errata: FormNotice[];
  resultChanged: FormNotice[];
  href: string;
};
type MissedItem = { kind: "missed"; key: string; date: string; meet: string | null; reason: string | null };
type PausedItem = {
  kind: "paused";
  key: string;
  date: string;
  until: string | null;
  meet: string | null;
  reason: string | null;
};
export type HistoryItem = EditionItem | MissedItem | PausedItem;

export type HistoryCounts = {
  editions: number;
  late: number;
  missed: number;
  withdrawn: number;
  errata: number;
  resultChanged: number;
  paused: number;
};

/** 발행본 머리 + 공개 공지 → 발행 이력 (최근 경주일 먼저, 같은 날은 MEET_ORDER). */
export function buildHistory(
  editions: readonly EditionHead[],
  notices: readonly FormNotice[],
): { items: HistoryItem[]; counts: HistoryCounts } {
  const items: HistoryItem[] = editions.map((e) => {
    const mine = notices.filter((n) => n.edition_id === e.id);
    return {
      kind: "edition",
      key: `e-${e.id}`,
      date: e.race_date,
      meet: e.meet,
      issueNo: e.issue_no,
      publishedAt: e.published_at,
      late: isLate(e.published_at, e.race_date),
      withdrawn: mine.find((n) => n.kind === "withdrawn") ?? null,
      errata: mine.filter((n) => n.kind === "erratum"),
      resultChanged: mine.filter((n) => n.kind === "result_changed"),
      href: formEditionPath(e.race_date, e.meet),
    };
  });
  for (const n of notices) {
    if (n.kind === "missed") {
      items.push({
        kind: "missed",
        key: `n-${n.id}`,
        date: n.race_date,
        meet: n.meet,
        reason: missedReasonOf(n.public_text),
      });
    } else if (n.kind === "paused") {
      items.push({
        kind: "paused",
        key: `n-${n.id}`,
        date: n.race_date,
        until: n.until,
        meet: n.meet,
        reason: pausedReasonOf(n.public_text),
      });
    }
  }
  items.sort(
    (a, b) =>
      (a.date < b.date ? 1 : a.date > b.date ? -1 : 0) ||
      meetOrder(a.meet ?? "") - meetOrder(b.meet ?? "") ||
      a.key.localeCompare(b.key),
  );
  const eds = items.filter((i): i is EditionItem => i.kind === "edition");
  return {
    items,
    counts: {
      editions: eds.length,
      late: eds.filter((e) => e.late).length,
      missed: items.filter((i) => i.kind === "missed").length,
      withdrawn: eds.filter((e) => e.withdrawn).length,
      errata: eds.reduce((s, e) => s + e.errata.length, 0),
      resultChanged: eds.reduce((s, e) => s + e.resultChanged.length, 0),
      paused: items.filter((i) => i.kind === "paused").length,
    },
  };
}

function Tag({ children }: { children: string }) {
  return (
    <span className="inline-flex h-7 items-center rounded-md border border-foreground px-2 text-sm font-semibold text-foreground">
      {children}
    </span>
  );
}

/**
 * 발행 이력 — 호 수·늦게 발행·미발행 사유·철회·정정·쉼·확정 뒤 결과 변경을 빠짐없이 (계획 7.7).
 * 빠진 호도 숨기지 않는다 (생존 편향 방지).
 */
export function PublicationHistory({
  items,
  counts,
}: {
  items: readonly HistoryItem[];
  counts: HistoryCounts;
}) {
  if (items.length === 0) {
    return <p className="text-base text-muted-foreground">아직 발행 이력이 없습니다.</p>;
  }
  return (
    <div className="space-y-3">
      <p className="text-base text-foreground">
        발행 <span className="font-mono font-semibold tabular-nums">{counts.editions}</span>호 · 늦게 발행{" "}
        <span className="font-mono tabular-nums">{counts.late}</span> · 미발행{" "}
        <span className="font-mono tabular-nums">{counts.missed}</span> · 철회{" "}
        <span className="font-mono tabular-nums">{counts.withdrawn}</span> · 정정{" "}
        <span className="font-mono tabular-nums">{counts.errata}</span> · 확정 뒤 결과 변경{" "}
        <span className="font-mono tabular-nums">{counts.resultChanged}</span> · 쉼{" "}
        <span className="font-mono tabular-nums">{counts.paused}</span>
      </p>
      <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
        {items.map((it) => {
          if (it.kind === "missed") {
            return (
              <li key={it.key} className="px-4 py-3 text-base text-foreground">
                <span className="font-semibold">
                  {dateKo(it.date)} {it.meet ?? "전 경마장"}
                </span>{" "}
                <Tag>미발행</Tag>
                <span className="block text-sm text-muted-foreground">
                  사유: {it.reason ?? "확인 중"}
                </span>
              </li>
            );
          }
          if (it.kind === "paused") {
            return (
              <li key={it.key} className="px-4 py-3 text-base text-foreground">
                <span className="font-semibold">
                  {dateKo(it.date)}
                  {it.until && it.until !== it.date ? `~${dateKo(it.until)}` : ""} {it.meet ?? "전 경마장"}
                </span>{" "}
                <Tag>쉼</Tag>
                {it.reason ? (
                  <span className="block text-sm text-muted-foreground">사유: {it.reason}</span>
                ) : null}
              </li>
            );
          }
          return (
            <li key={it.key}>
              <Link
                href={it.href}
                className={cn(
                  "block space-y-1 px-4 py-3 text-base text-foreground transition-colors hover:bg-muted",
                  TAP,
                )}
              >
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="font-semibold">
                    {dateKo(it.date)} {it.meet} {issueLabel(it.issueNo)}
                  </span>
                  {it.late ? <Tag>늦게 발행</Tag> : null}
                  {it.withdrawn ? <Tag>철회</Tag> : null}
                  {it.errata.length > 0 ? <Tag>{`정정 ${it.errata.length}`}</Tag> : null}
                  {it.resultChanged.length > 0 ? <Tag>{`결과 변경 ${it.resultChanged.length}`}</Tag> : null}
                </span>
                <span className="block text-sm text-muted-foreground">
                  {publishStampKo(it.publishedAt)} 발행
                </span>
                {it.withdrawn ? (
                  <span className="block text-sm text-foreground">
                    철회 ({publishStampKo(it.withdrawn.noticed_at)}) — {it.withdrawn.public_text} · 기록에 포함
                  </span>
                ) : null}
                {it.errata.map((n) => (
                  <span key={n.id} className="block text-sm text-foreground">
                    정정 ({publishStampKo(n.noticed_at)}) — {n.public_text}
                  </span>
                ))}
                {it.resultChanged.map((n) => (
                  <span key={n.id} className="block text-sm text-foreground">
                    결과 변경 — {n.public_text}
                  </span>
                ))}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
