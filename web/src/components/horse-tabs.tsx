"use client";

import { useState } from "react";
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
import { youtubeWatchUrl } from "@/lib/video-helpers";

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

const TABS = [
  { id: "races" as const, label: "경주 기록" },
  { id: "pedigree" as const, label: "혈통 & 가족" },
];

export function HorseTabs({
  horse,
  results,
  jockeyMap,
  videoEntries,
  rankChanges,
  pedigree,
  siblings,
}: HorseTabsProps) {
  const [tab, setTab] = useState<"races" | "pedigree">("races");
  const videoMap = new Map<RaceKey, { video_id: string }>(videoEntries);

  return (
    <div>
      {/* Tab bar */}
      <div className="flex border-b">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-5 py-3 text-sm font-medium transition-colors ${
              tab === t.id
                ? "border-b-2 border-primary text-primary"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab: 경주 기록 */}
      {tab === "races" && (
        <div className="mt-8 space-y-10">
          <RaceResultsSection results={results} jockeyMap={jockeyMap} videoMap={videoMap} />
          {rankChanges.length > 0 && <RankChangesSection changes={rankChanges} />}
        </div>
      )}

      {/* Tab: 혈통 & 가족 */}
      {tab === "pedigree" && (
        <div className="mt-8">
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
      )}
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
                <TableHead className="w-8"></TableHead>
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
                    <TableCell>
                      {video && (
                        <a
                          href={youtubeWatchUrl(video.video_id)}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label="YouTube에서 경주 영상 보기"
                          className="inline-flex items-center justify-center text-[#FF0000] opacity-70 transition hover:opacity-100"
                        >
                          <YoutubeIcon />
                        </a>
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

function YoutubeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
    </svg>
  );
}
