import Link from "next/link";

import { GateNum } from "@/components/race-detail-ui";
import type { SettlementLine } from "@/lib/racing_form-shared";
import { cn } from "@/lib/utils";

import { TAP } from "./format";
import { PickMark } from "./pick-mark";

/** 발행 후 기수 변경 한 건 (덧씌움 — 고정본은 그대로). */
export type StatusChange = {
  key: string;
  href: string;
  raceNo: number;
  chulNo: number;
  horseName: string;
  before: string | null;
  after: string;
  reason: string | null;
};

/** 경주일의 다음 경주. time 이 null 이면 "발주 시각 미정". */
export type NextRace = { raceNo: number; time: string | null; href: string } | { raceNo: null };

/** 기수 변경 수집 주기 안내 (계획 4.7). */
export const JOCKEY_CHANGE_SOURCE_NOTE = "기수 변경 자료는 매일 오전 6시 25분에 수집합니다.";

/** "정민준→조지호 (기수 부상)" */
export function changeText(c: Pick<StatusChange, "before" | "after" | "reason">): string {
  return `${c.before ?? "-"}→${c.after}${c.reason ? ` (${c.reason})` : ""}`;
}

/**
 * 1면 상태 블록 — 하나만, 내용이 없으면 그리지 않는다 (계획 4.5-2).
 *  - 경주 후: 결산 한 줄 (4.8, 분수·고정 순서·강조 없음)
 *  - 경주일: "다음 경주 3R 14:30" (모르면 "발주 시각 미정")
 *  - 경주 전·경주일: "발행 후 바뀐 것 n건" (발행 후 기수 변경)
 */
export function StatusBlock({
  settlement,
  next,
  changes,
}: {
  settlement: SettlementLine | null;
  next: NextRace | null;
  /** null = 이 줄을 싣지 않음 */
  changes: readonly StatusChange[] | null;
}) {
  if (!settlement && !next && !changes) return null;
  return (
    <section
      aria-labelledby="status-title"
      className="space-y-3 rounded-xl border border-border bg-card px-4 py-3"
    >
      <h2 id="status-title" className="sr-only">
        지금 상태
      </h2>

      {settlement ? (
        <div className="space-y-1 text-base leading-relaxed text-foreground">
          <p>
            <span className="font-semibold">{settlement.head}</span> — {settlement.consensus}
          </p>
          {settlement.marks ? (
            <p>
              <PickMark mark={1} /> {settlement.marks}
            </p>
          ) : null}
          {settlement.provisional ? (
            <p className="text-sm text-muted-foreground">({settlement.provisional})</p>
          ) : null}
        </div>
      ) : null}

      {next ? (
        next.raceNo === null ? (
          <p className="text-base text-foreground">
            <span className="font-semibold">다음 경주</span> — 발주 시각 미정
          </p>
        ) : (
          <Link
            href={next.href}
            className={cn(
              "flex items-center justify-between gap-3 rounded-md border border-border px-3 text-base text-foreground transition-colors hover:bg-muted",
              TAP,
            )}
          >
            <span>
              <span className="font-semibold">다음 경주</span>{" "}
              <span className="font-mono font-bold tabular-nums">{next.raceNo}R</span>
              {next.time ? (
                <span className="font-mono tabular-nums"> {next.time}</span>
              ) : (
                <span className="text-muted-foreground"> 발주 시각 미정</span>
              )}
            </span>
            <span aria-hidden="true" className="text-muted-foreground">
              ›
            </span>
          </Link>
        )
      ) : null}

      {changes ? (
        <div className="space-y-2">
          <p className="text-base text-foreground">
            <span className="font-semibold">
              {changes.length > 0 ? `발행 후 바뀐 것 ${changes.length}건` : "발행 후 바뀐 것 없음"}
            </span>
            {changes.length > 0 ? " — 예상·판정은 발행한 그대로 둡니다" : null}
          </p>
          {changes.length > 0 ? (
            <ul className="space-y-1">
              {changes.map((c) => (
                <li key={c.key}>
                  <Link
                    href={c.href}
                    className={cn(
                      "flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md px-1 text-sm text-foreground transition-colors hover:bg-muted",
                      TAP,
                    )}
                  >
                    <span className="font-mono font-bold tabular-nums">{c.raceNo}R</span>
                    <GateNum n={c.chulNo} size={22} />
                    <span className="sr-only">번</span>
                    <span className="font-semibold">{c.horseName}</span>
                    <span>· 발행 후 기수 변경 {changeText(c)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
          <p className="text-small text-muted-foreground">{JOCKEY_CHANGE_SOURCE_NOTE}</p>
        </div>
      ) : null}
    </section>
  );
}
