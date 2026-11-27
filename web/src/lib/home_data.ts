import { unstable_cache } from "next/cache";

import { getRecentWinners } from "./horses";
import { getAllJockeys } from "./jockeys";
import {
  getNextRaceDayRaces,
  getRecentRaceDaysRaces,
  getRecentTopFinishers,
} from "./races";
import { getUpcomingStakesFromPlans } from "./race_plans";
import { loadHomeFormCards, type HomeFormCard } from "./racing_form";
import { getVideosForRaces, type RaceKey } from "./videos";
import type { VideoItem } from "./video-helpers";

// 홈 페이지 전용 캐시. 각 데이터의 신선도 요구치에 맞춰 TTL 다르게 설정.
// - 결과/영상 (results-driven): 5분 — 크롤러가 결과 적재할 때만 변동
// - 랭킹 (jockeys): 30분 — 통산 통계라 분 단위 변화 없음
// - 다음 경기 일정: 5분 — 일 단위 변화

export const cachedRecentRaceDaysRaces = unstable_cache(
  (days: number) => getRecentRaceDaysRaces(days),
  ["home:recentRaceDaysRaces"],
  { revalidate: 300, tags: ["home", "races"] },
);

export const cachedRecentTopFinishers = unstable_cache(
  (days: number) => getRecentTopFinishers(days),
  ["home:recentTopFinishers"],
  { revalidate: 300, tags: ["home", "race_results"] },
);

export const cachedRecentWinners = unstable_cache(
  (limit: number) => getRecentWinners(limit),
  ["home:recentWinners"],
  { revalidate: 300, tags: ["home", "race_results"] },
);

export const cachedAllJockeys = unstable_cache(
  (limit: number) => getAllJockeys(limit),
  ["home:allJockeys"],
  { revalidate: 1800, tags: ["home", "jockeys"] },
);

export const cachedNextRaceDayRaces = unstable_cache(
  () => getNextRaceDayRaces(),
  ["home:nextRaceDayRaces"],
  { revalidate: 300, tags: ["home", "races"] },
);

export const cachedUpcomingStakes = unstable_cache(
  (limit: number) => getUpcomingStakesFromPlans(limit),
  ["home:upcomingStakes"],
  { revalidate: 600, tags: ["home", "race_plans"] },
);

// 경마지 카드 — 발행은 하루 한 번(전날 18:00), 정산은 30분마다라 5분이면 충분.
const cachedHomeFormCardsRaw = unstable_cache(
  (today: string) => loadHomeFormCards(today),
  ["home:formCards"],
  { revalidate: 300, tags: ["home", "racing_form"] },
);

/** 홈 '경마지' 카드 재료(발행본 + 정산). 실패하면 [] — try/catch 는 캐시 바깥(실패를 캐시하지 않는다). */
export async function cachedHomeFormCardsSafe(today: string): Promise<HomeFormCard[]> {
  try {
    return await cachedHomeFormCardsRaw(today);
  } catch (err) {
    console.error("[home] 경마지 카드 조회 실패", err);
    return [];
  }
}

export const cachedVideosForRaces = unstable_cache(
  async (
    races: Array<{ race_date: string; meet: string | null; race_no: number }>,
  ): Promise<Array<[RaceKey, VideoItem]>> => {
    const m = await getVideosForRaces(races);
    return Array.from(m.entries());
  },
  ["home:videosForRaces"],
  { revalidate: 300, tags: ["home", "videos"] },
);
