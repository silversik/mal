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
  getRanking,
  type RankingEntity,
  type RankingScope,
} from "@/lib/rankings";

export const metadata: Metadata = {
  title: "랭킹",
  description: "마필·기수·조교사 시즌 랭킹 — 1착·복승률 기준",
  alternates: { canonical: "/rankings" },
};

const ENTITIES: { key: RankingEntity; label: string; href: string }[] = [
  { key: "horse", label: "마필", href: "horse" },
  { key: "jockey", label: "기수", href: "jockey" },
  { key: "trainer", label: "조교사", href: "trainer" },
];

const SCOPES: { key: RankingScope; label: string }[] = [
  { key: "year", label: "연도별" },
  { key: "ytd", label: "올해" },
  { key: "all", label: "통산" },
];

function clampYear(input: string | undefined): number {
  const now = new Date();
  const y = Number(input ?? "");
  if (!Number.isFinite(y) || y < 2000 || y > now.getFullYear()) return now.getFullYear();
  return y;
}

export default async function RankingsPage({
  searchParams,
}: {
  searchParams: Promise<{ entity?: string; scope?: string; year?: string }>;
}) {
  const sp = await searchParams;
  const entity: RankingEntity =
    (ENTITIES.find((e) => e.key === sp.entity)?.key ?? "horse");
  const scope: RankingScope =
    (SCOPES.find((s) => s.key === sp.scope)?.key ?? "year");
  const currentYear = new Date().getFullYear();
  const year = scope === "ytd" ? currentYear : clampYear(sp.year);

  const rows = await getRanking(entity, scope, year, 50);

  const yearOptions: number[] = [];
  for (let y = currentYear; y >= currentYear - 6; y--) yearOptions.push(y);

  const buildHref = (overrides: Partial<{ entity: RankingEntity; scope: RankingScope; year: number }>) => {
    const next = {
      entity: overrides.entity ?? entity,
      scope: overrides.scope ?? scope,
      year: overrides.year ?? year,
    };
    const params = new URLSearchParams();
    params.set("entity", next.entity);
    params.set("scope", next.scope);
    if (next.scope === "year") params.set("year", String(next.year));
    return `/rankings?${params.toString()}`;
  };

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10">
      <h1 className="text-3xl font-bold tracking-tight">랭킹</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        race_results 1착 횟수 기준 — 동률은 출전 수로 차순.
      </p>

      <div className="mt-6 flex flex-wrap items-center gap-2">
        <TabGroup label="대상">
          {ENTITIES.map((e) => (
            <TabLink
              key={e.key}
              href={buildHref({ entity: e.key })}
              active={e.key === entity}
            >
              {e.label}
            </TabLink>
          ))}
        </TabGroup>

        <TabGroup label="기간">
          {SCOPES.map((s) => (
            <TabLink
              key={s.key}
              href={buildHref({ scope: s.key })}
              active={s.key === scope}
            >
              {s.label}
            </TabLink>
          ))}
        </TabGroup>

        {scope === "year" && (
          <TabGroup label="연도">
            {yearOptions.map((y) => (
              <TabLink
                key={y}
                href={buildHref({ year: y })}
                active={y === year}
              >
                {y}
              </TabLink>
            ))}
          </TabGroup>
        )}
      </div>

      <div className="mt-6">
        {rows.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              조건에 해당하는 랭킹이 없습니다.
            </CardContent>
          </Card>
        ) : (
          <Card className="py-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12 text-center">#</TableHead>
                  <TableHead>{entity === "horse" ? "마명" : entity === "jockey" ? "기수" : "조교사"}</TableHead>
                  <TableHead className="text-center">출전</TableHead>
                  <TableHead className="text-center">1-2-3</TableHead>
                  <TableHead className="text-right">승률</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r, i) => {
                  const detailHref =
                    entity === "horse" && r.no
                      ? `/horse/${r.no}`
                      : entity === "jockey" && r.no
                        ? `/jockey/${r.no}`
                        : entity === "trainer" && r.no
                          ? `/trainer/${r.no}`
                          : null;
                  return (
                    <TableRow key={`${r.no}-${r.name}`}>
                      <TableCell className="text-center">
                        <RankBadge rank={i + 1} />
                      </TableCell>
                      <TableCell className="font-semibold">
                        {detailHref ? (
                          <Link
                            href={detailHref}
                            className="text-primary hover:underline"
                          >
                            {r.name}
                          </Link>
                        ) : (
                          r.name
                        )}
                      </TableCell>
                      <TableCell className="text-center font-mono tabular-nums">
                        {r.starts}
                      </TableCell>
                      <TableCell className="text-center font-mono tabular-nums">
                        <span className="font-semibold text-primary">{r.win}</span>
                        -{r.place}-{r.show}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {(r.win_rate * 100).toFixed(1)}%
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Card>
        )}
      </div>
    </main>
  );
}

function TabGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="inline-flex items-center gap-1.5 rounded-md border bg-card px-2 py-1">
      <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      {children}
    </div>
  );
}

function TabLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`rounded px-2 py-0.5 text-xs font-semibold transition ${
        active
          ? "bg-primary text-primary-foreground"
          : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </Link>
  );
}

const RANK_MEDAL_STYLE: Record<number, string> = {
  1: "bg-champagne-gold text-primary",
  2: "bg-slate-400 text-white",
  3: "bg-amber-700 text-white",
};

function RankBadge({ rank }: { rank: number }) {
  if (rank <= 3) {
    return (
      <span
        className={`inline-flex h-6 w-6 items-center justify-center rounded-full font-mono text-xs font-bold tabular-nums ${RANK_MEDAL_STYLE[rank]}`}
      >
        {rank}
      </span>
    );
  }
  return <span className="font-mono tabular-nums text-sm text-muted-foreground">{rank}</span>;
}
