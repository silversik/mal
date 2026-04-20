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

export default async function JockeyDetailPage({
  params,
}: {
  params: Promise<{ jk_no: string }>;
}) {
  const { jk_no } = await params;
  const jockey = await getJockeyByNo(jk_no);
  if (!jockey) notFound();

  const recentRaces = await getRecentRacesByJockey(jockey.jk_name, 20);

  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-12">
      <Link
        href="/"
        className="group mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground transition hover:text-primary"
      >
        <span className="transition group-hover:-translate-x-0.5">&larr;</span>
        메인으로
      </Link>

      <JockeyProfileCard jockey={jockey} />

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

function JockeyProfileCard({ jockey }: { jockey: Jockey }) {
  const winPct = jockey.win_rate ? `${jockey.win_rate}%` : "-";
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
    ["승률", winPct],
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
