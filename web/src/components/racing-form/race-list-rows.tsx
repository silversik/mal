"use client";

import Link from "next/link";
import { useState } from "react";
import { Dialog } from "radix-ui";

import { RankBadge } from "@/components/rank-badge";
import { cn } from "@/lib/utils";

import { FocusLabel } from "./focus-label";
import { FormNum } from "./form-num";
import type { RaceListRow, RacePickView, RaceRowResult } from "./race-list";

/** 터치 타깃 하한 — format.ts 의 TAP 과 같은 값 (그 모듈은 서버 쪽 헬퍼를 끌고 와서 여기 따로 둔다). */
const TAP = "min-h-[max(44px,2.75rem)]";

function ResultMark({ result }: { result: RaceRowResult }) {
  if (result.kind === "void") {
    return (
      <span className="inline-flex h-7 items-center rounded-md border border-border px-2 text-sm font-semibold text-muted-foreground">
        무효
      </span>
    );
  }
  if (result.rank === null) {
    return <span className="text-sm font-semibold text-muted-foreground">순위 없음</span>;
  }
  return (
    <span className="inline-flex items-center gap-1">
      <span className="sr-only">결과</span>
      <RankBadge rank={result.rank} rest="chip" />
      <span className="text-sm text-muted-foreground">착</span>
    </span>
  );
}

/**
 * 팝업의 별 — 마우스를 올리거나 누르면 "고른 기준 n개" 가 말풍선으로 뜬다 (본문에 따로 적지 않는다).
 * 누르는 영역은 ::before 로 넓힌다 (별은 작다).
 */
function StarTip({ count }: { count: number }) {
  const [open, setOpen] = useState(false);
  const tip = `고른 기준 ${count}개`;
  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        aria-label={`주목 — ${tip}`}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        onBlur={() => setOpen(false)}
        className="relative inline-flex items-center rounded-md before:absolute before:-inset-3 before:content-[''] focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <FocusLabel decorative />
      </button>
      {open ? (
        <span
          role="tooltip"
          className="absolute top-full left-1/2 z-10 mt-1.5 -translate-x-1/2 rounded-md bg-foreground px-2 py-1 text-sm font-semibold whitespace-nowrap text-background shadow-md"
        >
          {tip}
        </span>
      ) : null}
    </span>
  );
}

function PickDetail({ pick }: { pick: RacePickView }) {
  return (
    <li className="space-y-1.5 rounded-lg border border-border px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <FormNum n={pick.chulNo} />
        <span className="sr-only">번</span>
        <span className="min-w-0 break-words text-lg font-bold text-foreground">
          {pick.horseName}
        </span>
        {pick.strong ? <StarTip count={pick.criteria.length} /> : null}
        {pick.result ? (
          <span className="ml-auto">
            <ResultMark result={pick.result} />
          </span>
        ) : null}
      </div>
      {pick.criteria.length > 0 ? (
        <div className="space-y-1">
          <ul className="divide-y divide-border border-y border-border">
            {pick.criteria.map((c) => (
              <li key={c.rule} className="py-1.5 text-sm leading-relaxed text-foreground">
                <span className="font-semibold">{c.rule}</span>{" "}
                <span className="font-semibold">{c.mark}</span>
                <span className="block text-muted-foreground">{c.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </li>
  );
}

/**
 * 주목마 버튼 — 보이는 높이는 36px(2.25rem)로 줄이고, 누르는 영역은 ::before 로 위아래 4px 씩 넓혀
 * 44px 을 지킨다 (DESIGN.md 터치 타깃). 마번은 테두리 없이, "주목" 뱃지는 버튼 안에.
 */
const PICK_BUTTON =
  "relative inline-flex min-h-9 min-w-0 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1 text-base font-semibold text-foreground transition-colors before:absolute before:inset-x-0 before:-inset-y-1 before:content-[''] hover:bg-muted focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50";

/** RaceList 의 클라이언트 쪽 — 주목마 버튼과 요약 팝업 하나(열린 경주만 그린다). */
export function RaceListRows({ rows }: { rows: readonly RaceListRow[] }) {
  const [openNo, setOpenNo] = useState<number | null>(null);
  const open = rows.find((r) => r.raceNo === openNo) ?? null;
  return (
    <>
      <ol className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
        {rows.map((r) => {
          return (
            <li
              key={r.raceNo}
              className="grid grid-cols-[3rem_minmax(0,1fr)] items-center gap-x-2 px-3 py-1"
            >
              <Link
                href={r.href}
                aria-label={`${r.raceNo}경주 경주면`}
                className={cn(
                  "inline-flex items-center rounded-md font-mono text-base font-bold tabular-nums text-foreground underline-offset-4 hover:underline",
                  TAP,
                )}
              >
                {r.raceNo}R
              </Link>
              <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 py-1">
                {r.stakes ? (
                  <span className="text-sm font-semibold text-foreground">{r.stakes}</span>
                ) : null}
                {r.picks.map((p) => (
                  <span key={p.chulNo} className="inline-flex min-w-0 items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setOpenNo(r.raceNo)}
                      aria-haspopup="dialog"
                      className={PICK_BUTTON}
                    >
                      <FormNum n={p.chulNo} plain />
                      <span className="sr-only">번</span>
                      <span className="min-w-0 break-words text-left">{p.horseName}</span>
                      {p.strong ? (
                        <FocusLabel size="sm" tip={`고른 기준 ${p.criteria.length}개`} />
                      ) : null}
                    </button>
                    {p.result ? <ResultMark result={p.result} /> : null}
                  </span>
                ))}
              </span>
            </li>
          );
        })}
      </ol>

      <Dialog.Root open={open !== null} onOpenChange={(o) => (o ? undefined : setOpenNo(null))}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
          <Dialog.Content className="theme-v2 fixed top-1/2 left-1/2 z-50 max-h-[85vh] w-[min(92vw,28rem)] -translate-x-1/2 -translate-y-1/2 space-y-3 overflow-y-auto break-keep rounded-xl border border-border bg-card p-4 shadow-xl focus:outline-none">
            {open ? (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Dialog.Title className="text-lg font-bold text-foreground">
                      <span className="font-mono tabular-nums">{open.raceNo}R</span> 주목마
                    </Dialog.Title>
                    <Dialog.Description className="text-sm text-muted-foreground">
                      {open.stakes ? `${open.stakes} · ` : ""}공개 기준들이 함께 고른 말
                    </Dialog.Description>
                  </div>
                  <Dialog.Close
                    className={cn(
                      "inline-flex shrink-0 items-center rounded-md border border-border bg-card px-3 text-sm font-semibold text-foreground transition-colors hover:bg-muted",
                      TAP,
                    )}
                  >
                    닫기
                  </Dialog.Close>
                </div>
                <ul className="space-y-2">
                  {open.picks.map((p) => (
                    <PickDetail key={p.chulNo} pick={p} />
                  ))}
                </ul>
                <Link
                  href={open.href}
                  className={cn(
                    "flex items-center justify-between gap-3 rounded-md border border-border px-3 text-base font-semibold text-foreground transition-colors hover:bg-muted",
                    TAP,
                  )}
                >
                  <span>경주면 전체 보기</span>
                  <span aria-hidden="true" className="text-muted-foreground">
                    ›
                  </span>
                </Link>
              </>
            ) : null}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
