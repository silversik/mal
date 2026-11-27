"use client";

import Link from "next/link";
import { useState } from "react";
import { Dialog } from "radix-ui";

import type { EditionPickerGroup } from "@/lib/racing_form-shared";
import { cn } from "@/lib/utils";

const TAP = "min-h-[max(44px,2.75rem)]";
const BTN =
  "inline-flex items-center justify-center rounded-md border px-3 text-base font-semibold transition-colors";

/**
 * 지면 바깥 오른쪽 위의 "경마지 선택" — 누르면 팝업 (DESIGN.md Decisions Log 2026-11-27).
 * 팝업 위쪽은 호 번호 드롭다운(제1호·제2호 … · 발행 예정), 아래쪽은 그 호의 경마지를 날짜별 버튼으로.
 * 지금 보는 호는 brown 채움 + aria-current. 맨 아래 "경마지 전체 보기"(허브).
 */
export function EditionPicker({
  groups,
  currentHref,
  hubHref,
}: {
  groups: readonly EditionPickerGroup[];
  /** 지금 보는 호 (1면 주소) */
  currentHref: string;
  hubHref: string;
}) {
  const home =
    groups.find((g) => g.items.some((it) => it.href === currentHref))?.key ?? groups[0]?.key ?? "";
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState(home);
  const group = groups.find((g) => g.key === key) ?? null;
  // 날짜별로 묶는다 — 같은 날 여러 경마장이면 한 줄에 버튼이 나란히
  const dates = group ? [...new Set(group.items.map((it) => it.date))] : [];

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setKey(home); // 열 때마다 지금 호의 번호에서 시작
      }}
    >
      <Dialog.Trigger
        className={cn(BTN, TAP, "border-border bg-card text-foreground hover:bg-muted")}
      >
        경마지 선택
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Content className="theme-v2 fixed top-1/2 left-1/2 z-50 max-h-[85vh] w-[min(92vw,26rem)] -translate-x-1/2 -translate-y-1/2 space-y-4 overflow-y-auto break-keep rounded-xl border border-border bg-card p-4 shadow-xl focus:outline-none">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <Dialog.Title className="text-lg font-bold text-foreground">경마지 선택</Dialog.Title>
              <Dialog.Description className="text-sm text-muted-foreground">
                호를 고르면 그 호의 경마지가 날짜별로 나옵니다
              </Dialog.Description>
            </div>
            <Dialog.Close
              className={cn(BTN, TAP, "shrink-0 border-border bg-card text-sm text-foreground hover:bg-muted")}
            >
              닫기
            </Dialog.Close>
          </div>

          {groups.length > 0 ? (
            <>
              <label className="block space-y-1">
                <span className="text-sm font-semibold text-muted-foreground">호</span>
                <select
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  className={cn(
                    "block w-full rounded-md border border-border bg-card px-3 text-base font-semibold text-foreground",
                    TAP,
                  )}
                >
                  {groups.map((g) => (
                    <option key={g.key} value={g.key}>
                      {g.label}
                    </option>
                  ))}
                </select>
              </label>

              <ul className="space-y-2">
                {dates.map((d) => (
                  <li key={d} className="flex flex-wrap gap-2">
                    {group?.items
                      .filter((it) => it.date === d)
                      .map((it) =>
                        it.href === currentHref ? (
                          <span
                            key={it.href}
                            aria-current="page"
                            className={cn(BTN, TAP, "border-brown bg-brown text-[var(--brown-fg)]")}
                          >
                            {it.label}
                          </span>
                        ) : (
                          <Link
                            key={it.href}
                            href={it.href}
                            onClick={() => setOpen(false)}
                            className={cn(BTN, TAP, "border-border bg-card text-foreground hover:bg-muted")}
                          >
                            {it.label}
                          </Link>
                        ),
                      )}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-base text-muted-foreground">아직 발행한 경마지가 없습니다.</p>
          )}

          <Link
            href={hubHref}
            onClick={() => setOpen(false)}
            className={cn(
              "flex items-center justify-between gap-3 rounded-md border border-border px-3 text-base font-semibold text-foreground transition-colors hover:bg-muted",
              TAP,
            )}
          >
            <span>경마지 전체 보기</span>
            <span aria-hidden="true" className="text-muted-foreground">
              ›
            </span>
          </Link>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
