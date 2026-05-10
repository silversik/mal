import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { HorseMark } from "@/components/brand/logo";
import { coatBgHex, coatBodyHex } from "@/lib/coat";
import { BreadcrumbJsonLd } from "@/components/seo/breadcrumb-jsonld";
import {
  getChildrenByParentNo,
  getHorseByNo,
  getParentChildAggregate,
} from "@/lib/horses";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ parent_no: string }>;
}): Promise<Metadata> {
  const { parent_no } = await params;
  const horse = await getHorseByNo(parent_no);
  if (!horse) return { title: "혈통 정보 없음", robots: { index: false } };
  return {
    title: `${horse.horse_name} 자손 통계`,
    description: `${horse.horse_name} 의 자손 마필 통산 출전·우승 통계.`,
    alternates: { canonical: `/parent/${parent_no}` },
  };
}

export default async function ParentPage({
  params,
}: {
  params: Promise<{ parent_no: string }>;
}) {
  const { parent_no } = await params;
  const [parent, children, agg] = await Promise.all([
    getHorseByNo(parent_no),
    getChildrenByParentNo(parent_no, 200),
    getParentChildAggregate(parent_no),
  ]);

  if (!parent && children.length === 0) notFound();

  const sideLabel = agg?.side === "sire" ? "부마" : agg?.side === "dam" ? "모마" : "부모";
  const displayName = parent?.horse_name ?? children[0]?.sire_name ?? children[0]?.dam_name ?? parent_no;

  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-10">
      <BreadcrumbJsonLd
        items={[
          { name: "홈", url: "/" },
          { name: "혈통", url: `/parent/${parent_no}` },
          { name: displayName, url: `/parent/${parent_no}` },
        ]}
      />

      <div className="mb-1 text-xs font-bold uppercase tracking-wider text-muted-foreground">
        {sideLabel}
      </div>
      <h1 className="text-3xl font-bold tracking-tight">{displayName}</h1>
      <div className="mt-1 text-xs text-muted-foreground">
        마번 <code className="font-mono">{parent_no}</code>
        {parent && (
          <Link
            href={`/horse/${parent_no}`}
            className="ml-3 text-primary hover:underline"
          >
            본인 프로필 →
          </Link>
        )}
      </div>

      {agg && (
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCell label="자손 수" value={agg.total_children} />
          <StatCell label="자손 통산 출전" value={agg.total_starts} />
          <StatCell
            label="자손 1-2-3"
            value={`${agg.total_win}-${agg.total_place}-${agg.total_show}`}
          />
          <StatCell
            label="우승 자손 비율"
            value={`${(agg.win_rate * 100).toFixed(0)}%`}
          />
        </div>
      )}

      <div className="mt-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          자손 ({children.length})
        </h2>
        {children.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              등록된 자손이 없습니다.
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {children.map((c) => (
              <Link
                key={c.horse_no}
                href={`/horse/${c.horse_no}`}
                className="group flex items-center gap-3 rounded-lg border bg-card p-3 transition hover:border-primary/50 hover:bg-accent/30"
              >
                <HorseMark
                  size={32}
                  radius={6}
                  badgeFill={coatBgHex(c.coat_color)}
                  markFill={coatBodyHex(c.coat_color)}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold group-hover:text-primary">
                    {c.horse_name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {[c.country, c.sex, c.birth_date?.slice(0, 4)]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                {c.first_place_count > 0 && (
                  <Badge variant="secondary" className="shrink-0 text-xs">
                    {c.first_place_count}승
                  </Badge>
                )}
              </Link>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

function StatCell({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <Card className="py-0">
      <CardContent className="p-3">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">
          {label}
        </div>
        <div className="mt-1 text-xl font-bold tabular-nums">{value}</div>
      </CardContent>
    </Card>
  );
}
