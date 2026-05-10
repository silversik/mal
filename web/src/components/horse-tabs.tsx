"use client";

import { useEffect, useState } from "react";
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
import type { PedigreeNode, RaceWithMsf } from "@/lib/horses";
import type { Horse } from "@/lib/horses";
import type { HorseRankChange } from "@/lib/horse_rank_changes";

type JockeyMap = Record<string, string>;
type RaceKey = string;

interface HorseTabsProps {
  horse: Horse;
  results: RaceWithMsf[];
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

  const treeProps = {
    current: horseToFamNode(horse, true),
    sire: pedigree?.sire ? pedToFamNode(pedigree.sire) : null,
    dam: pedigree?.dam ? pedToFamNode(pedigree.dam) : null,
    sire_sire: pedigree?.sire?.sire ? pedToFamNode(pedigree.sire.sire) : null,
    sire_dam: pedigree?.sire?.dam ? pedToFamNode(pedigree.sire.dam) : null,
    dam_sire: pedigree?.dam?.sire ? pedToFamNode(pedigree.dam.sire) : null,
    dam_dam: pedigree?.dam?.dam ? pedToFamNode(pedigree.dam.dam) : null,
    siblings: siblings.map(sibToFamNode),
  } as const;

  return (
    <div className="space-y-10">
      <PedigreeSection treeProps={treeProps} />
      <RaceWithMsfsSection
        results={results}
        jockeyMap={jockeyMap}
        videoMap={videoMap}
      />
      {rankChanges.length > 0 && <RankChangesSection changes={rankChanges} />}
    </div>
  );
}

/* ── 족보 ──────────────────────────────────────────────── */

function PedigreeSection({
  treeProps,
}: {
  treeProps: React.ComponentProps<typeof FamilyTreeDiagram>;
}) {
  const [expanded, setExpanded] = useState(false);

  // Esc 로 모달 닫기 + 모달 열려 있는 동안 body 스크롤 차단.
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(false);
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [expanded]);

  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          족보
        </h2>
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-semibold text-foreground transition hover:border-primary/40 hover:bg-accent"
        >
          <ExpandIcon />
          크게 보기
        </button>
      </div>
      <FamilyTreeDiagram {...treeProps} />

      {expanded && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 sm:p-8"
          onClick={(e) => {
            if (e.target === e.currentTarget) setExpanded(false);
          }}
        >
          <div className="relative max-h-[92vh] w-full max-w-6xl overflow-auto rounded-xl bg-white shadow-2xl">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-white px-4 py-3">
              <h3 className="text-sm font-semibold">족보 (크게 보기)</h3>
              <button
                type="button"
                onClick={() => setExpanded(false)}
                aria-label="닫기"
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground"
              >
                <CloseIcon />
              </button>
            </div>
            <div className="p-4">
              <FamilyTreeDiagram {...treeProps} responsive />
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function ExpandIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="15 3 21 3 21 9" />
      <polyline points="9 21 3 21 3 15" />
      <line x1="21" y1="3" x2="14" y2="10" />
      <line x1="3" y1="21" x2="10" y2="14" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
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

function RaceWithMsfsSection({
  results,
  jockeyMap,
  videoMap,
}: {
  results: RaceWithMsf[];
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
                <TableHead className="w-[88px] text-center">영상</TableHead>
                <TableHead className="text-center">경마장</TableHead>
                <TableHead className="text-center">경주</TableHead>
                <TableHead className="text-center">착순</TableHead>
                <TableHead className="text-center">기록</TableHead>
                <TableHead className="text-center" title="mal지수 — 같은 경주 1착 기록 대비 % (100=1착)">
                  mal지수
                </TableHead>
                <TableHead className="text-center">마체중</TableHead>
                <TableHead className="text-center">기수</TableHead>
                <TableHead className="text-center">조교사</TableHead>
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
                    <TableCell className="py-1.5 text-center">
                      {raceHref ? (
                        <Link
                          href={raceHref}
                          aria-label={`${r.race_date ?? ""} ${r.meet ?? ""} ${r.race_no ?? ""}R 경주 페이지로 이동`}
                          title={`${r.race_date ?? ""} ${r.meet ?? ""} ${r.race_no ?? ""}R`}
                          className="group relative mx-auto block h-[45px] w-20 overflow-hidden rounded bg-muted transition hover:opacity-90"
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
                    <TableCell className="text-center">{r.meet ?? "-"}</TableCell>
                    <TableCell className="text-center">
                      {raceHref ? (
                        <Link href={raceHref} className="text-primary hover:underline">
                          {r.race_no}R
                        </Link>
                      ) : (
                        `${r.race_no}R`
                      )}
                    </TableCell>
                    <TableCell className="text-center font-semibold">
                      <RankBadge rank={r.rank} />
                    </TableCell>
                    <TableCell className="text-center font-mono tabular-nums">
                      {r.record_time ?? "-"}
                    </TableCell>
                    <TableCell className="text-center font-mono tabular-nums">
                      <MsfCell msf={r.msf} />
                    </TableCell>
                    <TableCell className="text-center font-mono tabular-nums">
                      {r.weight ?? "-"}
                    </TableCell>
                    <TableCell className="text-center">
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
                    <TableCell className="text-center text-muted-foreground">
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

// 1·2·3위는 홈의 "TOP 기수 랭킹" 메달과 동일한 금/은/동 원형 배지로 통일.
const RANK_MEDAL_STYLE: Record<number, string> = {
  1: "bg-champagne-gold text-primary",
  2: "bg-slate-400 text-white",
  3: "bg-amber-700 text-white",
};

/**
 * mal지수 (MSF) 셀.
 * 100=1착(금), 95~99=정상권(녹), 90~94=후미(회), 90 미만=흐림.
 */
function MsfCell({ msf }: { msf: number | null }) {
  if (msf === null) return <span className="text-muted-foreground">-</span>;
  let cls = "text-slate-500";
  if (msf >= 100) cls = "text-amber-700 font-bold";
  else if (msf >= 95) cls = "text-emerald-700 font-semibold";
  else if (msf >= 90) cls = "text-slate-600";
  return <span className={cls}>{msf.toFixed(1)}</span>;
}

function RankBadge({ rank }: { rank: number | null }) {
  if (rank === null) return <span className="text-muted-foreground">-</span>;
  if (rank <= 3) {
    return (
      <span
        className={`inline-flex h-7 w-7 items-center justify-center rounded-full font-mono text-xs font-bold tabular-nums ${RANK_MEDAL_STYLE[rank]}`}
      >
        {rank}
      </span>
    );
  }
  return <span>{rank}</span>;
}

