import type { Metadata } from "next";
import Link from "next/link";

import { Card, CardContent } from "@/components/ui/card";
import {
  SectionHead,
  IconBars,
  IconTarget,
  IconTrend,
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
    <div className="space-y-5">
      <section className="grid gap-3 md:grid-cols-3">
        <ToolTile href="/rankings" title="랭킹" desc="기수·마필·조교사 통산 성적 랭킹표" Icon={IconBars} />
        <ToolTile href="/records" title="코스 레코드" desc="경마장·거리별 역대 최고 기록" Icon={IconTrend} />
        <ToolTile href="/compare" title="마필 비교" desc="두 마필 성적을 나란히 비교" Icon={IconTarget} />
      </section>

      <section className="grid gap-3 md:grid-cols-3">
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

function ToolTile({
  href,
  title,
  desc,
  Icon,
}: {
  href: string;
  title: string;
  desc: string;
  Icon: (p: { size?: number }) => React.JSX.Element;
}) {
  return (
    <Link
      href={href}
      className="group flex flex-col rounded-[10px] border border-border bg-card p-4 transition hover:border-primary/40 hover:shadow-subtle"
    >
      <div className="flex items-start gap-2">
        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Icon size={18} />
        </span>
        <div className="min-w-0">
          <h3 className="truncate text-sm font-bold tracking-tight group-hover:text-primary">{title}</h3>
          <p className="mt-0.5 text-caption leading-snug text-muted-foreground">{desc}</p>
        </div>
      </div>
      <span className="mt-2 inline-flex items-center gap-1 text-caption font-semibold text-primary opacity-0 transition group-hover:opacity-100">
        열기
        <svg width="10" height="10" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M3 2 L7 6 L3 10" stroke="currentColor" strokeWidth="1.6" fill="none" />
        </svg>
      </span>
    </Link>
  );
}

// 1·2·3 위만 메달 배지 — 홈 "TOP 기수 랭킹" 카드와 톤 통일.
const RANK_MEDAL_STYLE: Record<number, string> = {
  1: "bg-champagne-gold text-secondary-foreground",
  2: "bg-slate-400 text-white",
  3: "bg-amber-700 text-white",
};

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
    <Card>
      <CardContent className="p-4">
        <SectionHead
          icon={<IconActivity size={13} />}
          label={title}
          right={
            <Link href={moreHref} className="text-caption font-semibold text-muted-foreground hover:text-primary">
              전체 →
            </Link>
          }
        />
        {ranking.fellBack && (
          // 좁은 3열 카드에서 제목이 줄바꿈되지 않게 제목과 분리한 보조 줄 (DESIGN small 13).
          <p className="-mt-1.5 mb-2 text-small text-muted-foreground">
            <span className="font-mono tabular-nums">{ranking.requestedYear}</span> 집계 전 ·{" "}
            <span className="font-mono tabular-nums">{ranking.year}</span> 기준
          </p>
        )}
        {rows.length === 0 ? (
          <p className="py-2 text-center text-xs text-muted-foreground">데이터 없음</p>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((r, i) => {
              const rank = i + 1;
              return (
                <li key={r.no}>
                  <Link
                    href={r.href}
                    className="group flex items-center gap-2 py-2 text-sm transition hover:bg-muted/40 -mx-2 px-2 rounded"
                  >
                    <span
                      className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-caption font-bold tabular-nums ${
                        RANK_MEDAL_STYLE[rank] ?? "bg-muted text-muted-foreground"
                      }`}
                    >
                      {rank}
                    </span>
                    <span className="flex-1 truncate font-semibold group-hover:text-primary">
                      {r.name}
                    </span>
                    {r.sub && (
                      <span className="font-mono text-caption tabular-nums text-muted-foreground">
                        {r.sub}
                      </span>
                    )}
                    <span className="font-mono text-xs font-bold tabular-nums text-primary">
                      {r.value}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
