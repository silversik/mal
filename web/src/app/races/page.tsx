import Link from "next/link";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { RaceDatePicker } from "@/components/race-date-picker";
import { VenueIcon } from "@/components/venue-icon";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { getDailyBetTotalP, getUserBalance } from "@/lib/balances";
import { getRaceBetState } from "@/lib/bets";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  getAllRaceDates,
  getRaceDataSyncedAt,
  getRaceEntries,
  getRacesByDate,
  type RaceEntry,
  type RaceInfo,
} from "@/lib/races";
import {
  getUpcomingStakesFromPlans,
  type UpcomingStake,
} from "@/lib/race_plans";
import {
  getRaceComboDividends,
  POOL_LABEL,
  POOL_ORDERED,
  type ComboPool,
  type RaceComboDividend,
} from "@/lib/race_combo_dividends";
import {
  getRacePoolSales,
  POOL_DISPLAY_ORDER,
  type RacePoolSales,
} from "@/lib/race_pool_sales";
import { getRaceVideo, youtubeWatchUrl } from "@/lib/videos";

import { BetForm } from "./bet-form";
import { EntryCards } from "./entry-cards";

// KRBC 채널(UCsIvYoihIg37E96LkG-XHAw)의 라이브 URL — 방송 중이면 현재 스트림으로 자동 리다이렉트.
const KRBC_LIVE_URL =
  "https://www.youtube.com/channel/UCsIvYoihIg37E96LkG-XHAw/live";

type SearchParams = { date?: string; venue?: string; race?: string };

const MEET_ORDER = ["서울", "제주", "부경"] as const;

/* ── date helpers ────────────────────────────────────────── */

/**
 * 정렬된 YYYY-MM-DD 리스트(`raceDates`)에서 기준일의 바로 이전/다음
 * "경기 있는 날" 을 반환. 현재 날짜가 리스트에 없어도 주변 레이스데이로 점프한다.
 */
function findNearbyRaceDate(
  raceDates: string[],
  currentDate: string,
  direction: "prev" | "next",
): string | null {
  if (raceDates.length === 0) return null;
  if (direction === "prev") {
    let candidate: string | null = null;
    for (const d of raceDates) {
      if (d < currentDate) candidate = d;
      else break;
    }
    return candidate;
  }
  return raceDates.find((d) => d > currentDate) ?? null;
}

function formatDateLabel(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dow = ["일", "월", "화", "수", "목", "금", "토"][
    new Date(y, m - 1, d).getDay()
  ];
  return `${m}월 ${d}일 (${dow})`;
}

/**
 * Postgres `timestamptz::text` 포맷을 Asia/Seoul 시각 기준 짧은 문자열로 변환.
 */
