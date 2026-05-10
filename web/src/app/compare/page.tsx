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
import {
  getHorseCompareSummaries,
  getHorseByNo,
  type HorseCompareSummary,
} from "@/lib/horses";
import { RecentFormStrip } from "@/components/recent-form-strip";

export const metadata: Metadata = {
  title: "마필 비교",
  description: "여러 마필을 한 번에 비교 — 통산·최근 폼·mal지수",
  alternates: { canonical: "/compare" },
};

const MAX_HORSES = 5;

function parseHorseParams(input: string | string[] | undefined): string[] {
  if (!input) return [];
  const arr = Array.isArray(input) ? input : [input];
  // ?h=A,B,C 형태도 허용.
  const flat = arr.flatMap((s) => s.split(",")).map((s) => s.trim()).filter(Boolean);
  return [...new Set(flat)].slice(0, MAX_HORSES);
}

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<{ h?: string | string[] }>;
}) {
  const sp = await searchParams;
  const horseNos = parseHorseParams(sp.h);

  const summaries: HorseCompareSummary[] =
    horseNos.length > 0 ? await getHorseCompareSummaries(horseNos) : [];

  // 마스터 정보 — 부마·모마 등.
  const masters = await Promise.all(horseNos.map((no) => getHorseByNo(no)));
  const masterByNo = Object.fromEntries(
    masters.map((m, i) => [horseNos[i], m]),
  );

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10">
      <h1 className="text-3xl font-bold tracking-tight">마필 비교</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        URL ?h=마번&h=마번 으로 최대 {MAX_HORSES}두 비교.
        예) <code className="rounded bg-muted px-1 font-mono text-xs">/compare?h=0047231&h=3104646</code>
      </p>

      {summaries.length === 0 ? (
        <Card className="mt-8 border-dashed">
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            비교할 마필이 없습니다. URL 에 ?h=마번 을 추가하세요.
          </CardContent>
        </Card>
      ) : (
        <div className="mt-8 space-y-6">
          <CompareSummaryTable summaries={summaries} masterByNo={masterByNo} />
          <CompareHeadToHead horseNos={horseNos} />
        </div>
      )}
    </main>
  );
}

function CompareSummaryTable({
  summaries,
  masterByNo,
}: {
  summaries: HorseCompareSummary[];
  masterByNo: Record<string, Awaited<ReturnType<typeof getHorseByNo>>>;
}) {
  const rows: Array<[string, (s: HorseCompareSummary) => React.ReactNode]> = [
    ["마명", (s) => (
      <Link href={`/horse/${s.horse_no}`} className="text-primary hover:underline">
        {s.horse_name}
      </Link>
    )],
    ["마번", (s) => <span className="font-mono text-xs">{s.horse_no}</span>],
    ["부마", (s) => masterByNo[s.horse_no]?.sire_name ?? "-"],
    ["모마", (s) => masterByNo[s.horse_no]?.dam_name ?? "-"],
    ["산지", (s) => masterByNo[s.horse_no]?.country ?? "-"],
    ["성별", (s) => masterByNo[s.horse_no]?.sex ?? "-"],
    ["통산 출전", (s) => s.total_race_count],
    ["통산 1-2-3", (s) => `${s.first_place_count}-${s.second_place_count}-${s.third_place_count}`],
    ["최근 5전", (s) => <RecentFormStrip finishes={s.recent_finishes} />],
    ["평균 mal지수", (s) => (s.avg_msf !== null ? s.avg_msf.toFixed(1) : "-")],
    ["최고 mal지수", (s) => (s.best_msf !== null ? s.best_msf.toFixed(1) : "-")],
  ];

  return (
    <Card className="py-0">
      <CardContent className="p-3">
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          요약 비교
        </h3>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-32 text-muted-foreground">항목</TableHead>
              {summaries.map((s) => (
                <TableHead key={s.horse_no} className="text-center">
                  {s.horse_name}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(([label, render]) => (
              <TableRow key={label}>
                <TableCell className="text-xs font-semibold text-muted-foreground">
                  {label}
                </TableCell>
                {summaries.map((s) => (
                  <TableCell key={s.horse_no} className="text-center">
                    {render(s)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

import { query } from "@/lib/db";

async function CompareHeadToHead({ horseNos }: { horseNos: string[] }) {
  if (horseNos.length < 2) return null;
  // 동시 출주: 같은 (race_date, meet, race_no) 에 모두 등장한 race.
  const placeholders = horseNos.map((_, i) => `$${i + 1}`).join(",");
  const rows = await query<{
    race_date: string;
    meet: string | null;
    race_no: number;
    payload: { horse_no: string; horse_name: string; rank: number | null }[];
  }>(
    `SELECT to_char(rr.race_date, 'YYYY-MM-DD') AS race_date,
            rr.meet,
            rr.race_no,
            jsonb_agg(jsonb_build_object(
              'horse_no', rr.horse_no,
              'horse_name', h.horse_name,
              'rank', rr.rank
            ) ORDER BY rr.rank NULLS LAST) AS payload
       FROM race_results rr
       JOIN horses h ON h.horse_no = rr.horse_no
      WHERE rr.horse_no IN (${placeholders})
      GROUP BY rr.race_date, rr.meet, rr.race_no
     HAVING COUNT(DISTINCT rr.horse_no) = ${horseNos.length}
      ORDER BY rr.race_date DESC, rr.race_no DESC
      LIMIT 20`,
    horseNos,
  );

  if (rows.length === 0) {
    return (
      <Card className="py-0">
        <CardContent className="p-4 text-center text-sm text-muted-foreground">
          이 마필들이 함께 출주한 경기가 없습니다.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="py-0">
      <CardContent className="p-3">
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Head-to-Head — 함께 출주한 경기 ({rows.length}건)
        </h3>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>일자</TableHead>
              <TableHead>경기</TableHead>
              <TableHead>결과 (착순순)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={`${r.race_date}-${r.meet}-${r.race_no}`}>
                <TableCell className="font-mono text-xs">{r.race_date}</TableCell>
                <TableCell className="text-xs">
                  <Link
                    href={`/races?date=${r.race_date}&venue=${encodeURIComponent(r.meet ?? "")}&race=${r.race_no}`}
                    className="text-primary hover:underline"
                  >
                    {r.meet} {r.race_no}R
                  </Link>
                </TableCell>
                <TableCell className="text-xs">
                  {r.payload.map((p, i) => (
                    <span key={p.horse_no}>
                      {i > 0 && <span className="text-muted-foreground"> / </span>}
                      <span className="font-mono">{p.rank ?? "-"}</span>{" "}
                      <Link
                        href={`/horse/${p.horse_no}`}
                        className="text-primary hover:underline"
                      >
                        {p.horse_name}
                      </Link>
                    </span>
                  ))}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
