import Link from "next/link";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  HorseAvatar,
  coatColorLabel,
  normalizeCharacteristics,
} from "@/components/horse-avatar";
import { HorseTabs } from "@/components/horse-tabs";
import { query } from "@/lib/db";
import {
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
import { getVideosForRaces, raceKey } from "@/lib/videos";

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
  const horse = await getHorseByNo(horse_no);
  if (!horse) {
    return (
      <main className="mx-auto w-full max-w-4xl px-6 py-12">
        <Link
          href="/"
          className="group mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground transition hover:text-primary"
        >
          <span className="transition group-hover:-translate-x-0.5">&larr;</span>
          메인으로
        </Link>
        <div className="mt-20 text-center">
          <p className="text-2xl font-bold">{horse_no}</p>
          <p className="mt-2 text-muted-foreground">이 말의 상세 데이터가 아직 수집되지 않았습니다.</p>
        </div>
      </main>
    );
  }

  const [results, siblings, pedigree, rating, ratingHistory, rankChanges] = await Promise.all([
    getRaceResultsForHorse(horse_no, 10),
    getSiblings(horse.sire_name, horse_no),
    getPedigree(horse_no, 4),
    getLatestRating(horse_no),
    getRatingHistory(horse_no, 52),
    getHorseRankChanges(horse_no, 10),
  ]);

  const [jockeyMap, videoMap] = await Promise.all([
    buildJockeyMap(results.map((r) => r.jockey_name).filter((n): n is string => n !== null)),
    getVideosForRaces(results),
  ]);

  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-12">
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
}: {
  horse: Horse;
  rating: HorseRating | null;
  ratingHistory: HorseRatingPoint[];
}) {
  const fields: Array<[string, React.ReactNode]> = [
    ["마번", <span className="font-mono" key="no">{horse.horse_no}</span>],
    ["성별", horse.sex ?? "-"],
    ["생년월일", horse.birth_date ?? "-"],
    ["산지", horse.country ?? "-"],
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

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-start gap-4">
          <HorseAvatar
            coatColor={horse.coat_color}
            characteristics={horse.characteristics}
            size={96}
          />
          <div>
            <CardTitle className="text-4xl font-bold tracking-tight">
              {horse.horse_name}
            </CardTitle>
            {coatColorLabel(horse.coat_color) && (
              <p className="mt-0.5 text-sm text-muted-foreground">
                모색: {coatColorLabel(horse.coat_color)}
              </p>
            )}
          </div>
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
        {ratingHistory.filter((p) => p.rating4 !== null).length >= 2 && (
          <div className="mt-5 border-t pt-4">
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
