/**
 * /races 상세(?date=&venue=&race=) SEO helper — 순수 함수만 (DB 의존 없음).
 *
 * 경주 페이지는 searchParams 로만 구분되므로 canonical 을 "/races" 하나로 두면
 * 모든 경주가 한 URL 로 합쳐져 색인되지 않는다. 파라미터를 정규화해 페이지 자기
 * 자신의 URL 을 canonical 로 쓰고, sitemap 도 같은 builder 로 loc 를 만든다.
 */

export const RACE_MEETS = ["서울", "제주", "부경"] as const;

type RawParam = string | string[] | undefined;

export type NormalizedRaceParams = {
  date: string | null;   // YYYY-MM-DD (실재 날짜만)
  venue: string | null;  // RACE_MEETS 중 하나
  race: number | null;   // 1..99
};

function first(v: RawParam): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/** YYYY-MM-DD 형식 + 달력상 실재하는 날짜만 통과. */
export function normalizeRaceDate(v: RawParam): string | null {
  const s = first(v)?.trim();
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== m - 1 ||
    dt.getUTCDate() !== d
  ) {
    return null;
  }
  return s;
}

export function normalizeRaceParams(sp: {
  date?: RawParam;
  venue?: RawParam;
  race?: RawParam;
}): NormalizedRaceParams {
  const date = normalizeRaceDate(sp.date);
  const venueRaw = first(sp.venue)?.trim();
  const venue =
    venueRaw && (RACE_MEETS as readonly string[]).includes(venueRaw)
      ? venueRaw
      : null;
  const raceRaw = first(sp.race)?.trim();
  // "03" 같은 0 패딩도 3 으로 정규화.
  const raceNum = raceRaw && /^\d{1,2}$/.test(raceRaw) ? Number(raceRaw) : NaN;
  const race = raceNum >= 1 && raceNum <= 99 ? raceNum : null;
  return { date, venue, race };
}

/** 경주 상세 경로. 파라미터 순서 고정(date→venue→race), venue 는 URL 인코딩. */
export function raceDetailPath(date: string, meet: string, raceNo: number): string {
  return `/races?date=${date}&venue=${encodeURIComponent(meet)}&race=${raceNo}`;
}

/**
 * 정규화된 파라미터 → canonical 경로.
 *   date+venue+race 모두 유효 → 경주 상세
 *   date 만 유효             → 해당 일자 (/races?date=)
 *   그 외                     → /races
 */
export function buildRaceCanonical(p: NormalizedRaceParams): string {
  if (!p.date) return "/races";
  if (p.venue && p.race !== null) return raceDetailPath(p.date, p.venue, p.race);
  return `/races?date=${p.date}`;
}

export type RaceSeoInfo = {
  race_name: string | null;
  grade: string | null;
  distance: number | null;
  track_type: string | null;
  has_results: boolean;
};

/** 대상·특별경주만 경주명을 제목에 붙인다 (일반 경주명은 노이즈). */
function stakesName(r: RaceSeoInfo): string | null {
  const name = r.race_name?.trim();
  if (!name) return null;
  const g = r.grade ?? "";
  const isStakes =
    g.includes("G") || g.includes("L") || g.includes("대상") || name.includes("대상");
  return isStakes ? name : null;
}

export function buildRaceTitle(
  date: string,
  venue: string,
  raceNo: number,
  info: RaceSeoInfo | null,
): string {
  const suffix = info && !info.has_results ? "출전표" : "경주 결과";
  const name = info ? stakesName(info) : null;
  return `${date} ${venue} ${raceNo}R${name ? ` ${name}` : ""} ${suffix}`;
}

export function buildRaceDescription(
  date: string,
  venue: string,
  raceNo: number,
  info: RaceSeoInfo | null,
): string {
  const [y, m, d] = date.split("-").map(Number);
  const head = `${y}년 ${m}월 ${d}일 ${venue} 제${raceNo}경주`;
  const name = info?.race_name?.trim();
  const facts = info
    ? [
        info.distance ? `${info.distance}m` : null,
        info.grade,
        info.track_type,
      ].filter(Boolean)
    : [];
  const body =
    info && !info.has_results
      ? "출전마·기수·조교사·최근 전적"
      : "착순·출전마·기수·조교사·배당";
  return `${head}${name ? ` ${name}` : ""}${facts.length ? ` (${facts.join(" · ")})` : ""} — ${body} 데이터.`;
}
