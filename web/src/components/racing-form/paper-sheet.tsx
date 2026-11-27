import Link from "next/link";
import type { ReactNode } from "react";

import { dateKo, issueLabel } from "@/lib/racing_form-shared";
import { cn } from "@/lib/utils";

/** 지면 제호 — "서울 11월 28일(토) 제1호 경마지" (발행 전이면 호 번호 없이 "서울 11월 28일(토) 경마지"). */
export function paperTitleKo(date: string, meet: string, issueNo: number | null): string {
  return [meet, dateKo(date), issueNo !== null ? issueLabel(issueNo) : null, "경마지"]
    .filter(Boolean)
    .join(" ");
}

/**
 * 호 한 부를 담는 지면 (DESIGN.md Decisions Log 2026-11-27) — 특정 경주일·경마장의 경마지에 들어가면
 * 사이트 본문과 구분된 종이 한 장 안에서 읽는다. 첫 장은 요약(1면), 다음 장부터 라운드(경주면).
 *
 * 틀만 그린다 (DB 를 읽지 않는 레이아웃이 쓴다) — 제호는 호 번호를 아는 페이지가 PaperMasthead 로 얹는다.
 * `relative`: 지면 바깥 오른쪽 위의 "다른 경마지" 드롭다운(EditionSwitcher)이 이 틀을 기준으로 놓인다.
 * 모바일은 화면 폭을 다 쓰고(좌우 테두리 없음) md 부터 가운데 한 장.
 */
export function PaperSheet({ children }: { children: ReactNode }) {
  return (
    <div className="relative mx-auto w-full max-w-[46rem] border-y border-border bg-card shadow-sm md:rounded-sm md:border">
      <div className="px-4 py-5 md:px-8 md:py-7">{children}</div>
    </div>
  );
}

/**
 * 지면 제호 + 굵은 이중 괘선. 신문 느낌은 타이포와 괘선으로만 낸다
 * (DESIGN "minimal — 타이포 + 여백 + 1px 헤어라인", 텍스처·세리프·장식 금지).
 * 1면에서는 페이지 제목(h1), 경주면에서는 1면(요약)으로 가는 링크 — 페이지 h1 은 늘 하나.
 */
export function PaperMasthead({
  title,
  as = "h1",
  href,
}: {
  title: string;
  as?: "h1" | "p";
  /** 주면 제호가 그곳(요약 장)으로 가는 링크가 된다 */
  href?: string;
}) {
  const Tag = as;
  const text = "text-2xl font-extrabold tracking-tight text-balance text-foreground md:text-3xl";
  return (
    <div className="border-b-4 border-double border-foreground pb-2 text-center">
      <Tag className={cn(href ? "" : text)}>
        {href ? (
          <Link
            href={href}
            className={cn(text, "inline-flex min-h-[max(44px,2.75rem)] items-center underline-offset-4 hover:underline")}
          >
            {title}
          </Link>
        ) : (
          title
        )}
      </Tag>
    </div>
  );
}
