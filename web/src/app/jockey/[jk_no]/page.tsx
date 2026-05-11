import { cache } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

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
  getJockeyByNo,
  getJockeyMonthlyStats,
  getJockeyTrainerCombos,
  getRecentRacesByJockey,
  type Jockey,
} from "@/lib/jockeys";
import { getVideosForRaces, raceKey } from "@/lib/videos";
import { youtubeWatchUrl } from "@/lib/video-helpers";
import { WinRateBars } from "@/components/win-rate-bar";
import { WinRateRing } from "@/components/win-rate-ring";
import { RecentFormDots } from "@/components/recent-form-dots";
import { JockeyTrainerCombos } from "@/components/jockey-trainer-combos";
import { JockeyMonthlyChart } from "@/components/jockey-monthly-chart";
import { BreadcrumbJsonLd } from "@/components/seo/breadcrumb-jsonld";
import {
  BreadCrumb,
  ProfileTag,
  SectionHead,
  IconActivity,
  IconBars,
  IconCalendar,
  IconCrown,
  IconFlag,
  IconHash,
  IconTarget,
  IconUserPlus,
} from "@/components/profile-ui";
import { StatsBar } from "@/components/stats-bar";

const fetchJockey = cache(getJockeyByNo);

export async function generateMetadata(
  { params }: { params: Promise<{ jk_no: string }> },
): Promise<Metadata> {
  const { jk_no } = await params;
  const jockey = await fetchJockey(jk_no);
  if (!jockey) return { title: "기수 정보 없음", robots: { index: false } };
  const winRate = jockey.win_rate ? `${jockey.win_rate}%` : "-";
  const description = `${jockey.jk_name} 기수 (${jockey.meet ?? ""}) — 통산 ${jockey.total_race_count}전 ${jockey.first_place_count}·${jockey.second_place_count}·${jockey.third_place_count}, 승률 ${winRate}. 최근 기승 기록.`;
  return {
    title: `${jockey.jk_name} · 기수 프로필`,
    description,
    alternates: { canonical: `/jockey/${jk_no}` },
    openGraph: {
      type: "profile",
      title: `${jockey.jk_name} · 기수 프로필`,
      description,
      url: `/jockey/${jk_no}`,
    },
  };
}

