import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "경주 결과",
  description:
    "한국마사회 경주 결과 — 일자·경마장별 출전마, 기수, 조교사, 배당 데이터를 한 곳에서.",
  alternates: { canonical: "/races" },
};

import { auth } from "@/auth";
import { RaceDatePicker } from "@/components/race-date-picker";
import { VenueIcon } from "@/components/venue-icon";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { getDailyBetTotalP, getUserBalance } from "@/lib/balances";
import { getRaceBetState } from "@/lib/bets";
import {
  getAllRaceDates,
  getRaceDataSyncedAt,
  getRaceEntries,
  getRacesByDate,
  getRecentFinishesBulk,
  type RaceInfo,
} from "@/lib/races";
import {
  getUpcomingStakesFromPlans,
  type UpcomingStake,
} from "@/lib/race_plans";
import {
  getRaceComboDividends,
  type RaceComboDividend,
} from "@/lib/race_combo_dividends";
import {
  getRacePoolSales,
  POOL_DISPLAY_ORDER,
  type RacePoolSales,
} from "@/lib/race_pool_sales";
import { getRaceVideo, youtubeEmbedUrl } from "@/lib/videos";
import { youtubeSearchUrl } from "@/lib/video-helpers";
import {
  GateNum,
  OddsBar,
  PodiumCard,
  type PodiumEntry,
  PoolSalesTiles,
  PopularityChart,
  RaceChip,
  RankMedal,
  RoundBadge,
  SexBullet,
  WeightDelta,
} from "@/components/race-detail-ui";
import { PreRaceBanner } from "@/components/pre-race-banner";
import { PopularityVsResult } from "@/components/popularity-vs-result";
import { PaceMap } from "@/components/pace-map";
import { RecentFormStrip } from "@/components/recent-form-strip";
import { ComboDividendsSection } from "@/components/combo-dividends-section";
import {
  getHorseCompareSummaries,
  type HorseCompareSummary,
} from "@/lib/horses";
import { getRaceCorner } from "@/lib/race_corners";

import { BetForm } from "./bet-form";

type SearchParams = { date?: string; venue?: string; race?: string };

const MEET_ORDER = ["서울", "제주", "부경"] as const;

/* ── date helpers ────────────────────────────────────────── */

function offsetDate(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d + days);
  return [
    dt.getFullYear(),
    String(dt.getMonth() + 1).padStart(2, "0"),
    String(dt.getDate()).padStart(2, "0"),
  ].join("-");
}

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
 * Postgres `timestamptz::text` 포맷("2026-04-22 13:15:42.056544+00") 을 Asia/Seoul
 * 시각 기준 짧은 문자열("04/22 22:15") 로 변환. 호버 title 에는 원본 ISO 를 그대로
 * 노출해 타임존/초 단위까지 확인할 수 있게 한다.
 *
 * JS `Date` 는 공백 구분자와 콜론 없는 offset("+00") 을 거부하므로,
 *   1. 공백 → "T"
 *   2. 뒤 offset "+HH" → "+HH:00"
 * 으로 정규화해서 넘긴다.
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

/* ── page ────────────────────────────────────────────────── */

