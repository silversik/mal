import Link from "next/link";

import { HorseAvatar } from "@/components/horse-avatar";
import { VenueIcon } from "@/components/venue-icon";
import { TodayMeetCard } from "@/components/today-meet-card";
import { EmptyState } from "@/components/empty-state";
import { WinRateBar } from "@/components/win-rate-bar";
import { Badge } from "@/components/ui/badge";
import { getRecentHorses, type Horse } from "@/lib/horses";
import { getAllJockeys, type Jockey } from "@/lib/jockeys";
import { getLatestNews, type NewsItem } from "@/lib/news";
import { getRecentPosts, type CommunityPost } from "@/lib/posts";
import {
  getNextRaceDayRaces,
  getRecentRaceDaysRaces,
  getRaceDayCard,
  type RaceInfo,
} from "@/lib/races";
import {
  getUpcomingStakesFromPlans,
  type UpcomingStake,
} from "@/lib/race_plans";

function getRaceStatus(raceDate: string): "예정" | "진행중" | "종료" {
  const today = new Date().toISOString().slice(0, 10);
  if (raceDate < today) return "종료";
  if (raceDate === today) return "진행중";
  return "예정";
}

const STATUS_STYLE = {
  종료: "bg-muted text-slate-grey border-slate-grey/20",
  진행중: "bg-dirt-brown/10 text-dirt-brown border-dirt-brown/30 animate-pulse",
  예정: "bg-champagne-gold text-white border-champagne-gold shadow-sm",
} as const;

const MEET_ORDER = ["서울", "제주", "부경"] as const;

function isStakesRace(r: RaceInfo): boolean {
  return !!(
    (r.grade &&
      (r.grade.includes("G") ||
        r.grade.includes("L") ||
        r.grade.includes("대상"))) ||
    (r.race_name && r.race_name.includes("대상"))
  );
}

