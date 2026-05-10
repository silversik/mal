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
import type { JockeyTrainerCombo } from "@/lib/jockeys";

export function JockeyTrainerCombos({
  combos,
}: {
  combos: JockeyTrainerCombo[];
}) {
  if (combos.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-6 text-center text-sm text-muted-foreground">
          5회 이상 동승한 조교사가 아직 없습니다.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="py-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>조교사</TableHead>
            <TableHead className="text-center">동승</TableHead>
            <TableHead className="text-center">1-2-3</TableHead>
            <TableHead className="text-right">승률</TableHead>
            <TableHead className="text-right">복승</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {combos.map((c) => (
            <TableRow key={c.trainer_name}>
              <TableCell>
                {c.tr_no ? (
                  <Link
                    href={`/trainer/${c.tr_no}`}
                    className="text-primary hover:underline"
                  >
                    {c.trainer_name}
                  </Link>
                ) : (
                  c.trainer_name
                )}
              </TableCell>
              <TableCell className="text-center font-mono text-xs tabular-nums">
                {c.starts}
              </TableCell>
              <TableCell className="text-center font-mono text-xs tabular-nums">
                {c.win}-{c.place}-{c.show}
              </TableCell>
              <TableCell className="text-right font-mono text-xs tabular-nums">
                {c.win_rate > 0 ? (
                  <span className="font-semibold text-primary">
                    {(c.win_rate * 100).toFixed(0)}%
                  </span>
                ) : (
                  <span className="text-muted-foreground">-</span>
                )}
              </TableCell>
              <TableCell className="text-right font-mono text-xs tabular-nums text-muted-foreground">
                {c.in_money_rate > 0 ? `${(c.in_money_rate * 100).toFixed(0)}%` : "-"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}
