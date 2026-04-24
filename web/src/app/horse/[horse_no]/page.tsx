import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
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
  HorseAvatar,
  coatColorLabel,
  normalizeCharacteristics,
} from "@/components/horse-avatar";
import { PedigreeDialog } from "@/components/pedigree-dialog";
import { query } from "@/lib/db";
import {
  getHorseByNo,
  getPedigree,
  getRaceResultsForHorse,
  getSiblings,
  type Horse,
  type PedigreeNode,
  type RaceResult,
} from "@/lib/horses";
import {
  getLatestRating,
  getRatingHistory,
  type HorseRating,
  type HorseRatingPoint,
} from "@/lib/horse_ratings";
import {
  getHorseRankChanges,
  type HorseRankChange,
} from "@/lib/horse_rank_changes";
import { RatingSparkline } from "@/components/rating-sparkline";

type JockeyMap = Record<string, string>; // jk_name → jk_no

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
  if (!horse) notFound();

  const [results, siblings, pedigree, rating, ratingHistory, rankChanges] = await Promise.all([
    getRaceResultsForHorse(horse_no, 10),
    getSiblings(horse.sire_name, horse_no),
    getPedigree(horse_no, 4),
    getLatestRating(horse_no),
    getRatingHistory(horse_no, 52),
    getHorseRankChanges(horse_no, 10),
  ]);

  const jockeyMap = await buildJockeyMap(
    results.map((r) => r.jockey_name).filter((n): n is string => n !== null),
  );

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
        pedigree={pedigree}
        rating={rating}
        ratingHistory={ratingHistory}
      />

      <section className="mt-10">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          최근 경주 기록
        </h2>
        <RaceResultsTable results={results} jockeyMap={jockeyMap} />
      </section>

      {rankChanges.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            등급변동 이력
          </h2>
          <RankChangesTable changes={rankChanges} />
        </section>
      )}

      {siblings.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            형제마{" "}
            <Badge variant="outline" className="ml-1 font-normal">
              父 {horse.sire_name}
            </Badge>
          </h2>
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {siblings.map((s) => (
              <li key={s.horse_no}>
                <Link href={`/horse/${s.horse_no}`}>
                  <Card className="transition hover:border-primary/40 hover:shadow-sm">
                    <CardContent className="p-3">
                      <div className="font-medium">{s.horse_name}</div>
                      <div className="text-xs text-muted-foreground">
                        {s.sex} · {s.birth_date}
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

/* ── Profile Card ─────────────────────────────────────── */

function ProfileCard({
  horse,
  pedigree,
  rating,
  ratingHistory,
}: {
  horse: Horse;
  pedigree: PedigreeNode | null;
  rating: HorseRating | null;
  ratingHistory: HorseRatingPoint[];
}) {
  const fields: Array<[string, React.ReactNode]> = [
    ["마번", <span className="font-mono" key="no">{horse.horse_no}</span>],
    ["성별", horse.sex ?? "-"],
    ["생년월일", horse.birth_date ?? "-"],
    ["산지", horse.country ?? "-"],
    ["父마", horse.sire_name ?? "-"],
    ["母마", horse.dam_name ?? "-"],
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
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-4">
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
          {pedigree && (
            <PedigreeDialog data={pedigree} rootName={horse.horse_name} />
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

/* ── Race Results Table ───────────────────────────────── */

function RaceResultsTable({
  results,
  jockeyMap,
}: {
  results: RaceResult[];
  jockeyMap: JockeyMap;
}) {
  if (results.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          경주 기록이 아직 적재되지 않았습니다.
          <br />
          <span className="text-xs">
            경주성적정보 API 활용신청 후{" "}
            <code className="rounded bg-muted px-1">crawler</code> 의
            race-result 수집 잡을 실행하세요.
          </span>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>일자</TableHead>
            <TableHead>경마장</TableHead>
            <TableHead className="text-right">경주</TableHead>
            <TableHead className="text-right">착순</TableHead>
            <TableHead className="text-right">기록</TableHead>
            <TableHead className="text-right">마체중</TableHead>
            <TableHead>기수</TableHead>
            <TableHead>조교사</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {results.map((r) => {
            const raceHref =
              r.race_date && r.meet && r.race_no
                ? `/races?date=${r.race_date}&venue=${encodeURIComponent(r.meet)}&race=${r.race_no}`
                : null;
            return (
            <TableRow key={r.id}>
              <TableCell className="font-mono text-xs">{r.race_date}</TableCell>
              <TableCell>{r.meet ?? "-"}</TableCell>
              <TableCell className="text-right">
                {raceHref ? (
                  <Link href={raceHref} className="text-primary hover:underline">
                    {r.race_no}R
                  </Link>
                ) : (
                  `${r.race_no}R`
                )}
              </TableCell>
              <TableCell className="text-right font-semibold">
                <RankBadge rank={r.rank} />
              </TableCell>
              <TableCell className="text-right font-mono tabular-nums">
                {r.record_time ?? "-"}
              </TableCell>
              <TableCell className="text-right font-mono tabular-nums">
                {r.weight ?? "-"}
              </TableCell>
              <TableCell>
                {r.jockey_name ? (
                  jockeyMap[r.jockey_name] ? (
                    <Link
                      href={`/jockey/${jockeyMap[r.jockey_name]}`}
                      className="text-primary hover:underline"
                    >
                      {r.jockey_name}
                    </Link>
                  ) : (
                    r.jockey_name
                  )
                ) : (
                  "-"
                )}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {r.trainer_name ? (
                  r.trainer_no ? (
                    <Link
                      href={`/trainer/${r.trainer_no}`}
                      className="text-primary hover:underline"
                    >
                      {r.trainer_name}
                    </Link>
                  ) : (
                    r.trainer_name
                  )
                ) : (
                  "-"
                )}
              </TableCell>
            </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Card>
  );
}

function RankBadge({ rank }: { rank: number | null }) {
  if (rank === null) return <span className="text-muted-foreground">-</span>;
  if (rank === 1)
    return <Badge className="bg-primary text-primary-foreground">1</Badge>;
  if (rank <= 3) return <Badge variant="secondary">{rank}</Badge>;
  return <span>{rank}</span>;
}

/* ── Rank Changes Table ───────────────────────────────── */

function RankChangesTable({ changes }: { changes: HorseRankChange[] }) {
  return (
    <Card>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>적용일</TableHead>
            <TableHead>이전 등급</TableHead>
            <TableHead></TableHead>
            <TableHead>변경 등급</TableHead>
            <TableHead className="text-muted-foreground">혈통</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {changes.map((c) => (
            <TableRow key={c.st_date}>
              <TableCell className="font-mono text-xs">{c.st_date}</TableCell>
              <TableCell>
                {c.before_rank ? (
                  <Badge variant="outline" className="font-normal">
                    {c.before_rank}
                  </Badge>
                ) : (
                  <span className="text-muted-foreground">-</span>
                )}
              </TableCell>
              <TableCell className="text-muted-foreground">→</TableCell>
              <TableCell>
                {c.after_rank ? (
                  <Badge variant="secondary" className="font-normal">
                    {c.after_rank}
                  </Badge>
                ) : (
                  <span className="text-muted-foreground">-</span>
                )}
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {c.blood ?? "-"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}
