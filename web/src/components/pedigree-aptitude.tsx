import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import type { ParentChildAggregate } from "@/lib/horses";

/**
 * 마필 상세에서 부마·모마 자손 통계 노출 — 혈통 적성 짧은 한줄 카드.
 */
export function PedigreeAptitude({
  sire,
  dam,
}: {
  sire: ParentChildAggregate | null;
  dam: ParentChildAggregate | null;
}) {
  if (!sire && !dam) return null;
  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        혈통 적성
      </h2>
      <div className="grid gap-3 sm:grid-cols-2">
        {sire && <ParentLine agg={sire} />}
        {dam && <ParentLine agg={dam} />}
      </div>
    </section>
  );
}

function ParentLine({ agg }: { agg: ParentChildAggregate }) {
  const sideLabel = agg.side === "sire" ? "父" : "母";
  return (
    <Card className="py-0">
      <CardContent className="flex items-center justify-between gap-3 p-3">
        <div className="min-w-0">
          <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            {sideLabel} 자손 통계
          </div>
          <Link
            href={`/parent/${agg.parent_no}`}
            className="block truncate text-sm font-semibold text-primary hover:underline"
          >
            {agg.parent_name}
          </Link>
        </div>
        <div className="grid grid-cols-3 gap-3 text-right text-xs">
          <Cell label="자손" value={agg.total_children} />
          <Cell
            label="1-2-3"
            value={`${agg.total_win}-${agg.total_place}-${agg.total_show}`}
          />
          <Cell label="우승률" value={`${(agg.win_rate * 100).toFixed(0)}%`} />
        </div>
      </CardContent>
    </Card>
  );
}

function Cell({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="font-mono font-semibold tabular-nums">{value}</div>
    </div>
  );
}
