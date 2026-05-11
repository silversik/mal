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
import { getRanking } from "@/lib/rankings";

export const metadata: Metadata = {
  title: "분석 · mal.kr",
  description: "랭킹 · 코스 레코드 · 마필 비교 등 mal.kr 의 데이터 분석 도구.",
  alternates: { canonical: "/analysis" },
};

export default async function AnalysisPage() {
  const currentYear = new Date().getFullYear();
  const [topJockeys, topTrainers, topHorses] = await Promise.all([
    getRanking("jockey", "ytd", currentYear, 5),
    getRanking("trainer", "ytd", currentYear, 5),
    getRanking("horse", "ytd", currentYear, 5),
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
          title={`TOP 기수 · ${currentYear}`}
          moreHref={`/rankings?entity=jockey&scope=ytd`}
          rows={topJockeys.map((r) => ({ name: r.name, sub: `${r.starts}전`, value: `${r.win}승` }))}
        />
        <TopList
          title={`TOP 마필 · ${currentYear}`}
          moreHref={`/rankings?entity=horse&scope=ytd`}
          rows={topHorses.map((r) => ({ name: r.name, sub: `${r.starts}전`, value: `${r.win}승` }))}
        />
        <TopList
          title={`TOP 조교사 · ${currentYear}`}
          moreHref={`/rankings?entity=trainer&scope=ytd`}
          rows={topTrainers.map((r) => ({ name: r.name, sub: `${r.starts}전`, value: `${r.win}승` }))}
        />
      </section>
    </div>
  );
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
        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-secondary">
          <Icon size={18} />
        </span>
        <div className="min-w-0">
          <h3 className="truncate text-sm font-bold tracking-tight group-hover:text-primary">{title}</h3>
          <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{desc}</p>
        </div>
      </div>
      <span className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-primary opacity-0 transition group-hover:opacity-100">
        열기
        <svg width="10" height="10" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M3 2 L7 6 L3 10" stroke="currentColor" strokeWidth="1.6" fill="none" />
        </svg>
      </span>
    </Link>
  );
}

function TopList({
  title,
  moreHref,
  rows,
}: {
  title: string;
  moreHref: string;
  rows: { name: string; sub?: string; value: string }[];
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <SectionHead
          icon={<IconActivity size={13} />}
          label={title}
          right={
            <Link href={moreHref} className="text-[11px] font-semibold text-muted-foreground hover:text-primary">
              전체 →
            </Link>
          }
        />
        {rows.length === 0 ? (
          <p className="py-2 text-center text-xs text-muted-foreground">데이터 없음</p>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((r, i) => (
              <li key={i} className="flex items-center gap-2 py-2 text-sm">
                <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-bold tabular-nums text-muted-foreground">
                  {i + 1}
                </span>
                <span className="flex-1 truncate font-semibold">{r.name}</span>
                {r.sub && (
                  <span className="font-mono text-[11px] tabular-nums text-muted-foreground">{r.sub}</span>
                )}
                <span className="font-mono text-xs font-bold tabular-nums text-primary">{r.value}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
