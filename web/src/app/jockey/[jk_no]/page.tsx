import { cache } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getJockeyByNo, getRecentRacesByJockey, type Jockey } from "@/lib/jockeys";
import { getVideosForRaces, raceKey, type RaceKey } from "@/lib/videos";
import { youtubeWatchUrl } from "@/lib/video-helpers";
import { WinRateBar } from "@/components/win-rate-bar";
import { RecentFormDots } from "@/components/recent-form-dots";
import { BreadcrumbJsonLd } from "@/components/seo/breadcrumb-jsonld";

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

  const recentRaces = await getRecentRacesByJockey(jockey.jk_name, 20);
  const videoMap = await getVideosForRaces(recentRaces);

  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-12">
      <BreadcrumbJsonLd
        items={[
          { name: "홈", url: "/" },
          { name: "기수", url: "/jockeys" },
          { name: jockey.jk_name, url: `/jockey/${jk_no}` },
        ]}
      />
      <Link
        href="/"
        className="group mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground transition hover:text-primary"
      >
        <span className="transition group-hover:-translate-x-0.5">&larr;</span>
        메인으로
      </Link>

      <JockeyProfileCard jockey={jockey} />

      {recentRaces.length > 0 && (
        <div className="mt-4 px-1">
          <RecentFormDots ranks={recentRaces.map((r) => r.rank)} />
        </div>
      )}

      <section className="mt-10">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          최근 기승 기록
        </h2>
        {recentRaces.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              기승 기록이 아직 적재되지 않았습니다.
            </CardContent>
          </Card>
        ) : (
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>일자</TableHead>
                  <TableHead>경마장</TableHead>
                  <TableHead className="text-right">경주</TableHead>
                  <TableHead className="text-right">착순</TableHead>
                  <TableHead>마명</TableHead>
                  <TableHead className="text-right">기록</TableHead>
                  <TableHead className="w-8"></TableHead>
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
                    <TableCell className="font-mono text-xs">
                      {r.race_date}
                    </TableCell>
                    <TableCell>{r.meet ?? "-"}</TableCell>
                    <TableCell className="text-right">
                      {raceHref ? (
                        <Link href={raceHref} className="text-primary hover:underline">
                          {r.race_no}R
                        </Link>
                      ) : (
                        `${r.race_no}R`
                      )}
                    </TableCell>
                    <TableCell className="text-right font-semibold">
                      {r.rank === 1 ? (
                        <Badge className="bg-primary text-primary-foreground">
                          1
                        </Badge>
                      ) : r.rank !== null && r.rank <= 3 ? (
                        <Badge variant="secondary">{r.rank}</Badge>
                      ) : (
                        (r.rank ?? "-")
                      )}
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/horse/${r.horse_no}`}
                        className="text-primary hover:underline"
                      >
                        {r.horse_name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {r.record_time ?? "-"}
                    </TableCell>
                    <TableCell>
                      {video && (
                        <a
                          href={youtubeWatchUrl(video.video_id)}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label="YouTube에서 경주 영상 보기"
                          className="inline-flex items-center justify-center text-[#FF0000] opacity-70 transition hover:opacity-100"
                        >
                          <YoutubeIcon />
                        </a>
                      )}
                    </TableCell>
                  </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Card>
        )}
      </section>
    </main>
  );
}

function JockeyProfileCard({ jockey }: { jockey: Jockey }) {
  const fields: Array<[string, React.ReactNode]> = [
    ["기수번호", <span className="font-mono" key="no">{jockey.jk_no}</span>],
    ["소속", jockey.meet ?? "-"],
    ["생년월일", jockey.birth_date ?? "-"],
    ["데뷔일", jockey.debut_date ?? "-"],
    [
      "통산 출전",
      <span key="rc">
        {jockey.total_race_count}
        <span className="text-muted-foreground">회</span>
      </span>,
    ],
    [
      "1착",
      <span key="f" className="text-primary">
        {jockey.first_place_count}
      </span>,
    ],
    [
      "2착 / 3착",
      `${jockey.second_place_count} / ${jockey.third_place_count}`,
    ],
    ["승률", <WinRateBar key="wr" rate={jockey.win_rate} layout="inline" />],
  ];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-4xl font-bold tracking-tight">
          {jockey.jk_name}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
          {fields.map(([label, value]) => (
            <div key={String(label)}>
              <dt className="text-xs uppercase tracking-wider text-muted-foreground">
                {label}
              </dt>
              <dd className="mt-0.5 text-sm font-medium">{value}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}

function YoutubeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
    </svg>
  );
}
