import type { Metadata } from "next";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  getAllOwners,
  searchOwnersByName,
  type Owner,
} from "@/lib/owners";

export const metadata: Metadata = {
  title: "마주 검색",
  description: "한국 경마 마주 명단 — 통산 출전·1·2·3착·승률을 이름별로 검색.",
  alternates: { canonical: "/owner" },
};

type SearchParams = { q?: string };

export default async function OwnersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { q = "" } = await searchParams;
  const query = q.trim();

  const owners: Owner[] = query
    ? await searchOwnersByName(query, 100)
    : await getAllOwners(100);

  return (
    <div>
      <h1 className="mb-5 text-2xl font-extrabold tracking-tight sm:text-3xl">
        마주
      </h1>

      <form action="/owner" className="mb-6">
        <Input
          name="q"
          type="search"
          defaultValue={query}
          placeholder="마주명으로 검색 (예: 성우레저산업)"
          autoFocus
          className="h-11 max-w-md rounded-xl px-4 text-base shadow-sm"
        />
      </form>

      {query && (
        <p className="mb-3 text-sm text-muted-foreground">
          검색 결과 <Badge variant="secondary">{owners.length}건</Badge>
        </p>
      )}

      {owners.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            {query ? "검색 결과가 없습니다." : "적재된 마주가 없습니다."}
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {owners.map((o) => (
            <Link key={o.ow_no} href={`/owner/${o.ow_no}`}>
              <Card className="transition hover:border-primary/40 hover:shadow-md hover:shadow-primary/5">
                <CardContent className="p-4">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-lg font-semibold">
                      {o.ow_name}
                    </span>
                    <Badge variant="outline" className="font-normal">
                      {o.meet ?? "-"}
                    </Badge>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm text-muted-foreground">
                    <span>
                      출전{" "}
                      <span className="font-medium text-foreground">
                        {o.total_race_count}
                      </span>
                    </span>
                    <span>
                      1착{" "}
                      <span className="font-medium text-primary">
                        {o.first_place_count}
                      </span>
                    </span>
                    {o.win_rate && (
                      <span>
                        승률{" "}
                        <span className="font-medium text-foreground">
                          {o.win_rate}%
                        </span>
                      </span>
                    )}
                  </div>
                  {o.reg_date && (
                    <div className="mt-1 text-xs text-muted-foreground">
                      등록 {o.reg_date}
                    </div>
                  )}
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
