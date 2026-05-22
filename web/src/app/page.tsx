import { Suspense } from "react";
import Link from "next/link";

import { HorseMark } from "@/components/brand/logo";
import { coatBodyHex, coatBgHex } from "@/lib/coat";
import { VenueIcon } from "@/components/venue-icon";
import { EmptyState } from "@/components/empty-state";
import { WinRateBar } from "@/components/win-rate-bar";
import { RecentRacesSwiper } from "@/components/recent-races-swiper";
import { type RecentWinner } from "@/lib/horses";
import { type Jockey } from "@/lib/jockeys";
import { type RaceInfo } from "@/lib/races";
import { type UpcomingStake } from "@/lib/race_plans";
import { raceKey } from "@/lib/videos";
import { getRecentComments } from "@/lib/comments";
import {
  cachedAllJockeys,
  cachedNextRaceDayRaces,
  cachedRecentRaceDaysRaces,
  cachedRecentTopFinishers,
  cachedRecentWinners,
  cachedUpcomingStakes,
  cachedVideosForRaces,
} from "@/lib/home_data";

function todayKST(): string {
  // KST(UTC+9) 기준 오늘 날짜 — toISOString()은 UTC 반환이라 자정~9시 사이 날짜가 틀림.
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// 같은 KST 날짜라도 결과가 모두 적재된 경기는 "종료" 로. has_results 는
// races.ts 의 getNextRaceDayRaces 가 채워주는 per-race boolean.
function getRaceStatus(race: Pick<RaceInfo, "race_date" | "has_results">): "예정" | "진행중" | "종료" {
  const today = todayKST();
  if (race.race_date < today) return "종료";
  if (race.race_date > today) return "예정";
  return race.has_results ? "종료" : "진행중";
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

/* ── Page shell — Suspense boundaries만 렌더 ─────────────── */

export default function Home() {
  const todayDate = todayKST();
  return (
    <div className="theme-v2 min-h-screen bg-[#fbfbf9]">
      <Suspense fallback={<HeroSkeleton />}>
        <HeroSection todayDate={todayDate} />
      </Suspense>

      <main className="mx-auto w-full max-w-6xl px-6 py-12">
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

        <Suspense fallback={null}>
          <RecentCommentsSection />
        </Suspense>
      </main>
    </div>
  );
}

/* ── Hero ────────────────────────────────────────────── */

async function HeroSection({ todayDate }: { todayDate: string }) {
  const [nextDayRaces, upcomingStakes, heroComments] = await Promise.all([
    cachedNextRaceDayRaces(),
    cachedUpcomingStakes(6),
    getRecentComments(6),
  ]);

  const nextRaceRef = nextDayRaces[0] ?? null;
  const nextRaceDate = nextRaceRef?.race_date ?? null;
  // 같은 KST 날짜의 모든 경기 결과가 적재됐으면 그 날 전체를 "종료"로 본다.
  const nextDayAllFinished =
    nextDayRaces.length > 0 && nextDayRaces.every((r) => r.has_results);
  const isRaceToday = nextRaceDate === todayDate;

  // featured 경주: 대상경주 우선, 없으면 미트별 대표 1경주.
  const detectedStakes = nextDayRaces.filter(isStakesRace);
  const featureRaces =
    detectedStakes.length > 0
      ? detectedStakes.slice(0, 4)
      : MEET_ORDER.flatMap((meet) =>
          nextDayRaces
            .filter((r) => r.meet === meet)
            .sort((a, b) => b.race_no - a.race_no)
            .slice(0, 1),
        );

  const useStakesFallback = featureRaces.length === 0 && upcomingStakes.length > 0;
  const fallbackDate = useStakesFallback ? upcomingStakes[0].race_date : null;
  const fallbackStakes = useStakesFallback
    ? upcomingStakes.filter((s) => s.race_date === fallbackDate).slice(0, 4)
    : [];
  const heroDate = nextRaceDate ?? fallbackDate ?? todayDate;

  const label = isRaceToday
    ? nextDayAllFinished
      ? "오늘 · 종료"
      : "LIVE · 오늘"
    : useStakesFallback
      ? "UPCOMING"
      : "NEXT";
  const title = isRaceToday
    ? "오늘의 핵심"
    : useStakesFallback
      ? "다가오는 대상경주"
      : "다음 진행 예정 경기";
  const moreHref = useStakesFallback ? "/races/schedule" : `/races?date=${heroDate}`;
  const empty = featureRaces.length === 0 && !useStakesFallback;

  return (
    <section className="border-b border-[#e7e7e2] bg-[#fbfbf9] px-5 py-8 md:py-12">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex items-end justify-between gap-4">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#1f6b47]">
              {label} · {heroDate}
            </div>
            <h1 className="mt-1.5 text-2xl font-extrabold tracking-tight text-[#191a18] md:text-3xl">
              {title}
            </h1>
          </div>
          <Link
            href={moreHref}
            className="shrink-0 text-sm font-semibold text-[#1f6b47] transition hover:underline"
          >
            더보기 &rarr;
          </Link>
        </div>

        {empty ? (
          <EmptyState
            title="예정된 경기가 없습니다."
            description="경기 일정을 확인해 보세요."
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[2fr_1fr]">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {useStakesFallback
                ? fallbackStakes.map((s) => <HeroStakeCard key={s.id} stake={s} />)
                : featureRaces.map((r) => <HeroFeatureCard key={r.id} race={r} />)}
            </div>
            <HeroCommentPanel comments={heroComments} />
          </div>
        )}
      </div>
    </section>
  );
}

/* ── Hero feature/stake 카드 (페이퍼 네이티브) ───────────── */

function HeroMetaItem({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex items-baseline gap-1">
      <span className="text-[10px] uppercase tracking-wide text-[#9b9e99]">{label}</span>
      <span className="font-mono text-sm font-semibold tabular-nums text-[#191a18]">{value}</span>
    </span>
  );
}

function HeroFeatureCard({ race }: { race: RaceInfo }) {
  const status = getRaceStatus(race);
  const stakes = isStakesRace(race);
  const href = `/races?date=${race.race_date}&venue=${encodeURIComponent(race.meet)}&race=${race.race_no}`;
  const statusCls =
    status === "진행중"
      ? "bg-[#1f6b47] text-white"
      : status === "예정"
        ? "border border-[#1f6b47] text-[#1f6b47]"
        : "bg-[#f1f1ed] text-[#6b6e6a]";
  return (
    <Link
      href={href}
      className="group block rounded-xl border border-[#e7e7e2] bg-white p-4 transition-all hover:border-[#1f6b47]/50 hover:shadow-sm"
    >
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[#191a18]">
          <VenueIcon meet={race.meet} size={16} />
          <span className="text-sm font-semibold">{race.meet}</span>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${statusCls}`}>
          {status}
        </span>
      </div>
      <h3
        className={`text-base font-bold ${stakes ? "text-[#1f6b47]" : "text-[#191a18] group-hover:text-[#1f6b47]"}`}
      >
        {race.race_name ?? `${race.race_no}R 메인 경주`}
      </h3>
      <div className="mt-3 flex items-center gap-4 border-t border-dashed border-[#e7e7e2] pt-3">
        <HeroMetaItem label="R" value={`${race.race_no}`} />
        {race.start_time && <HeroMetaItem label="출발" value={race.start_time} />}
        <HeroMetaItem label="출주" value={`${race.entry_count ?? "-"}두`} />
      </div>
    </Link>
  );
}

function HeroStakeCard({ stake }: { stake: UpcomingStake }) {
  const displayName = stake.race_name.replace(/\s*\((G[123]|L|특)\)\s*/g, "").trim();
  const tierBadge = stake.tier ?? (stake.grade === "대상" ? "대상" : null);
  return (
    <Link
      href={`/races?date=${stake.race_date}`}
      className="group block rounded-xl border border-[#e7e7e2] bg-white p-4 transition-all hover:border-[#1f6b47]/50 hover:shadow-sm"
    >
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[#191a18]">
          <VenueIcon meet={stake.meet} size={16} />
          <span className="text-sm font-semibold">{stake.meet}</span>
        </div>
        {tierBadge && (
          <span className="rounded-full border border-[#1f6b47] px-2 py-0.5 text-[11px] font-semibold text-[#1f6b47]">
            {tierBadge}
          </span>
        )}
      </div>
      <h3 className="text-base font-bold text-[#1f6b47]">{displayName}</h3>
      <div className="mt-3 flex items-center gap-4 border-t border-dashed border-[#e7e7e2] pt-3">
        <HeroMetaItem label="일자" value={stake.race_date} />
        {stake.distance && <HeroMetaItem label="거리" value={`${stake.distance}m`} />}
        {stake.age_cond && <HeroMetaItem label="조건" value={stake.age_cond} />}
      </div>
    </Link>
  );
}

/* ── Hero 최신 댓글 패널 (오른쪽 열) ─────────────────── */

function HeroCommentPanel({
  comments,
}: {
  comments: Array<{ id: bigint | number | string; entity_href: string; entity_name: string; content: string; created_at: string; author_name: string | null }>;
}) {
  if (comments.length === 0) return null;
  return (
    <div className="flex flex-col rounded-xl border border-[#e7e7e2] bg-white p-4">
      <div className="mb-2.5 text-[11px] font-bold uppercase tracking-[0.1em] text-[#6b6e6a]">
        최신 댓글
      </div>
      <div className="flex flex-col gap-1">
        {comments.slice(0, 5).map((c) => (
          <Link
            key={String(c.id)}
            href={c.entity_href}
            className="rounded-lg px-2.5 py-2 transition-colors hover:bg-[#f1f1ed]"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-[12px] font-semibold text-[#1f6b47]">{c.entity_name}</span>
              <time className="shrink-0 font-mono text-[10px] tabular-nums text-[#6b6e6a]">{commentTimeAgo(c.created_at)}</time>
            </div>
            <p className="line-clamp-1 text-[12px] text-[#6b6e6a]">{c.content}</p>
          </Link>
        ))}
      </div>
    </div>
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

/* ── 최신 댓글 ─────────────────────────────────────── */

function commentTimeAgo(isoStr: string): string {
  const now = new Date();
  const diffMin = Math.floor((now.getTime() - new Date(isoStr).getTime()) / 60_000);
  if (diffMin < 1) return "방금";
  if (diffMin < 60) return `${diffMin}분 전`;
  const h = Math.floor(diffMin / 60);
  if (h < 24) return `${h}시간 전`;
  return `${Math.floor(h / 24)}일 전`;
}

async function RecentCommentsSection() {
  const comments = await getRecentComments(10);
  if (comments.length === 0) return null;

  return (
    <Section title="최신 댓글" href="#" tier="l1">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {comments.map((c) => (
          <Link key={c.id} href={c.entity_href} className="group block rounded-lg border border-primary/8 bg-white p-3 hover:border-secondary/50 hover:shadow-sm transition-all">
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="text-xs font-semibold truncate group-hover:text-primary transition-colors">{c.entity_name}</span>
              <time className="shrink-0 text-[10px] text-muted-foreground tabular-nums">{commentTimeAgo(c.created_at)}</time>
            </div>
            <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">{c.content}</p>
            <p className="mt-1 text-[10px] text-muted-foreground/60">{c.author_name ?? "알 수 없음"}</p>
          </Link>
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

function HeroSkeleton() {
  return (
    <section className="border-b border-[#e7e7e2] bg-[#fbfbf9] px-5 py-8 md:py-12">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6">
          <div className="h-3 w-40 animate-pulse rounded bg-[#e7e7e2]" />
          <div className="mt-2 h-8 w-56 animate-pulse rounded bg-[#e7e7e2]" />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-32 animate-pulse rounded-xl border border-[#e7e7e2] bg-white" />
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
