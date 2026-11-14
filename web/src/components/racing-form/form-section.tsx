import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * 경마지 화면의 h2 섹션 — 제목 + 1px 헤어라인 + 우측 보조(선택). 장식 없음 (DESIGN.md minimal).
 * 페이지 h1 은 하나 — 섹션은 늘 h2.
 */
export function FormSection({
  id,
  title,
  right,
  children,
  className,
}: {
  /** 앵커 겸 aria-labelledby 대상 (`${id}-title`) */
  id: string;
  title: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const headingId = `${id}-title`;
  return (
    <section id={id} aria-labelledby={headingId} className={cn("scroll-mt-20", className)}>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-x-3 gap-y-1 border-b border-border pb-1.5">
        <h2 id={headingId} className="text-lg font-bold text-foreground md:text-xl">
          {title}
        </h2>
        {right ? <div className="min-w-0">{right}</div> : null}
      </div>
      {children}
    </section>
  );
}