export default async function Home() {
  // KST(UTC+9) 기준 오늘 날짜 — toISOString()은 UTC 반환이라 자정~9시 사이 날짜가 틀림.
  const todayDate = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const [
    recentDayRaces,
    horses,
    jockeys,
    nextDayRaces,
    upcomingStakes,
    news,
    recentPosts,
  ] = await Promise.all([
    getRecentRaceDaysRaces(2),
    getRecentHorses(6),
    getAllJockeys(6),
    getNextRaceDayRaces(),
    getUpcomingStakesFromPlans(6),
    getLatestNews(3),
    getRecentPosts(5),
  ]);

  // 오늘 경기가 있으면 경마장별 라운드 카드(출전/결과) 로드.
  const isRaceToday = nextDayRaces[0]?.race_date === todayDate;
  const todayMeets = isRaceToday
    ? MEET_ORDER.filter((m) => nextDayRaces.some((r) => r.meet === m))
    : [];
  const todayCards = await Promise.all(
    todayMeets.map((meet) =>
      getRaceDayCard(todayDate, meet).then((c) => ({
        meet,
        phase: c.phase,
        // Map is not serializable for Client Components — convert to plain object.
        byRace: Object.fromEntries(c.byRace),
      })),
    ),
  );

  /*
   * "다음 진행 예정 경기": 가장 가까운 개최일(오늘 포함)의 경주 중 대상/G/L 경주를 우선,
   * 등급 메타데이터가 없으면 경마장별 마지막 경주(일반적으로 메인 경주)로 대체.
   * KRA 공공API(racedetailresult)가 등급·경주명을 제공하지 않아서 생기는 갭.
   *
   * races 테이블에 미래 일자가 아직 없는 평일에는 race_plans(API40) 의 예정된
   * 대상경주를 폴백으로 노출한다 — 일정 자체가 비어있는 건 아니므로 "없음" 으로
   * 보이는 것을 방지.
   */
  const nextRaceDate = nextDayRaces[0]?.race_date ?? null;
  const nextStatus = nextRaceDate
    ? getRaceStatus(nextRaceDate)
    : null;
  const detectedStakes = nextDayRaces.filter(isStakesRace);
  const featureRaces =
    detectedStakes.length > 0
      ? detectedStakes
      : MEET_ORDER.flatMap((meet) => {
          const meetRaces = nextDayRaces
            .filter((r) => r.meet === meet)
            .sort((a, b) => b.race_no - a.race_no);
          return meetRaces.slice(0, 1);
        });

  // 폴백: races 가 비어있을 때만 race_plans 의 가장 가까운 일자만 뽑아 노출.
  const useStakesFallback = featureRaces.length === 0 && upcomingStakes.length > 0;
  const fallbackDate = useStakesFallback ? upcomingStakes[0].race_date : null;
  const fallbackStakes = useStakesFallback
    ? upcomingStakes.filter((s) => s.race_date === fallbackDate)
    : [];

  const heroDate = nextRaceDate ?? fallbackDate;
  const heroStatus = heroDate ? getRaceStatus(heroDate) : null;
  const nextDayHref = heroDate
    ? `/races?date=${heroDate}`
    : `/races?date=${todayDate}`;

  /*
   * "최근 주요 경기": 최근 개최일 × 경마장 단위로 묶어서 라운드 버튼 형태로 노출.
   * 날짜 내림차순 → 경마장 정렬 순서 유지.
   */
  const recentGroups = groupByDateAndMeet(recentDayRaces);

  return (
    <div className="min-h-screen">
      <section className="relative overflow-hidden border-b border-primary/5 bg-primary px-6 py-10 md:py-16 text-white">
        <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'url("https://www.transparenttextures.com/patterns/carbon-fibre.png")' }}></div>
        <div className="relative mx-auto max-w-6xl">
          <div>
            <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
              <div>
                <Badge variant="outline" className="mb-3 border-champagne-gold text-champagne-gold">
                  {heroStatus === "진행중" ? "LIVE" : useStakesFallback ? "UPCOMING" : "NEXT"} · {heroDate ?? todayDate}
                </Badge>
                <h1 className="font-serif text-2xl font-bold tracking-tight text-sand-ivory md:text-4xl">
                  {nextStatus === "진행중"
                    ? "진행중인 경기"
                    : useStakesFallback
                      ? "다가오는 대상경주"
                      : "다음 진행 예정 경기"}
                </h1>
              </div>
              <Link
                href={useStakesFallback ? "/races/schedule" : nextDayHref}
                className="text-sm font-semibold text-champagne-gold transition hover:text-white"
              >
                더보기 &rarr;
              </Link>
            </div>

            {featureRaces.length === 0 && !useStakesFallback ? (
              <EmptyState
                title="예정된 경기가 없습니다."
                description="경기 일정을 확인해 보세요."
                variant="dark"
              />
            ) : useStakesFallback ? (
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                {fallbackStakes.map((s) => (
                  <StakesPlanCard key={s.id} stake={s} />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                {featureRaces.map((r) => (
                  <BannerRaceCard key={r.id} race={r} />
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      <main className="mx-auto w-full max-w-6xl px-6 py-12">
        {/* 오늘의 경주 — 경기 있는 날만 노출 */}
        {todayCards.length > 0 && (
          <Section
            title={`오늘의 경주 ${todayCards[0]?.phase === "post" ? "· 결과" : "· 출전표"}`}
            href={`/races?date=${todayDate}`}
            tier="l1"
          >
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              {todayCards.map(({ meet, phase, byRace }) => (
                <TodayMeetCard
                  key={meet}
                  meet={meet}
                  date={todayDate}
                  races={nextDayRaces.filter((r) => r.meet === meet)}
                  byRace={byRace}
                  phase={phase}
                />
              ))}
            </div>
          </Section>
        )}

        {/* 경기 */}
        <Section title="최근 주요 경기" href="/races" tier="l1">
          {recentGroups.length === 0 ? (
            <EmptyState title="적재된 경기가 없습니다." description="크롤러가 데이터를 수집하면 표시됩니다." />
          ) : (
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              {recentGroups.map((g) => (
                <RaceDayGroupCard key={`${g.date}-${g.meet}`} group={g} />
              ))}
            </div>
          )}
        </Section>

        {/* 뉴스 미리보기 */}
        <Section title="뉴스" href="/news">
          {news.length === 0 ? (
            <EmptyState title="아직 수집된 공지가 없습니다." />
          ) : (
            <div className="divide-y divide-primary/5 rounded-lg border border-primary/5 bg-white">
              {news.map((n) => (
                <NewsRow key={n.id} item={n} />
              ))}
            </div>
          )}
        </Section>

        {/* 커뮤니티 최근 글 */}
        <Section title="커뮤니티 최근 글" href="/board">
          {recentPosts.length === 0 ? (
            <EmptyState title="아직 작성된 글이 없습니다." />
          ) : (
            <div className="divide-y divide-primary/5 rounded-lg border border-primary/5 bg-white">
              {recentPosts.map((p) => (
                <PostRow key={p.id} post={p} />
              ))}
            </div>
          )}
        </Section>

        {/* 마필 & 기수 레이아웃 */}
        <div className="grid grid-cols-1 gap-12 lg:grid-cols-2">
          <Section title="최근 등록 마필" href="/horses" tier="l3">
            <div className="space-y-4">
              {horses.map((h) => (
                <HorseRow key={h.horse_no} horse={h} />
              ))}
            </div>
          </Section>

          <Section title="TOP 기수 랭킹" href="/jockeys" tier="l3">
            <div className="space-y-4">
              {jockeys.map((j) => (
                <JockeyRow key={j.jk_no} jockey={j} />
              ))}
            </div>
          </Section>
        </div>
      </main>
    </div>
  );
}

/* ── Section wrapper ──────────────────────────────────── */

const SECTION_TIER = {
  l1: {
    section: "mb-12",
    header: "mb-5 border-b-2 border-primary/15 pb-2",
    h2: "font-serif text-3xl font-bold text-primary",
  },
  l2: {
    section: "mb-10",
    header: "mb-5 border-b border-primary/10 pb-2",
    h2: "font-serif text-xl font-semibold text-primary",
  },
  l3: {
    section: "mb-8",
    header: "mb-4 border-b border-primary/8 pb-2",
    h2: "text-sm font-bold uppercase tracking-widest text-slate-grey",
  },
} as const;

function Section({
  title,
  href,
  tier = "l2",
  children,
}: {
  title: string;
  href: string;
  tier?: "l1" | "l2" | "l3";
  children: React.ReactNode;
}) {
  const t = SECTION_TIER[tier];
  return (
    <section className={t.section}>
      <div className={`flex items-end justify-between ${t.header}`}>
        <h2 className={t.h2}>{title}</h2>
        <Link
          href={href}
          className="text-sm font-semibold text-slate-grey transition hover:text-secondary"
        >
          더보기 &rarr;
        </Link>
      </div>
      {children}
    </section>
  );
}

/* ── Cards ────────────────────────────────────────────── */

const BANNER_STATUS_STYLE = {
  종료: "bg-white/10 text-white/70 border-white/20",
  진행중: "bg-champagne-gold/15 text-champagne-gold border-champagne-gold/40 animate-pulse",
  예정: "bg-champagne-gold text-primary border-champagne-gold",
} as const;

function BannerRaceCard({ race }: { race: RaceInfo }) {
  const status = getRaceStatus(race.race_date);
  const stakes = isStakesRace(race);
  const href = `/races?date=${race.race_date}&venue=${encodeURIComponent(race.meet)}&race=${race.race_no}`;
  return (
    <Link href={href}>
      <div className="group cursor-pointer rounded-xl border border-white/10 bg-white/5 p-6 backdrop-blur-sm transition-all hover:border-champagne-gold/50 hover:bg-white/10">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2 text-champagne-gold">
            <VenueIcon meet={race.meet} size={18} />
            <span className="text-sm font-semibold">{race.meet}</span>
          </div>
          <Badge variant="outline" className={`border ${BANNER_STATUS_STYLE[status]}`}>
            {status}
          </Badge>
        </div>
        <h3 className={`mb-2 text-xl font-bold transition-colors ${stakes ? "text-champagne-gold" : "text-sand-ivory group-hover:text-champagne-gold"}`}>
          {race.race_name ?? `${race.race_no}R 메인 경주`}
        </h3>
        <div className="mt-4 flex items-center justify-between border-t border-dashed border-white/10 pt-4">
          <div className="flex flex-col">
            <span className="text-[10px] font-bold uppercase text-white/50">Race</span>
            <span className="text-sm font-semibold text-white">{race.race_no}R</span>
          </div>
          {race.start_time && (
            <div className="flex flex-col text-center">
              <span className="text-[10px] font-bold uppercase text-white/50">Start</span>
              <span className="font-mono text-sm font-semibold tabular-nums text-white">{race.start_time}</span>
            </div>
          )}
          <div className="flex flex-col text-right">
            <span className="text-[10px] font-bold uppercase text-white/50">Entries</span>
            <span className="text-sm font-semibold text-white">{race.entry_count ?? "-"}두</span>
          </div>
        </div>
      </div>
    </Link>
  );
}

function StakesPlanCard({ stake }: { stake: UpcomingStake }) {
  const displayName = stake.race_name.replace(/\s*\((G[123]|L|특)\)\s*/g, "").trim();
  const tierBadge = stake.tier ?? (stake.grade === "대상" ? "대상" : null);
  return (
    <Link href={`/races?date=${stake.race_date}`}>
      <div className="group cursor-pointer rounded-xl border border-champagne-gold/30 bg-white/5 p-6 backdrop-blur-sm transition-all hover:border-champagne-gold/60 hover:bg-white/10">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2 text-champagne-gold">
            <VenueIcon meet={stake.meet} size={18} />
            <span className="text-sm font-semibold">{stake.meet}</span>
          </div>
          {tierBadge && (
            <Badge variant="outline" className="border border-champagne-gold/60 bg-champagne-gold/15 text-champagne-gold">
              {tierBadge}
            </Badge>
          )}
        </div>
        <h3 className="mb-2 text-xl font-bold text-champagne-gold transition-colors">
          {displayName}
        </h3>
        <div className="mt-4 flex items-center justify-between border-t border-dashed border-white/10 pt-4">
          <div className="flex flex-col">
            <span className="text-[10px] font-bold uppercase text-white/50">Date</span>
            <span className="font-mono text-sm font-semibold tabular-nums text-white">{stake.race_date}</span>
          </div>
          {stake.distance && (
            <div className="flex flex-col text-center">
              <span className="text-[10px] font-bold uppercase text-white/50">Dist</span>
              <span className="font-mono text-sm font-semibold tabular-nums text-white">{stake.distance}m</span>
            </div>
          )}
          {stake.age_cond && (
            <div className="flex flex-col text-right">
              <span className="text-[10px] font-bold uppercase text-white/50">Age</span>
              <span className="text-sm font-semibold text-white">{stake.age_cond}</span>
            </div>
          )}
        </div>
      </div>
    </Link>
  );
}

type RaceDayGroup = {
  date: string;
  meet: string;
  races: RaceInfo[];
};

function groupByDateAndMeet(races: RaceInfo[]): RaceDayGroup[] {
  const map = new Map<string, RaceDayGroup>();
  for (const race of races) {
    const key = `${race.race_date}__${race.meet}`;
    let group = map.get(key);
    if (!group) {
      group = { date: race.race_date, meet: race.meet, races: [] };
      map.set(key, group);
    }
    group.races.push(race);
  }
  const meetRank = (m: string) => {
    const idx = MEET_ORDER.indexOf(m as (typeof MEET_ORDER)[number]);
    return idx === -1 ? MEET_ORDER.length : idx;
  };
  return Array.from(map.values())
    .map((g) => ({
      ...g,
      races: [...g.races].sort((a, b) => a.race_no - b.race_no),
    }))
    .sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return meetRank(a.meet) - meetRank(b.meet);
    });
}

function RaceDayGroupCard({ group }: { group: RaceDayGroup }) {
  const status = getRaceStatus(group.date);
  const stakes = group.races.filter(isStakesRace);
  return (
    <div className="royal-card overflow-hidden">
      <div className="flex items-center justify-between border-b border-primary/10 bg-primary/5 px-5 py-3">
        <div className="flex items-center gap-2">
          <VenueIcon meet={group.meet} size={16} />
          <span className="font-semibold text-sm">{group.meet}</span>
          <span className="font-mono text-xs text-slate-grey tabular-nums">
            {group.date}
          </span>
        </div>
        <Badge variant="outline" className={`border ${STATUS_STYLE[status]}`}>
          {status}
        </Badge>
      </div>

      {stakes.length > 0 && (
        <ul className="divide-y divide-primary/5 border-b border-primary/5">
          {stakes.map((r) => (
            <li key={r.id}>
              <Link
                href={`/races?date=${r.race_date}&venue=${encodeURIComponent(r.meet)}&race=${r.race_no}`}
                className="flex items-center gap-2 px-5 py-2 transition hover:bg-champagne-gold/5"
              >
                <span className="flex h-6 w-8 shrink-0 items-center justify-center rounded bg-champagne-gold text-[11px] font-bold text-white tabular-nums">
                  {r.race_no}R
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-semibold text-champagne-gold">
                  {r.race_name ?? `${r.race_no}라운드`}
                </span>
                {r.grade && (
                  <span className="shrink-0 text-[10px] font-bold uppercase text-champagne-gold/80">
                    {r.grade}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap gap-1.5 p-5">
        {group.races.map((r) => {
          const isStakes = isStakesRace(r);
          return (
            <Link
              key={r.id}
              href={`/races?date=${r.race_date}&venue=${encodeURIComponent(r.meet)}&race=${r.race_no}`}
              title={r.race_name ?? `${r.race_no}라운드`}
              className={[
                "flex h-9 min-w-9 items-center justify-center rounded-md border px-2 text-xs font-bold tabular-nums transition",
                isStakes
                  ? "border-champagne-gold/40 bg-champagne-gold/10 text-champagne-gold hover:bg-champagne-gold/20"
                  : "border-primary/10 bg-white text-primary hover:border-primary/30 hover:bg-primary/5",
              ].join(" ")}
            >
              {r.race_no}R
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function HorseRow({ horse }: { horse: Horse }) {
  return (
    <Link href={`/horse/${horse.horse_no}`}>
      <div className="flex items-center justify-between p-4 bg-white border border-primary/5 rounded-lg hover:border-secondary/50 hover:shadow-sm transition-all group">
        <div className="flex items-center gap-4">
          <HorseAvatar coatColor={horse.coat_color} size={40} />
          <div>
            <div className="font-bold group-hover:text-primary transition-colors">{horse.horse_name}</div>
            <div className="text-xs text-slate-grey uppercase tracking-wider font-semibold">{horse.country} · {horse.sex}</div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs font-bold text-slate-grey">NO.{horse.horse_no}</div>
        </div>
      </div>
    </Link>
  );
}

function JockeyRow({ jockey }: { jockey: Jockey }) {
  return (
    <Link href={`/jockey/${jockey.jk_no}`}>
      <div className="flex items-center justify-between p-4 bg-white border border-primary/5 rounded-lg hover:border-secondary/50 hover:shadow-sm transition-all group">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 bg-primary rounded flex items-center justify-center font-bold text-champagne-gold shadow-inner border border-white/10 uppercase">
            {jockey.jk_name.slice(0, 1)}
          </div>
          <div>
            <div className="font-bold group-hover:text-primary transition-colors">{jockey.jk_name}</div>
            <div className="text-xs text-slate-grey font-semibold uppercase tracking-wider">{jockey.meet} 기수</div>
          </div>
        </div>
        <div className="min-w-[60px]">
          <WinRateBar rate={jockey.win_rate} />
        </div>
      </div>
    </Link>
  );
}

function PostRow({ post }: { post: CommunityPost }) {
  return (
    <Link
      href={`/board/${post.id}`}
      className="block first:rounded-t-lg last:rounded-b-lg"
    >
      <div className="group flex items-center justify-between gap-4 px-4 py-2.5 transition-colors hover:bg-muted/50">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold transition-colors group-hover:text-primary">
            {post.title}
          </div>
          <div className="mt-0.5 text-xs text-slate-grey">
            {post.author_name ?? "익명"}
          </div>
        </div>
        <div className="shrink-0 font-mono text-xs text-slate-grey tabular-nums">
          {post.created_at.slice(0, 10)}
        </div>
      </div>
    </Link>
  );
}

function NewsRow({ item }: { item: NewsItem }) {
  return (
    <a
      href={item.link}
      target="_blank"
      rel="noopener noreferrer"
      className="block first:rounded-t-lg last:rounded-b-lg"
    >
      <div className="group flex items-center justify-between gap-4 px-4 py-2.5 transition-colors hover:bg-muted/50">
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-sm group-hover:text-primary transition-colors line-clamp-1">
            {item.title}
          </div>
        </div>
        <div className="text-xs text-slate-grey font-mono shrink-0">
          {item.published_at.slice(0, 10)}
        </div>
      </div>
    </a>
  );
}


