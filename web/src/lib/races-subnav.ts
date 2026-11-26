/**
 * '경기' 영역 서브탭 — 경기 일람 | 경마지 | 대상경주 일정 (docs/feature/racing-form.md 4.4).
 * 순수 모듈 (컴포넌트 `components/races-subnav.tsx` 와 vitest 가 함께 쓴다).
 */
export const RACES_SUBNAV_ITEMS = [
  { href: "/races", label: "경기 일람" },
  { href: "/form", label: "경마지" },
  { href: "/races/schedule", label: "대상경주 일정" },
] as const;

export type RacesSubnavHref = (typeof RACES_SUBNAV_ITEMS)[number]["href"];

/** pathname → 활성 탭 href. /races/schedule 을 /races 보다 먼저 본다. 그 밖은 null. */
export function activeRacesSubnav(pathname: string): RacesSubnavHref | null {
  const under = (base: string) => pathname === base || pathname.startsWith(`${base}/`);
  if (under("/races/schedule")) return "/races/schedule";
  if (under("/form")) return "/form";
  if (under("/races")) return "/races";
  return null;
}
