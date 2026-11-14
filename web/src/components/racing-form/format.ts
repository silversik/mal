/**
 * 경마지 화면 표기 헬퍼 — 순수 함수만 (DB·React 없음).
 * 숫자는 payload 의 정수(0.1 단위 `*_tenths`)를 그대로 받아 문자열로만 바꾼다 (계산·반올림 없음).
 */
import { mdKo } from "@/lib/racing_form-shared";

/** 터치 타깃 하한 — DESIGN.md "max(44px, 2.75rem)" (큰글씨 모드에서 함께 커진다). */
export const TAP = "min-h-[max(44px,2.75rem)]";

/** 0.1kg 정수 → "53.5kg". 없으면 null. */
export function kgText(tenths: number | null | undefined): string | null {
  if (tenths === null || tenths === undefined) return null;
  return `${(tenths / 10).toFixed(1)}kg`;
}

/** 0.1초 정수 → "1:13.5" (60초 미만은 "59.8"). */
export function timeText(tenths: number): string {
  const whole = Math.floor(tenths / 10);
  const frac = tenths % 10;
  const min = Math.floor(whole / 60);
  const sec = whole % 60;
  return min > 0 ? `${min}:${String(sec).padStart(2, "0")}.${frac}` : `${sec}.${frac}`;
}

/** 착순 → "3착" / "순위 없음" (실격 등 착순 없는 출주). */
export function rankText(rank: number | null | undefined): string {
  return rank === null || rank === undefined ? "순위 없음" : `${rank}착`;
}

/** "2026-10-18" → "10월 18일" (payload 날짜 한 형식). */
export function shortDate(date: string): string {
  return mdKo(date);
}

/** 정수 증감 → { text: "▲4" | "▼2" | "±0", sign }. 색과 부호를 함께 쓰는 곳에서만 쓴다 (DESIGN 색맹 대비). */
export function deltaText(delta: number, unit = ""): { text: string; sign: 1 | -1 | 0 } {
  if (delta > 0) return { text: `▲${delta}${unit}`, sign: 1 };
  if (delta < 0) return { text: `▼${Math.abs(delta)}${unit}`, sign: -1 };
  return { text: `±0${unit}`, sign: 0 };
}

/** 증감 부호 → semantic 토큰 클래스 (양 = positive 올리브, 음 = negative clay, 0 = muted). */
export function deltaClass(sign: 1 | -1 | 0): string {
  if (sign > 0) return "text-positive";
  if (sign < 0) return "text-negative";
  return "text-muted-foreground";
}

/** 경기 일람(출전표·결과 원본) 경마장 하루 목록 경로 — race-seo raceDetailPath 와 같은 파라미터 규칙. */
export function racesDayPath(date: string, meet: string): string {
  return `/races?date=${date}&venue=${encodeURIComponent(meet)}`;
}
