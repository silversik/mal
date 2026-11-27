import Link from "next/link";
import type { ReactNode } from "react";

import { FORM_HUB_PATH } from "@/lib/racing_form-shared";

const WEEKDAY_KO = "일월화수목금토";

/** "2026년 11월 27일 금요일" — 날짜 문자열 기준 (프로세스 TZ 무관). */
export function paperDateKo(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${y}년 ${m}월 ${d}일 ${WEEKDAY_KO[dow]}요일`;
}

/**
 * 호 한 부를 담는 지면 (DESIGN.md Decisions Log 2026-11-27) — 특정 경주일·경마장의 경마지에 들어가면
 * 사이트 본문과 구분된 종이 한 장 안에서 읽는다. 첫 장은 요약(1면), 다음 장부터 라운드(경주면).
 *
 * 신문 느낌은 타이포와 괘선으로만 낸다 (DESIGN "minimal — 타이포 + 여백 + 1px 헤어라인", 텍스처·장식 금지):
 * 제호(헤비) → 굵은 이중 괘선 → 날짜·경마장 줄. 색은 paper 위의 surface 한 장 + ink.
 * 모바일은 화면 폭을 다 쓰고(좌우 테두리 없음) md 부터 가운데 한 장.
 */
export function PaperSheet({
  date,
  meet,
  children,
}: {
  date: string;
  meet: string;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-[46rem] border-y border-border bg-card shadow-sm md:rounded-sm md:border">
      <div className="px-4 pt-4 md:px-8 md:pt-6">
        <p className="text-center">
          <Link
            href={FORM_HUB_PATH}
            className="inline-flex min-h-[max(44px,2.75rem)] items-center text-3xl font-extrabold tracking-tight text-foreground md:text-4xl"
          >
            mal.kr 경마지
          </Link>
        </p>
        <p className="mt-1 flex items-baseline justify-between gap-3 border-t-4 border-b border-double border-foreground py-1.5 text-sm font-semibold text-foreground">
          <span className="font-mono tabular-nums">{paperDateKo(date)}</span>
          <span>{meet}</span>
        </p>
      </div>
      <div className="px-4 py-5 md:px-8 md:py-7">{children}</div>
    </div>
  );
}
