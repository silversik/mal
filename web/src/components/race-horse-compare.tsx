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
import { RecentFormStrip } from "./recent-form-strip";
import type { HorseCompareSummary } from "@/lib/horses";

/**
 * 출주마 빠른 비교 표 — race detail 의 출전표 위에 노출.
 * 통산 1-2-3 / 최근 5전 / 최근 10전 평균·최고 mal지수.
 */
export function RaceHorseCompare({
  summaries,
  chulMap,
}: {
  summaries: HorseCompareSummary[];
  /** horse_no → chul_no 매핑 (출전표 순서로 정렬 + 게이트 표시). */
  chulMap: Record<string, number | null | undefined>;
}) {
  if (summaries.length === 0) return null;

  const sorted = [...summaries].sort((a, b) => {
    const ca = chulMap[a.horse_no] ?? 999;
    const cb = chulMap[b.horse_no] ?? 999;
    return ca - cb;
  });

  const hasMsf = sorted.some((s) => s.avg_msf !== null);

  return (
    <Card className="py-0">
      <CardContent className="p-3">
        <div className="mb-2 flex items-baseline justify-between">
          <h3 className="text-sm font-semibold text-primary">출주마 비교</h3>
          <span className="text-xs text-muted-foreground">
            통산·최근 폼·mal지수
          </span>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10 text-center">#</TableHead>
              <TableHead>마명</TableHead>
              <TableHead className="text-center">통산 1-2-3</TableHead>
              <TableHead>최근 5전</TableHead>
              {hasMsf && (
                <>
                  <TableHead
                    className="text-right"
                    title="최근 10전 평균 mal지수"
                  >
                    평균지수
                  </TableHead>
                  <TableHead
                    className="text-right"
                    title="최근 10전 최고 mal지수"
                  >
                    최고
                  </TableHead>
                </>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((s) => {
              const chul = chulMap[s.horse_no];
              return (
                <TableRow key={s.horse_no}>
                  <TableCell className="text-center font-mono text-xs tabular-nums">
                    {chul ?? "-"}
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/horse/${s.horse_no}`}
                      className="text-primary hover:underline"
                    >
                      {s.horse_name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-center font-mono text-xs tabular-nums">
                    {s.first_place_count}-{s.second_place_count}-{s.third_place_count}
                    <span className="text-muted-foreground"> / {s.total_race_count}</span>
                  </TableCell>
                  <TableCell>
                    {s.recent_finishes.length > 0 ? (
                      <RecentFormStrip finishes={s.recent_finishes} />
                    ) : (
                      <span className="text-muted-foreground text-xs">-</span>
                    )}
                  </TableCell>
                  {hasMsf && (
                    <>
                      <TableCell className="text-right font-mono text-xs tabular-nums">
                        <MsfNumber value={s.avg_msf} />
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">
                        <MsfNumber value={s.best_msf} />
                      </TableCell>
                    </>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function MsfNumber({ value }: { value: number | null }) {
  if (value === null) return <span className="text-muted-foreground">-</span>;
  let cls = "text-slate-500";
  if (value >= 100) cls = "text-amber-700 font-bold";
  else if (value >= 95) cls = "text-emerald-700 font-semibold";
  else if (value >= 90) cls = "text-slate-600";
  return <span className={cls}>{value.toFixed(1)}</span>;
}
