import Link from "next/link";

import { editionStateText, type EditionState } from "@/lib/racing_form-shared";
import { cn } from "@/lib/utils";

import { racesDayPath, TAP } from "./format";

/** 상태별 덧붙임 한 줄 — 무엇이 언제 일어나는지만 사실로. */
function detailOf(state: EditionState["state"]): string | null {
  switch (state) {
    case "planned":
      return "경주 전날 오후 6시에 발행하고, 발행한 뒤에는 고치지 않습니다.";
    case "delayed":
      return "발행이 늦어지면 '늦게 발행'으로 표시하고 실제 발행 시각을 함께 적습니다.";
    case "missed":
      return "발행하지 않은 호도 기록 페이지의 발행 이력에 남깁니다.";
    case "paused":
      return "쉬는 동안의 호는 발행하지 않고, 발행 이력에 '쉼'으로 남깁니다.";
    default:
      return null;
  }
}

/**
 * 1면의 발행 전·미발행·쉼 안내 (계획 4.3) — 발행본이 없을 때 고정본 대신 이 상자 하나.
 * "출전표는 경기 일람에서 ›" 로 사실 정보(출전표)로 보낸다.
 */
export function EditionStateMessage({
  state,
  date,
  meet,
  className,
}: {
  state: EditionState;
  date: string;
  meet: string;
  className?: string;
}) {
  const text = editionStateText(state);
  if (!text) return null;
  const detail = detailOf(state.state);
  return (
    <section
      aria-labelledby="state-title"
      className={cn("space-y-2 rounded-xl border border-border bg-card px-4 py-4", className)}
    >
      <h2 id="state-title" className="text-lg font-bold leading-snug text-foreground">
        {text}
      </h2>
      {detail ? <p className="text-base text-muted-foreground">{detail}</p> : null}
      <Link
        href={racesDayPath(date, meet)}
        className={cn(
          "inline-flex items-center text-base font-semibold text-foreground underline-offset-4 transition-colors hover:underline",
          TAP,
        )}
      >
        출전표는 경기 일람에서 ›
      </Link>
    </section>
  );
}
