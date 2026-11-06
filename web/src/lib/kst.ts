// KST(Asia/Seoul) 기준 날짜/연도 — 서버 프로세스 TZ(컨테이너 UTC 등)에 의존하지 않는다.
// new Date().getFullYear() 는 process TZ 를 따르므로 UTC 컨테이너에선 09:00 KST 에 날짜가 바뀐다.

const KST_DATE_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** KST 기준 오늘 "YYYY-MM-DD". */
export function kstToday(now: Date = new Date()): string {
  const parts = KST_DATE_FMT.formatToParts(now);
  const get = (t: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** KST 기준 현재 연도. */
export function kstYear(now: Date = new Date()): number {
  return Number(kstToday(now).slice(0, 4));
}
