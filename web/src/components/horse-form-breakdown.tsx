import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import type { FormBreakdown, FormRow } from "@/lib/horses";

/**
 * 마필 조건별 폼 분해 카드.
 * 4개 그리드: 거리 / 주로 / 주로상태 / 경마장.
 * 데이터 없는 그룹은 통째로 생략.
 */
export function HorseFormBreakdown({ data }: { data: FormBreakdown }) {
  const sections: Array<{ title: string; rows: FormRow[]; firstHeader: string }> = [
    { title: "거리별", rows: data.by_distance, firstHeader: "거리" },
    { title: "주로별", rows: data.by_track_type, firstHeader: "주로" },
    { title: "주로상태", rows: data.by_track_condition, firstHeader: "상태" },
    { title: "경마장별", rows: data.by_meet, firstHeader: "경마장" },
  ].filter((s) => s.rows.length > 0);

  if (sections.length === 0) return null;

  return (
    <section>
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        조건별 성적
      </h2>
      <div className="grid gap-4 md:grid-cols-2">
        {sections.map((s) => (
          <Card key={s.title} className="py-0">
            <CardContent className="p-3">
              <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-primary">
                {s.title}
              </h3>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="h-8 px-2 text-xs">{s.firstHeader}</TableHead>
                    <TableHead className="h-8 px-2 text-center text-xs">출주</TableHead>
                    <TableHead className="h-8 px-2 text-center text-xs">1-2-3</TableHead>
                    <TableHead className="h-8 px-2 text-right text-xs">승률</TableHead>
                    <TableHead className="h-8 px-2 text-right text-xs">복승</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {s.rows.map((r) => (
                    <TableRow key={r.bucket}>
                      <TableCell className="px-2 py-1.5 font-mono text-xs tabular-nums">
                        {r.bucket}
                      </TableCell>
                      <TableCell className="px-2 py-1.5 text-center font-mono text-xs tabular-nums">
                        {r.starts}
                      </TableCell>
                      <TableCell className="px-2 py-1.5 text-center font-mono text-xs tabular-nums">
                        {r.win}-{r.place}-{r.show}
                      </TableCell>
                      <TableCell className="px-2 py-1.5 text-right font-mono text-xs tabular-nums">
                        <RateCell rate={r.win_rate} />
                      </TableCell>
                      <TableCell className="px-2 py-1.5 text-right font-mono text-xs tabular-nums">
                        <RateCell rate={r.in_money_rate} muted />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}

function RateCell({ rate, muted = false }: { rate: number; muted?: boolean }) {
  if (rate === 0) return <span className="text-muted-foreground">-</span>;
  const pct = (rate * 100).toFixed(0);
  return (
    <span className={muted ? "text-muted-foreground" : "font-semibold text-primary"}>
      {pct}%
    </span>
  );
}
