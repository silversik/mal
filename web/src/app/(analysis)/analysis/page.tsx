import type { Metadata } from "next";
import Link from "next/link";

import { RankBadge } from "@/components/rank-badge";

import { Card } from "@/components/ui/card";
import {
  SectionHead,
  IconActivity,
} from "@/components/profile-ui";
import { kstYear } from "@/lib/kst";
import { getRankingWithFallback, type RankingEntity } from "@/lib/rankings";
import { buildRankingsHref, type YearFallbackResult } from "@/lib/rankings-shared";

export const metadata: Metadata = {
  title: "분석 · mal.kr",
  description: "랭킹 · 코스 레코드 · 마필 비교 등 mal.kr 의 데이터 분석 도구.",
  alternates: { canonical: "/analysis" },
};

// TOP 5 카드: 올해 집계가 3행 미만(연초 HAVING 최소 출전수로 1~2행만 남는 구간)이면
// 직전 연도로 폴백. /rankings 표는 0건일 때만 폴백 — 규칙은 lib/rankings-shared.ts 참고.
const TOP_CARD_MIN_ROWS = 3;

export default async function AnalysisPage() {
  // KST 기준 올해. 카드별로 직전 연도 폴백 판단.
  const currentYear = kstYear();
  const opts = { minRows: TOP_CARD_MIN_ROWS };
  const [topJockeys, topTrainers, topHorses] = await Promise.all([
    getRankingWithFallback("jockey", "ytd", currentYear, 5, opts),
    getRankingWithFallback("trainer", "ytd", currentYear, 5, opts),
    getRankingWithFallback("horse", "ytd", currentYear, 5, opts),
  ]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">분석 대시보드</h1>
        <p className="mt-1 text-base text-muted-foreground">
          올해 성적 상위 기수 · 마필 · 조교사. 전체 순위는 랭킹에서 볼 수 있습니다.
        </p>
      </header>

      <section className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <TopList
          title={`TOP 기수 · ${topJockeys.year}`}
          ranking={topJockeys}
          moreHref={rankingsHref("jockey", topJockeys)}
          rows={topJockeys.rows.map((r) => ({
            no: r.no,
            href: `/jockey/${r.no}`,
            name: r.name,
            sub: `${r.starts}전 · 승률 ${(r.win_rate * 100).toFixed(1)}%`,
            value: `${r.win}승`,
          }))}
        />
        <TopList
          title={`TOP 마필 · ${topHorses.year}`}
          ranking={topHorses}
          moreHref={rankingsHref("horse", topHorses)}
          rows={topHorses.rows.map((r) => ({
            no: r.no,
            href: `/horse/${r.no}`,
            name: r.name,
            sub: `${r.starts}전 · 복승률 ${(((r.win + r.place) / r.starts) * 100).toFixed(1)}%`,
            value: `${r.win}승`,
          }))}
        />
        <TopList
          title={`TOP 조교사 · ${topTrainers.year}`}
          ranking={topTrainers}
          moreHref={rankingsHref("trainer", topTrainers)}
          rows={topTrainers.rows.map((r) => ({
            no: r.no,
            href: `/trainer/${r.no}`,
            name: r.name,
            sub: `${r.starts}전 · 승률 ${(r.win_rate * 100).toFixed(1)}%`,
            value: `${r.win}승`,
          }))}
        />
      </section>
    </div>
  );
}

// 폴백 시 "전체 →" 도 실제 보여준 연도의 연도별 랭킹으로 보낸다 (올해 탭은 비어 있으므로).
function rankingsHref(entity: RankingEntity, r: YearFallbackResult<unknown>): string {
  return buildRankingsHref({ entity, scope: r.fellBack ? "year" : "ytd", year: r.year });
}



type TopListRow = {
  no: string;
  href: string;
  name: string;
  sub?: string;
  value: string;
};

function TopList({
  title,
  ranking,
  moreHref,
  rows,
}: {
  title: string;
  /** 폴백 여부/요청 연도 — 폴백이면 제목 아래 별도 muted 줄로 "(올해) 집계 전" 표기. */
  ranking: Pick<YearFallbackResult<unknown>, "year" | "requestedYear" | "fellBack">;
  moreHref: string;
  rows: TopListRow[];
}) {
  return (
    <Card className="gap-0 py-0">
      <div className="p-4">
        <SectionHead
          icon={<IconActivity size={14} />}
          label={title}
          right={
            <Link
              href={moreHref}
              className="inline-flex min-h-11 items-center text-small font-semibold text-muted-foreground hover:text-foreground"
            >
              전체 →
            </Link>
          }
        />
        {ranking.fellBack && (
          <p className="-mt-1 mb-2 text-small text-muted-foreground">
            <span className="font-mono tabular-nums">{ranking.requestedYear}</span> 집계 전 ·{" "}
            <span className="font-mono tabular-nums">{ranking.year}</span> 기준
          </p>
        )}
        {rows.length === 0 ? (
          <p className="py-4 text-center text-base text-muted-foreground">아직 집계된 데이터가 없습니다.</p>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((r, i) => (
              <li key={r.no}>
                <Link
                  href={r.href}
                  className="group -mx-2 flex min-h-12 items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-muted"
                >
                  <RankBadge size="sm" rest="chip" rank={i + 1} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-base font-semibold text-foreground">
                      {r.name}
                    </span>
                    {r.sub && (
                      <span className="block truncate font-mono text-small tabular-nums text-muted-foreground">
                        {r.sub}
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 font-mono text-base font-bold tabular-nums text-foreground">
                    {r.value}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
