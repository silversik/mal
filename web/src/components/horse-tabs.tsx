"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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
import { PedigreeTree } from "@/components/pedigree-tree";
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
  const router = useRouter();
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
        <div className="mt-8 space-y-10">
          <ParentSection horse={horse} pedigree={pedigree} />
          {pedigree && (
            <section>
              <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                족보
              </h2>
              <Card>
                <CardContent className="p-0 overflow-hidden rounded-md">
                  <div className="rounded-md bg-muted/30" style={{ height: 440 }}>
                    <PedigreeTree
                      data={pedigree}
                      maxGenerations={5}
                      linkStyle="bezier"
                      height={440}
                      onNodeClick={(n) => {
                        if (n.id && !n.id.includes("__")) {
                          router.push(`/horse/${n.id}`);
                        }
                      }}
                    />
                  </div>
                  <p className="px-4 py-2 text-xs text-muted-foreground border-t">
                    노드 클릭 = 해당 말 상세 · 우측 원(＋/−) = 접기/펼치기 · 드래그/휠 = 이동·확대
                  </p>
                </CardContent>
              </Card>
            </section>
          )}
          {siblings.length > 0 && <SiblingsSection horse={horse} siblings={siblings} />}
        </div>
      )}
    </div>
  );
}

/* ── 부마/모마 카드 ──────────────────────────────────────── */

function ParentSection({
  horse,
  pedigree,
}: {
  horse: Horse;
  pedigree: PedigreeNode | null;
}) {
  const sireNode = pedigree?.sire;
  const damNode = pedigree?.dam;

  const parents = [
    {
      role: "父 (부마)",
      name: horse.sire_name,
      node: sireNode,
    },
    {
      role: "母 (모마)",
      name: horse.dam_name,
      node: damNode,
    },
  ];

  return (
    <section>
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        부모마
      </h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {parents.map(({ role, name, node }) => (
          <Card key={role}>
            <CardContent className="p-4">
              <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {role}
              </div>
              {name ? (
                <>
                  <div className="text-lg font-semibold">
                    {node?.horse_no ? (
                      <Link
                        href={`/horse/${node.horse_no}`}
                        className="text-primary hover:underline"
                      >
                        {name}
                      </Link>
                    ) : (
                      name
                    )}
                  </div>
                  {(node?.country || node?.birthYear) && (
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {[node.country, node.birthYear].filter(Boolean).join(" · ")}
                    </div>
                  )}
                  {node?.gradeWinner && (
                    <Badge variant="secondary" className="mt-2 font-normal text-xs">
                      ★ 우승마
                    </Badge>
                  )}
                  {node?.stats && (
                    <div className="mt-2 text-xs text-muted-foreground">
                      {Object.entries(node.stats)
                        .map(([k, v]) => `${k} ${v}`)
                        .join(" / ")}
                    </div>
                  )}
                </>
              ) : (
                <div className="text-sm text-muted-foreground">정보 없음</div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
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
                const key = r.race_date && r.meet && r.race_no
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

/* ── 형제마 ──────────────────────────────────────────────── */

function SiblingsSection({ horse, siblings }: { horse: Horse; siblings: Horse[] }) {
  return (
    <section>
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
  );
}

/* ── Helpers ─────────────────────────────────────────────── */

function RankBadge({ rank }: { rank: number | null }) {
  if (rank === null) return <span className="text-muted-foreground">-</span>;
  if (rank === 1)
    return <Badge className="bg-primary text-primary-foreground">1</Badge>;
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
