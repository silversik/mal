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
import { kstYear } from "@/lib/kst";
import {
  getRankingWithFallback,
  type RankingEntity,
  type RankingScope,
} from "@/lib/rankings";
import { buildRankingsHref } from "@/lib/rankings-shared";
import { RankBadge } from "@/components/rank-badge";

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

function clampYear(input: string | undefined, currentYear: number): number {
  const y = Number(input ?? "");
  if (!Number.isFinite(y) || y < 2000 || y > currentYear) return currentYear;
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
  // 서버 TZ 와 무관하게 KST 기준 올해.
  const currentYear = kstYear();
  const requestedYear = scope === "ytd" ? currentYear : clampYear(sp.year, currentYear);
  // 연도/기간을 직접 고른 경우(?year= / ?scope=)는 그대로 존중 — 기본 진입만 직전 연도 폴백.
  const explicit = sp.year !== undefined || sp.scope !== undefined;
  // 폴백은 0건일 때만 (50행 표) — 규칙은 lib/rankings-shared.ts 참고.
  const ranking = await getRankingWithFallback(entity, scope, requestedYear, 50, { explicit });
  const { rows, year } = ranking;

  const yearOptions: number[] = [];
  for (let y = currentYear; y >= currentYear - 6; y--) yearOptions.push(y);

  const buildHref = (
    overrides: Partial<{ entity: RankingEntity; scope: RankingScope; year: number }>,
    opts?: { omitPeriod?: boolean },
  ) =>
    // 기간을 직접 고른 적 없는 기본 진입(폴백 여부 무관)에서 대상 탭은 omitPeriod 로
    // scope/year 를 싣지 않는다 → 새 대상도 기본 진입으로 취급돼 올해 기준 폴백 판단을 다시 한다
    // (예: 1월 마필 0건→2026 폴백, 기수는 2027 데이터 있음 → 기수 탭은 2027 로 열려야 함).
    buildRankingsHref(
      {
        entity: overrides.entity ?? entity,
        scope: overrides.scope ?? scope,
        year: overrides.year ?? year,
      },
      opts,
    );

  return (
    <div>
      <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">랭킹</h1>
      <p className="mt-1 text-base text-muted-foreground">
        1착 횟수 기준 · 동률은 출전 수 순.
      </p>

      <div className="mt-4 flex flex-col gap-2 lg:flex-row lg:flex-wrap lg:gap-x-6">
        <TabGroup label="대상">
          {ENTITIES.map((e) => (
            <TabLink
              key={e.key}
              href={buildHref({ entity: e.key }, { omitPeriod: !explicit })}
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

      {ranking.fellBack && (
        <p
          role="status"
          className="mt-4 rounded-md border bg-card px-4 py-2 text-base text-muted-foreground"
        >
          <span className="font-mono tabular-nums">{ranking.requestedYear}</span>년 집계 전이라{" "}
          <span className="font-mono font-semibold tabular-nums text-foreground">{year}</span>년
          랭킹을 보여드립니다.
        </p>
      )}

      <div className="mt-4">
        {rows.length === 0 ? (
          <Card className="border-dashed py-0">
            <CardContent className="py-8 text-center text-base text-muted-foreground">
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
                        <RankBadge size="sm" rest="plain" rank={i + 1} />
                      </TableCell>
                      <TableCell className="font-semibold">
                        {detailHref ? (
                          <Link
                            href={detailHref}
                            className="text-foreground underline-offset-4 hover:underline"
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
                        <span className="font-bold text-foreground">{r.win}</span>
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
    </div>
  );
}

// 필터 그룹: 라벨 + 칩 한 줄. 칩이 많으면(연도 7개) 그룹 안에서 가로 스크롤 — 페이지 전체가
// 375px 밖으로 밀리지 않게. 칩은 터치타깃 44px(min-h-11).
function TabGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span className="w-9 shrink-0 text-small font-semibold text-muted-foreground">{label}</span>
      <div className="flex min-w-0 gap-1 overflow-x-auto scrollbar-hide">{children}</div>
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
      aria-current={active ? "page" : undefined}
      className={`inline-flex min-h-11 shrink-0 items-center rounded-md border px-3 text-base font-semibold tabular-nums transition-colors ${
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-card text-foreground hover:bg-muted"
      }`}
    >
      {children}
    </Link>
  );
}
