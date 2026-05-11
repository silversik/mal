import { cache } from "react";
import type { Metadata } from "next";
import Link from "next/link";

import { auth } from "@/auth";
import { Card, CardContent } from "@/components/ui/card";
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
import { HorseFormBreakdown } from "@/components/horse-form-breakdown";
import { RecentFormStrip } from "@/components/recent-form-strip";
import { MsfSparkline } from "@/components/msf-sparkline";
import { PedigreeAptitude } from "@/components/pedigree-aptitude";
import { InlineRatingChart } from "@/components/inline-rating-chart";
import {
  BreadCrumb,
  MetaTile,
  ProfileTag,
  IconCalendar,
  IconCrown,
  IconFlag,
  IconHash,
  IconHorseshoe,
  IconTrend,
  IconUser,
  IconUserPlus,
} from "@/components/profile-ui";
import { StatsBar } from "@/components/stats-bar";
import { generateHorseComment } from "@/lib/horse_comment";
import { isHorseFavorited } from "@/lib/favorite_horses";
import { query } from "@/lib/db";
import {
  getChildrenByParentNo,
  getHorseByNo,
  getHorseFormBreakdown,
  getHorseRankAggregate,
  getMsfHistory,
  getParentChildAggregate,
  getPedigree,
  getRaceResultsWithMsf,
  getRecentFinishes,
  getSiblings,
  type Horse,
  type PedigreeNode,
} from "@/lib/horses";
import { PedigreeDialog } from "@/components/pedigree-dialog";
import type { PedigreeInput } from "@/components/pedigree-tree";
import { getTrainerNoMap } from "@/lib/trainers";
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

  const [
    results,
    siblings,
    pedigree,
    rating,
    ratingHistory,
    rankChanges,
    favorited,
    formBreakdown,
    recentFinishes,
    msfHistory,
    sireAgg,
    damAgg,
    rankAgg,
  ] = await Promise.all([
    getRaceResultsWithMsf(horse_no, 10),
    getSiblings(horse.sire_name, horse_no),
    getPedigree(horse_no, 4),
    getLatestRating(horse_no),
    getRatingHistory(horse_no, 52),
    getHorseRankChanges(horse_no, 10),
    userId ? isHorseFavorited(userId, horse_no) : Promise.resolve(false),
    getHorseFormBreakdown(horse_no),
    getRecentFinishes(horse_no, 5),
    getMsfHistory(horse_no, 20),
    horse.sire_no ? getParentChildAggregate(horse.sire_no) : Promise.resolve(null),
    horse.dam_no ? getParentChildAggregate(horse.dam_no) : Promise.resolve(null),
    getHorseRankAggregate(horse_no),
  ]);

  // 마지막 trainer 는 가장 최근 경주의 trainer_name 으로 (horses 테이블엔 컬럼 없음).
  const trainerName =
    results.find((r) => r.trainer_name)?.trainer_name ?? null;

  const [jockeyMap, videoMap, trainerNoMap] = await Promise.all([
    buildJockeyMap(results.map((r) => r.jockey_name).filter((n): n is string => n !== null)),
    getVideosForRaces(results),
    trainerName ? getTrainerNoMap([trainerName]) : Promise.resolve<Record<string, string>>({}),
  ]);

  const trainerNo = trainerName ? trainerNoMap[trainerName] ?? null : null;

  // AI 코멘트에 쓰는 최고 mal지수.
  const bestMsf = msfHistory.length > 0
    ? Math.max(...msfHistory.map((p) => p.msf))
    : null;

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-5 md:px-6 md:py-6">
      <BreadcrumbJsonLd
        items={[
          { name: "홈", url: "/" },
          { name: "마필", url: "/horses" },
          { name: horse.horse_name, url: `/horse/${horse_no}` },
        ]}
      />

      <BreadCrumb
        items={[
          { label: "홈", href: "/" },
          { label: "마필", href: "/horses" },
          { label: horse.horse_name },
        ]}
      />

      <ProfileCard
        horse={horse}
        rating={rating}
        ratingHistory={ratingHistory}
        favorited={favorited}
        loggedIn={!!userId}
        trainerName={trainerName}
        trainerNo={trainerNo}
        rankAgg={rankAgg}
        pedigree={pedigree}
      />

      <div className="mt-5 grid gap-5 md:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0">
          <AutoCommentBlock
            comment={generateHorseComment({
              horse_name: horse.horse_name,
              total_race_count: horse.total_race_count,
              first_place_count: horse.first_place_count,
              recent_finishes: recentFinishes,
              avg_msf: msfHistory.length > 0
                ? msfHistory.reduce((s, p) => s + p.msf, 0) / msfHistory.length
                : null,
              best_msf: bestMsf,
              form: formBreakdown,
              sire_aggregate: sireAgg ? {
                parent_name: sireAgg.parent_name,
                win_rate: sireAgg.win_rate,
                total_children: sireAgg.total_children,
              } : null,
            })}
          />
          <div className="mt-5">
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

          <div className="mt-6">
            <HorseFormBreakdown data={formBreakdown} />
          </div>

          {(sireAgg || damAgg) && (
            <div className="mt-6">
              <PedigreeAptitude sire={sireAgg} dam={damAgg} />
            </div>
          )}
        </div>

        <aside className="flex flex-col gap-3">
          {recentFinishes.length > 0 && (
            <Card>
              <CardContent className="p-3">
                <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  최근 폼
                </h3>
                <RecentFormStrip finishes={recentFinishes} />
              </CardContent>
            </Card>
          )}
          {msfHistory.length >= 2 && (
            <Card>
              <CardContent className="p-3">
                <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  mal지수 추세
                </h3>
                <MsfSparkline points={msfHistory} width={260} height={56} />
              </CardContent>
            </Card>
          )}
        </aside>
      </div>
    </main>
  );
}