function formatSyncedAt(isoWithTz: string): string {
  const normalized = isoWithTz
    .replace(" ", "T")
    .replace(/([+-]\d{2})$/, "$1:00");
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return isoWithTz;
  const parts = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("month")}/${get("day")} ${get("hour")}:${get("minute")}`;
}

function isStakesRace(r: RaceInfo): boolean {
  return !!(
    (r.grade &&
      (r.grade.includes("G") ||
        r.grade.includes("L") ||
        r.grade.includes("대상"))) ||
    (r.race_name && r.race_name.includes("대상"))
  );
}

/** 두 날짜(YYYY-MM-DD) 사이의 일수 차이. */
function daysDiff(from: string, to: string): number {
  return Math.round(
    (new Date(to).getTime() - new Date(from).getTime()) / 86_400_000,
  );
}

/* ── page ────────────────────────────────────────────────── */

export default async function RacesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { date, venue, race } = await searchParams;
  const today = new Date().toISOString().slice(0, 10);
  const currentDate = date ?? today;
  const isToday = currentDate === today;

  const [races, raceDates, upcomingAll] = await Promise.all([
    getRacesByDate(currentDate),
    getAllRaceDates(currentDate, 3),
    getUpcomingStakesFromPlans(30),
  ]);
  // 선택된 날짜의 예정 대상경주 — races 가 비어도 race_plans 에 있으면 예고 카드 노출.
  const plannedForDate = upcomingAll.filter((s) => s.race_date === currentDate);

  const byMeet = Object.fromEntries(
    MEET_ORDER.map((m) => [
      m,
      races.filter((r) => r.meet === m).sort((a, b) => a.race_no - b.race_no),
    ]),
  );
  const activeMeets = MEET_ORDER.filter((m) => byMeet[m].length > 0);

  if (!venue && !race && activeMeets.length > 0) {
    const firstMeet = activeMeets[0];
    const firstRace = byMeet[firstMeet][0];
    redirect(
      `/races?date=${currentDate}&venue=${encodeURIComponent(firstMeet)}&race=${firstRace.race_no}`,
    );
  }

  /*
   * 기본 진입(date 파라미터 없음)인데 오늘은 경기가 없고 예정된 대상경주도 없는 경우,
   * 가까운 경기 있는 날로 자동 점프 — 빈 페이지로 유입되는 UX 결함 방지.
   */
  if (!date && activeMeets.length === 0 && plannedForDate.length === 0) {
    const nextRaceDay = raceDates.find((d) => d >= currentDate) ?? null;
    const prevRaceDay = [...raceDates].reverse().find((d) => d < currentDate) ?? null;
    const jumpTo = nextRaceDay ?? prevRaceDay;
    if (jumpTo) redirect(`/races?date=${jumpTo}`);
  }

  const selectedRace =
    venue && race
      ? races.find((r) => r.meet === venue && r.race_no === Number(race)) ??
        null
      : null;

  const session = await auth();
  const userId = session?.user?.id ?? null;

  // 1일 한도 표시용 — KST 기준 오늘.
  const todayKst = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  const [
    entriesResult,
    raceVideo,
    syncedAt,
    comboDividends,
    poolSales,
    betState,
    userBalance,
    dailyTotalP,
  ] = selectedRace
    ? await Promise.all([
        getRaceEntries(currentDate, selectedRace.meet, selectedRace.race_no),
        getRaceVideo(currentDate, selectedRace.meet, selectedRace.race_no),
        getRaceDataSyncedAt(currentDate, selectedRace.meet, selectedRace.race_no),
        getRaceComboDividends(currentDate, selectedRace.meet, selectedRace.race_no),
        getRacePoolSales(currentDate, selectedRace.meet, selectedRace.race_no),
        getRaceBetState(currentDate, selectedRace.meet, selectedRace.race_no),
        userId ? getUserBalance(userId) : Promise.resolve(null),
        userId ? getDailyBetTotalP(userId, todayKst) : Promise.resolve(null),
      ])
    : [
        { phase: "post" as const, entries: [] },
        null,
        null,
        [] as RaceComboDividend[],
        [] as RacePoolSales[],
        null,
        null,
        null,
      ];
  const entries = entriesResult.entries;
  const entriesPhase = entriesResult.phase;

  // 경기 있는 날만 순회하도록 raceDates 내에서 탐색.
  const prevDate = findNearbyRaceDate(raceDates, currentDate, "prev");
  const nextDate = findNearbyRaceDate(raceDates, currentDate, "next");

  // 빈 날짜 히어로 카드용 다가오는 대상경주 (오늘 이후, 최대 3개)
  const upcomingForEmpty = upcomingAll
    .filter((s) => s.race_date > currentDate)
    .slice(0, 3);

  // 레일 상태 레이블
  const raceStatus =
    currentDate < today ? "종료" : currentDate === today ? "진행중" : "예정";

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8">
      {/* ── 헤더: 제목 + 대상경주 링크 ── */}
      <div className="mb-5 flex items-baseline justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">경기 일람</h1>
        <Link
          href="/races/schedule"
          className="text-sm text-muted-foreground transition hover:text-primary"
        >
          대상경주 일정 →
        </Link>
      </div>

      {/* ── 날짜 네비게이션: 이전/다음 + 데이트피커 + 오늘 ── */}
      <div className="mb-6 flex items-center gap-2">
        <NavArrow target={prevDate} direction="prev" />
        <RaceDatePicker currentDate={currentDate} raceDates={raceDates} />
        <NavArrow target={nextDate} direction="next" />
        {!isToday && (
          <Link
            href="/races"
            className="shrink-0 rounded-lg border border-champagne-gold/60 bg-champagne-gold/10 px-3 py-1.5 text-sm font-medium text-champagne-gold transition hover:bg-champagne-gold/20 whitespace-nowrap"
          >
            오늘
          </Link>
        )}
      </div>

      {/* ── 경기 없음 (빈 날) ── */}
      {activeMeets.length === 0 && plannedForDate.length === 0 && (
        <EmptyStateCard
          currentDate={currentDate}
          prevDate={prevDate}
          nextDate={nextDate}
          upcomingStakes={upcomingForEmpty}
        />
      )}

      {/* ── 예정된 대상경주 (races 미적재 상태) ── */}
      {activeMeets.length === 0 && plannedForDate.length > 0 && (
        <UpcomingStakesPanel date={currentDate} stakes={plannedForDate} />
      )}

      {/* ── 라운드 레일 ── */}
      {activeMeets.length > 0 && (
        <div className="mb-6 rounded-xl border bg-card shadow-sm">
          {activeMeets.map((meet, idx) => {
            const meetRaces = byMeet[meet];
            return (
              <div
                key={meet}
                className={idx < activeMeets.length - 1 ? "border-b" : ""}
              >
                <div className="flex items-center gap-3 px-4 py-2">
                  {/* 경기장 레이블 + 상태 */}
                  <div className="flex w-20 shrink-0 items-center gap-1.5 text-xs font-semibold">
                    <VenueIcon meet={meet} size={13} />
                    <span>{meet}</span>
                    <span
                      className={
                        raceStatus === "종료"
                          ? "text-muted-foreground"
                          : raceStatus === "진행중"
                            ? "text-red-500"
                            : "text-champagne-gold"
                      }
                    >
                      · {raceStatus}
                    </span>
                  </div>
                  {/* 레이스 칩 */}
                  <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto pb-0.5 scrollbar-hide">
                    {meetRaces.map((r) => {
                      const stakes = isStakesRace(r);
                      const isSelected =
                        selectedRace?.meet === r.meet &&
                        selectedRace?.race_no === r.race_no;
                      const href = `/races?date=${currentDate}&venue=${encodeURIComponent(r.meet)}&race=${r.race_no}`;
                      return (
                        <Link key={r.id} href={href} className="shrink-0">
                          <div
                            className={[
                              "relative flex h-10 w-10 flex-col items-center justify-center rounded-lg border transition",
                              isSelected
                                ? "border-primary bg-primary text-white shadow-sm"
                                : stakes
                                  ? "border-champagne-gold/60 bg-champagne-gold/10 text-champagne-gold hover:bg-champagne-gold/20"
                                  : raceStatus === "종료"
                                    ? "border-border bg-card text-muted-foreground hover:bg-muted"
                                    : "border-border bg-card text-foreground hover:bg-muted",
                            ]
                              .filter(Boolean)
                              .join(" ")}
                          >
                            {stakes && !isSelected && (
                              <span className="absolute right-0.5 top-0.5 text-[8px] font-bold leading-none">
                                ★
                              </span>
                            )}
                            <span className="text-xs font-bold leading-none">
                              {r.race_no}
                            </span>
                            {r.start_time && (
                              <span className="mt-0.5 text-[9px] leading-none opacity-60 tabular-nums">
                                {r.start_time}
                              </span>
                            )}
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── 선택된 경기 상세 ── */}
      {selectedRace && (
        <section>
          {/* 경기 헤더 카드 */}
          <RaceHeaderCard
            race={selectedRace}
            currentDate={currentDate}
            isToday={isToday}
            syncedAt={syncedAt}
            videoId={raceVideo?.video_id ?? null}
          />

          {/* 출전표 상태 배지 */}
          {entriesPhase === "pre" && entries.length > 0 && (
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-champagne-gold/40 bg-champagne-gold/10 px-3 py-1.5 text-xs font-semibold text-champagne-gold">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-champagne-gold opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-champagne-gold" />
              </span>
              출전표 · {selectedRace.start_time
                ? `발주 ${selectedRace.start_time}`
                : "경주 전 · 결과 미확정"}
            </div>
          )}

          {entries.length > 0 ? (
            entriesPhase === "post" ? (
              /* ── 결과 (종료 경주) ── */
              <>
                <PodiumCards entries={entries} />
                <div className="grid grid-cols-1 gap-5 md:grid-cols-[1.65fr_1fr]">
                  <ResultsTable entries={entries} />
                  {poolSales.length > 0 && <PoolSalesCard rows={poolSales} />}
                </div>
              </>
            ) : (
              /* ── 출전표 (예정 / 진행중) ── */
              <>
                {/* 모바일: 카드 리스트 */}
                <div className="md:hidden">
                  <EntryCards entries={entries} />
                </div>
                {/* 데스크톱: 테이블 */}
                <div className="hidden md:block">
                  <EntriesTable entries={entries} phase="pre" />
                </div>
              </>
            )
          ) : (
            <Card className="border-dashed">
              <CardContent className="py-8 text-center text-sm text-muted-foreground">
                출전 정보가 없습니다.
              </CardContent>
            </Card>
          )}

          {betState && (
            <BetForm
              raceDate={currentDate}
              meet={selectedRace.meet}
              raceNo={selectedRace.race_no}
              entries={entries
                .filter(
                  (e): e is typeof e & { chul_no: number } =>
                    e.chul_no != null,
                )
                .map((e) => ({ chul_no: e.chul_no, horse_name: e.horse_name }))}
              state={betState}
              loggedIn={!!userId}
              balanceP={userBalance?.balance_p ?? null}
              dailyTotalP={dailyTotalP}
              startTime={selectedRace.start_time ?? null}
            />
          )}

          {comboDividends.length > 0 && (
            <ComboDividendsSection rows={comboDividends} />
          )}

          {/* 출전표 상태에서 pool sales — 별도 섹션으로 표시 */}
          {entriesPhase !== "post" && poolSales.length > 0 && (
            <PoolSalesSection rows={poolSales} />
          )}
        </section>
      )}
    </main>
  );
}

/* ── 경기 헤더 카드 ────────────────────────────────────────── */

function RaceHeaderCard({
  race,
  currentDate,
  isToday,
  syncedAt,
  videoId,
}: {
  race: RaceInfo;
  currentDate: string;
  isToday: boolean;
  syncedAt: string | null;
  videoId: string | null;
}) {
  const stakes = isStakesRace(race);
  // 썸네일을 오른쪽에 표시할 조건: 영상이 있거나 오늘 라이브
  const hasThumb = !!(videoId || isToday);

  return (
    <div
      className="mb-5 grid items-start gap-5 rounded-xl border bg-card p-5 shadow-sm"
      style={{
        gridTemplateColumns: hasThumb ? "auto 1fr auto" : "auto 1fr",
      }}
    >
      {/* 메달리언 */}
      <div
        className="flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-2xl text-white shadow"
        style={{
          background: stakes
            ? "linear-gradient(135deg, #D4AF37, #B8962E)"
            : "linear-gradient(135deg, #8B5A3C, #6E4631)",
        }}
      >
        <span className="text-2xl font-extrabold leading-none tracking-tight">
          {race.race_no}
        </span>
        <span className="mt-0.5 text-[10px] tracking-widest opacity-80">
          RACE
        </span>
      </div>

      {/* 제목 + 메타 */}
      <div className="min-w-0">
        <div className="mb-1.5 flex flex-wrap items-center gap-2">
          {stakes && (
            <span className="rounded border border-champagne-gold/40 bg-champagne-gold/10 px-1.5 py-0.5 text-[10px] font-bold tracking-wider text-champagne-gold">
              {race.grade ?? "G3"} 대상경주
            </span>
          )}
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold">
            <VenueIcon meet={race.meet} size={12} />
            {race.meet}
          </span>
        </div>
        <h2 className="mb-2 text-xl font-extrabold leading-tight tracking-tight">
          {race.race_name ?? `${race.race_no}경주`}
        </h2>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground tabular-nums">
          <span>📅 {formatDateLabel(currentDate)}</span>
          {race.start_time && <span>🕐 {race.start_time}</span>}
          {race.distance && <span>📏 {race.distance}m</span>}
          {race.track_condition && <span>🌤 주로 {race.track_condition}</span>}
        </div>
        {syncedAt && (
          <p className="mt-2 text-[11px] text-muted-foreground/70 tabular-nums">
            업데이트 {formatSyncedAt(syncedAt)}
          </p>
        )}
      </div>

      {/* 유튜브 썸네일 (있을 때만) */}
      {hasThumb && (
        <a
          href={
            videoId
              ? youtubeWatchUrl(videoId)
              : KRBC_LIVE_URL
          }
          target="_blank"
          rel="noopener noreferrer"
          aria-label={
            isToday && !videoId ? "KRBC 라이브 시청" : "경주 영상 보기"
          }
          className="relative block shrink-0 overflow-hidden rounded-lg border"
          style={{ width: 168, aspectRatio: "16 / 9", background: "#000" }}
        >
          {videoId ? (
            <img
              src={`https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`}
              alt=""
              className="h-full w-full object-cover"
            />
          ) : (
            /* 라이브 전용: 썸네일 없을 때 어두운 배경 */
            <div className="h-full w-full bg-zinc-900" />
          )}
          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black/40" />
          {/* LIVE / ▶ 배지 */}
          <div
            className={[
              "absolute left-1.5 top-1.5 flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-bold tracking-wider text-white",
              isToday && !videoId ? "bg-red-500" : "bg-black/80",
            ].join(" ")}
          >
            {isToday && !videoId && (
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
            )}
            {isToday && !videoId ? "LIVE" : "▶ 영상"}
          </div>
          {/* 플레이 버튼 */}
          <div className="absolute inset-0 flex items-center justify-center">
            <div
              className={[
                "flex h-7 w-10 items-center justify-center rounded-md",
                isToday && !videoId ? "bg-red-500/90" : "bg-black/75",
              ].join(" ")}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="white">
                <path d="M8 5v14l11-7z" />
              </svg>
            </div>
          </div>
        </a>
      )}
    </div>
  );
}

/* ── 빈 날짜 히어로 카드 ──────────────────────────────────── */

function EmptyStateCard({
  currentDate,
  prevDate,
  nextDate,
  upcomingStakes,
}: {
  currentDate: string;
  prevDate: string | null;
  nextDate: string | null;
  upcomingStakes: UpcomingStake[];
}) {
  return (
    <div>
      {/* 히어로 카드 */}
      <div className="relative overflow-hidden rounded-2xl border bg-card p-14 text-center shadow-sm">
        {/* 장식 골드 링 */}
        <div className="pointer-events-none absolute -right-32 -top-32 h-72 w-72 rounded-full border border-champagne-gold/15 bg-champagne-gold/5" />
        <div className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full border border-champagne-gold/10" />

        <div className="relative mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <svg
            width="26"
            height="26"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="3" y="4" width="18" height="18" rx="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
        </div>

        <h2 className="relative mb-2 text-xl font-extrabold tracking-tight">
          이 날은 경기가 없어요
        </h2>
        <p className="relative mb-7 leading-relaxed text-sm text-muted-foreground">
          {formatDateLabel(currentDate)}에는 등록된 경기가 없습니다.
          <br />
          가까운 경기일로 이동하거나, 다가오는 대상경주 일정을 확인해 보세요.
        </p>

        <div className="relative inline-flex flex-wrap justify-center gap-2.5">
          {prevDate && (
            <Link
              href={`/races?date=${prevDate}`}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-bold text-white shadow-sm transition hover:opacity-90"
            >
              ‹ {formatDateLabel(prevDate)} 결과 보기
            </Link>
          )}
          {nextDate && (
            <Link
              href={`/races?date=${nextDate}`}
              className="inline-flex items-center gap-2 rounded-lg border bg-card px-5 py-2.5 text-sm font-bold text-foreground transition hover:bg-muted"
            >
              {formatDateLabel(nextDate)} 출전표 ›
            </Link>
          )}
        </div>
      </div>

      {/* 다가오는 대상경주 */}
      {upcomingStakes.length > 0 && (
        <div className="mt-8">
          <div className="mb-3 flex items-baseline justify-between">
            <h3 className="text-sm font-bold text-muted-foreground">
              다가오는 대상경주
            </h3>
            <Link
              href="/races/schedule"
              className="text-xs text-muted-foreground hover:text-primary"
            >
              전체 일정 →
            </Link>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {upcomingStakes.map((s) => {
              const diff = daysDiff(currentDate, s.race_date);
              const dLabel = diff === 0 ? "D-Day" : `D-${diff}`;
              const display = s.race_name
                .replace(/\s*\((G[123]|L|특)\)\s*/g, "")
                .trim();
              return (
                <Link
                  key={s.id}
                  href={`/races?date=${s.race_date}`}
                  className="block rounded-xl border bg-card p-4 shadow-sm transition hover:shadow-md"
                >
                  <div className="mb-2.5 flex items-center justify-between">
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold">
                      <VenueIcon meet={s.meet} size={12} />
                      {s.meet}
                    </span>
                    {s.tier && (
                      <span className="rounded bg-champagne-gold/15 px-1.5 py-0.5 text-[10px] font-bold tracking-wider text-champagne-gold">
                        {s.tier}
                      </span>
                    )}
                  </div>
                  <p className="mb-1.5 font-bold leading-snug">{display}</p>
                  <div className="flex items-center justify-between text-xs text-muted-foreground tabular-nums">
                    <span>
                      {formatDateLabel(s.race_date)}
                      {s.distance ? ` · ${s.distance}m` : ""}
                    </span>
                    <span className="font-bold text-primary">{dLabel}</span>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── 결과 시상대 카드 ──────────────────────────────────────── */

function PodiumCards({ entries }: { entries: RaceEntry[] }) {
  const top3 = entries
    .filter((e) => e.rank !== null && e.rank <= 3)
    .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99));

  if (top3.length === 0) return null;

  const accentColors: Record<number, string> = {
    1: "#D4AF37",
    2: "#C0C0C0",
    3: "#CD7F32",
  };

  return (
    <div className="mb-5 grid grid-cols-3 gap-3">
      {top3.map((e) => {
        const accent = accentColors[e.rank!] ?? "#6C757D";
        const isSecond = e.rank === 2;
        return (
          <div
            key={e.chul_no ?? e.horse_no}
            className="relative flex items-center gap-3 overflow-hidden rounded-xl border bg-card p-4 shadow-sm"
          >
            {/* 착 컬러 바 */}
            <div
              className="absolute inset-y-0 left-0 w-1"
              style={{ background: accent }}
            />
            {/* 착 원형 뱃지 */}
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-base font-extrabold"
              style={{ background: accent, color: isSecond ? "#222" : "white" }}
            >
              {e.rank}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-1.5">
                {e.chul_no != null && (
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {e.chul_no}번
                  </span>
                )}
                <Link
                  href={`/horse/${e.horse_no}`}
                  className="truncate font-extrabold text-primary hover:underline"
                >
                  {e.horse_name}
                </Link>
              </div>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {e.jockey_name} · {e.trainer_name}
              </p>
            </div>
            <div className="shrink-0 text-right">
              <p className="font-mono text-sm font-extrabold tabular-nums">
                {e.record_time ?? "-"}
              </p>
              <p className="text-[10px] tabular-nums text-muted-foreground">
                착차 {e.differ ?? "-"}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ── 결과 테이블 (side-by-side 왼쪽) ────────────────────────── */

function ResultsTable({ entries }: { entries: RaceEntry[] }) {
  return (
    <div>
      <div className="mb-2.5 flex items-baseline justify-between">
        <h3 className="text-sm font-semibold text-muted-foreground">
          전체 착순
        </h3>
      </div>
      <Card>
        <div className="overflow-x-auto rounded-[inherit]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12 text-center">착</TableHead>
                <TableHead>마명</TableHead>
                <TableHead className="text-center">기수</TableHead>
                <TableHead className="text-right">기록</TableHead>
                <TableHead className="hidden text-right md:table-cell">
                  착차
                </TableHead>
                <TableHead className="text-right">마체중</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((e, i) => (
                <TableRow key={i}>
                  <TableCell className="text-center">
                    <RankBadge rank={e.rank} />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      {e.chul_no != null && (
                        <span className="font-mono text-[11px] text-muted-foreground">
                          {e.chul_no}
                        </span>
                      )}
                      <Link
                        href={`/horse/${e.horse_no}`}
                        className="font-semibold text-primary hover:underline"
                      >
                        {e.horse_name}
                      </Link>
                    </div>
                  </TableCell>
                  <TableCell className="text-center text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      {e.jockey_name ?? "-"}
                      {e.jockey_changed_from && (
                        <JockeyChangeBadge
                          from={e.jockey_changed_from}
                          to={e.jockey_name}
                          reason={e.jockey_change_reason}
                          weightBefore={e.jockey_weight_before}
                          weightAfter={e.jockey_weight_after}
                        />
                      )}
                    </span>
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {e.record_time ?? "-"}
                  </TableCell>
                  <TableCell className="hidden text-right font-mono tabular-nums text-muted-foreground md:table-cell">
                    {e.differ ?? "-"}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {e.weight ?? "-"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}

/* ── 풀별 매출 카드 (side-by-side 오른쪽) ────────────────────── */

function PoolSalesCard({ rows }: { rows: RacePoolSales[] }) {
  const total = rows.reduce((s, r) => s + Number(r.amount), 0);
  const sorted = [...rows].sort(
    (a, b) =>
      POOL_DISPLAY_ORDER.indexOf(
        a.pool as (typeof POOL_DISPLAY_ORDER)[number],
      ) -
      POOL_DISPLAY_ORDER.indexOf(b.pool as (typeof POOL_DISPLAY_ORDER)[number]),
  );
  return (
    <div>
      <div className="mb-2.5 flex items-baseline justify-between">
        <h3 className="text-sm font-semibold text-muted-foreground">
          풀별 매출 · 배당
        </h3>
        <span className="text-xs text-muted-foreground tabular-nums">
          총{" "}
          <strong className="text-foreground">
            {formatAmount(String(total))}
          </strong>
        </span>
      </div>
      <Card>
        <div className="divide-y divide-border/60">
          {sorted.map((r) => (
            <div
              key={r.pool}
              className="grid items-center gap-2 px-4 py-3"
              style={{ gridTemplateColumns: "44px 1fr auto" }}
            >
              <span className="text-[11px] font-extrabold tracking-wider text-champagne-gold">
                {r.pool}
              </span>
              <span className="truncate font-mono text-xs tabular-nums text-muted-foreground">
                {r.odds_summary ?? "-"}
              </span>
              <span className="font-mono text-sm font-bold tabular-nums">
                {formatAmount(r.amount)}
              </span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

/* ── 출전표 테이블 (데스크톱 전용) ────────────────────────── */

function EntriesTable({
  entries,
  phase,
}: {
  entries: RaceEntry[];
  phase: "pre" | "post";
}) {
  return (
    <Card>
      <div className="relative overflow-x-auto rounded-[inherit]">
        <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-8 bg-gradient-to-l from-background to-transparent md:hidden" />
        <Table className="min-w-[580px]">
          <TableHeader>
            <TableRow>
              <TableHead className="sticky left-0 z-10 w-14 bg-background text-center">
                {phase === "pre" ? "출전" : "착순"}
              </TableHead>
              <TableHead>마명</TableHead>
              <TableHead className="text-center">기수</TableHead>
              <TableHead className="text-center">조교사</TableHead>
              <TableHead
                className="hidden text-center sm:table-cell"
                title="말 연령"
              >
                연령
              </TableHead>
              <TableHead
                className="hidden text-right sm:table-cell"
                title="경주 시점의 말 레이팅"
              >
                레이팅
              </TableHead>
              <TableHead
                className="hidden text-right sm:table-cell"
                title="부담중량 (핸디캡)"
              >
                부담
              </TableHead>
              <TableHead className="text-right">기록</TableHead>
              <TableHead
                className="hidden text-right md:table-cell"
                title="1착과의 착차"
              >
                착차
              </TableHead>
              <TableHead className="text-right">마체중</TableHead>
              <TableHead className="text-right">단승</TableHead>
              <TableHead className="text-right">연승</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map((e, i) => (
              <TableRow key={i}>
                <TableCell className="sticky left-0 z-10 bg-background text-center font-semibold">
                  {phase === "pre" ? (
                    <span className="font-mono text-sm tabular-nums text-muted-foreground">
                      {e.chul_no ?? "-"}
                    </span>
                  ) : (
                    <RankBadge rank={e.rank} />
                  )}
                </TableCell>
                <TableCell>
                  <Link
                    href={`/horse/${e.horse_no}`}
                    className="text-primary hover:underline"
                  >
                    {e.horse_name}
                  </Link>
                </TableCell>
                <TableCell className="text-center text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    {e.jockey_name ?? "-"}
                    {e.jockey_changed_from && (
                      <JockeyChangeBadge
                        from={e.jockey_changed_from}
                        to={e.jockey_name}
                        reason={e.jockey_change_reason}
                        weightBefore={e.jockey_weight_before}
                        weightAfter={e.jockey_weight_after}
                      />
                    )}
                  </span>
                </TableCell>
                <TableCell className="text-center text-muted-foreground">
                  {e.trainer_name ? (
                    e.trainer_no ? (
                      <Link
                        href={`/trainer/${e.trainer_no}`}
                        className="text-primary hover:underline"
                      >
                        {e.trainer_name}
                      </Link>
                    ) : (
                      e.trainer_name
                    )
                  ) : (
                    "-"
                  )}
                </TableCell>
                <TableCell className="hidden text-center font-mono tabular-nums text-muted-foreground sm:table-cell">
                  {e.age ?? "-"}
                </TableCell>
                <TableCell className="hidden text-right font-mono tabular-nums text-muted-foreground sm:table-cell">
                  {e.hr_rating ?? "-"}
                </TableCell>
                <TableCell className="hidden text-right font-mono tabular-nums text-muted-foreground sm:table-cell">
                  {e.budam_weight ?? "-"}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {e.record_time ?? "-"}
                </TableCell>
                <TableCell className="hidden text-right font-mono tabular-nums text-muted-foreground md:table-cell">
                  {e.differ ?? "-"}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {e.weight ?? "-"}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                  {e.win_rate ?? "-"}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                  {e.plc_rate ?? "-"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}

/* ── 풀별 매출 섹션 (출전표 상태용 전체 테이블) ─────────────── */

function PoolSalesSection({ rows }: { rows: RacePoolSales[] }) {
  const total = rows.reduce((s, r) => s + Number(r.amount), 0);
  const sorted = [...rows].sort(
    (a, b) =>
      POOL_DISPLAY_ORDER.indexOf(
        a.pool as (typeof POOL_DISPLAY_ORDER)[number],
      ) -
      POOL_DISPLAY_ORDER.indexOf(b.pool as (typeof POOL_DISPLAY_ORDER)[number]),
  );

  return (
    <div className="mt-6">
      <div className="mb-3 flex items-baseline justify-between">
        <h3 className="text-sm font-semibold text-muted-foreground">
          풀별 매출
        </h3>
        <span className="text-xs text-muted-foreground tabular-nums">
          총 매출{" "}
          <strong className="text-foreground">
            {formatAmount(String(total))}
          </strong>
        </span>
      </div>
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-16">풀</TableHead>
              <TableHead className="text-right">매출액</TableHead>
              <TableHead>인기순위 (배당률)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((r) => (
              <TableRow key={r.pool}>
                <TableCell className="font-semibold">{r.pool}</TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {formatAmount(r.amount)}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {r.odds_summary ?? "-"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

/* ── 복식 배당 섹션 ──────────────────────────────────────── */

const POOL_ORDER: ComboPool[] = ["QNL", "QPL", "EXA", "TRI", "TLA"];

function formatCombo(d: RaceComboDividend): string {
  const sep = POOL_ORDERED[d.pool] ? " → " : ", ";
  const parts = [
    d.horse_name_1 ? `${d.horse_no_1} ${d.horse_name_1}` : d.horse_no_1,
    d.horse_name_2 ? `${d.horse_no_2} ${d.horse_name_2}` : d.horse_no_2,
  ];
  if (d.horse_no_3) {
    parts.push(
      d.horse_name_3 ? `${d.horse_no_3} ${d.horse_name_3}` : d.horse_no_3,
    );
  }
  return parts.join(sep);
}

function formatOdds(odds: string | null): string {
  if (odds === null) return "-";
  const n = Number(odds);
  if (Number.isNaN(n)) return odds;
  return n.toFixed(1);
}

function ComboDividendsSection({ rows }: { rows: RaceComboDividend[] }) {
  const byPool = new Map<ComboPool, RaceComboDividend[]>();
  for (const r of rows) {
    const arr = byPool.get(r.pool) ?? [];
    arr.push(r);
    byPool.set(r.pool, arr);
  }
  const activePools = POOL_ORDER.filter((p) => byPool.has(p));

  return (
    <div className="mt-6">
      <h3 className="mb-3 text-sm font-semibold text-muted-foreground">
        복식 배당
      </h3>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {activePools.map((pool) => {
          const items = byPool.get(pool) ?? [];
          return (
            <Card key={pool}>
              <div className="border-b bg-muted/40 px-4 py-2 text-xs font-semibold tracking-wide text-muted-foreground">
                {POOL_LABEL[pool]}{" "}
                <span className="ml-1 font-mono opacity-70">{pool}</span>
              </div>
              <div className="divide-y divide-border/40">
                {items.map((d, i) => (
                  <div
                    key={`${pool}-${i}`}
                    className="flex items-center justify-between px-4 py-1.5 text-xs"
                  >
                    <span className="truncate">{formatCombo(d)}</span>
                    <span className="ml-2 shrink-0 font-mono tabular-nums font-semibold">
                      {formatOdds(d.odds)}
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

/* ── helpers ─────────────────────────────────────────────── */

function UpcomingStakesPanel({
  date,
  stakes,
}: {
  date: string;
  stakes: UpcomingStake[];
}) {
  const byMeet = new Map<string, UpcomingStake[]>();
  for (const s of stakes) {
    const arr = byMeet.get(s.meet) ?? [];
    arr.push(s);
    byMeet.set(s.meet, arr);
  }
  return (
    <Card>
      <CardContent className="py-8">
        <div className="mb-4 flex items-baseline justify-between gap-3">
          <div>
            <Badge className="mb-1 bg-champagne-gold text-white">예정</Badge>
            <h2 className="text-base font-bold">
              {formatDateLabel(date)} 예정 대상경주
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              주간 카드가 아직 등록되지 않아 출전표·결과는 일정 공개 후
              표시됩니다.
            </p>
          </div>
          <Link
            href="/races/schedule"
            className="text-xs text-muted-foreground transition hover:text-primary whitespace-nowrap"
          >
            전체 일정 →
          </Link>
        </div>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {Array.from(byMeet.entries()).map(([meet, items]) => (
            <div key={meet} className="overflow-hidden rounded-lg border bg-card">
              <div className="flex items-center gap-2 border-b bg-primary/5 px-3 py-2">
                <VenueIcon meet={meet} size={14} />
                <span className="text-sm font-bold">{meet}</span>
              </div>
              <ul className="divide-y divide-border/40">
                {items.map((s) => {
                  const display = s.race_name
                    .replace(/\s*\((G[123]|L|특)\)\s*/g, "")
                    .trim();
                  return (
                    <li
                      key={s.id}
                      className="flex items-center gap-2 px-3 py-2 text-sm"
                    >
                      {s.tier && (
                        <span className="shrink-0 rounded bg-champagne-gold/20 px-1.5 py-0.5 text-[10px] font-bold text-champagne-gold">
                          {s.tier}
                        </span>
                      )}
                      <span className="min-w-0 flex-1 truncate font-medium">
                        {display}
                      </span>
                      {s.distance && (
                        <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
                          {s.distance}m
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function NavArrow({
  target,
  direction,
}: {
  target: string | null;
  direction: "prev" | "next";
}) {
  const arrow = direction === "prev" ? "‹" : "›";
  const label = direction === "prev" ? "이전 경기일" : "다음 경기일";
  const base =
    "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border bg-card text-muted-foreground transition";
  if (!target) {
    return (
      <span
        aria-label={label}
        aria-disabled="true"
        title={`${label} 없음`}
        className={`${base} cursor-not-allowed opacity-40`}
      >
        {arrow}
      </span>
    );
  }
  return (
    <Link
      href={`/races?date=${target}`}
      aria-label={label}
      title={`${label}: ${target}`}
      className={`${base} hover:bg-muted`}
    >
      {arrow}
    </Link>
  );
}

function RankBadge({ rank }: { rank: number | null }) {
  if (rank === null) return <span className="text-muted-foreground">-</span>;
  if (rank === 1)
    return <Badge className="bg-primary text-primary-foreground">1</Badge>;
  if (rank <= 3) return <Badge variant="secondary">{rank}</Badge>;
  return <span>{rank}</span>;
}

function JockeyChangeBadge({
  from,
  to,
  reason,
  weightBefore,
  weightAfter,
}: {
  from: string;
  to: string | null;
  reason: string | null;
  weightBefore: string | null;
  weightAfter: string | null;
}) {
  const wb = weightBefore ? Number(weightBefore) : null;
  const wa = weightAfter ? Number(weightAfter) : null;
  const hasWeightDelta =
    wb !== null &&
    wa !== null &&
    Number.isFinite(wb) &&
    Number.isFinite(wa) &&
    wb !== wa;
  const title = [
    `기수교체: ${from} → ${to ?? "?"}`,
    reason ? `(${reason})` : null,
    hasWeightDelta ? `부담중량: ${wb} → ${wa}kg` : null,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <span
      className="inline-flex items-center gap-1 rounded border border-amber-500/40 bg-amber-500/10 px-1 text-[10px] font-semibold text-amber-700 dark:text-amber-400"
      title={title}
    >
      교체
      {hasWeightDelta && (
        <span className="font-mono tabular-nums opacity-80">
          {wb}→{wa}
        </span>
      )}
    </span>
  );
}

/** 매출액(원) → "1.2억" / "3,400만" / "5,200" 형태로 축약. */
function formatAmount(amountStr: string): string {
  const n = Number(amountStr);
  if (!Number.isFinite(n) || n === 0) return "-";
  if (n >= 100_000_000) return `${(n / 100_000_000).toFixed(2)}억`;
  if (n >= 10_000)
    return `${Math.round(n / 10_000).toLocaleString("ko-KR")}만`;
  return n.toLocaleString("ko-KR");
}
