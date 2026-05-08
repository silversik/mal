import { cache } from "react";
import type { Metadata } from "next";
import Link from "next/link";

import { auth } from "@/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FavoriteHorseButton } from "@/components/favorite-horse-button";
import { HorseMark } from "@/components/brand/logo";
import {
  coatBgHex,
  coatBodyHex,
  coatColorLabel,
  normalizeCharacteristics,
} from "@/lib/coat";
import { HorseTabs } from "@/components/horse-tabs";
import { isHorseFavorited } from "@/lib/favorite_horses";
import { query } from "@/lib/db";
import {
  getChildrenByParentNo,
  getHorseByNo,
  getPedigree,
  getRaceResultsForHorse,
  getSiblings,
  type Horse,
} from "@/lib/horses";
import {
  getLatestRating,
  getRatingHistory,
  type HorseRating,
  type HorseRatingPoint,
} from "@/lib/horse_ratings";
import {
  getHorseRankChanges,
} from "@/lib/horse_rank_changes";
import { RatingSparkline } from "@/components/rating-sparkline";
import { BreadcrumbJsonLd } from "@/components/seo/breadcrumb-jsonld";
import { getVideosForRaces, raceKey } from "@/lib/videos";

// generateMetadata 와 페이지 본체가 같은 horse_no 를 두 번 호출하므로 cache 로 한 번만 실행.
const fetchHorse = cache(getHorseByNo);

export async function generateMetadata(
  { params }: { params: Promise<{ horse_no: string }> },
): Promise<Metadata> {
  const { horse_no } = await params;
  const horse = await fetchHorse(horse_no);
  if (!horse) {
    return {
      title: `마필 ${horse_no} (정보 없음)`,
      description: "이 마필의 상세 데이터는 아직 수집되지 않았습니다.",
      robots: { index: false, follow: true },
      alternates: { canonical: `/horse/${horse_no}` },
    };
  }
  const stats = `통산 ${horse.total_race_count}전 ${horse.first_place_count}승`;
  const sex = horse.sex ?? "";
  const country = horse.country ?? "";
  const sire = horse.sire_name ?? "-";
  const dam = horse.dam_name ?? "-";
  const description = `${horse.horse_name} (${[country, sex].filter(Boolean).join("·")}) — ${stats}. 부 ${sire} / 모 ${dam}. 혈통·경주 기록·레이팅 추이.`;
  return {
    title: `${horse.horse_name} · 경주마 프로필`,
    description,
    alternates: { canonical: `/horse/${horse_no}` },
    openGraph: {
      type: "profile",
      title: `${horse.horse_name} · 경주마 프로필`,
      description,
      url: `/horse/${horse_no}`,
    },
  };
}

type JockeyMap = Record<string, string>;

async function buildJockeyMap(names: string[]): Promise<JockeyMap> {
  const unique = [...new Set(names.filter(Boolean))];
  if (unique.length === 0) return {};
  const placeholders = unique.map((_, i) => `$${i + 1}`).join(", ");
  const rows = await query<{ jk_name: string; jk_no: string }>(
    `SELECT jk_name, jk_no FROM jockeys WHERE jk_name IN (${placeholders})`,
    unique,
  );
  return Object.fromEntries(rows.map((r) => [r.jk_name, r.jk_no]));
}

