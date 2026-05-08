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

// KRBC 채널(UCsIvYoihIg37E96LkG-XHAw)의 라이브 URL — 방송 중이면 현재 스트림으로 자동 리다이렉트.
const KRBC_LIVE_URL = "https://www.youtube.com/channel/UCsIvYoihIg37E96LkG-XHAw/live";

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
            className="shrink-0 rounded-lg border border-champagne-gold/60 bg-champagne-gold/10 px-3 py-1.5 text-sm font-medium text-champagne-gold transition hover:bg-champagne-gold/20 whitespace-nowrap"
          >
            오늘
          </Link>
        )}
      </div>

      {/* ── 경기 없음 — CTA + 다가오는 대상경주 미리보기 ── */}
      {activeMeets.length === 0 && plannedForDate.length === 0 && (
        <EmptyDayPanel
          currentDate={currentDate}
          prevDate={prevDate}
          nextDate={nextDate}
          upcoming={upcomingAll
            .filter((s) => s.race_date > currentDate)
            .slice(0, 3)}
        />
      )}

      {/* ── 예정된 대상경주 (races 미적재 상태) ── */}
      {activeMeets.length === 0 && plannedForDate.length > 0 && (
        <UpcomingStakesPanel date={currentDate} stakes={plannedForDate} />
      )}

      {/* ── 라운드 레일 (경기장별) ── */}
      {activeMeets.length > 0 && (
        <div className="mb-6 overflow-hidden rounded-xl border bg-card shadow-sm">
          {activeMeets.map((meet, mi) => {
            const meetRaces = byMeet[meet];
            const status =
              currentDate < today
                ? "종료"
                : currentDate === today
                  ? "진행중"
                  : "예정";
            const statusClass =
              status === "종료"
                ? "text-muted-foreground"
                : status === "진행중"
                  ? "text-[#FF0000]"
                  : "text-champagne-gold";

            return (
              <div
                key={meet}
                className={[
                  "flex items-center gap-3 px-3 py-2 sm:px-4",
                  mi > 0 ? "border-t" : "",
                ].join(" ")}
              >
                <div className="flex w-[88px] shrink-0 items-center gap-1.5 whitespace-nowrap text-[13px] font-bold">
                  <VenueIcon meet={meet} size={14} />
                  <span>{meet}</span>
                  <span className={`text-[10px] font-semibold ${statusClass}`}>
                    · {status}
                  </span>
                </div>
                <div className="flex flex-1 gap-1.5 overflow-x-auto scrollbar-hide">
                  {meetRaces.map((r) => {
                    const stakes = isStakesRace(r);
                    const isSelected =
                      selectedRace?.meet === r.meet &&
                      selectedRace?.race_no === r.race_no;
                    const href = `/races?date=${currentDate}&venue=${encodeURIComponent(r.meet)}&race=${r.race_no}`;

                    return (
                      <Link
                        key={r.id}
                        href={href}
                        className="relative flex h-[42px] min-w-[60px] flex-1 flex-col items-center justify-center rounded-lg border transition"
                        style={
                          isSelected
                            ? {
                                borderColor: "var(--primary)",
                                background: "var(--primary)",
                                color: "#fff",
                                boxShadow: "0 2px 6px -2px rgba(139,90,60,0.4)",
                              }
                            : stakes
                              ? {
                                  borderColor:
                                    "color-mix(in srgb, var(--color-champagne-gold) 50%, transparent)",
                                  background:
                                    "color-mix(in srgb, var(--color-champagne-gold) 12%, transparent)",
                                  color: "var(--color-champagne-gold)",
                                }
                              : {
                                  borderColor: "var(--border)",
                                  background: "var(--card)",
                                  color:
                                    status === "종료"
                                      ? "var(--muted-foreground)"
                                      : "var(--foreground)",
                                }
                        }
                      >
                        <span className="text-[13px] font-bold leading-none">
                          {r.race_no}R
                        </span>
                        {r.start_time && (
                          <span className="mt-1 font-mono text-[10px] leading-none tabular-nums opacity-70">
                            {r.start_time}
                          </span>
                        )}
                        {stakes && !isSelected && (
                          <span className="absolute right-1 top-0.5 text-[9px] font-extrabold leading-none">
                            ★
                          </span>
                        )}
                        {stakes &&
                          status === "진행중" &&
                          !isSelected && (
                            <span className="absolute inset-0 animate-pulse rounded-lg ring-1 ring-champagne-gold/40" />
                          )}
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
        <section className="mt-6">
          <RaceHeaderCard
            race={selectedRace}
            currentDate={currentDate}
            isToday={isToday}
            isStakes={isStakesRace(selectedRace)}
            syncedAtFormatted={syncedAt ? formatSyncedAt(syncedAt) : null}
            syncedAtRaw={syncedAt}
            videoId={raceVideo?.video_id ?? null}
            videoTitle={raceVideo?.title ?? null}
            ytSearchUrl={ytSearchUrl}
          />

          {entries.length > 0 ? (
            <>
              {entriesPhase === "pre" && (
                <div className="mb-3 inline-flex items-center gap-2 rounded-md border border-champagne-gold/40 bg-champagne-gold/10 px-3 py-1.5 text-xs font-medium text-champagne-gold">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-champagne-gold opacity-60" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-champagne-gold" />
                  </span>
                  출전표 (경주 전 · 결과 미확정)
                </div>
              )}
              <Card>
              <div className="relative overflow-x-auto rounded-[inherit]">
                <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-8 bg-gradient-to-l from-background to-transparent md:hidden" />
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
        <h3 className="text-sm font-semibold text-muted-foreground">
          풀별 매출 · 배당
        </h3>
        <span className="text-xs text-muted-foreground tabular-nums">
          총{" "}
          <strong className="text-foreground">{formatAmount(String(total))}</strong>
        </span>
      </div>
      <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
        {sorted.map((r, i) => (
          <div
            key={r.pool}
            className={[
              "grid items-center gap-3 px-4 py-3 text-sm",
              "grid-cols-[44px_1fr_auto]",
              i < sorted.length - 1 ? "border-b" : "",
            ].join(" ")}
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
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {activePools.map((pool) => {
          const items = byPool.get(pool) ?? [];
          const ordered = POOL_ORDERED[pool];
          return (
            <div
              key={pool}
              className="overflow-hidden rounded-xl border bg-card shadow-sm"
            >
              <div className="flex items-baseline justify-between border-b border-champagne-gold/20 bg-champagne-gold/8 px-3 py-2">
                <div className="flex items-baseline gap-1.5">
                  <span className="text-[12px] font-extrabold tracking-wider text-champagne-gold">
                    {POOL_LABEL[pool]}
                  </span>
                  <span className="font-mono text-[10px] text-champagne-gold/70">
                    {pool}
                  </span>
                </div>
                <span className="text-[10px] text-muted-foreground">
                  {ordered ? "착순 일치" : "조합"}
                </span>
              </div>
              <div className="divide-y divide-border/40">
                {items.map((d, i) => (
                  <ComboRow
                    key={`${pool}-${i}`}
                    d={d}
                    ordered={ordered}
                    rank={i + 1}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** 복식배당 한 줄 — 마번 칩 + (→ / ·) 구분자 + 마명 + 우측 배당 */
function ComboRow({
  d,
  ordered,
  rank,
}: {
  d: RaceComboDividend;
  ordered: boolean;
  rank: number;
}) {
  const horses: { no: string; name: string | null }[] = [
    { no: d.horse_no_1, name: d.horse_name_1 },
    { no: d.horse_no_2, name: d.horse_name_2 },
  ];
  if (d.horse_no_3) {
    horses.push({ no: d.horse_no_3, name: d.horse_name_3 });
  }
  const sep = ordered ? "→" : "·";
  return (
    <div className="grid grid-cols-[1fr_auto] items-center gap-3 px-3 py-2">
      <div className="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-1">
        <span
          className="mr-1 text-[10px] font-bold tabular-nums text-muted-foreground/80"
          aria-hidden
        >
          {rank}
        </span>
        {horses.map((h, i) => (
          <span key={i} className="flex items-center gap-1 min-w-0">
            {i > 0 && (
              <span className="text-[11px] text-muted-foreground/70">
                {sep}
              </span>
            )}
            <span className="inline-flex h-[18px] min-w-[20px] items-center justify-center rounded bg-muted px-1 font-mono text-[10px] font-bold tabular-nums">
              {h.no}
            </span>
            {h.name && (
              <span className="truncate text-[12px] font-medium">
                {h.name}
              </span>
            )}
          </span>
        ))}
      </div>
      <span className="shrink-0 font-mono text-[13px] font-bold tabular-nums">
        {formatOdds(d.odds)}
      </span>
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
                        <span className="shrink-0 rounded bg-champagne-gold/20 px-1.5 py-0.5 text-[10px] font-bold text-champagne-gold">
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

function RankBadge({ rank }: { rank: number | null }) {
  if (rank === null) return <span className="text-muted-foreground">-</span>;
  if (rank === 1)
    return <Badge className="bg-primary text-primary-foreground">1</Badge>;
  if (rank <= 3) return <Badge variant="secondary">{rank}</Badge>;
  return <span>{rank}</span>;
}

function YoutubeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
    </svg>
  );
}

/* ── 경기 헤더 카드 ──────────────────────────────────────── */
/**
 * 출전표/결과 위에 올라가는 메달리언 카드.
 * 디자인 요점: 메달리언(R번호) + 제목·메타 + 우측 데이터 갱신 시각 + 우측 영상 썸네일.
 *
 * 영상 썸네일 우선순위: race_video > KRBC 라이브(오늘) > 유튜브 검색 폴백.
 * 라이브 상태는 KRBC 채널의 LIVE 페이지(자동 리다이렉트)로 빠지므로 썸네일에는
 * `LIVE` 배지만 표시한다. 검색 폴백은 썸네일 대신 텍스트 링크.
 */
function RaceHeaderCard({
  race,
  currentDate,
  isToday,
  isStakes,
  syncedAtFormatted,
  syncedAtRaw,
  videoId,
  videoTitle,
  ytSearchUrl,
}: {
  race: RaceInfo;
  currentDate: string;
  isToday: boolean;
  isStakes: boolean;
  syncedAtFormatted: string | null;
  syncedAtRaw: string | null;
  videoId: string | null;
  videoTitle: string | null;
  ytSearchUrl: string | null;
}) {
  const showLiveThumb = isToday && !videoId;
  const showVideoThumb = !!videoId;
  const hasThumb = showVideoThumb || showLiveThumb;

  const thumbHref = videoId ? youtubeWatchUrl(videoId) : KRBC_LIVE_URL;
  // KRBC 채널 라이브 페이지는 thumbnail 이미지가 채널 정책상 핫링크 차단되는 경우가
  // 있어 빈 검정 박스로 폴백. 영상 ID 가 있으면 ytimg CDN 의 mqdefault 사용.
  const thumbImg = videoId
    ? `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`
    : null;

  return (
    <div
      className={[
        "mb-5 rounded-xl border bg-card shadow-sm",
        "px-4 py-4 sm:px-6 sm:py-5",
      ].join(" ")}
    >
      <div
        className={[
          "grid items-center gap-4",
          hasThumb
            ? "grid-cols-[auto_1fr] sm:grid-cols-[auto_1fr_auto_auto]"
            : "grid-cols-[auto_1fr] sm:grid-cols-[auto_1fr_auto]",
        ].join(" ")}
      >
        {/* Race-number medallion */}
        <div
          className="flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-xl text-white shadow-md sm:h-16 sm:w-16"
          style={{
            background: isStakes
              ? "linear-gradient(135deg, var(--color-champagne-gold), #B8962E)"
              : "linear-gradient(135deg, var(--primary), #6E4631)",
          }}
        >
          <span className="text-2xl font-extrabold leading-none tracking-tight sm:text-[26px]">
            {race.race_no}
          </span>
          <span className="mt-1 text-[9px] tracking-[0.1em] opacity-80">
            RACE
          </span>
        </div>

        {/* Title + meta */}
        <div className="min-w-0">
          <div className="mb-1.5 flex flex-wrap items-center gap-2">
            {isStakes && race.grade && (
              <span className="rounded border border-champagne-gold/40 bg-champagne-gold/10 px-1.5 py-0.5 text-[10px] font-extrabold tracking-wider text-champagne-gold">
                {race.grade} 대상경주
              </span>
            )}
            {!isStakes && race.grade && (
              <Badge variant="secondary" className="font-normal">
                {race.grade}
              </Badge>
            )}
            <span className="venue-chip inline-flex items-center gap-1.5 text-xs font-semibold">
              <VenueIcon meet={race.meet} size={13} />
              {race.meet}
            </span>
          </div>
          <h2 className="truncate text-lg font-extrabold tracking-tight sm:text-xl">
            {race.race_name ?? `${race.race_no}라운드`}
          </h2>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-muted-foreground tabular-nums">
            <span className="font-mono">📅 {currentDate}</span>
            {race.start_time && (
              <span className="font-mono font-semibold">
                🕐 {race.start_time}
              </span>
            )}
            {race.distance && <span>📏 {race.distance}m</span>}
            {race.track_condition && <span>🌤 주로 {race.track_condition}</span>}
          </div>
        </div>

        {/* Synced at + KRBC live (sm+) */}
        <div className="col-span-2 flex flex-col items-end gap-1.5 sm:col-span-1">
          {syncedAtFormatted && (
            <span
              className="text-[11px] tabular-nums text-muted-foreground/70"
              title={
                syncedAtRaw ? `데이터 수집 시각: ${syncedAtRaw}` : undefined
              }
            >
              업데이트 {syncedAtFormatted}
            </span>
          )}
          {!hasThumb && isToday && (
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
          {!hasThumb && !isToday && ytSearchUrl && (
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

        {/* Right thumbnail link (video or live) */}
        {hasThumb && (
          <a
            href={thumbHref}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={
              showLiveThumb ? "KRBC 라이브 시청" : "경주 영상 보기"
            }
            title={videoTitle ?? (showLiveThumb ? "KRBC 라이브" : undefined)}
            className={[
              "relative col-span-2 block aspect-video w-full overflow-hidden rounded-lg bg-black sm:col-span-1 sm:w-[180px]",
              showLiveThumb
                ? "border border-[#FF0000]/40"
                : "border border-border",
            ].join(" ")}
          >
            {thumbImg ? (
              <img
                src={thumbImg}
                alt=""
                className="absolute inset-0 h-full w-full object-cover"
              />
            ) : (
              <div className="absolute inset-0 bg-gradient-to-br from-[#1a0000] via-black to-[#1a0000]" />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-transparent" />
            <span
              className={[
                "absolute left-1.5 top-1.5 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9.5px] font-extrabold tracking-wider text-white",
                showLiveThumb ? "bg-[#FF0000]" : "bg-black/75",
              ].join(" ")}
            >
              {showLiveThumb && (
                <span className="relative inline-flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-white" />
                </span>
              )}
              {showLiveThumb ? "LIVE" : "▶ 영상"}
            </span>
            <span className="absolute inset-0 flex items-center justify-center">
              <span
                className={[
                  "flex h-7 w-9 items-center justify-center rounded-md",
                  showLiveThumb ? "bg-[#FF0000]/90" : "bg-black/75",
                ].join(" ")}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="white"
                >
                  <path d="M8 5v14l11-7z" />
                </svg>
              </span>
            </span>
          </a>
        )}
      </div>
    </div>
  );
}

/* ── 빈 날짜 패널 ────────────────────────────────────────── */
/** "이 날은 경기가 없어요" — CTA(직전 결과 / 다음 출전표) + 다가오는 대상경주 미리보기. */
function EmptyDayPanel({
  currentDate,
  prevDate,
  nextDate,
  upcoming,
}: {
  currentDate: string;
  prevDate: string | null;
  nextDate: string | null;
  upcoming: UpcomingStake[];
}) {
  return (
    <>
      <div className="relative overflow-hidden rounded-2xl border bg-card px-6 py-12 text-center shadow-sm sm:px-12 sm:py-14">
        {/* Decorative gold rings */}
        <div
          className="pointer-events-none absolute -right-32 -top-32 h-72 w-72 rounded-full border border-champagne-gold/20"
          style={{
            background:
              "radial-gradient(circle at 30% 30%, rgba(212,175,55,0.10), transparent 60%)",
          }}
        />
        <div className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full border border-champagne-gold/10" />

        <div className="relative">
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-muted text-muted-foreground">
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
          <h2 className="mb-2 text-xl font-extrabold tracking-tight sm:text-2xl">
            이 날은 경기가 없어요
          </h2>
          <p className="mb-7 text-sm leading-relaxed text-muted-foreground">
            {formatDateLabel(currentDate)}에는 등록된 경기가 없습니다.
            <br />
            가까운 경기일로 이동하거나, 다가오는 대상경주 일정을 확인해 보세요.
          </p>

          <div className="flex flex-wrap items-center justify-center gap-2.5">
            {prevDate && (
              <Link
                href={`/races?date=${prevDate}`}
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-3 text-sm font-bold text-white shadow-md transition hover:bg-primary/90"
              >
                ‹ {formatDateLabel(prevDate)} 결과 보기
              </Link>
            )}
            {nextDate && (
              <Link
                href={`/races?date=${nextDate}`}
                className="inline-flex items-center gap-2 rounded-lg border bg-card px-5 py-3 text-sm font-bold text-foreground transition hover:bg-muted"
              >
                {formatDateLabel(nextDate)} 출전표 ›
              </Link>
            )}
          </div>
        </div>
      </div>

      {upcoming.length > 0 && (
        <div className="mt-8">
          <div className="mb-3 flex items-baseline justify-between">
            <h3 className="text-sm font-bold tracking-tight text-muted-foreground">
              다가오는 대상경주
            </h3>
            <Link
              href="/races/schedule"
              className="text-xs text-muted-foreground transition hover:text-primary"
            >
              전체 일정 →
            </Link>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {upcoming.map((s) => (
              <UpcomingStakeCard key={s.id} stake={s} today={currentDate} />
            ))}
          </div>
        </div>
      )}
    </>
  );
}

function UpcomingStakeCard({
  stake,
  today,
}: {
  stake: UpcomingStake;
  today: string;
}) {
  const display = stake.race_name.replace(/\s*\((G[123]|L|특)\)\s*/g, "").trim();
  const days = daysBetween(today, stake.race_date);
  const dLabel = days <= 0 ? "오늘" : `D-${days}`;
  return (
    <Link
      href={`/races?date=${stake.race_date}`}
      className="block rounded-xl border bg-card p-4 shadow-sm transition hover:bg-muted/40"
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="venue-chip inline-flex items-center gap-1.5 text-xs font-semibold">
          <VenueIcon meet={stake.meet} size={13} />
          {stake.meet}
        </span>
        {stake.tier && (
          <span className="rounded bg-champagne-gold/15 px-1.5 py-0.5 text-[10px] font-extrabold tracking-wider text-champagne-gold">
            {stake.tier}
          </span>
        )}
      </div>
      <div className="mb-1.5 truncate text-[15px] font-bold tracking-tight">
        {display}
      </div>
      <div className="flex items-baseline justify-between text-xs text-muted-foreground tabular-nums">
        <span>
          {formatDateLabel(stake.race_date)}
          {stake.distance ? ` · ${stake.distance}m` : ""}
        </span>
        <span className="font-bold text-primary">{dLabel}</span>
      </div>
    </Link>
  );
}

/** 두 YYYY-MM-DD 사이의 일수 차이(정수). 같은 날이면 0. */
function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  const da = Date.UTC(ay, am - 1, ad);
  const db = Date.UTC(by, bm - 1, bd);
  return Math.round((db - da) / 86_400_000);
}
