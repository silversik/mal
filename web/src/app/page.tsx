import { Suspense } from "react";
import Link from "next/link";

import { HorseMark } from "@/components/brand/logo";
import { coatBodyHex, coatBgHex } from "@/lib/coat";
import { VenueIcon } from "@/components/venue-icon";
import { TodayMeetCard } from "@/components/today-meet-card";
import { EmptyState } from "@/components/empty-state";
import { WinRateBar } from "@/components/win-rate-bar";
import { RecentRacesSwiper } from "@/components/recent-races-swiper";
import { Badge } from "@/components/ui/badge";
import { type RecentWinner } from "@/lib/horses";
import { type Jockey } from "@/lib/jockeys";
import { type RaceInfo } from "@/lib/races";
import { type UpcomingStake } from "@/lib/race_plans";
import { raceKey } from "@/lib/videos";
import {
  cachedAllJockeys,
  cachedNextRaceDayRaces,
  cachedRaceDayCard,
  cachedRecentRaceDaysRaces,
  cachedRecentTopFinishers,
  cachedRecentWinners,
  cachedUpcomingStakes,
  cachedVideosForRaces,
} from "@/lib/home_data";

function getRaceStatus(raceDate: string): "예정" | "진행중" | "종료" {
  const today = new Date().toISOString().slice(0, 10);
  if (raceDate < today) return "종료";
  if (raceDate === today) return "진행중";
  return "예정";
}

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

function todayKST(): string {
  // KST(UTC+9) 기준 오늘 날짜 — toISOString()은 UTC 반환이라 자정~9시 사이 날짜가 틀림.
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/* ── Page shell — Suspense boundaries만 렌더 ─────────────── */

export default function Home() {
  const todayDate = todayKST();
  return (
    <div className="min-h-screen">
      <Suspense fallback={<HeroSkeleton todayDate={todayDate} />}>
        <HeroSection todayDate={todayDate} />
      </Suspense>

      <main className="mx-auto w-full max-w-6xl px-6 py-12">
        <Suspense fallback={null}>
          <TodayMeetSection todayDate={todayDate} />
        </Suspense>

        <Suspense fallback={<SwiperSkeleton />}>
          <RecentRacesSection />
        </Suspense>

        <div className="grid grid-cols-1 gap-10 lg:grid-cols-2">
          <Suspense fallback={<RowsSkeleton title="최근 승리 마필" href="/horses?sort=wins" />}>
            <RecentWinnersSection />
          </Suspense>

          <Suspense fallback={<RowsSkeleton title="TOP 기수 랭킹" href="/jockeys" />}>
            <TopJockeysSection />
          </Suspense>
        </div>
      </main>
    </div>
  );
}

/* ── Hero ────────────────────────────────────────────── */

async function HeroSection({ todayDate }: { todayDate: string }) {
  const [nextDayRaces, upcomingStakes] = await Promise.all([
    cachedNextRaceDayRaces(),
    cachedUpcomingStakes(6),
  ]);

  const nextRaceDate = nextDayRaces[0]?.race_date ?? null;
  const nextStatus = nextRaceDate ? getRaceStatus(nextRaceDate) : null;
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

  return (
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
  );
}

/* ── 오늘의 경주 (개최일에만) ─────────────────────────── */

async function TodayMeetSection({ todayDate }: { todayDate: string }) {
  const nextDayRaces = await cachedNextRaceDayRaces();
  const isRaceToday = nextDayRaces[0]?.race_date === todayDate;
  if (!isRaceToday) return null;

  const todayMeets = MEET_ORDER.filter((m) => nextDayRaces.some((r) => r.meet === m));
  const todayCards = await Promise.all(
    todayMeets.map((meet) =>
      cachedRaceDayCard(todayDate, meet).then((c) => ({
        meet,
        phase: c.phase,
        byRace: Object.fromEntries(c.byRace),
      })),
    ),
  );

  if (todayCards.length === 0) return null;

  return (
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
  );
}

/* ── 최근 경기 (스와이퍼) ─────────────────────────────── */

async function RecentRacesSection() {
  const [recentDayRaces, recentTopFinishers] = await Promise.all([
    cachedRecentRaceDaysRaces(4),
    cachedRecentTopFinishers(4),
  ]);

  const videos = await cachedVideosForRaces(
    recentDayRaces.map((r) => ({ race_date: r.race_date, meet: r.meet, race_no: r.race_no })),
  );
  const videoEntries = videos.map(([k, v]) => ({ key: String(k), video: v }));
  void raceKey;

  return (
    <Section title="최근 경기" href="/races" tier="l1">
      {recentDayRaces.length === 0 ? (
        <EmptyState title="적재된 경기가 없습니다." description="크롤러가 데이터를 수집하면 표시됩니다." />
      ) : (
        <RecentRacesSwiper
          races={recentDayRaces}
          finishers={recentTopFinishers}
          videos={videoEntries}
        />
      )}
    </Section>
  );
}

/* ── 최근 승리 마필 ──────────────────────────────────── */

async function RecentWinnersSection() {
  const horses = await cachedRecentWinners(8);
  return (
    <Section title="최근 승리 마필" href="/horses?sort=wins" tier="l1">
      <div className="space-y-2">
        {horses.map((h) => (
          <HorseRow key={h.horse_no} horse={h} />
        ))}
      </div>
    </Section>
  );
}

/* ── TOP 기수 랭킹 ──────────────────────────────────── */

async function TopJockeysSection() {
  const jockeys = await cachedAllJockeys(8);
  return (
    <Section title="TOP 기수 랭킹" href="/jockeys" tier="l1">
      <div className="space-y-2">
        {jockeys.map((j, i) => (
          <JockeyRow key={j.jk_no} jockey={j} rank={i + 1} />
        ))}
      </div>
    </Section>
  );
}

/* ── Skeleton fallbacks ───────────────────────────────── */

function HeroSkeleton({ todayDate }: { todayDate: string }) {
  return (
    <section className="relative overflow-hidden border-b border-primary/5 bg-primary px-6 py-10 md:py-16 text-white">
      <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'url("https://www.transparenttextures.com/patterns/carbon-fibre.png")' }}></div>
      <div className="relative mx-auto max-w-6xl">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="mb-3 inline-block rounded border border-champagne-gold/40 px-2 py-0.5 text-[10px] text-champagne-gold/70">
              · {todayDate}
            </div>
            <div className="h-9 w-72 animate-pulse rounded bg-white/10 md:h-12 md:w-96" />
          </div>
        </div>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          {[0, 1].map((i) => (
            <div key={i} className="h-40 animate-pulse rounded-xl border border-white/10 bg-white/5" />
          ))}
        </div>
      </div>
    </section>
  );
}

