import type { Metadata } from "next";
import Link from "next/link";

import { Card, CardContent } from "@/components/ui/card";
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
    <div className="space-y-5">
      <section>
        <SectionHead icon={<IconHorseshoe size={13} />} label="엔티티 통계" />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <CountTile href="/horses" label="마필" value={horseCount} Icon={IconHorseshoe} />
          <CountTile href="/jockeys" label="기수" value={jockeyCount} Icon={IconUser} />
          <CountTile href="/trainer" label="조교사" value={trainerCount} Icon={IconUserPlus} />
          <CountTile href="/owner" label="마주" value={ownerCount} Icon={IconCrown} />
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-2">
        <Card>
          <CardContent className="p-4">
            <SectionHead
              icon={<IconHorseshoe size={13} />}
              label="최근 1착 마필"
              right={
                <Link href="/horses" className="text-[11px] font-semibold text-muted-foreground hover:text-primary">
                  전체 →
                </Link>
              }
            />
            <ul className="divide-y divide-border">
              {recentWinners.map((h, i) => (
                <li key={h.horse_no} className="flex items-center gap-2 py-2 text-sm">
                  <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-bold tabular-nums text-muted-foreground">
                    {i + 1}
                  </span>
                  <Link href={`/horse/${h.horse_no}`} className="flex-1 truncate font-semibold hover:text-primary">
                    {h.horse_name}
                  </Link>
                  <span className="font-mono text-xs tabular-nums text-muted-foreground">
                    {h.win_count}승
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <SectionHead
              icon={<IconUser size={13} />}
              label="TOP 기수"
              right={
                <Link href="/jockeys" className="text-[11px] font-semibold text-muted-foreground hover:text-primary">
                  전체 →
                </Link>
              }
            />
            <ul className="divide-y divide-border">
              {topJockeys.map((j, i) => (
                <li key={j.jk_no} className="flex items-center gap-2 py-2 text-sm">
                  <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-bold tabular-nums text-muted-foreground">
                    {i + 1}
                  </span>
                  <Link href={`/jockey/${j.jk_no}`} className="flex-1 truncate font-semibold hover:text-primary">
                    {j.jk_name}
                  </Link>
                  <span className="font-mono text-xs tabular-nums text-muted-foreground">
                    {j.first_place_count}승
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-3 md:grid-cols-2">
        <Card>
          <CardContent className="p-4">
            <SectionHead
              icon={<IconUserPlus size={13} />}
              label="TOP 조교사"
              right={
                <Link href="/trainer" className="text-[11px] font-semibold text-muted-foreground hover:text-primary">
                  전체 →
                </Link>
              }
            />
            <ul className="divide-y divide-border">
              {topTrainers.map((t, i) => (
                <li key={t.tr_no} className="flex items-center gap-2 py-2 text-sm">
                  <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-bold tabular-nums text-muted-foreground">
                    {i + 1}
                  </span>
                  <Link href={`/trainer/${t.tr_no}`} className="flex-1 truncate font-semibold hover:text-primary">
                    {t.tr_name}
                  </Link>
                  <span className="font-mono text-xs tabular-nums text-muted-foreground">
                    {t.first_place_count}승
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <SectionHead
              icon={<IconCrown size={13} />}
              label="TOP 마주"
              right={
                <Link href="/owner" className="text-[11px] font-semibold text-muted-foreground hover:text-primary">
                  전체 →
                </Link>
              }
            />
            <ul className="divide-y divide-border">
              {topOwners.map((o, i) => (
                <li key={o.ow_no} className="flex items-center gap-2 py-2 text-sm">
                  <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-bold tabular-nums text-muted-foreground">
                    {i + 1}
                  </span>
                  <Link href={`/owner/${o.ow_no}`} className="flex-1 truncate font-semibold hover:text-primary">
                    {o.ow_name}
                  </Link>
                  <span className="font-mono text-xs tabular-nums text-muted-foreground">
                    {o.first_place_count}승
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </section>
    </div>
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
      className="group block rounded-[10px] border border-border bg-card px-4 py-3 transition hover:border-primary/40"
    >
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        <span className="text-muted-foreground opacity-40 group-hover:opacity-100 group-hover:text-primary">
          <Icon size={14} />
        </span>
      </div>
      <div className="mt-1 font-mono text-xl font-bold leading-tight tabular-nums text-foreground">
        {value.toLocaleString()}
        <span className="ml-1 text-[11px] font-medium text-muted-foreground">건</span>
      </div>
    </Link>
  );
}
