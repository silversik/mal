import { cache } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  getHorsesByOwner,
  getOwnerByNo,
  type Owner,
} from "@/lib/owners";
import { BreadcrumbJsonLd } from "@/components/seo/breadcrumb-jsonld";

const fetchOwner = cache(getOwnerByNo);

export async function generateMetadata(
  { params }: { params: Promise<{ ow_no: string }> },
): Promise<Metadata> {
  const { ow_no } = await params;
  const owner = await fetchOwner(ow_no);
  if (!owner) return { title: "마주 정보 없음", robots: { index: false } };
  const winRate = owner.win_rate ? `${owner.win_rate}%` : "-";
  const description = `${owner.ow_name} 마주 (${owner.meet ?? ""}) — 보유마 통산 ${owner.total_race_count}전 ${owner.first_place_count}·${owner.second_place_count}·${owner.third_place_count}, 승률 ${winRate}. 보유마 목록.`;
  return {
    title: `${owner.ow_name} · 마주 프로필`,
    description,
    alternates: { canonical: `/owner/${ow_no}` },
    openGraph: {
      type: "profile",
      title: `${owner.ow_name} · 마주 프로필`,
      description,
      url: `/owner/${ow_no}`,
    },
  };
}

export default async function OwnerDetailPage({
  params,
}: {
  params: Promise<{ ow_no: string }>;
}) {
  const { ow_no } = await params;
  const owner = await fetchOwner(ow_no);
  if (!owner) notFound();

  const horses = await getHorsesByOwner(ow_no, 50);

  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-12">
      <BreadcrumbJsonLd
        items={[
          { name: "홈", url: "/" },
          { name: "마주", url: "/horses" },
          { name: owner.ow_name, url: `/owner/${ow_no}` },
        ]}
      />
      <Link
        href="/"
        className="group mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground transition hover:text-primary"
      >
        <span className="transition group-hover:-translate-x-0.5">&larr;</span>
        메인으로
      </Link>

      <OwnerProfileCard owner={owner} />

      <section className="mt-10">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          보유마{" "}
          <span className="ml-1 text-xs font-normal text-muted-foreground">
            ({horses.length}두)
          </span>
        </h2>
        {horses.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              보유마 데이터가 아직 적재되지 않았습니다.
            </CardContent>
          </Card>
        ) : (
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>마명</TableHead>
                  <TableHead>성별</TableHead>
                  <TableHead>생년월일</TableHead>
                  <TableHead className="text-right">출전</TableHead>
                  <TableHead className="text-right">1착</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {horses.map((h) => (
                  <TableRow key={h.horse_no}>
                    <TableCell>
                      <Link
                        href={`/horse/${h.horse_no}`}
                        className="text-primary hover:underline"
                      >
                        {h.horse_name}
                      </Link>
                    </TableCell>
                    <TableCell>{h.sex ?? "-"}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {h.birth_date ?? "-"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {h.total_race_count}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-primary">
                      {h.first_place_count}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )}
      </section>
    </main>
  );
}

function OwnerProfileCard({ owner }: { owner: Owner }) {
  const winPct = owner.win_rate ? `${owner.win_rate}%` : "-";
  const fields: Array<[string, React.ReactNode]> = [
    ["마주번호", <span className="font-mono" key="no">{owner.ow_no}</span>],
    ["소속", owner.meet ?? "-"],
    ["등록일", owner.reg_date ?? "-"],
    [
      "통산 출전",
      <span key="rc">
        {owner.total_race_count}
        <span className="text-muted-foreground">회</span>
      </span>,
    ],
    [
      "1착",
      <span key="f" className="text-primary">
        {owner.first_place_count}
      </span>,
    ],
    [
      "2착 / 3착",
      `${owner.second_place_count} / ${owner.third_place_count}`,
    ],
    ["승률", winPct],
  ];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-4xl font-bold tracking-tight">
          {owner.ow_name}
        </CardTitle>
        {owner.ow_name_en && (
          <p className="mt-1 text-sm text-muted-foreground">{owner.ow_name_en}</p>
        )}
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
          {fields.map(([label, value]) => (
            <div key={String(label)}>
              <dt className="text-xs uppercase tracking-wider text-muted-foreground">
                {label}
              </dt>
              <dd className="mt-0.5 text-sm font-medium">{value}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}
