import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { getAllJockeys, searchJockeysByName, type Jockey } from "@/lib/jockeys";

type SearchParams = { q?: string };

export default async function JockeysPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { q = "" } = await searchParams;
  const query = q.trim();

  const jockeys = query
    ? await searchJockeysByName(query, 100)
    : await getAllJockeys(100);

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-12">
      <Link
        href="/"
        className="group mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground transition hover:text-primary"
      >
        <span className="transition group-hover:-translate-x-0.5">&larr;</span>
        메인으로
      </Link>

      <h1 className="mb-6 text-3xl font-bold tracking-tight">기수</h1>

      {/* Search */}
      <form action="/jockeys" className="mb-8">
        <Input
          name="q"
          type="search"
          defaultValue={query}
          placeholder="기수명으로 검색 (예: 문세영)"
          autoFocus
          className="h-12 max-w-md rounded-xl px-4 text-base shadow-sm"
        />
      </form>

      {query && (
        <p className="mb-4 text-sm text-muted-foreground">
          검색 결과 <Badge variant="secondary">{jockeys.length}건</Badge>
        </p>
      )}

      {jockeys.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            {query ? "검색 결과가 없습니다." : "적재된 기수가 없습니다."}
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {jockeys.map((j) => (
            <Link key={j.jk_no} href={`/jockey/${j.jk_no}`}>
              <Card className="transition hover:border-primary/40 hover:shadow-md hover:shadow-primary/5">
                <CardContent className="p-4">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-lg font-semibold">
                      {j.jk_name}
                    </span>
                    <Badge variant="outline" className="font-normal">
                      {j.meet ?? "-"}
                    </Badge>
                  </div>
                  <div className="mt-1 flex items-center gap-3 text-sm text-muted-foreground">
                    <span>
                      출전{" "}
                      <span className="font-medium text-foreground">
                        {j.total_race_count}
                      </span>
                    </span>
                    <span>
                      1착{" "}
                      <span className="font-medium text-primary">
                        {j.first_place_count}
                      </span>
                    </span>
                    {j.win_rate && (
                      <span>
                        승률{" "}
                        <span className="font-medium text-foreground">
                          {j.win_rate}%
                        </span>
                      </span>
                    )}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {j.debut_date && <span>데뷔 {j.debut_date}</span>}
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