/* ── 자동 코멘트 (룰베이스) ─────────────────────────────── */

function AutoCommentBlock({ comment }: { comment: string }) {
  return (
    <div className="mt-4 rounded-md border border-primary/10 bg-primary/[0.02] px-4 py-3">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">
          ai
        </span>
        <p className="text-sm leading-relaxed text-foreground">{comment}</p>
      </div>
    </div>
  );
}

/* ── Profile Card ─────────────────────────────────────────── */

function ProfileCard({
  horse,
  rating,
  ratingHistory,
  favorited,
  loggedIn,
  trainerName,
  trainerNo,
  rankAgg,
  pedigree,
}: {
  horse: Horse;
  rating: HorseRating | null;
  ratingHistory: HorseRatingPoint[];
  favorited: boolean;
  loggedIn: boolean;
  trainerName: string | null;
  trainerNo: string | null;
  rankAgg: { total: number; win: number; place: number; show: number };
  pedigree: PedigreeNode | null;
}) {
  const hasRatingTrend = ratingHistory.filter((p) => p.rating4 !== null).length >= 2;
  const characteristics = normalizeCharacteristics(horse.characteristics);

  const sex = (horse.sex ?? "").trim();
  const ageYear = horse.birth_date ? new Date().getFullYear() - Number(horse.birth_date.slice(0, 4)) : null;

  return (
    <Card className="royal-card relative">
      <FavoriteHorseButton
        horseNo={horse.horse_no}
        initialFavorited={favorited}
        loggedIn={loggedIn}
        className="absolute right-3 top-3"
      />
      <CardContent className="p-4">
        {/* 헤더: 마크 · 이름/태그/메타 · ⭐ 자리 */}
        <div className="flex items-start gap-3 pr-12">
          <HorseMark
            size={64}
            radius={10}
            badgeFill={coatBgHex(horse.coat_color)}
            markFill={coatBodyHex(horse.coat_color)}
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              {rating?.rating4 != null && (
                <ProfileTag tone="navy" icon={<IconTrend size={11} />}>
                  레이팅 {rating.rating4}
                </ProfileTag>
              )}
              {coatColorLabel(horse.coat_color) && (
                <ProfileTag tone="gold" icon={<IconCrown size={11} />}>
                  {coatColorLabel(horse.coat_color)}
                </ProfileTag>
              )}
            </div>
            <h1 className="mt-0.5 text-2xl font-extrabold leading-tight tracking-tight sm:text-3xl">
              {horse.horse_name}
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              {sex && (
                <span className="inline-flex items-center gap-1">
                  <SexBadge sex={horse.sex} />
                  {sex.startsWith("거")
                    ? "거세"
                    : sex.startsWith("암")
                      ? "암말"
                      : sex.startsWith("수")
                        ? "수말"
                        : sex}
                </span>
              )}
              <Sep />
              {ageYear != null && (
                <span className="inline-flex items-center gap-1">
                  <IconCalendar size={12} />
                  {ageYear}세 · {horse.birth_date}
                </span>
              )}
              <Sep />
              <span className="inline-flex items-center gap-1">
                <IconFlag size={12} />
                {horse.country ?? "-"}
              </span>
              <Sep />
              <span className="inline-flex items-center gap-1 font-mono">
                <IconHash size={12} />
                {horse.horse_no}
              </span>
            </div>
          </div>
        </div>

        {/* 통산 성적 stacked bar */}
        <div className="mt-3">
          <StatsBar
            total={Math.max(rankAgg.total, horse.total_race_count)}
            win={rankAgg.win || horse.first_place_count}
            place={rankAgg.place}
            show={rankAgg.show}
          />
        </div>

        {/* 메타 + sparkline 그리드 */}
        <div className="mt-3 grid gap-2.5 sm:grid-cols-[1fr_280px]">
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-3 self-start">
            <MetaTile
              icon={<IconUser size={14} />}
              label="마주"
              value={
                horse.owner_name && horse.ow_no ? (
                  <Link href={`/owner/${horse.ow_no}`} className="hover:underline">
                    {horse.owner_name}
                  </Link>
                ) : (
                  (horse.owner_name ?? horse.ow_no ?? "-")
                )
              }
            />
            <MetaTile
              icon={<IconUserPlus size={14} />}
              label="조교사"
              value={
                trainerName && trainerNo ? (
                  <Link href={`/trainer/${trainerNo}`} className="hover:underline">
                    {trainerName}
                  </Link>
                ) : (
                  (trainerName ?? "-")
                )
              }
            />
            <MetaTile
              icon={<IconHorseshoe size={14} />}
              label="부 / 모"
              value={<SireDamValue horse={horse} pedigree={pedigree} />}
            />
          </div>
          {hasRatingTrend && (
            <InlineRatingChart points={ratingHistory} width={280} />
          )}
        </div>

        {characteristics.length > 0 && (
          <div className="mt-2.5 flex flex-wrap items-center gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              특징
            </span>
            {characteristics.map((c) => (
              <Badge key={c} variant="secondary" className="font-normal text-[11px]">
                {c}
              </Badge>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Sep() {
  return <span className="h-2.5 w-px bg-border" aria-hidden />;
}

/**
 * "부 / 모" MetaTile 값 — 각 부모를 마필 페이지 링크로,
 * pedigree 데이터가 있으면 우측에 작은 "족보" 버튼(다이얼로그).
 */
function SireDamValue({
  horse,
  pedigree,
}: {
  horse: Horse;
  pedigree: PedigreeNode | null;
}) {
  const sireNode = horse.sire_name ? (
    horse.sire_no ? (
      <Link href={`/horse/${horse.sire_no}`} className="hover:underline">
        {horse.sire_name}
      </Link>
    ) : (
      <span>{horse.sire_name}</span>
    )
  ) : (
    <span className="text-muted-foreground">-</span>
  );

  const damNode = horse.dam_name ? (
    horse.dam_no ? (
      <Link href={`/horse/${horse.dam_no}`} className="hover:underline">
        {horse.dam_name}
      </Link>
    ) : (
      <span>{horse.dam_name}</span>
    )
  ) : (
    <span className="text-muted-foreground">-</span>
  );

  return (
    <span className="flex items-center gap-1.5">
      <span className="truncate">
        {sireNode}
        <span className="mx-1 text-muted-foreground">/</span>
        {damNode}
      </span>
      {pedigree && (
        <PedigreeDialog
          data={pedigree as unknown as PedigreeInput}
          rootName={horse.horse_name}
        />
      )}
    </span>
  );
}

/* ── Sex 표시 ─────────────────────────────────────────────── */
// "수" → ♂(파랑), "암" → ♀(분홍), "거" → ♂(파랑) + (거).
// horse.sex 는 "수4", "암3", "거6" 처럼 연령이 붙는 케이스도 있어 startsWith 비교.
function SexBadge({ sex }: { sex: string | null }) {
  if (!sex) return <span className="text-muted-foreground">-</span>;
  const s = sex.trim();
  if (s.startsWith("거")) {
    return (
      <span className="inline-flex items-center gap-1">
        <span aria-label="수말 (거세)" className="text-lg leading-none text-blue-500">♂</span>
        <span className="text-xs text-muted-foreground">(거)</span>
      </span>
    );
  }
  if (s.startsWith("수")) {
    return <span aria-label="수말" className="text-lg leading-none text-blue-500">♂</span>;
  }
  if (s.startsWith("암")) {
    return <span aria-label="암말" className="text-lg leading-none text-pink-500">♀</span>;
  }
  return <span>{s}</span>;
}
