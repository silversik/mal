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
import { getRaceVideo, youtubeEmbedUrl } from "@/lib/videos";

import { BetForm } from "./bet-form";

// KRBC 채널(UCsIvYoihIg37E96LkG-XHAw)의 라이브 URL — 방송 중이면 현재 스트림으로 자동 리다이렉트.
const KRBC_LIVE_URL = "https://www.youtube.com/channel/UCsIvYoihIg37E96LkG-XHAw/live";

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

  // 크롤러 `sync_videos_backfill.format_race_title_query()` 와 동일한 포맷 — 수동 검색과
  // 자동 백필이 같은 쿼리를 쓰도록 맞춤. 예) "(서울) 2026.02.28 1경주"
  const ytSearchUrl = selectedRace
    ? `https://www.youtube.com/results?search_query=${encodeURIComponent(
        `(${selectedRace.meet}) ${currentDate.replaceAll("-", ".")} ${selectedRace.race_no}경주`,
      )}`
    : null;

  // 경기 있는 날만 순회하도록 raceDates 내에서 탐색. 인접 레이스데이가 없으면 null.
  const prevDate = findNearbyRaceDate(raceDates, currentDate, "prev");
  const nextDate = findNearbyRaceDate(raceDates, currentDate, "next");

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8">
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
        <div className="mb-6 space-y-2">
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
                <div className="flex gap-1.5 overflow-x-auto pb-0.5 scrollbar-hide">
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
                            "flex h-9 w-9 flex-col items-center justify-center rounded-md border transition",
                            isSelected
                              ? "border-primary bg-primary text-white shadow-sm"
                              : stakes
                                ? "border-champagne-gold/60 bg-champagne-gold/10 text-gold-ink hover:bg-champagne-gold/20"
                                : status === "종료"
                                  ? "border-border bg-card text-muted-foreground hover:bg-muted"
                                  : "border-border bg-card text-foreground hover:bg-muted",
                            stakes && status === "진행중" && !isSelected
                              ? "animate-pulse"
                              : "",
                          ]
                            .filter(Boolean)
                            .join(" ")}
                        >
                          <span className="text-xs font-bold leading-none">
                            {r.race_no}
                          </span>
                          <span className="text-[8px] leading-none opacity-60">
                            R
                          </span>
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
        <section className="mt-8">
          <div className="mb-4 flex flex-wrap items-center gap-3 border-t pt-8">
            <div className="flex h-10 w-10 flex-col items-center justify-center rounded-md bg-primary text-white">
              <span className="text-sm font-bold leading-none">
                {selectedRace.race_no}
              </span>
              <span className="text-[9px] leading-none opacity-70">R</span>
            </div>
            <h2 className="text-xl font-bold">
              {selectedRace.race_name ?? `${selectedRace.race_no}라운드`}
            </h2>
            <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <VenueIcon meet={selectedRace.meet} size={14} className="opacity-60" />
              <span>{selectedRace.meet}</span>
            </div>
            <span className="font-mono text-sm text-muted-foreground">
              {currentDate}
            </span>
            {selectedRace.start_time && (
              <span className="font-mono text-sm font-semibold tabular-nums text-muted-foreground">
                {selectedRace.start_time}
              </span>
            )}
            {selectedRace.distance && (
              <span className="text-sm text-muted-foreground">
                {selectedRace.distance}m
              </span>
            )}
            {selectedRace.grade && (
              <Badge
                variant="secondary"
                className={`font-normal ${
                  isStakesRace(selectedRace)
                    ? "border-champagne-gold/40 bg-champagne-gold/10 text-gold-ink"
                    : ""
                }`}
              >
                {selectedRace.grade}
              </Badge>
            )}
            {selectedRace.track_condition && (
              <span className="text-sm text-muted-foreground">
                주로: {selectedRace.track_condition}
              </span>
            )}
            {selectedRace && (
              <div className="ml-auto flex items-center gap-2">
                {syncedAt && (
                  <span
                    className="text-[11px] text-muted-foreground/70 tabular-nums"
                    title={`데이터 수집 시각: ${syncedAt}`}
                  >
                    업데이트 {formatSyncedAt(syncedAt)}
                  </span>
                )}
                {isToday && (
                  <a
                    href={KRBC_LIVE_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-md bg-[#FF0000] px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-[#CC0000]"
                  >
                    <span className="relative flex h-2 w-2">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-white" />
                    </span>
                    KRBC 라이브
                  </a>
                )}
                {/* 시작 전 경기(미래/오늘 + phase=pre) 는 KRBC 영상이 존재할 수 없어
                    검색해도 빈 결과 → 검색 버튼 자체를 숨김. 지난 경기인데 phase=pre
                    (수집 지연) 또는 phase=post + 영상 매칭 누락 case 는 사용자가 직접
                    검색해 영상을 찾을 수 있게 유지. */}
                {!raceVideo && ytSearchUrl && !(entriesPhase === "pre" && currentDate >= today) && (
                  <a
                    href={ytSearchUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-md border border-[#FF0000]/30 px-3 py-1.5 text-xs font-medium text-[#FF0000] transition hover:bg-[#FF0000]/10"
                  >
                    <YoutubeIcon />
                    유튜브에서 검색
                  </a>
                )}
              </div>
            )}
          </div>

          {raceVideo && (
            <div className="mb-6 overflow-hidden rounded-xl border bg-card shadow-sm">
              <div className="aspect-video w-full bg-black">
                <iframe
                  src={youtubeEmbedUrl(raceVideo.video_id)}
                  title={raceVideo.title}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                  className="h-full w-full"
                />
              </div>
              <div className="px-4 py-3 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{raceVideo.title}</span>
                {raceVideo.channel_title && (
                  <>
                    <span className="mx-1.5 opacity-40">·</span>
                    {raceVideo.channel_title}
                  </>
                )}
              </div>
            </div>
          )}

          {entries.length > 0 ? (
            <>
              {entriesPhase === "pre" && (
                <div className="mb-3 inline-flex items-center gap-2 rounded-md border border-champagne-gold/40 bg-champagne-gold/10 px-3 py-1.5 text-xs font-medium text-gold-ink">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-champagne-gold opacity-60" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-champagne-gold" />
                  </span>
                  출전표 (경주 전 · 결과 미확정)
                </div>
              )}
              <Card className="py-0">
              <div className="relative overflow-x-auto rounded-[inherit]">
              <Table className="min-w-[580px]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="sticky left-0 z-10 w-14 bg-background text-center">
                      {entriesPhase === "pre" ? "출전" : "착순"}
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
                        {entriesPhase === "pre" ? (
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

          {comboDividends.length > 0 && (
            <ComboDividendsSection rows={comboDividends} />
          )}

          {poolSales.length > 0 && <PoolSalesSection rows={poolSales} />}
        </section>
      )}
    </main>
  );
}

/* ── 풀별 매출 섹션 ──────────────────────────────────────── */

/** 매출액(원) → "1.2억" / "3,400만" / "5,200" 형태로 축약. */
function formatAmount(amountStr: string): string {
  const n = Number(amountStr);
  if (!Number.isFinite(n) || n === 0) return "-";
  if (n >= 100_000_000) return `${(n / 100_000_000).toFixed(2)}억`;
  if (n >= 10_000) return `${Math.round(n / 10_000).toLocaleString("ko-KR")}만`;
  return n.toLocaleString("ko-KR");
}

function PoolSalesSection({ rows }: { rows: RacePoolSales[] }) {
  const total = rows.reduce((s, r) => s + Number(r.amount), 0);
  // KRA 가 응답 안 한 풀은 표시하지 않음 — 단순히 받은 풀만 정렬해 보여준다.
  const sorted = [...rows].sort(
    (a, b) =>
      POOL_DISPLAY_ORDER.indexOf(a.pool as (typeof POOL_DISPLAY_ORDER)[number]) -
      POOL_DISPLAY_ORDER.indexOf(b.pool as (typeof POOL_DISPLAY_ORDER)[number]),
  );

  return (
    <div className="mt-6">
      <div className="mb-3 flex items-baseline justify-between">
        <h3 className="text-sm font-semibold text-muted-foreground">풀별 매출</h3>
        <span className="text-xs text-muted-foreground tabular-nums">
          총 매출 <strong className="text-foreground">{formatAmount(String(total))}</strong>
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
      {/* 좌우 슬라이드 — 풀 종류가 많고 모바일에서 그리드로 펼치면 너무 길어지므로
          가로 스크롤 + snap 으로 한 손 스와이프에 최적화. */}
      <div className="-mx-4 overflow-x-auto px-4 scrollbar-hide sm:mx-0 sm:px-0">
        <div className="flex snap-x snap-mandatory gap-4 pb-2">
          {activePools.map((pool) => {
            const items = byPool.get(pool) ?? [];
            return (
              <Card
                key={pool}
                className="w-[78%] shrink-0 snap-start py-0 sm:w-[46%] lg:w-[32%]"
              >
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

function YoutubeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
    </svg>
  );
}
