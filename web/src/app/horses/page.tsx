import Link from "next/link";

import { HorseAvatar } from "@/components/horse-avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { getRecentHorses, searchHorsesByName, type Horse } from "@/lib/horses";

type SearchParams = { q?: string };

export default async function HorsesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { q = "" } = await searchParams;
  const query = q.trim();

  const horses = query
    ? await searchHorsesByName(query, 50)
    : await getRecentHorses(50);

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-12">
      <Link
        href="/"
        className="group mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground transition hover:text-primary"
      >
        <span className="transition group-hover:-translate-x-0.5">&larr;</span>
        메인으로
      </Link>

      <h1 className="mb-6 text-3xl font-bold tracking-tight">마필</h1>

      {/* Search */}
      <form action="/horses" className="mb-8">
        <Input
          name="q"
          type="search"
          defaultValue={query}
          placeholder="마명으로 검색 (예: 황홀한질주자마)"
          autoFocus
          className="h-12 max-w-md rounded-xl px-4 text-base shadow-sm"
        />
      </form>

      {query && (
        <p className="mb-4 text-sm text-muted-foreground">
          검색 결과 <Badge variant="secondary">{horses.length}건</Badge>
        </p>
      )}

      {horses.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            {query ? "검색 결과가 없습니다." : "적재된 마필이 없습니다."}
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {horses.map((h) => (
            <Link key={h.horse_no} href={`/horse/${h.horse_no}`}>
              <Card className="transition hover:border-primary/40 hover:shadow-md hover:shadow-primary/5">
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    <HorseAvatar coatColor={h.coat_color} size={36} className="shrink-0" />
                    <div className="flex min-w-0 flex-1 items-baseline justify-between gap-2">
                      <span className="truncate text-lg font-semibold">
                        {h.horse_name}
                      </span>
                      <span className="shrink-0 font-mono text-xs text-muted-foreground">
                        {h.horse_no}
                      </span>
                    </div>
                  </div>
                  <div className="mt-1 text-sm text-muted-foreground">
                    {h.sex && <span className="mr-2">{h.sex}</span>}
                    {h.birth_date && <span className="mr-2">{h.birth_date}</span>}
                    {h.country && <span>· {h.country}</span>}
                  </div>
                  {(h.sire_name || h.dam_name) && (
                    <div className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
                      {h.sire_name && (
                        <Badge variant="outline" className="font-normal">
                          父 {h.sire_name}
                        </Badge>
                      )}
                      {h.dam_name && (
                        <Badge variant="outline" className="font-normal">
                          母 {h.dam_name}
                        </Badge>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
