import { unstable_cache } from "next/cache";

import { getRecentWinners } from "./horses";
import { getAllJockeys } from "./jockeys";
import {
  getNextRaceDayRaces,
  getRecentRaceDaysRaces,
  getRecentTopFinishers,
  getRaceDayCard,
} from "./races";
import { getUpcomingStakesFromPlans } from "./race_plans";
import { getVideosForRaces, type RaceKey } from "./videos";
import type { VideoItem } from "./video-helpers";

// 홈 페이지 전용 캐시. 각 데이터의 신선도 요구치에 맞춰 TTL 다르게 설정.
// - 결과/영상 (results-driven): 5분 — 크롤러가 결과 적재할 때만 변동
// - 랭킹 (jockeys): 30분 — 통산 통계라 분 단위 변화 없음
// - 다음 경기 일정: 5분 — 일 단위 변화
// - 오늘 경기 카드: 60초 — 실시간 결과 노출 시 신선도 우선

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

export const cachedRaceDayCard = unstable_cache(
  async (raceDate: string, meet: string) => {
    const c = await getRaceDayCard(raceDate, meet);
    return { phase: c.phase, byRace: Array.from(c.byRace.entries()) };
  },
  ["home:raceDayCard"],
  { revalidate: 60, tags: ["home", "race_card"] },
);
