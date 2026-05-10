import type { Metadata } from "next";
import Link from "next/link";

import { AgeSelect } from "./age-select";
import { HorseMark } from "@/components/brand/logo";
import { coatBgHex, coatBodyHex } from "@/lib/coat";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  countAllHorses,
  getHorsesSorted,
  searchHorses,
  type Horse,
  type HorseAgeBucket,
  type HorseCountryFilter,
  type HorseSexFilter,
  type HorseSort,
} from "@/lib/horses";

export const metadata: Metadata = {
  title: "마필 검색",
  description:
    "한국 경주마 데이터베이스 — 마명·출생연도·나이로 검색하고 통산 출전·우승·혈통을 한눈에.",
  alternates: { canonical: "/horses" },
};

type SearchParams = { q?: string; sort?: string; age?: string; sex?: string; origin?: string };

const SORT_OPTIONS: { value: HorseSort; label: string }[] = [
  { value: "wins",   label: "우승순" },
  { value: "latest", label: "등록순" },
];

function isAgeBucket(v: string | undefined): v is HorseAgeBucket {
  return v === "under5" || v === "under10" || v === "over11";
}

function isSexFilter(v: string | undefined): v is HorseSexFilter {
  return v === "all" || v === "수" || v === "암" || v === "거";
}

function isCountryFilter(v: string | undefined): v is HorseCountryFilter {
  return v === "all" || v === "domestic" || v === "foreign";
}

const SEX_OPTIONS: { value: HorseSexFilter; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "수", label: "수" },
  { value: "암", label: "암" },
  { value: "거", label: "거" },
];

const COUNTRY_OPTIONS: { value: HorseCountryFilter; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "domestic", label: "국내산" },
  { value: "foreign", label: "외산" },
];

export default async function HorsesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { q = "", sort, age, sex, origin } = await searchParams;
  const queryStr = q.trim();
  const activeSort: HorseSort = sort === "latest" ? "latest" : "wins";
  const activeAge: HorseAgeBucket = isAgeBucket(age) ? age : "under5";
  const activeSex: HorseSexFilter = isSexFilter(sex) ? sex : "all";
  const activeOrigin: HorseCountryFilter = isCountryFilter(origin) ? origin : "all";

  const [searchHit, horses, totalCount] = await Promise.all([
    queryStr ? searchHorses(queryStr, 60) : Promise.resolve(null),
    queryStr
      ? Promise.resolve<Horse[]>([])
      : getHorsesSorted(activeSort, activeAge, activeSex, activeOrigin, 60),
    countAllHorses(),
  ]);
  const resultRows: Horse[] = searchHit ? searchHit.rows : horses;

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-12">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-baseline gap-3">
          <h1 className="font-serif text-3xl font-bold tracking-tight text-primary">마필</h1>
          <span className="text-sm text-muted-foreground tabular-nums">
            등록 {totalCount.toLocaleString()}마리
          </span>
        </div>

        {/* Sort toggle + filters — only when not searching */}
        {!queryStr && (
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 rounded-lg border border-primary/10 bg-white p-1">
              {SORT_OPTIONS.map(({ value, label }) => (
                <Link
                  key={value}
                  href={buildHorsesHref({ sort: value, age: activeAge, sex: activeSex, origin: activeOrigin })}
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
            <AgeSelect activeAge={activeAge} activeSort={activeSort} />
            <FilterPills
              label="성별"
              options={SEX_OPTIONS}
              active={activeSex}
              build={(v) =>
                buildHorsesHref({ sort: activeSort, age: activeAge, sex: v, origin: activeOrigin })
              }
            />
            <FilterPills
              label="산지"
              options={COUNTRY_OPTIONS}
              active={activeOrigin}
              build={(v) =>
                buildHorsesHref({ sort: activeSort, age: activeAge, sex: activeSex, origin: v })
              }
            />
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
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {resultRows.map((h) => (
            <HorseCard key={h.horse_no} horse={h} showWins={!queryStr && activeSort === "wins"} />
          ))}
        </div>
      )}
    </main>
  );
}

function buildHorsesHref(params: {
  sort: HorseSort;
  age: HorseAgeBucket;
  sex: HorseSexFilter;
  origin: HorseCountryFilter;
}) {
  const sp = new URLSearchParams();
  sp.set("sort", params.sort);
  sp.set("age", params.age);
  if (params.sex !== "all") sp.set("sex", params.sex);
  if (params.origin !== "all") sp.set("origin", params.origin);
  return `/horses?${sp.toString()}`;
}

function FilterPills<T extends string>({
  label,
  options,
  active,
  build,
}: {
  label: string;
  options: { value: T; label: string }[];
  active: T;
  build: (v: T) => string;
}) {
  return (
    <div className="flex items-center gap-1 rounded-lg border border-primary/10 bg-white p-1 text-xs">
      <span className="px-1 font-bold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      {options.map((o) => (
        <Link
          key={o.value}
          href={build(o.value)}
          className={`rounded-md px-2 py-0.5 font-semibold transition-colors ${
            active === o.value
              ? "bg-primary text-sand-ivory shadow-sm"
              : "text-slate-grey hover:text-primary"
          }`}
        >
          {o.label}
        </Link>
      ))}
    </div>
  );
}

function HorseCard({ horse, showWins }: { horse: Horse; showWins: boolean }) {
  const winRate =
    horse.total_race_count > 0
      ? ((horse.first_place_count / horse.total_race_count) * 100).toFixed(1)
      : null;

  return (
    <Link href={`/horse/${horse.horse_no}`}>
      <Card className="h-full py-0 transition hover:border-primary/40 hover:shadow-md hover:shadow-primary/5">
        <CardContent className="p-3">
          <div className="flex items-start gap-3">
            <HorseMark
              size={36}
              radius={6}
              badgeFill={coatBgHex(horse.coat_color)}
              markFill={coatBodyHex(horse.coat_color)}
              className="mt-0.5 shrink-0"
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-base font-semibold leading-snug">
                  {horse.horse_name}
                </span>
                {showWins && horse.first_place_count > 0 && (
                  <span className="shrink-0 text-xs font-bold text-gold-ink">
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