function SwiperSkeleton() {
  return (
    <section className="mb-12">
      <div className="mb-5 flex items-end justify-between border-b-2 border-primary/15 pb-2">
        <h2 className="font-serif text-3xl font-bold text-primary">최근 경기</h2>
      </div>
      <div className="flex gap-3 overflow-hidden sm:gap-4">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="h-56 w-[55%] shrink-0 animate-pulse rounded-xl border border-primary/8 bg-white sm:w-48" />
        ))}
      </div>
    </section>
  );
}

function RowsSkeleton({ title, href }: { title: string; href: string }) {
  return (
    <Section title={title} href={href} tier="l1">
      <div className="space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 rounded-lg border border-primary/5 bg-white p-3">
            <div className="h-10 w-10 shrink-0 animate-pulse rounded bg-muted" />
            <div className="flex-1 space-y-1.5">
              <div className="h-4 w-32 animate-pulse rounded bg-muted" />
              <div className="h-3 w-20 animate-pulse rounded bg-muted/70" />
            </div>
          </div>
        ))}
      </div>
    </Section>
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
          className="text-sm font-semibold text-slate-grey transition hover:text-primary"
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

const RANK_BADGE_STYLE: Record<number, string> = {
  1: "bg-champagne-gold text-primary",
  2: "bg-slate-400 text-white",
  3: "bg-amber-700 text-white",
};

function HorseRow({ horse }: { horse: RecentWinner }) {
  return (
    <Link href={`/horse/${horse.horse_no}`}>
      <div className="flex items-center gap-3 p-3 bg-white border border-primary/5 rounded-lg hover:border-secondary/50 hover:shadow-sm transition-all group">
        <HorseMark
          size={40}
          radius={8}
          badgeFill={coatBgHex(horse.coat_color)}
          markFill={coatBodyHex(horse.coat_color)}
        />
        <div className="min-w-0 flex-1">
          <div className="font-bold truncate group-hover:text-primary transition-colors">{horse.horse_name}</div>
          <div className="text-[11px] text-slate-grey uppercase tracking-wider font-semibold">
            {horse.country} · {horse.sex}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-sm font-bold text-primary">{horse.win_count}승</div>
          <div className="text-[10px] font-mono text-muted-foreground">
            {horse.last_win_date}
          </div>
        </div>
      </div>
    </Link>
  );
}

function JockeyRow({ jockey, rank }: { jockey: Jockey; rank: number }) {
  return (
    <Link href={`/jockey/${jockey.jk_no}`}>
      <div className="flex items-center gap-3 p-3 bg-white border border-primary/5 rounded-lg hover:border-secondary/50 hover:shadow-sm transition-all group">
        <span
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-mono text-xs font-bold tabular-nums ${
            RANK_BADGE_STYLE[rank] ?? "bg-muted text-foreground"
          }`}
        >
          {rank}
        </span>
        <div className="w-10 h-10 shrink-0 bg-primary rounded flex items-center justify-center font-bold text-champagne-gold shadow-inner border border-white/10 uppercase">
          {jockey.jk_name.slice(0, 1)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-bold truncate group-hover:text-primary transition-colors">{jockey.jk_name}</div>
          <div className="text-[11px] text-slate-grey font-semibold uppercase tracking-wider">{jockey.meet} 기수</div>
        </div>
        <div className="min-w-[70px] shrink-0">
          <WinRateBar rate={jockey.win_rate} />
        </div>
      </div>
    </Link>
  );
}
