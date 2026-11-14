import Link from "next/link";

import { GateNum } from "@/components/race-detail-ui";
import {
  formRacePath,
  runnerAnchorId,
  type FrontRunnerV1,
  type HeadlineV1,
} from "@/lib/racing_form-shared";
import { cn } from "@/lib/utils";

import { TAP } from "./format";

export type HeadlineItem = {
  key: string;
  kind: string;
  text: string;
  /** 경주면 (말 소식이면 #출전마 카드 앵커). 요약 헤드라인은 null */
  href: string | null;
  raceNo: number | null;
  chulNo: number | null;
  horseName: string | null;
};

/** payload 헤드라인 → 화면 항목. 경주·출전번호·마명은 웹이 붙인다 (계약 §3). */
export function buildHeadlineItems(args: {
  date: string;
  meet: string;
  headlines: readonly HeadlineV1[];
  runners: readonly FrontRunnerV1[];
}): HeadlineItem[] {
  return args.headlines.map((h, i) => {
    const horse =
      h.race_no !== null && h.horse_no !== null
        ? args.runners.find((u) => u.race_no === h.race_no && u.horse_no === h.horse_no) ?? null
        : null;
    let href: string | null = null;
    if (h.race_no !== null) {
      href = formRacePath(args.date, args.meet, h.race_no);
      if (h.chul_no !== null) href += `#${runnerAnchorId(h.chul_no)}`;
    }
    return {
      key: `${i}-${h.kind}-${h.race_no ?? ""}-${h.chul_no ?? ""}`,
      kind: h.kind,
      text: h.text,
      href,
      raceNo: h.race_no,
      chulNo: h.chul_no,
      horseName: horse?.horse_name ?? h.horse_no,
    };
  });
}

function Body({ item }: { item: HeadlineItem }) {
  if (item.kind === "stakes") {
    return (
      <>
        <span className="text-sm font-semibold text-muted-foreground">대상경주</span>
        <span className="font-semibold text-foreground">{item.text}</span>
      </>
    );
  }
  return (
    <>
      {item.raceNo !== null ? (
        <span className="font-mono font-bold tabular-nums text-foreground">{item.raceNo}R</span>
      ) : null}
      {item.chulNo !== null ? (
        <>
          <GateNum n={item.chulNo} size={22} />
          <span className="sr-only">번</span>
        </>
      ) : null}
      {item.chulNo !== null && item.horseName ? (
        <span className="font-semibold text-foreground">{item.horseName}</span>
      ) : null}
      <span className="text-foreground">{item.text}</span>
    </>
  );
}

/** 1면 말 소식 헤드라인 — 최대 6개 + "외 n건" (계획 4.5-5). 평가어 없이 KRA 사실만. */
export function Headlines({
  items,
  overflow,
}: {
  items: readonly HeadlineItem[];
  overflow: number;
}) {
  if (items.length === 0) {
    return <p className="text-base text-muted-foreground">이번 호에는 말 소식이 없습니다.</p>;
  }
  const row = cn("flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 text-base", TAP);
  return (
    <div className="space-y-2">
      <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
        {items.map((it) => (
          <li key={it.key}>
            {it.href ? (
              <Link href={it.href} className={cn(row, "transition-colors hover:bg-muted")}>
                <Body item={it} />
              </Link>
            ) : (
              <div className={row}>
                <Body item={it} />
              </div>
            )}
          </li>
        ))}
      </ul>
      {overflow > 0 ? (
        <p className="text-sm text-muted-foreground">
          외 {overflow}건 — 경주면 출전마 카드에서 볼 수 있습니다.
        </p>
      ) : null}
    </div>
  );
}
