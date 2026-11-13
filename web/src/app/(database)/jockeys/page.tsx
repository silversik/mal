import type { Metadata } from "next";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { LIST_PAGE_SIZE, ListPager, parseListPage, splitPage } from "@/components/list-pager";
import { getAllJockeys, searchJockeysByName, type Jockey } from "@/lib/jockeys";

export const metadata: Metadata = {
  title: "기수 검색",
  description:
    "한국 경마 기수 명단 — 통산 출전·1·2·3착·승률을 기수명/소속별로 검색.",
  alternates: { canonical: "/jockeys" },
};

type SearchParams = { q?: string; page?: string };

export default async function JockeysPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { q = "", page: pageRaw } = await searchParams;
  const query = q.trim();
  const page = parseListPage(pageRaw);
  const offset = (page - 1) * LIST_PAGE_SIZE;

  const { rows: jockeys, hasNext } = splitPage<Jockey>(
    query
      ? await searchJockeysByName(query, LIST_PAGE_SIZE + 1, offset)
      : await getAllJockeys(LIST_PAGE_SIZE + 1, offset),
  );
  const pageHref = (p: number) => {
    const sp = new URLSearchParams();
    if (query) sp.set("q", query);
    if (p > 1) sp.set("page", String(p));
    const qs = sp.toString();
    return qs ? `/jockeys?${qs}` : "/jockeys";
  };

  return (
    <div>
      <h1 className="mb-4 text-2xl font-extrabold tracking-tight sm:text-3xl">기수</h1>

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
          검색 결과{" "}
          <Badge variant="secondary">
            {page > 1 || hasNext ? `${page} 페이지` : `${jockeys.length}건`}
          </Badge>
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
                  <div className="mt-1 text-sm text-muted-foreground">
                    {j.debut_date && <span>데뷔 {j.debut_date}</span>}
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
      <ListPager page={page} hasNext={hasNext} href={pageHref} />
    </div>
  );
}
