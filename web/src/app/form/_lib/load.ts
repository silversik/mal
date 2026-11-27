/**
 * /form 페이지 공용 조회 — generateMetadata 와 page 가 React cache() 로 한 요청에 한 번만 읽는다.
 * (`_lib` 은 private folder 라 라우트가 아니다.)
 *
 * - 모든 판정은 racing_form-shared 의 순수 함수(editionState 등)에 맡긴다. 여기서는 읽고 묶기만 한다.
 * - now 는 요청마다 한 번 — 같은 요청의 메타데이터와 본문이 같은 시각으로 판정한다.
 */
import { cache } from "react";

import {
  getEditionHead,
  getEditionIndex,
  getFormCalendar,
  getLaunchAt,
  getNotices,
  getRaceSlice,
} from "@/lib/racing_form";
import {
  addDays,
  dateKo,
  editionState,
  formEditionPath,
  issueLabel,
  meetFromSlug,
  meetOrder,
  mondayOf,
  normalizeFormDate,
  normalizeFormRaceNo,
  SCHEMA_VERSION,
  type FormMeet,
} from "@/lib/racing_form-shared";

export type EditionParams = { date: string; meet: FormMeet };

/** URL 조각 검증 — 날짜(실재하는 YYYY-MM-DD)·경마장 slug(seoul·jeju·busan). 아니면 null → 404. */
export function parseEditionParams(p: { date: string; meet: string }): EditionParams | null {
  const date = normalizeFormDate(p.date);
  const meet = meetFromSlug(p.meet);
  return date && meet ? { date, meet } : null;
}

/** + 경주 번호 1~30 ("03" 은 3). */
export function parseRaceParams(p: {
  date: string;
  meet: string;
  race: string;
}): (EditionParams & { raceNo: number }) | null {
  const base = parseEditionParams(p);
  const raceNo = normalizeFormRaceNo(p.race);
  return base && raceNo !== null ? { ...base, raceNo } : null;
}

/** 한 호(경주일, 경마장)의 화면 상태 — 달력·발행본 머리·공지·출시 시각을 한 번에. */
export const loadEdition = cache(async (date: string, meet: FormMeet) => {
  const now = new Date();
  const [calendar, head, notices, launchAt] = await Promise.all([
    getFormCalendar(date, date),
    getEditionHead(date, meet),
    getNotices(date, meet),
    getLaunchAt(),
  ]);
  const planned = calendar.find((c) => c.meet === meet) ?? null;
  const state = editionState({ planned, edition: head, notices, now, launchAt });
  return {
    now,
    planned,
    head,
    notices,
    launchAt,
    state,
    /** 그날 계획된 경마장 (MEET_ORDER 순) — 1면 경마장 칩 */
    meets: calendar.map((c) => c.meet),
  };
});

export type EditionLoad = Awaited<ReturnType<typeof loadEdition>>;

/**
 * 그 호가 속한 주(월~일)의 경마지 목록 — 지면 바깥 "다른 경마지" 드롭다운 재료.
 * 달력(출전표가 있는 경주일) ∪ 발행본, 경주일 → 경마장 순. 출시 전이라 404 인 호는 뺀다 (허브와 같은 판정).
 */
export const loadWeekEditionOptions = cache(async (date: string) => {
  const weekStart = mondayOf(date);
  const weekEnd = addDays(weekStart, 6);
  const [calendar, editions, launchAt] = await Promise.all([
    getFormCalendar(weekStart, weekEnd),
    getEditionIndex(weekStart, weekEnd),
    getLaunchAt(),
  ]);
  const now = new Date();
  const keys = new Map<string, { date: string; meet: string }>();
  for (const c of calendar) keys.set(`${c.race_date}|${c.meet}`, { date: c.race_date, meet: c.meet });
  for (const e of editions) keys.set(`${e.race_date}|${e.meet}`, { date: e.race_date, meet: e.meet });
  return [...keys.values()]
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : meetOrder(a.meet) - meetOrder(b.meet)))
    .flatMap((k) => {
      const planned = calendar.find((c) => c.race_date === k.date && c.meet === k.meet) ?? null;
      const edition = editions.find((e) => e.race_date === k.date && e.meet === k.meet) ?? null;
      const st = editionState({
        planned: planned ?? (edition ? { race_date: edition.race_date, meet: edition.meet, first_post: null } : null),
        edition,
        notices: [],
        now,
        launchAt,
      });
      if (st.notFound) return [];
      return [
        {
          href: formEditionPath(k.date, k.meet),
          label: `${dateKo(k.date)} ${k.meet}${edition ? ` · ${issueLabel(edition.issue_no)}` : " · 발행 예정"}`,
        },
      ];
    });
});

/**
 * 경주면 — 발행본이 있을 때만 payload 에서 그 경주 하나를 잘라 읽는다.
 *  - slice null + unknownSchema → "새 형식" 안내, slice null + 경주 없음 → 404
 */
export const loadRace = cache(async (date: string, meet: FormMeet, raceNo: number) => {
  const ed = await loadEdition(date, meet);
  if (!ed.head || ed.state.notFound) return { ed, slice: null, unknownSchema: false, raceKnown: false };
  if (ed.head.schema_version !== SCHEMA_VERSION) {
    return { ed, slice: null, unknownSchema: true, raceKnown: true };
  }
  const slice = await getRaceSlice(ed.head.id, raceNo);
  // payload 형식 오류로 null 이면(요약에는 그 경주가 있음) 404 대신 "새 형식" 안내
  const raceKnown = ed.head.summary?.races.some((r) => r.race_no === raceNo) ?? slice !== null;
  return { ed, slice, unknownSchema: slice === null && raceKnown, raceKnown };
});
