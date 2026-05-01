import Link from "next/link";

import { HorseAvatar } from "@/components/horse-avatar";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  countAllHorses,
  getHorsesSorted,
  searchHorses,
  type Horse,
  type HorseSort,
} from "@/lib/horses";

type SearchParams = { q?: string; sort?: string };

const SORT_OPTIONS: { value: HorseSort; label: string }[] = [
  { value: "latest", label: "등록순" },
  { value: "wins",   label: "우승순" },
];

export default async function HorsesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { q = "", sort = "latest" } = await searchParams;
  const queryStr = q.trim();
  const activeSort: HorseSort = sort === "wins" ? "wins" : "latest";

  const [searchHit, horses, totalCount] = await Promise.all([
    queryStr ? searchHorses(queryStr, 60) : Promise.resolve(null),
    queryStr ? Promise.resolve<Horse[]>([]) : getHorsesSorted(activeSort, 60),
    countAllHorses(),
  ]);
  const resultRows: Horse[] = searchHit ? searchHit.rows : horses;

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-12">
      <Link
        href="/"
        className="group mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground transition hover:text-primary"
      >
        <span className="transition group-hover:-translate-x-0.5">&larr;</span>
        메인으로
      </Link>

      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-baseline gap-3">
          <h1 className="font-serif text-3xl font-bold tracking-tight text-primary">마필</h1>
          <span className="text-sm text-muted-foreground tabular-nums">
            등록 {totalCount.toLocaleString()}마리
          </span>
        </div>

        {/* Sort toggle — only when not searching */}
        {!queryStr && (
          <div className="flex items-center gap-1 rounded-lg border border-primary/10 bg-white p-1">
            {SORT_OPTIONS.map(({ value, label }) => (
              <Link
                key={value}
                href={`/horses?sort=${value}`}
                className={`rounded-md px-3 py-1.5 text-sm font-semibold transition-colors ${
                  activeSort === value
                    ? "bg-primary text-sand-ivory shadow-sm"
                    : "text-slate-grey hover:text-primary"
                }`}
              >
                {label}
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Search */}
      <form action="/horses" className="mb-8">
        <Input
          name="q"
          type="search"
          defaultValue={queryStr}
          placeholder="마명·년생·나이로 검색 (예: 장오름 / 2016 / 8세)"
          className="h-12 max-w-md rounded-xl px-4 text-base shadow-sm"
        />
      </form>

      {queryStr && searchHit && (
        <p className="mb-4 text-sm text-muted-foreground">
          {searchHit.mode === "year" && (
            <>
              <Badge variant="outline" className="mr-2">{searchHit.birthYear}년생</Badge>
            </>
          )}
          {searchHit.mode === "age" && (
            <>
              <Badge variant="outline" className="mr-2">
                {Number(queryStr.match(/^(\d{1,2})/)?.[1])}세 ({searchHit.birthYear}년생)
              </Badge>
            </>
          )}
          검색 결과 <Badge variant="secondary">{resultRows.length}건</Badge>
        </p>
      )}

      {resultRows.length === 0 ? (
        <EmptyState
          title={queryStr ? "검색 결과가 없습니다." : "적재된 마필이 없습니다."}
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {resultRows.map((h) => (
            <HorseCard key={h.horse_no} horse={h} showWins={!queryStr && activeSort === "wins"} />
          ))}
        </div>
      )}
    </main>
  );
}

function HorseCard({ horse, showWins }: { horse: Horse; showWins: boolean }) {
  const winRate =
    horse.total_race_count > 0
      ? ((horse.first_place_count / horse.total_race_count) * 100).toFixed(1)
      : null;

  return (
    <Link href={`/horse/${horse.horse_no}`}>
      <Card className="h-full transition hover:border-primary/40 hover:shadow-md hover:shadow-primary/5">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <HorseAvatar coatColor={horse.coat_color} size={36} className="mt-0.5 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-base font-semibold leading-snug">
                  {horse.horse_name}
                </span>
                {showWins && horse.first_place_count > 0 && (
                  <span className="shrink-0 text-xs font-bold text-champagne-gold">
                    {horse.first_place_count}승
                  </span>
                )}
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {[horse.sex, horse.birth_date, horse.country].filter(Boolean).join(" · ")}
              </div>

              {showWins && horse.total_race_count > 0 && (
                <div className="mt-2 flex items-center gap-2">
                  {/* Win rate bar */}
                  <div className="h-1 flex-1 overflow-hidden rounded-full bg-primary/10">
                    <div
                      className="h-full rounded-full bg-champagne-gold"
                      style={{ width: `${Math.min(100, Number(winRate))}%` }}
                    />
                  </div>
                  <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                    {horse.total_race_count}전 {horse.first_place_count}승
                    {winRate ? ` (${winRate}%)` : ""}
                  </span>
                </div>
              )}

              {(horse.sire_name || horse.dam_name) && (
                <div className="mt-2 flex flex-wrap items-center gap-1">
                  {horse.sire_name && (
                    <Badge variant="outline" className="text-[10px] font-normal">
                      父 {horse.sire_name}
                    </Badge>
                  )}
                  {horse.dam_name && (
                    <Badge variant="outline" className="text-[10px] font-normal">
                      母 {horse.dam_name}
                    </Badge>
                  )}
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
