import type { Metadata } from "next";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  getAllTrainers,
  searchTrainersByName,
  type Trainer,
} from "@/lib/trainers";

export const metadata: Metadata = {
  title: "조교사 검색",
  description: "한국 경마 조교사 명단 — 통산 출전·1·2·3착·승률을 이름별로 검색.",
  alternates: { canonical: "/trainer" },
};

type SearchParams = { q?: string };

export default async function TrainersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { q = "" } = await searchParams;
  const query = q.trim();

  const trainers: Trainer[] = query
    ? await searchTrainersByName(query, 100)
    : await getAllTrainers(100);

  return (
    <div>
      <h1 className="mb-5 text-2xl font-extrabold tracking-tight sm:text-3xl">
        조교사
      </h1>

      <form action="/trainer" className="mb-6">
        <Input
          name="q"
          type="search"
          defaultValue={query}
          placeholder="조교사명으로 검색 (예: 김영관)"
          autoFocus
          className="h-11 max-w-md rounded-xl px-4 text-base shadow-sm"
        />
      </form>

      {query && (
        <p className="mb-3 text-sm text-muted-foreground">
          검색 결과 <Badge variant="secondary">{trainers.length}건</Badge>
        </p>
      )}

      {trainers.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            {query ? "검색 결과가 없습니다." : "적재된 조교사가 없습니다."}
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {trainers.map((t) => (
            <Link key={t.tr_no} href={`/trainer/${t.tr_no}`}>
              <Card className="transition hover:border-primary/40 hover:shadow-md hover:shadow-primary/5">
                <CardContent className="p-4">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-lg font-semibold">
                      {t.tr_name}
                    </span>
                    <Badge variant="outline" className="font-normal">
                      {t.meet ?? "-"}
                    </Badge>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm text-muted-foreground">
                    <span>
                      출전{" "}
                      <span className="font-medium text-foreground">
                        {t.total_race_count}
                      </span>
                    </span>
                    <span>
                      1착{" "}
                      <span className="font-medium text-primary">
                        {t.first_place_count}
                      </span>
                    </span>
                    {t.win_rate && (
                      <span>
                        승률{" "}
                        <span className="font-medium text-foreground">
                          {t.win_rate}%
                        </span>
                      </span>
                    )}
                  </div>
                  {t.debut_date && (
                    <div className="mt-1 text-xs text-muted-foreground">
                      데뷔 {t.debut_date}
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
