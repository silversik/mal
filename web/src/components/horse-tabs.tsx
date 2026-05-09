"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { FamilyTreeDiagram, type FamNode } from "@/components/family-tree-diagram";
import type { PedigreeNode } from "@/lib/horses";
import type { RaceResult, Horse } from "@/lib/horses";
import type { HorseRankChange } from "@/lib/horse_rank_changes";

type JockeyMap = Record<string, string>;
type RaceKey = string;

interface HorseTabsProps {
  horse: Horse;
  results: RaceResult[];
  jockeyMap: JockeyMap;
  videoEntries: [RaceKey, { video_id: string }][];
  rankChanges: HorseRankChange[];
  pedigree: PedigreeNode | null;
  siblings: Horse[];
}

export function HorseTabs({
  horse,
  results,
  jockeyMap,
  videoEntries,
  rankChanges,
  pedigree,
  siblings,
}: HorseTabsProps) {
  const videoMap = new Map<RaceKey, { video_id: string }>(videoEntries);

  return (
    <div className="space-y-10">
      <div>
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          가족 관계
        </h2>
        <FamilyTreeDiagram
          current={horseToFamNode(horse, true)}
          sire={pedigree?.sire  ? pedToFamNode(pedigree.sire)  : null}
          dam={pedigree?.dam   ? pedToFamNode(pedigree.dam)   : null}
          sire_sire={pedigree?.sire?.sire ? pedToFamNode(pedigree.sire.sire) : null}
          sire_dam={pedigree?.sire?.dam  ? pedToFamNode(pedigree.sire.dam)  : null}
          dam_sire={pedigree?.dam?.sire  ? pedToFamNode(pedigree.dam.sire)  : null}
          dam_dam={pedigree?.dam?.dam   ? pedToFamNode(pedigree.dam.dam)   : null}
          siblings={siblings.map(sibToFamNode)}
        />
      </div>
      <RaceResultsSection
        results={results}
        jockeyMap={jockeyMap}
        videoMap={videoMap}
      />
      {rankChanges.length > 0 && <RankChangesSection changes={rankChanges} />}
    </div>
  );
}

/* ── Data converters ─────────────────────────────────────── */

function pedToFamNode(n: PedigreeNode): FamNode {
  return {
    id: n.horse_no ?? n.id,
    horse_no: n.horse_no,
    name: n.name,
    gender: n.gender,
    birthYear: n.birthYear,
    country: n.country,
  };
}

function horseToFamNode(h: Horse, isCurrent = false): FamNode {
  return {
    id: h.horse_no,
    horse_no: h.horse_no,
    name: h.horse_name,
    gender: sexToGender(h.sex),
    birthYear: h.birth_date?.slice(0, 4) ?? null,
    country: h.country,
    dam_name: h.dam_name,
    isCurrent,
  };
}

function sibToFamNode(h: Horse): FamNode {
  return horseToFamNode(h, false);
}

function sexToGender(sex: string | null): FamNode["gender"] {
  if (!sex) return "Unknown";
  if (sex.startsWith("수") || sex.startsWith("거")) return "Male";
  if (sex.startsWith("암")) return "Female";
  return "Unknown";
}

/* ── 경주 기록 ──────────────────────────────────────────── */

function RaceResultsSection({
  results,
  jockeyMap,
  videoMap,
}: {
  results: RaceResult[];
  jockeyMap: JockeyMap;
  videoMap: Map<RaceKey, { video_id: string }>;
}) {
  return (
    <section>
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        최근 경주 기록
      </h2>
      {results.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            경주 기록이 아직 적재되지 않았습니다.
          </CardContent>
        </Card>
      ) : (
        <Card className="py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[88px]">영상</TableHead>
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
                const key =
                  r.race_date && r.meet && r.race_no
                    ? `${r.race_date}|${r.meet}|${r.race_no}`
                    : null;
                const video = key ? videoMap.get(key) : null;
                return (
                  <TableRow key={r.id}>
                    <TableCell className="py-1.5">
                      {raceHref ? (
                        <Link
                          href={raceHref}
                          aria-label={`${r.race_date ?? ""} ${r.meet ?? ""} ${r.race_no ?? ""}R 경주 페이지로 이동`}
                          title={`${r.race_date ?? ""} ${r.meet ?? ""} ${r.race_no ?? ""}R`}
                          className="group relative block h-[45px] w-20 overflow-hidden rounded bg-muted transition hover:opacity-90"
                        >
                          {video ? (
                            <>
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={`https://i.ytimg.com/vi/${video.video_id}/mqdefault.jpg`}
                                alt=""
                                loading="lazy"
                                className="h-full w-full object-cover"
                              />
                              <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
                                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#FF0000] text-white opacity-90 transition group-hover:opacity-100">
                                  <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                                    <path d="M8 5v14l11-7z" />
                                  </svg>
                                </span>
                              </span>
                            </>
                          ) : (
                            <span className="flex h-full w-full items-center justify-center text-[10px] font-medium text-muted-foreground/60">
                              경주 보기 →
                            </span>
                          )}
                        </Link>
                      ) : null}
                    </TableCell>
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
      )}
    </section>
  );
}

/* ── 등급변동 ────────────────────────────────────────────── */

function RankChangesSection({ changes }: { changes: HorseRankChange[] }) {
  return (
    <section>
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        등급변동 이력
      </h2>
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
    </section>
  );
}

/* ── Helpers ─────────────────────────────────────────────── */

function RankBadge({ rank }: { rank: number | null }) {
  if (rank === null) return <span className="text-muted-foreground">-</span>;
  if (rank === 1) return <Badge className="bg-primary text-primary-foreground">1</Badge>;
  if (rank <= 3) return <Badge variant="secondary">{rank}</Badge>;
  return <span>{rank}</span>;
}