export default async function JockeyDetailPage({
  params,
}: {
  params: Promise<{ jk_no: string }>;
}) {
  const { jk_no } = await params;
  const jockey = await fetchJockey(jk_no);
  if (!jockey) notFound();

  const [recentRaces, combos, monthly] = await Promise.all([
    getRecentRacesByJockey(jockey.jk_name, 20),
    getJockeyTrainerCombos(jockey.jk_name, 5),
    getJockeyMonthlyStats(jockey.jk_name, 12),
  ]);
  const videoMap = await getVideosForRaces(recentRaces);

  const total = jockey.total_race_count;
  const winRate = jockey.win_rate == null ? null : Number(jockey.win_rate);
  const plcRate =
    total > 0
      ? ((jockey.first_place_count + jockey.second_place_count) / total) * 100
      : null;
  const showRate =
    total > 0
      ? ((jockey.first_place_count +
          jockey.second_place_count +
          jockey.third_place_count) /
          total) *
        100
      : null;

  const monthlyHasData = monthly.some((m) => m.starts > 0);
  const recentRanks = recentRaces.map((r) => r.rank);

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-5 md:px-6 md:py-6">
      <BreadcrumbJsonLd
        items={[
          { name: "홈", url: "/" },
          { name: "기수", url: "/jockeys" },
          { name: jockey.jk_name, url: `/jockey/${jk_no}` },
        ]}
      />

      <BreadCrumb
        items={[
          { label: "홈", href: "/" },
          { label: "기수", href: "/jockeys" },
          { label: jockey.jk_name },
        ]}
      />

      <JockeyProfileCard jockey={jockey} recentRanks={recentRanks} winRate={winRate} />

      <div className="mt-5 grid gap-5 md:grid-cols-[minmax(0,1fr)_320px]">
        {/* 좌측: 최근 기승 기록 */}
        <div className="min-w-0">
          <SectionHead icon={<IconActivity size={13} />} label="최근 기승 기록" />
          {recentRaces.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="py-8 text-center text-sm text-muted-foreground">
                기승 기록이 아직 적재되지 않았습니다.
              </CardContent>
            </Card>
          ) : (
            <Card className="overflow-hidden p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-center">착순</TableHead>
                    <TableHead className="text-center">일자</TableHead>
                    <TableHead className="text-center">경마장</TableHead>
                    <TableHead className="text-center">경주</TableHead>
                    <TableHead className="text-center">마명</TableHead>
                    <TableHead className="text-right">기록</TableHead>
                    <TableHead className="w-12 text-center">영상</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentRaces.map((r) => {
                    const raceHref =
                      r.race_date && r.meet && r.race_no
                        ? `/races?date=${r.race_date}&venue=${encodeURIComponent(r.meet)}&race=${r.race_no}`
                        : null;
                    const video =
                      r.race_date && r.meet && r.race_no
                        ? videoMap.get(raceKey(r.race_date, r.meet, r.race_no))
                        : null;
                    return (
                      <TableRow key={r.id}>
                        <TableCell className="text-center font-semibold">
                          <RankBadge rank={r.rank} />
                        </TableCell>
                        <TableCell className="text-center font-mono text-xs text-muted-foreground">
                          {r.race_date}
                        </TableCell>
                        <TableCell className="text-center">{r.meet ?? "-"}</TableCell>
                        <TableCell className="text-center">
                          {raceHref ? (
                            <Link href={raceHref} className="text-primary hover:underline">
                              {r.race_no}R
                            </Link>
                          ) : (
                            `${r.race_no}R`
                          )}
                        </TableCell>
                        <TableCell className="text-center">
                          <Link
                            href={`/horse/${r.horse_no}`}
                            className="text-primary hover:underline"
                          >
                            {r.horse_name}
                          </Link>
                        </TableCell>
                        <TableCell className="text-right font-mono font-semibold tabular-nums">
                          {r.record_time ?? "-"}
                        </TableCell>
                        <TableCell className="text-center">
                          {video ? (
                            <a
                              href={youtubeWatchUrl(video.video_id)}
                              target="_blank"
                              rel="noopener noreferrer"
                              aria-label="YouTube에서 경주 영상 보기"
                              className="inline-flex items-center justify-center text-[#FF0000] opacity-70 transition hover:opacity-100"
                            >
                              <YoutubeIcon />
                            </a>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Card>
          )}

          {combos.length > 0 && (
            <div className="mt-8">
              <SectionHead
                icon={<IconUserPlus size={13} />}
                label="조교사별 동승"
                right={
                  <span className="text-[11px] text-muted-foreground">
                    5회 이상
                  </span>
                }
              />
              <JockeyTrainerCombos combos={combos} />
            </div>
          )}
        </div>

        {/* 우측 사이드바: 승률 카드 + 월별 카드 */}
        <aside className="flex flex-col gap-4">
          {(winRate != null || plcRate != null || showRate != null) && (
            <Card>
              <CardContent className="p-4">
                <SectionHead
                  icon={<IconTarget size={13} />}
                  label="승률 · 복승률 · 복연승률"
                />
                <WinRateBars
                  winRate={winRate}
                  plcRate={plcRate}
                  showRate={showRate}
                />
              </CardContent>
            </Card>
          )}

          {monthlyHasData && (
            <Card>
              <CardContent className="p-4">
                <SectionHead icon={<IconBars size={13} />} label="월별 1착" />
                <JockeyMonthlyChart data={monthly} width={272} height={110} />
              </CardContent>
            </Card>
          )}
        </aside>
      </div>
    </main>
  );
}

function JockeyProfileCard({
  jockey,
  recentRanks,
  winRate,
}: {
  jockey: Jockey;
  recentRanks: (number | null)[];
  winRate: number | null;
}) {
  const initial = jockey.jk_name?.[0] ?? "?";

  return (
    <Card className="royal-card">
      <CardContent className="p-4">
        {/* 헤더 */}
        <div className="flex items-start gap-3">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-primary text-3xl font-extrabold leading-none text-secondary">
            {initial}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              {jockey.meet && (
                <ProfileTag tone="navy" icon={<IconFlag size={10} />}>
                  {jockey.meet} 소속
                </ProfileTag>
              )}
              {winRate != null && winRate >= 15 && (
                <ProfileTag tone="gold" icon={<IconCrown size={11} />}>
                  승률 TOP
                </ProfileTag>
              )}
            </div>
            <h1 className="mt-0.5 whitespace-nowrap text-2xl font-extrabold leading-tight tracking-tight sm:text-3xl">
              {jockey.jk_name}
              <span className="ml-2 align-middle text-sm font-medium text-muted-foreground">
                기수
              </span>
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              {jockey.debut_date && (
                <span className="inline-flex items-center gap-1">
                  <IconCalendar size={12} />
                  데뷔 {jockey.debut_date}
                </span>
              )}
              <Sep />
              <span className="inline-flex items-center gap-1 font-mono">
                <IconHash size={12} />
                {jockey.jk_no}
              </span>
              {jockey.birth_date && (
                <>
                  <Sep />
                  <span className="inline-flex items-center gap-1">
                    <IconCalendar size={12} />생 {jockey.birth_date}
                  </span>
                </>
              )}
            </div>
          </div>
          {winRate != null && (
            <div className="shrink-0">
              <WinRateRing value={winRate} size={72} />
            </div>
          )}
        </div>

        {/* 통산 성적 stacked bar */}
        <div className="mt-3">
          <StatsBar
            total={jockey.total_race_count}
            win={jockey.first_place_count}
            place={jockey.second_place_count}
            show={jockey.third_place_count}
          />
        </div>

        {recentRanks.length > 0 && (
          <div className="mt-3 rounded-[10px] border border-border bg-card px-3 py-2">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              최근 폼 ({Math.min(recentRanks.length, 15)}경기)
            </div>
            <RecentFormDots ranks={recentRanks} count={15} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Sep() {
  return <span className="h-2.5 w-px bg-border" aria-hidden />;
}

// 1·2·3위 메달 톤.
const RANK_MEDAL_STYLE: Record<number, string> = {
  1: "bg-secondary text-primary",
  2: "bg-slate-300 text-slate-900",
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
  return (
    <span className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-border bg-muted font-mono text-xs font-bold tabular-nums text-muted-foreground">
      {rank}
    </span>
  );
}

function YoutubeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
    </svg>
  );
}