export default async function RacesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { date, venue, race } = await searchParams;
  // KST(UTC+9) 기준 오늘. UTC 자정~9시 사이에 어제로 잘못 잡혀 isToday 가
  // 거짓 falsy → KRBC 라이브 버튼 미노출, 검색 버튼 노출 같은 표시 오류를 방지.
  const today = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
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
   * 1순위: 다음 경기일(예정 대상경주 포함), 2순위: 최근 경기일.
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

  // 1일 한도 표시용 — KST 기준 오늘 (선택된 race_date 가 아니라 *현재* 일자가 한도 단위).
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
    raceCorner,
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
        getRaceCorner(currentDate, selectedRace.meet, selectedRace.race_no),
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
        null,
      ];
  const entries = entriesResult.entries;
  const entriesPhase = entriesResult.phase;
  const [compareSummaries, recentFinishesMap] = entries.length > 0 && selectedRace
    ? await Promise.all([
        getHorseCompareSummaries(entries.map((e) => e.horse_no)),
        getRecentFinishesBulk(
          entries.map((e) => e.horse_no),
          currentDate,
          selectedRace.race_no,
          5,
        ),
      ])
    : [[], {} as Record<string, (number | null)[]>];
  const chulMap: Record<string, number | null> = Object.fromEntries(
    entries.map((e) => [e.horse_no, e.chul_no]),
  );
  // horse_no → 통산·평균지수·최근 5전 한 묶음. 별도 "출주마 비교" 표 대신
  // 출전표 인라인에 끼워 넣어 한눈 정보 밀도를 올린다.
  const compareMap: Record<string, HorseCompareSummary> = Object.fromEntries(
    compareSummaries.map((s) => [s.horse_no, s]),
  );
  const hasMsf = compareSummaries.some((s) => s.avg_msf !== null);

  // 경기 있는 날만 순회하도록 raceDates 내에서 탐색. 인접 레이스데이가 없으면 null.
  const prevDate = findNearbyRaceDate(raceDates, currentDate, "prev");
  const nextDate = findNearbyRaceDate(raceDates, currentDate, "next");

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-8">
      <div className="mb-5 flex items-baseline justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">경기 일람</h1>
        <Link
          href="/races/schedule"
          className="text-sm text-muted-foreground transition hover:text-primary"
        >
          대상경주 일정 →
        </Link>
      </div>

      {/* ── 날짜 네비게이션: 이전/다음(경기 있는 날로 점프) + 데이트피커 + 오늘 ── */}
      <div className="mb-6 flex items-center gap-2">
        <NavArrow target={prevDate} direction="prev" />

        <RaceDatePicker currentDate={currentDate} raceDates={raceDates} />

        <NavArrow target={nextDate} direction="next" />

        {!isToday && (
          <Link
            href="/races"
            className="shrink-0 rounded-lg border border-champagne-gold/60 bg-champagne-gold/10 px-3 py-1.5 text-sm font-medium text-gold-ink transition hover:bg-champagne-gold/20 whitespace-nowrap"
          >
            오늘
          </Link>
        )}
      </div>

      {/* ── 경기 없음 ── */}
      {activeMeets.length === 0 && plannedForDate.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            {formatDateLabel(currentDate)}에는 경기 기록이 없습니다.
          </CardContent>
        </Card>
      )}

      {/* ── 예정된 대상경주 (races 미적재 상태) ── */}
      {activeMeets.length === 0 && plannedForDate.length > 0 && (
        <UpcomingStakesPanel date={currentDate} stakes={plannedForDate} />
      )}

      {/* ── 라운드 필터 ── */}
      {activeMeets.length > 0 && (
        <div className="mb-6 space-y-2 rounded-xl border bg-card p-3">
          {activeMeets.map((meet) => {
            const meetRaces = byMeet[meet];
            const status =
              currentDate < today
                ? "종료"
                : currentDate === today
                  ? "진행중"
                  : "예정";

            return (
              <div key={meet} className="flex items-center gap-2">
                <div className="flex w-16 shrink-0 items-center gap-1 text-xs font-semibold text-foreground">
                  <VenueIcon meet={meet} size={13} />
                  <span>{meet}</span>
                </div>
                <div className="h-4 w-px shrink-0 bg-border" />
                <div className="flex flex-wrap gap-1.5">
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
                            "inline-flex h-8 min-w-9 items-center justify-center rounded-md border px-2 text-xs font-bold tabular-nums transition",
                            isSelected
                              ? "border-primary bg-primary text-white shadow-sm"
                              : stakes
                                ? "border-champagne-gold/60 bg-champagne-gold/10 text-gold-ink hover:bg-champagne-gold/20"
                                : status === "종료"
                                  ? "border-border bg-background text-muted-foreground hover:bg-muted"
                                  : "border-border bg-background text-foreground hover:bg-muted",
                            stakes && status === "진행중" && !isSelected
                              ? "animate-pulse"
                              : "",
                          ]
                            .filter(Boolean)
                            .join(" ")}
                        >
                          {r.race_no}R
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── 선택된 경기 상세 ── */}
      {selectedRace && (
        <section className="mt-8 border-t pt-8">
          {/* 헤더: 2열 그리드 — 좌(라운드 + 메타 + 타이틀 + 칩) / 우(영상 액션 + 업데이트) */}
          <div className="mb-4 grid grid-cols-1 gap-x-6 gap-y-3 md:grid-cols-[1fr_auto]">
            <div className="flex min-w-0 flex-col gap-2">
              <div className="flex items-center gap-3">
                <RoundBadge no={selectedRace.race_no} />
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <VenueIcon meet={selectedRace.meet} size={13} />
                      {selectedRace.meet}
                    </span>
                    <span className="h-[3px] w-[3px] rounded-full bg-current opacity-40" />
                    <span className="font-mono tabular-nums">{currentDate}</span>
                    {selectedRace.start_time && (
                      <>
                        <span className="h-[3px] w-[3px] rounded-full bg-current opacity-40" />
                        <span className="font-mono tabular-nums">
                          {selectedRace.start_time} 발주
                        </span>
                      </>
                    )}
                  </div>
                  <h2 className="mt-0.5 text-xl font-extrabold leading-tight tracking-tight sm:text-[22px]">
                    {selectedRace.race_name ?? `${selectedRace.race_no}R`}
                  </h2>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {selectedRace.distance && (
                  <RaceChip label="거리" value={`${selectedRace.distance}m`} />
                )}
                {selectedRace.grade && (
                  <RaceChip label="등급" value={selectedRace.grade} tone="gold" />
                )}
                {(selectedRace.track_type || selectedRace.track_condition) && (
                  <RaceChip
                    label="주로"
                    value={[selectedRace.track_type, selectedRace.track_condition]
                      .filter(Boolean)
                      .join(" · ") || "-"}
                    tone="condition"
                  />
                )}
                {selectedRace.entry_count != null && (
                  <RaceChip label="출전" value={`${selectedRace.entry_count}두`} />
                )}
              </div>
            </div>

            <div className="flex flex-col items-start gap-2 md:items-end">
              {/* 영상이 있으면 사이드바 embed 가 대신 노출되므로 헤더 영상 버튼 생략.
                  영상이 없는 경우만 KRBC 외부 검색 fallback 을 헤더에 유지. */}
              {!raceVideo && (
                <a
                  href={youtubeSearchUrl(
                    `${currentDate} ${selectedRace.meet} ${selectedRace.race_no}R 경마`,
                  )}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[rgba(255,0,0,0.3)] bg-transparent px-3 text-xs font-semibold text-[#FF0000] transition hover:bg-[rgba(255,0,0,0.06)]"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.5 12 3.5 12 3.5s-7.5 0-9.4.6A3 3 0 0 0 .5 6.2C0 8.1 0 12 0 12s0 3.9.5 5.8a3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1C24 15.9 24 12 24 12s0-3.9-.5-5.8zM9.5 15.6V8.4L15.8 12l-6.3 3.6z" />
                  </svg>
                  유튜브 검색
                </a>
              )}
              {syncedAt && (
                <span
                  className="text-[11px] text-muted-foreground/70 tabular-nums"
                  title={`데이터 수집 시각: ${syncedAt}`}
                >
                  데이터 업데이트{" "}
                  <span className="font-mono">{formatSyncedAt(syncedAt)}</span>
                </span>
              )}
            </div>
          </div>

          {/* 결과(post) 가 있고 1·2·3착이 모두 채워졌으면 시상대 카드로 즉시 노출.
              헤더 직후 → 출전표까지 스크롤하지 않고 결과 한 줄을 본다. */}
          {entriesPhase === "post" &&
            (() => {
              const podium: PodiumEntry[] = entries
                .filter(
                  (e): e is typeof e & { rank: number } =>
                    e.rank != null && e.rank >= 1 && e.rank <= 3,
                )
                .sort((a, b) => a.rank - b.rank)
                .map((e) => ({
                  rank: e.rank,
                  chul_no: e.chul_no,
                  horse_no: e.horse_no,
                  horse_name: e.horse_name,
                  jockey_name: e.jockey_name,
                  jockey_no: e.jockey_no,
                  win_rate: e.win_rate,
                  record_time: e.record_time,
                }));
              return podium.length > 0 ? (
                <div className="mb-5">
                  <PodiumCard podium={podium} />
                </div>
              ) : null;
            })()}

          {/* 2-열 그리드 — lg+ 에선 우측 사이드바(영상·풀별매출·인기분포),
              그 아래선 단일 컬럼. 사이드바는 데스크탑에서 sticky 로 따라온다. */}
          <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-6">
            <div className="min-w-0 space-y-5">
              {/* 모바일·태블릿(lg 미만)에선 영상이 메인 컬럼 상단. 데스크탑에선 사이드바로 이동. */}
              {raceVideo && (
                <div className="overflow-hidden rounded-xl border bg-card shadow-sm lg:hidden">
                  <div className="aspect-video w-full bg-black">
                    <iframe
                      src={youtubeEmbedUrl(raceVideo.video_id)}
                      title={raceVideo.title}
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                      allowFullScreen
                      className="h-full w-full"
                    />
                  </div>
                </div>
              )}

              {entries.length > 0 ? (
                <>
                  {entriesPhase === "pre" && (
                    <PreRaceBanner
                      raceDate={currentDate}
                      startTime={selectedRace.start_time ?? null}
                    />
                  )}
                  <Card className="overflow-hidden py-0">
                <div className="relative overflow-x-auto rounded-[inherit]">
                  <table className="w-full border-collapse text-[13px]">
                    <thead>
                      <tr className="bg-[#faf7ef]">
                        <th className="border-b border-border px-2 py-2.5 text-center text-[11px] font-bold uppercase tracking-wider text-muted-foreground" style={{ width: 52 }}>
                          {entriesPhase === "pre" ? "출전" : "착순"}
                        </th>
                        <th className="border-b border-border px-2 py-2.5 text-center text-[11px] font-bold uppercase tracking-wider text-muted-foreground" style={{ width: 44 }}>
                          번호
                        </th>
                        <th className="border-b border-border px-2 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                          마명
                        </th>
                        <th className="border-b border-border px-2 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-muted-foreground" style={{ width: 160 }}>
                          기수 / 조교사
                        </th>
                        <th className="hidden border-b border-border px-2 py-2.5 text-center text-[11px] font-bold uppercase tracking-wider text-muted-foreground sm:table-cell" style={{ width: 50 }}>
                          연령
                        </th>
                        <th className="hidden border-b border-border px-2 py-2.5 text-right text-[11px] font-bold uppercase tracking-wider text-muted-foreground sm:table-cell" style={{ width: 64 }}>
                          레이팅
                        </th>
                        <th className="hidden border-b border-border px-2 py-2.5 text-right text-[11px] font-bold uppercase tracking-wider text-muted-foreground sm:table-cell" style={{ width: 56 }}>
                          부담
                        </th>
                        <th className="border-b border-border px-2 py-2.5 text-right text-[11px] font-bold uppercase tracking-wider text-muted-foreground" style={{ width: 88 }}>
                          기록
                        </th>
                        <th className="hidden border-b border-border px-2 py-2.5 text-right text-[11px] font-bold uppercase tracking-wider text-muted-foreground md:table-cell" style={{ width: 60 }}>
                          착차
                        </th>
                        <th className="border-b border-border px-2 py-2.5 text-right text-[11px] font-bold uppercase tracking-wider text-muted-foreground" style={{ width: 86 }}>
                          마체중
                        </th>
                        {hasMsf && (
                          <th
                            className="hidden border-b border-border px-2 py-2.5 text-right text-[11px] font-bold uppercase tracking-wider text-muted-foreground md:table-cell"
                            style={{ width: 78 }}
                            title="최근 10전 평균 / 최고 mal지수"
                          >
                            지수
                          </th>
                        )}
                        <th className="border-b border-border px-2 py-2.5 text-right text-[11px] font-bold uppercase tracking-wider text-muted-foreground" style={{ width: 110 }}>
                          단승
                        </th>
                        <th className="border-b border-border px-2 py-2.5 text-right text-[11px] font-bold uppercase tracking-wider text-muted-foreground" style={{ width: 110 }}>
                          연승
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {entries.map((e, i) => {
                        const rowBg =
                          entriesPhase === "post" && e.rank === 1
                            ? "bg-[#fff8df]"
                            : entriesPhase === "post" && e.rank === 2
                              ? "bg-[#f0f1f4]"
                              : entriesPhase === "post" && e.rank === 3
                                ? "bg-[#f8eedf]"
                                : "";
                        return (
                          <tr
                            key={i}
                            className={`${rowBg} border-b border-border/60 last:border-b-0 hover:bg-champagne-gold/[0.06]`}
                          >
                            <td className="px-2 py-2.5 text-center font-bold align-middle">
                              {entriesPhase === "pre" ? (
                                <GateNum n={e.chul_no} size={24} />
                              ) : (
                                <RankMedal rank={e.rank} />
                              )}
                            </td>
                            <td className="px-2 py-2.5 text-center align-middle">
                              <GateNum n={e.chul_no} />
                            </td>
                            <td className="px-2 py-2.5 align-middle">
                              <Link
                                href={`/horse/${e.horse_no}`}
                                className="text-sm font-bold text-primary hover:underline"
                              >
                                {e.horse_name}
                              </Link>
                              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                                <span className="inline-flex items-center gap-1">
                                  <SexBullet sex={e.sex} />
                                  {e.age && (
                                    <span className="font-mono tabular-nums">
                                      {/* KRA raw 가 "3" 또는 "3세" 로 섞여 옴 — "세" 중복 방지 */}
                                      {String(e.age).replace(/세$/, "")}세
                                    </span>
                                  )}
                                </span>
                                {compareMap[e.horse_no] && (
                                  <span
                                    className="font-mono tabular-nums"
                                    title="통산 1·2·3착 / 출주"
                                  >
                                    <strong className="text-foreground">
                                      {compareMap[e.horse_no].first_place_count}
                                      -
                                      {compareMap[e.horse_no].second_place_count}
                                      -
                                      {compareMap[e.horse_no].third_place_count}
                                    </strong>
                                    <span className="opacity-70">
                                      {" "}
                                      / {compareMap[e.horse_no].total_race_count}
                                    </span>
                                  </span>
                                )}
                                {(() => {
                                  // compareMap 의 recent_finishes 가 우선 (출전표 fetch 와 별도 집계).
                                  // 없으면 recentFinishesMap fallback.
                                  const finishes =
                                    compareMap[e.horse_no]?.recent_finishes ??
                                    recentFinishesMap[e.horse_no] ??
                                    [];
                                  return finishes.length > 0 ? (
                                    <RecentFormStrip finishes={finishes} />
                                  ) : null;
                                })()}
                              </div>
                            </td>
                            <td className="px-2 py-2.5 align-middle leading-tight">
                              <div className="flex items-center gap-1.5 text-[13px]">
                                {e.jockey_name ? (
                                  e.jockey_no ? (
                                    <Link
                                      href={`/jockey/${e.jockey_no}`}
                                      className="text-primary hover:underline"
                                    >
                                      {e.jockey_name}
                                    </Link>
                                  ) : (
                                    <span>{e.jockey_name}</span>
                                  )
                                ) : (
                                  <span className="text-muted-foreground">-</span>
                                )}
                                {e.jockey_changed_from && (
                                  <JockeyChangeBadge
                                    from={e.jockey_changed_from}
                                    to={e.jockey_name}
                                    reason={e.jockey_change_reason}
                                    weightBefore={e.jockey_weight_before}
                                    weightAfter={e.jockey_weight_after}
                                  />
                                )}
                              </div>
                              <div className="mt-0.5 text-[11px] text-muted-foreground">
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
                              </div>
                            </td>
                            <td className="hidden px-2 py-2.5 text-center align-middle font-mono text-xs tabular-nums text-muted-foreground sm:table-cell">
                              {e.age ?? "-"}
                            </td>
                            <td className="hidden px-2 py-2.5 text-right align-middle font-mono text-xs tabular-nums sm:table-cell">
                              {e.hr_rating ?? "-"}
                            </td>
                            <td className="hidden px-2 py-2.5 text-right align-middle font-mono text-xs tabular-nums text-muted-foreground sm:table-cell">
                              {e.budam_weight ?? "-"}
                            </td>
                            <td
                              className={`px-2 py-2.5 text-right align-middle font-mono text-xs tabular-nums font-semibold ${
                                e.rank === 1 && entriesPhase === "post" ? "text-primary" : ""
                              } ${entriesPhase === "pre" ? "text-muted-foreground" : ""}`}
                            >
                              {e.record_time ?? "-"}
                            </td>
                            <td className="hidden px-2 py-2.5 text-right align-middle font-mono text-xs tabular-nums text-muted-foreground md:table-cell">
                              {e.differ ?? "-"}
                            </td>
                            <td className="px-2 py-2.5 text-right align-middle font-mono text-xs tabular-nums">
                              {e.weight ?? "-"}
                              <WeightDelta diff={e.weight_diff} />
                            </td>
                            {hasMsf && (
                              <td
                                className="hidden px-2 py-2.5 text-right align-middle font-mono text-[11px] tabular-nums leading-tight md:table-cell"
                                title="최근 10전 평균 / 최고 mal지수"
                              >
                                <MsfCell
                                  avg={compareMap[e.horse_no]?.avg_msf ?? null}
                                  best={compareMap[e.horse_no]?.best_msf ?? null}
                                />
                              </td>
                            )}
                            <td className="px-2 py-2.5 text-right align-middle">
                              <OddsBar value={e.win_rate} kind="win" />
                            </td>
                            <td className="px-2 py-2.5 text-right align-middle">
                              <OddsBar value={e.plc_rate} kind="plc" />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>
            </>
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
                    .filter((e): e is typeof e & { chul_no: number } => e.chul_no != null)
                    .map((e) => ({ chul_no: e.chul_no, horse_name: e.horse_name }))}
                  state={betState}
                  loggedIn={!!userId}
                  balanceP={userBalance?.balance_p ?? null}
                  dailyTotalP={dailyTotalP}
                  startTime={selectedRace.start_time ?? null}
                />
              )}

              {raceCorner && (
                <div>
                  <h3 className="mb-3 text-sm font-semibold text-muted-foreground">
                    페이스 맵
                  </h3>
                  <Card>
                    <CardContent className="p-4">
                      <PaceMap
                        corner={raceCorner}
                        meet={selectedRace.meet}
                        winnerChulNo={
                          entries.find((e) => e.rank === 1)?.chul_no ?? null
                        }
                      />
                    </CardContent>
                  </Card>
                </div>
              )}

            </div>

            {/* ── 사이드바 (lg+) / 메인 컬럼 아래(mobile) ──
                영상·풀별매출·인기분포처럼 "한눈 정보" 는 우측으로 빠져
                메인 컬럼 상단을 출전표가 차지. */}
            <aside className="mt-6 space-y-4 lg:mt-0 lg:sticky lg:top-4 lg:self-start">
              {raceVideo && (
                <div className="hidden overflow-hidden rounded-xl border bg-card shadow-sm lg:block">
                  <div className="aspect-video w-full bg-black">
                    <iframe
                      src={youtubeEmbedUrl(raceVideo.video_id)}
                      title={raceVideo.title}
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                      allowFullScreen
                      className="h-full w-full"
                    />
                  </div>
                </div>
              )}

              {poolSales.length > 0 && (
                <div>
                  <div className="mb-2 flex items-baseline justify-between">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                      풀별 매출
                    </h3>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {(() => {
                        const t = poolSales.reduce((s, r) => s + Number(r.amount), 0);
                        if (t >= 100_000_000) return `${(t / 100_000_000).toFixed(2)}억`;
                        if (t >= 10_000) return `${Math.round(t / 10_000).toLocaleString("ko-KR")}만`;
                        return t.toLocaleString("ko-KR");
                      })()}
                    </span>
                  </div>
                  <PoolSalesTiles
                    compact
                    rows={[...poolSales].sort(
                      (a, b) =>
                        POOL_DISPLAY_ORDER.indexOf(
                          a.pool as (typeof POOL_DISPLAY_ORDER)[number],
                        ) -
                        POOL_DISPLAY_ORDER.indexOf(
                          b.pool as (typeof POOL_DISPLAY_ORDER)[number],
                        ),
                    )}
                    totalAmount={poolSales.reduce((s, r) => s + Number(r.amount), 0)}
                  />
                </div>
              )}

              {entries.length > 0 && entries.some((e) => e.win_rate) && (
                <div>
                  <div className="mb-2 flex items-baseline justify-between">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                      인기 분포
                    </h3>
                    <span className="text-[10px] text-muted-foreground">
                      단승 기준
                    </span>
                  </div>
                  <PopularityChart entries={entries} compact />
                </div>
              )}

              {entriesPhase === "post" && (
                <div>
                  <div className="mb-2 flex items-baseline justify-between">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                      인기 vs 결과
                    </h3>
                  </div>
                  <Card>
                    <CardContent className="p-3">
                      {/* 사이드바(좁은 폭) 에선 SVG 위 / 텍스트 아래의 세로 스택. */}
                      <div className="[&>div]:!flex-col [&>div]:!items-stretch">
                        <PopularityVsResult entries={entries} />
                      </div>
                    </CardContent>
                  </Card>
                </div>
              )}
            </aside>
          </div>

          {comboDividends.length > 0 && (
            <ComboDividendsSection rows={comboDividends} />
          )}
        </section>
      )}
    </main>
  );
}

/**
 * 최근 10전 mal지수 — 평균/최고 stacked.
 * 평균 ≥100 골드 강조, 95+ 에메랄드, 그 이하 muted.
 */
function MsfCell({
  avg,
  best,
}: {
  avg: number | null;
  best: number | null;
}) {
  if (avg === null && best === null) {
    return <span className="text-muted-foreground">-</span>;
  }
  const avgCls =
    avg === null
      ? "text-muted-foreground"
      : avg >= 100
        ? "text-amber-700 font-bold"
        : avg >= 95
          ? "text-emerald-700 font-semibold"
          : "text-foreground";
  return (
    <div className="flex flex-col items-end leading-tight">
      <span className={avgCls}>{avg === null ? "-" : avg.toFixed(1)}</span>
      <span className="text-[10px] opacity-60">
        {best === null ? "-" : best.toFixed(1)}
      </span>
    </div>
  );
}

/**
 * 기수교체 인라인 배지.
 * 체중(부담중량) 변화가 있으면 배지 우측에 "56→57" 형태로 노출.
 * 교체 사유는 hover title 로 유지.
 */
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
    wb !== null && wa !== null && Number.isFinite(wb) && Number.isFinite(wa) && wb !== wa;
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
            <Badge className="mb-1 bg-champagne-gold text-primary">예정</Badge>
            <h2 className="text-base font-bold">
              {formatDateLabel(date)} 예정 대상경주
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              주간 카드가 아직 등록되지 않아 출전표·결과는 일정 공개 후 표시됩니다.
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
                  const display = s.race_name.replace(/\s*\((G[123]|L|특)\)\s*/g, "").trim();
                  return (
                    <li key={s.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                      {s.tier && (
                        <span className="shrink-0 rounded bg-champagne-gold/20 px-1.5 py-0.5 text-[10px] font-bold text-gold-ink">
                          {s.tier}
                        </span>
                      )}
                      <span className="min-w-0 flex-1 truncate font-medium">{display}</span>
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

// 1·2·3위는 홈의 "TOP 기수 랭킹" 메달과 동일한 금/은/동 배지로 통일.
const RANK_MEDAL_STYLE: Record<number, string> = {
  1: "bg-champagne-gold text-primary",
  2: "bg-slate-400 text-white",
  3: "bg-amber-700 text-white",
};

function RankBadge({ rank }: { rank: number | null }) {
  if (rank === null) return <span className="text-muted-foreground">-</span>;
  if (rank <= 3) {
    return (
      <span
        className={`inline-flex h-7 w-7 items-center justify-center rounded-full font-mono text-xs font-bold tabular-nums ${RANK_MEDAL_STYLE[rank]}`}
      >
        {rank}
      </span>
    );
  }
  return <span>{rank}</span>;
}

