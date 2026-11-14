/**
 * /form 페이지 공용 조회 — generateMetadata 와 page 가 React cache() 로 한 요청에 한 번만 읽는다.
 * (`_lib` 은 private folder 라 라우트가 아니다.)
 *
 * - 모든 판정은 racing_form-shared 의 순수 함수(editionState 등)에 맡긴다. 여기서는 읽고 묶기만 한다.
 * - now 는 요청마다 한 번 — 같은 요청의 메타데이터와 본문이 같은 시각으로 판정한다.
 */
import { cache } from "react";

import { getEditionHead, getFormCalendar, getLaunchAt, getNotices, getRaceSlice } from "@/lib/racing_form";
import {
  editionState,
  meetFromSlug,
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
