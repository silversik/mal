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
import {
  getRecentRacesByTrainer,
  getTrainerByNo,
  type Trainer,
} from "@/lib/trainers";
import { WinRateBar } from "@/components/win-rate-bar";
import { RecentFormDots } from "@/components/recent-form-dots";

const fetchTrainer = cache(getTrainerByNo);

export async function generateMetadata(
  { params }: { params: Promise<{ tr_no: string }> },
): Promise<Metadata> {
  const { tr_no } = await params;
  const trainer = await fetchTrainer(tr_no);
  if (!trainer) return { title: "조교사 정보 없음", robots: { index: false } };
  const winRate = trainer.win_rate ? `${trainer.win_rate}%` : "-";
  const description = `${trainer.tr_name} 조교사 (${trainer.meet ?? ""}) — 통산 ${trainer.total_race_count}전 ${trainer.first_place_count}·${trainer.second_place_count}·${trainer.third_place_count}, 승률 ${winRate}. 최근 출전 기록.`;
  return {
    title: `${trainer.tr_name} · 조교사 프로필`,
    description,
    alternates: { canonical: `/trainer/${tr_no}` },
    openGraph: {
      type: "profile",
      title: `${trainer.tr_name} · 조교사 프로필`,
      description,
      url: `/trainer/${tr_no}`,
    },
  };
}

export default async function TrainerDetailPage({
  params,
}: {
  params: Promise<{ tr_no: string }>;
}) {
  const { tr_no } = await params;
  const trainer = await fetchTrainer(tr_no);
  if (!trainer) notFound();

  const recentRaces = await getRecentRacesByTrainer(trainer.tr_name, 20);

  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-12">
      <Link
        href="/"
        className="group mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground transition hover:text-primary"
      >
        <span className="transition group-hover:-translate-x-0.5">&larr;</span>
        메인으로
      </Link>

      <TrainerProfileCard trainer={trainer} />

      {recentRaces.length > 0 && (
        <div className="mt-4 px-1">
          <RecentFormDots ranks={recentRaces.map((r) => r.rank)} />
        </div>
      )}

      <section className="mt-10">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          최근 출전 기록
        </h2>
        {recentRaces.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              출전 기록이 아직 적재되지 않았습니다.
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
                  <TableHead>기수</TableHead>
                  <TableHead className="text-right">기록</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentRaces.map((r) => {
                  const raceHref =
                    r.race_date && r.meet && r.race_no
                      ? `/races?date=${r.race_date}&venue=${encodeURIComponent(r.meet)}&race=${r.race_no}`
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
                      <TableCell>{r.jockey_name ?? "-"}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {r.record_time ?? "-"}
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

function TrainerProfileCard({ trainer }: { trainer: Trainer }) {
  const fields: Array<[string, React.ReactNode]> = [
    ["조교사번호", <span className="font-mono" key="no">{trainer.tr_no}</span>],
    ["소속", trainer.meet ?? "-"],
    ["생년월일", trainer.birth_date ?? "-"],
    ["데뷔일", trainer.debut_date ?? "-"],
    [
      "통산 출전",
      <span key="rc">
        {trainer.total_race_count}
        <span className="text-muted-foreground">회</span>
      </span>,
    ],
    [
      "1착",
      <span key="f" className="text-primary">
        {trainer.first_place_count}
      </span>,
    ],
    [
      "2착 / 3착",
      `${trainer.second_place_count} / ${trainer.third_place_count}`,
    ],
    ["승률", <WinRateBar key="wr" rate={trainer.win_rate} layout="inline" />],
  ];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-4xl font-bold tracking-tight">
          {trainer.tr_name}
        </CardTitle>
        {trainer.tr_name_en && (
          <p className="mt-1 text-sm text-muted-foreground">{trainer.tr_name_en}</p>
        )}
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
