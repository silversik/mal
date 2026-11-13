import type { Metadata } from "next";
import Link from "next/link";

import { Card, CardContent } from "@/components/ui/card";
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
    <div>
      <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">코스 레코드</h1>
      <p className="mt-1 text-base text-muted-foreground">
        경마장 · 거리별 역대 1착 최단 기록. 거리 정보가 있는 경주만 집계합니다.
      </p>

      {records.length === 0 ? (
        <Card className="mt-4 border-dashed py-0">
          <CardContent className="py-8 text-center text-base text-muted-foreground">
            거리 정보가 확인된 경주 결과가 아직 없습니다.
          </CardContent>
        </Card>
      ) : (
        <div className="mt-4 space-y-6">
          {[...byMeet.entries()].map(([meet, rows]) => (
            <section key={meet} aria-labelledby={`meet-${meet}`}>
              <h2 id={`meet-${meet}`} className="mb-2 text-lg font-bold">
                {meet}
              </h2>
              {/* 모바일 375px 에서 5열 표는 가로 스크롤 → stat-row 로 reflow (DESIGN 원칙 4).
                  md+ 는 같은 행이 5칸 그리드로 펼쳐진다 — 단일 트리. */}
              <Card className="gap-0 py-0">
                <div
                  aria-hidden="true"
                  className="hidden border-b border-border bg-muted px-4 py-2 text-small font-semibold text-muted-foreground md:grid md:grid-cols-[5rem_minmax(0,1fr)_7rem_7rem_6.5rem] md:gap-4"
                >
                  <span>거리</span>
                  <span>마필</span>
                  <span>기수</span>
                  <span>일자</span>
                  <span className="text-right">기록</span>
                </div>
                <ul className="divide-y divide-border">
                  {rows.map((r) => (
                    <li
                      key={`${meet}-${r.distance}`}
                      className="grid grid-cols-[4.5rem_minmax(0,1fr)_auto] items-center gap-x-3 px-4 py-3 md:grid-cols-[5rem_minmax(0,1fr)_7rem_7rem_6.5rem] md:gap-x-4"
                    >
                      <span className="font-mono text-base font-semibold tabular-nums">
                        {r.distance}m
                      </span>
                      <span className="min-w-0 md:contents">
                        <Link
                          href={`/horse/${r.horse_no}`}
                          className="block truncate text-base font-semibold text-foreground underline-offset-4 hover:underline"
                        >
                          {r.horse_name}
                        </Link>
                        <span className="block truncate text-small text-muted-foreground md:text-base md:text-foreground">
                          {r.jockey_name ?? "-"}
                          <span className="md:hidden"> · </span>
                          <span className="font-mono tabular-nums md:hidden">{r.race_date}</span>
                        </span>
                        <span className="hidden font-mono text-base tabular-nums md:block">
                          {r.race_date}
                        </span>
                      </span>
                      <span className="text-right font-mono text-lg font-bold tabular-nums text-foreground md:col-start-5 md:row-start-1">
                        {formatSeconds(r.record_time)}
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
