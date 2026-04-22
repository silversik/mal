import Link from "next/link";

import { RaceDatePicker } from "@/components/race-date-picker";
import { VenueIcon } from "@/components/venue-icon";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
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
  getRaceEntries,
  getRacesByDate,
  type RaceInfo,
} from "@/lib/races";
import { getRaceVideo, youtubeEmbedUrl, youtubeWatchUrl } from "@/lib/videos";

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

function formatDateLabel(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dow = ["일", "월", "화", "수", "목", "금", "토"][
    new Date(y, m - 1, d).getDay()
  ];
  return `${m}월 ${d}일 (${dow})`;
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

  const [races, raceDates] = await Promise.all([
    getRacesByDate(currentDate),
    getAllRaceDates(currentDate, 3),
  ]);

  const selectedRace =
    venue && race
      ? races.find((r) => r.meet === venue && r.race_no === Number(race)) ??
        null
      : null;

  const [entries, raceVideo] = selectedRace
    ? await Promise.all([
        getRaceEntries(currentDate, selectedRace.meet, selectedRace.race_no),
        getRaceVideo(currentDate, selectedRace.meet, selectedRace.race_no),
      ])
    : [[], null];

  // 크롤러 `sync_videos_backfill.format_race_title_query()` 와 동일한 포맷 — 수동 검색과
  // 자동 백필이 같은 쿼리를 쓰도록 맞춤. 예) "(서울) 2026.02.28 1경주"
  const ytSearchUrl = selectedRace
    ? `https://www.youtube.com/results?search_query=${encodeURIComponent(
        `(${selectedRace.meet}) ${currentDate.replaceAll("-", ".")} ${selectedRace.race_no}경주`,
      )}`
    : null;

  const byMeet = Object.fromEntries(
    MEET_ORDER.map((m) => [
      m,
      races.filter((r) => r.meet === m).sort((a, b) => a.race_no - b.race_no),
    ]),
  );
  const activeMeets = MEET_ORDER.filter((m) => byMeet[m].length > 0);

  const prevDate = offsetDate(currentDate, -1);
  const nextDate = offsetDate(currentDate, 1);

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8">
      <h1 className="mb-5 text-2xl font-bold tracking-tight">경기 일람</h1>

      {/* ── 날짜 네비게이션: 이전/다음 + 데이트피커 + 오늘 ── */}
      <div className="mb-6 flex items-center gap-2">
        <Link
          href={`/races?date=${prevDate}`}
          aria-label="이전 날"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border bg-card text-muted-foreground transition hover:bg-muted"
        >
          ‹
        </Link>

        <RaceDatePicker currentDate={currentDate} raceDates={raceDates} />

        <Link
          href={`/races?date=${nextDate}`}
          aria-label="다음 날"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border bg-card text-muted-foreground transition hover:bg-muted"
        >
          ›
        </Link>

        {!isToday && (
          <Link
            href="/races"
            className="shrink-0 rounded-lg border border-champagne-gold/60 bg-champagne-gold/10 px-3 py-1.5 text-sm font-medium text-champagne-gold transition hover:bg-champagne-gold/20 whitespace-nowrap"
          >
            오늘
          </Link>
        )}
      </div>

      {/* ── 경기 없음 ── */}
      {activeMeets.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            {formatDateLabel(currentDate)}에는 경기 기록이 없습니다.
          </CardContent>
        </Card>
      )}

      {/* ── 경마장 컬럼 그리드 ── */}
      {activeMeets.length > 0 && (
        <div
          className={`grid gap-4 ${
            activeMeets.length === 1
              ? "max-w-sm grid-cols-1"
              : activeMeets.length === 2
                ? "grid-cols-2"
                : "grid-cols-1 md:grid-cols-3"
          }`}
        >
          {activeMeets.map((meet) => {
            const meetRaces = byMeet[meet];
            const sampleRace = meetRaces[0];
            const trackInfo = [sampleRace.track_type, sampleRace.track_condition]
              .filter(Boolean)
              .join(" · ");

            return (
              <div
                key={meet}
                className="overflow-hidden rounded-xl border bg-card shadow-sm"
              >
                {/* 컬럼 헤더 */}
                <div className="border-b bg-primary/5 px-4 py-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-primary">
                      <VenueIcon meet={meet} size={18} />
                      <h2 className="text-base font-bold">{meet}</h2>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {meetRaces.length}경기
                    </span>
                  </div>
                  {trackInfo && (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      주로: {trackInfo}
                    </p>
                  )}
                </div>

                {/* 라운드 목록 */}
                <div className="divide-y divide-border/50">
                  {meetRaces.map((r) => {
                    const stakes = isStakesRace(r);
                    const status =
                      currentDate < today
                        ? "종료"
                        : currentDate === today
                          ? "진행중"
                          : "예정";
                    const isSelected =
                      selectedRace?.meet === r.meet &&
                      selectedRace?.race_no === r.race_no;
                    const href = `/races?date=${currentDate}&venue=${encodeURIComponent(r.meet)}&race=${r.race_no}`;

                    return (
                      <Link key={r.id} href={href} className="block">
                        <div
                          className={[
                            "flex items-start gap-3 px-4 py-2.5 transition",
                            isSelected
                              ? "bg-primary/8"
                              : "hover:bg-muted/50",
                            stakes && status === "진행중" && !isSelected
                              ? "bg-champagne-gold/6"
                              : "",
                          ]
                            .filter(Boolean)
                            .join(" ")}
                        >
                          {/* 라운드 배지 */}
                          <div
                            className={[
                              "flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded-md text-white",
                              isSelected
                                ? "bg-primary shadow-sm"
                                : stakes
                                  ? "bg-champagne-gold"
                                  : status === "종료"
                                    ? "bg-slate-400"
                                    : "bg-primary/80",
                              stakes && status === "진행중"
                                ? "animate-pulse"
                                : "",
                            ]
                              .filter(Boolean)
                              .join(" ")}
                          >
                            <span className="text-sm font-bold leading-none">
                              {r.race_no}
                            </span>
                            <span className="text-[9px] leading-none opacity-70">
                              R
                            </span>
                          </div>

                          {/* 경주 정보 */}
                          <div className="min-w-0 flex-1">
                            {/* 시각 */}
                            {r.start_time && (
                              <div className="mb-0.5 font-mono text-[11px] font-semibold text-muted-foreground tabular-nums">
                                {r.start_time}
                              </div>
                            )}
                            <div
                              className={`truncate text-sm font-semibold leading-snug ${
                                stakes
                                  ? "text-champagne-gold"
                                  : isSelected
                                    ? "text-primary"
                                    : ""
                              }`}
                            >
                              {r.race_name ?? `${r.race_no}라운드`}
                            </div>
                            <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                              {r.distance && <span>{r.distance}m</span>}
                              {r.entry_count && (
                                <>
                                  <span className="opacity-40">·</span>
                                  <span>{r.entry_count}두</span>
                                </>
                              )}
                              {r.grade && (
                                <>
                                  <span className="opacity-40">·</span>
                                  <span
                                    className={
                                      stakes
                                        ? "font-bold text-champagne-gold"
                                        : ""
                                    }
                                  >
                                    {r.grade}
                                  </span>
                                </>
                              )}
                            </div>
                          </div>

                          {isSelected && (
                            <div className="mt-2 h-2 w-2 shrink-0 rounded-full bg-primary" />
                          )}
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
                    ? "border-champagne-gold/40 bg-champagne-gold/10 text-champagne-gold"
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
                {raceVideo ? (
                  <a
                    href={youtubeWatchUrl(raceVideo.video_id)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-md bg-[#FF0000]/10 px-3 py-1.5 text-xs font-medium text-[#FF0000] transition hover:bg-[#FF0000]/20"
                  >
                    <YoutubeIcon />
                    경주 영상 보기
                  </a>
                ) : (
                  ytSearchUrl && (
                    <a
                      href={ytSearchUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-md border border-[#FF0000]/30 px-3 py-1.5 text-xs font-medium text-[#FF0000] transition hover:bg-[#FF0000]/10"
                    >
                      <YoutubeIcon />
                      유튜브에서 검색
                    </a>
                  )
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
            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-14 text-center">착순</TableHead>
                    <TableHead>마명</TableHead>
                    <TableHead className="text-center">기수</TableHead>
                    <TableHead className="text-right">기록</TableHead>
                    <TableHead className="text-right">마체중</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.map((e, i) => (
                    <TableRow key={i}>
                      <TableCell className="text-center font-semibold">
                        <RankBadge rank={e.rank} />
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
                        {e.jockey_name ?? "-"}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {e.record_time ?? "-"}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {e.weight ?? "-"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          ) : (
            <Card className="border-dashed">
              <CardContent className="py-8 text-center text-sm text-muted-foreground">
                출전 정보가 없습니다.
              </CardContent>
            </Card>
          )}
        </section>
      )}
    </main>
  );
}

/* ── helpers ─────────────────────────────────────────────── */

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
