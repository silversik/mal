import type { Metadata } from "next";
import Link from "next/link";

import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { query } from "@/lib/db";

export const metadata: Metadata = {
  title: "코스 레코드",
  description: "경마장·거리별 1착 최단 기록",
  alternates: { canonical: "/records" },
};

/**
 * 같은 (meet, distance) 의 1착 record_time 최단을 보유한 row 1건씩.
 *
 * 한계: races.distance 가 NULL row 가 많아 race_results.race_date+meet+race_no
 *       JOIN 매칭이 약함. 결과적으로 매칭 성공한 race 만 표 노출.
 *       Phase F (races.distance 백필) 후 풍부해짐.
 */
async function getCourseRecords(): Promise<
  {
    meet: string;
    distance: number;
    record_time: number;
    race_date: string;
    horse_no: string;
    horse_name: string;
    jockey_name: string | null;
  }[]
> {
  const rows = await query<{
    meet: string;
    distance: number;
    record_time: string;
    race_date: string;
    horse_no: string;
    horse_name: string;
    jockey_name: string | null;
  }>(
    `WITH ranked AS (
       SELECT rr.meet, r.distance, rr.race_date, rr.horse_no, rr.jockey_name,
              CASE
                WHEN rr.record_time IS NOT NULL THEN rr.record_time
                WHEN rr.raw->>'rcTime' ~ '^[0-9]+:[0-9]+(\\.[0-9]+)?$'
                  THEN (split_part(rr.raw->>'rcTime', ':', 1)::numeric * 60
                      + split_part(rr.raw->>'rcTime', ':', 2)::numeric)
                ELSE NULL
              END AS rt,
              ROW_NUMBER() OVER (
                PARTITION BY rr.meet, r.distance
                ORDER BY (
                  CASE
                    WHEN rr.record_time IS NOT NULL THEN rr.record_time
                    WHEN rr.raw->>'rcTime' ~ '^[0-9]+:[0-9]+(\\.[0-9]+)?$'
                      THEN (split_part(rr.raw->>'rcTime', ':', 1)::numeric * 60
                          + split_part(rr.raw->>'rcTime', ':', 2)::numeric)
                    ELSE NULL
                  END
                ) ASC NULLS LAST
              ) AS rn
         FROM race_results rr
         JOIN races r
           ON r.race_date = rr.race_date AND r.meet = rr.meet AND r.race_no = rr.race_no
        WHERE rr.rank = 1
          AND r.distance IS NOT NULL
          AND rr.meet IS NOT NULL
     )
     SELECT k.meet, k.distance,
            k.rt::text AS record_time,
            to_char(k.race_date, 'YYYY-MM-DD') AS race_date,
            k.horse_no,
            h.horse_name,
            k.jockey_name
       FROM ranked k
       JOIN horses h ON h.horse_no = k.horse_no
      WHERE k.rn = 1 AND k.rt IS NOT NULL
      ORDER BY k.meet, k.distance`,
  );
  return rows.map((r) => ({
    ...r,
    record_time: Number(r.record_time),
    distance: Number(r.distance),
  }));
}

function formatSeconds(s: number): string {
  if (!Number.isFinite(s)) return "-";
  const mins = Math.floor(s / 60);
  const secs = s - mins * 60;
  return `${mins}:${secs.toFixed(1).padStart(4, "0")}`;
}

export default async function RecordsPage() {
  const records = await getCourseRecords();

  // meet 별 그룹.
  const byMeet = new Map<string, typeof records>();
  for (const r of records) {
    const arr = byMeet.get(r.meet) ?? [];
    arr.push(r);
    byMeet.set(r.meet, arr);
  }

  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-10">
      <h1 className="text-3xl font-bold tracking-tight">코스 레코드</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        경마장 × 거리별 1착 최단 기록 (race_results.rank=1 기준).
        races.distance 적재가 부분적이라 거리 매칭 가능한 경기만 노출.
      </p>

      {records.length === 0 ? (
        <Card className="mt-8 border-dashed">
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            거리 매칭이 가능한 결과가 아직 적재되지 않았습니다.
          </CardContent>
        </Card>
      ) : (
        <div className="mt-8 space-y-6">
          {[...byMeet.entries()].map(([meet, rows]) => (
            <Card key={meet} className="py-0">
              <CardContent className="p-3">
                <h2 className="mb-3 text-base font-semibold text-primary">
                  {meet}
                </h2>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-center">거리</TableHead>
                      <TableHead className="text-center">기록</TableHead>
                      <TableHead>마필</TableHead>
                      <TableHead className="text-center">기수</TableHead>
                      <TableHead className="text-center">일자</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => (
                      <TableRow key={`${meet}-${r.distance}`}>
                        <TableCell className="text-center font-mono tabular-nums">
                          {r.distance}m
                        </TableCell>
                        <TableCell className="text-center font-mono font-semibold tabular-nums text-primary">
                          {formatSeconds(r.record_time)}
                        </TableCell>
                        <TableCell>
                          <Link
                            href={`/horse/${r.horse_no}`}
                            className="text-primary hover:underline"
                          >
                            {r.horse_name}
                          </Link>
                        </TableCell>
                        <TableCell className="text-center text-xs text-muted-foreground">
                          {r.jockey_name ?? "-"}
                        </TableCell>
                        <TableCell className="text-center font-mono text-xs">
                          {r.race_date}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </main>
  );
}
