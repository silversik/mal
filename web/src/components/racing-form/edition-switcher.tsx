"use client";

import { useRouter } from "next/navigation";

export type EditionOption = {
  href: string;
  /** "11월 28일(토) 서울 · 제1호" */
  label: string;
};

/**
 * 지면 바깥 오른쪽 위의 "다른 경마지" 드롭다운 (DESIGN.md Decisions Log 2026-11-27).
 * 지면 안의 경마장 탭을 대신한다 — 같은 주의 다른 호(다른 날·다른 경마장)로 옮겨 가고, 맨 아래는 전체 목록(허브).
 * 기본 <select> — 휴대폰에서 OS 선택창이 떠 고령 사용자도 고르기 쉽다. 44px.
 */
export function EditionSwitcher({
  options,
  current,
  hubHref,
}: {
  options: readonly EditionOption[];
  /** 지금 보는 호의 href (options 에 없으면 맨 위에 "이 경마지" 로 둔다) */
  current: string;
  hubHref: string;
}) {
  const router = useRouter();
  const known = options.some((o) => o.href === current);
  return (
    <label className="inline-flex items-center gap-2 text-sm font-semibold text-foreground">
      <span>다른 경마지</span>
      <select
        value={current}
        onChange={(e) => {
          if (e.target.value !== current) router.push(e.target.value);
        }}
        className="min-h-[max(44px,2.75rem)] max-w-[15rem] rounded-md border border-border bg-card px-2 text-base font-semibold text-foreground"
      >
        {known ? null : <option value={current}>이 경마지</option>}
        {options.map((o) => (
          <option key={o.href} value={o.href}>
            {o.label}
          </option>
        ))}
        <option value={hubHref}>경마지 전체 보기</option>
      </select>
    </label>
  );
}