export default async function HorseDetailPage({
  params,
}: {
  params: Promise<{ horse_no: string }>;
}) {
  const { horse_no } = await params;
  const horse = await fetchHorse(horse_no);
  if (!horse) {
    // 미수집 마필이라도 다른 horses 의 sire_no/dam_no 에 등록돼 있을 수 있다.
    // 자식 목록을 보여주면 stub 부모 노드 클릭 흐름이 의미를 가진다.
    const children = await getChildrenByParentNo(horse_no, 30);
    return (
      <main className="mx-auto w-full max-w-4xl px-6 py-12">
        <Link
          href="/"
          className="group mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground transition hover:text-primary"
        >
          <span className="transition group-hover:-translate-x-0.5">&larr;</span>
          메인으로
        </Link>
        <div className="mt-12 text-center">
          <p className="text-2xl font-bold">{horse_no}</p>
          <p className="mt-2 text-muted-foreground">
            이 말의 상세 데이터가 아직 수집되지 않았습니다.
          </p>
        </div>
        {children.length > 0 && (
          <div className="mt-12">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              이 마필을 부모로 둔 마필 ({children.length})
            </h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {children.map((c) => (
                <Link
                  key={c.horse_no}
                  href={`/horse/${c.horse_no}`}
                  className="group flex items-center gap-3 rounded-lg border bg-card p-3 transition hover:border-primary/50 hover:bg-accent/30"
                >
                  <HorseMark
                    size={36}
                    radius={6}
                    badgeFill={coatBgHex(c.coat_color)}
                    markFill={coatBodyHex(c.coat_color)}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium group-hover:text-primary">
                      {c.horse_name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {[c.country, c.sex, c.birth_date?.slice(0, 4)]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  {c.first_place_count > 0 && (
                    <Badge variant="secondary" className="shrink-0">
                      1착 {c.first_place_count}
                    </Badge>
                  )}
                </Link>
              ))}
            </div>
          </div>
        )}
      </main>
    );
  }

  const session = await auth();
  const userId = session?.user?.id ?? null;

  const [results, siblings, pedigree, rating, ratingHistory, rankChanges, favorited] = await Promise.all([
    getRaceResultsForHorse(horse_no, 10),
    getSiblings(horse.sire_name, horse_no),
    getPedigree(horse_no, 4),
    getLatestRating(horse_no),
    getRatingHistory(horse_no, 52),
    getHorseRankChanges(horse_no, 10),
    userId ? isHorseFavorited(userId, horse_no) : Promise.resolve(false),
  ]);

  const [jockeyMap, videoMap] = await Promise.all([
    buildJockeyMap(results.map((r) => r.jockey_name).filter((n): n is string => n !== null)),
    getVideosForRaces(results),
  ]);

  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-12">
      <BreadcrumbJsonLd
        items={[
          { name: "홈", url: "/" },
          { name: "마필", url: "/horses" },
          { name: horse.horse_name, url: `/horse/${horse_no}` },
        ]}
      />
      <Link
        href="/"
        className="group mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground transition hover:text-primary"
      >
        <span className="transition group-hover:-translate-x-0.5">&larr;</span>
        메인으로
      </Link>

      <ProfileCard
        horse={horse}
        rating={rating}
        ratingHistory={ratingHistory}
        favorited={favorited}
        loggedIn={!!userId}
      />

      <div className="mt-10">
        <HorseTabs
          horse={horse}
          results={results}
          jockeyMap={jockeyMap}
          videoEntries={[...videoMap.entries()].map(([k, v]) => [k, { video_id: v.video_id }])}
          rankChanges={rankChanges}
          pedigree={pedigree}
          siblings={siblings}
        />
      </div>
    </main>
  );
}

/* ── Profile Card ─────────────────────────────────────────── */

function ProfileCard({
  horse,
  rating,
  ratingHistory,
  favorited,
  loggedIn,
}: {
  horse: Horse;
  rating: HorseRating | null;
  ratingHistory: HorseRatingPoint[];
  favorited: boolean;
  loggedIn: boolean;
}) {
  const fields: Array<[string, React.ReactNode]> = [
    ["마번", <span className="font-mono" key="no">{horse.horse_no}</span>],
    ["성별", horse.sex ?? "-"],
    ["생년월일", horse.birth_date ?? "-"],
    ["산지", horse.country ?? "-"],
    ["모색", coatColorLabel(horse.coat_color) ?? "-"],
    [
      "마주",
      horse.owner_name && horse.ow_no ? (
        <Link
          key="ow"
          href={`/owner/${horse.ow_no}`}
          className="text-primary hover:underline"
        >
          {horse.owner_name}
        </Link>
      ) : (
        (horse.owner_name ?? horse.ow_no ?? "-")
      ),
    ],
    [
      "통산 출전",
      <span key="rc">
        {horse.total_race_count}
        <span className="text-muted-foreground">회</span>
      </span>,
    ],
    [
      "통산 1착",
      <span key="w">
        <span className="text-primary">{horse.first_place_count}</span>
        <span className="text-muted-foreground">회</span>
      </span>,
    ],
    [
      "레이팅",
      rating?.rating4 != null ? (
        <span key="r" className="font-mono tabular-nums">
          {rating.rating4}
          {rating.rating1 != null && rating.rating1 !== rating.rating4 && (
            <span className="ml-1 text-xs text-muted-foreground">
              ({rating.rating1} → {rating.rating2} → {rating.rating3} → {rating.rating4})
            </span>
          )}
        </span>
      ) : (
        "-"
      ),
    ],
  ];

  const characteristics = normalizeCharacteristics(horse.characteristics);

  const hasRatingTrend = ratingHistory.filter((p) => p.rating4 !== null).length >= 2;

  return (
    <Card className="relative">
      <FavoriteHorseButton
        horseNo={horse.horse_no}
        initialFavorited={favorited}
        loggedIn={loggedIn}
        className="absolute right-3 top-3"
      />
      <CardHeader className="pb-2">
        <div className="flex items-start gap-4 pr-10">
          <HorseMark
            size={96}
            radius={12}
            badgeFill={coatBgHex(horse.coat_color)}
            markFill={coatBodyHex(horse.coat_color)}
          />
          <div className="min-w-0 flex-1">
            <CardTitle className="text-4xl font-bold tracking-tight">
              {horse.horse_name}
            </CardTitle>
          </div>
          {hasRatingTrend && (
            <div className="hidden shrink-0 sm:block">
              <div className="mb-1 text-right text-[10px] uppercase tracking-wider text-muted-foreground">
                레이팅 추이
              </div>
              <RatingSparkline points={ratingHistory} />
            </div>
          )}
        </div>
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
        {hasRatingTrend && (
          <div className="mt-5 border-t pt-4 sm:hidden">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">
              레이팅 추이
            </div>
            <div className="mt-2">
              <RatingSparkline points={ratingHistory} />
            </div>
          </div>
        )}
        {characteristics.length > 0 && (
          <div className="mt-5 border-t pt-4">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">
              특징
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {characteristics.map((c) => (
                <Badge key={c} variant="secondary" className="font-normal">
                  {c}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
