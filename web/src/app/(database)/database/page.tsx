import type { Metadata } from "next";
import Link from "next/link";

import { Card } from "@/components/ui/card";
import {
  SectionHead,
  IconHorseshoe,
  IconUser,
  IconUserPlus,
  IconCrown,
} from "@/components/profile-ui";
import { countAllHorses, getRecentWinners } from "@/lib/horses";
import { countAllJockeys, getAllJockeys } from "@/lib/jockeys";
import { getAllTrainers, getTrainerCount } from "@/lib/trainers";
import { getAllOwners, getOwnerCount } from "@/lib/owners";

export const metadata: Metadata = {
  title: "데이터베이스 · mal.kr",
  description: "한국마사회 공공데이터 기반 마필 · 기수 · 조교사 · 마주 데이터베이스.",
  alternates: { canonical: "/database" },
};

export default async function DatabasePage() {
  const [horseCount, jockeyCount, trainerCount, ownerCount, recentWinners, topJockeys, topTrainers, topOwners] = await Promise.all([
    countAllHorses(),
    countAllJockeys(),
    getTrainerCount(),
    getOwnerCount(),
    getRecentWinners(5),
    getAllJockeys(5),
    getAllTrainers(5),
    getAllOwners(5),
  ]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">데이터베이스</h1>
        <p className="mt-1 text-base text-muted-foreground">
          한국마사회 공공데이터 기반 마필 · 기수 · 조교사 · 마주 정보.
        </p>
      </header>

      <section aria-label="등록 건수" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <CountTile href="/horses" label="마필" value={horseCount} Icon={IconHorseshoe} />
        <CountTile href="/jockeys" label="기수" value={jockeyCount} Icon={IconUser} />
        <CountTile href="/trainer" label="조교사" value={trainerCount} Icon={IconUserPlus} />
        <CountTile href="/owner" label="마주" value={ownerCount} Icon={IconCrown} />
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <TopCard
          Icon={IconHorseshoe}
          title="최근 1착 마필"
          moreHref="/horses"
          rows={recentWinners.map((h) => ({ key: h.horse_no, href: `/horse/${h.horse_no}`, name: h.horse_name, value: `${h.win_count}승` }))}
        />
        <TopCard
          Icon={IconUser}
          title="TOP 기수"
          moreHref="/jockeys"
          rows={topJockeys.map((j) => ({ key: j.jk_no, href: `/jockey/${j.jk_no}`, name: j.jk_name, value: `${j.first_place_count}승` }))}
        />
        <TopCard
          Icon={IconUserPlus}
          title="TOP 조교사"
          moreHref="/trainer"
          rows={topTrainers.map((t) => ({ key: t.tr_no, href: `/trainer/${t.tr_no}`, name: t.tr_name, value: `${t.first_place_count}승` }))}
        />
        <TopCard
          Icon={IconCrown}
          title="TOP 마주"
          moreHref="/owner"
          rows={topOwners.map((o) => ({ key: o.ow_no, href: `/owner/${o.ow_no}`, name: o.ow_name, value: `${o.first_place_count}승` }))}
        />
      </section>
    </div>
  );
}

function TopCard({
  Icon,
  title,
  moreHref,
  rows,
}: {
  Icon: (p: { size?: number }) => React.JSX.Element;
  title: string;
  moreHref: string;
  rows: { key: string; href: string; name: string; value: string }[];
}) {
  return (
    <Card className="gap-0 py-0">
      <div className="p-4">
        <SectionHead
          icon={<Icon size={14} />}
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
        {rows.length === 0 ? (
          <p className="py-4 text-center text-base text-muted-foreground">아직 데이터가 없습니다.</p>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((r, i) => (
              <li key={r.key}>
                <Link
                  href={r.href}
                  className="-mx-2 flex min-h-12 items-center gap-3 rounded-md px-2 transition-colors hover:bg-muted"
                >
                  <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted font-mono text-small font-bold tabular-nums text-foreground">
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-base font-semibold">{r.name}</span>
                  <span className="shrink-0 font-mono text-base font-bold tabular-nums">{r.value}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

function CountTile({
  href,
  label,
  value,
  Icon,
}: {
  href: string;
  label: string;
  value: number;
  Icon: (p: { size?: number }) => React.JSX.Element;
}) {
  return (
    <Link
      href={href}
      className="group block rounded-[10px] border border-border bg-card px-4 py-3 transition-colors hover:border-foreground"
    >
      <div className="flex items-center justify-between">
        <span className="text-small font-semibold text-muted-foreground">{label}</span>
        <span className="text-muted-foreground group-hover:text-foreground">
          <Icon size={16} />
        </span>
      </div>
      <div className="mt-1 font-mono text-xl font-bold leading-tight tabular-nums text-foreground">
        {value.toLocaleString()}
        <span className="ml-1 text-small font-medium text-muted-foreground">건</span>
      </div>
    </Link>
  );
}
