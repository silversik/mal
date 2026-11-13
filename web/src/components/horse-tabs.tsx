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
import type { Horse, PedigreeNode, RaceResult } from "@/lib/horses";
import type { HorseRankChange } from "@/lib/horse_rank_changes";
import { RankBadge } from "@/components/rank-badge";

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
  results,
  jockeyMap,
  videoEntries,
  rankChanges,
}: HorseTabsProps) {
  const videoMap = new Map<RaceKey, { video_id: string }>(videoEntries);
  // 족보는 ProfileCard 의 "부/모" MetaTile 옆 PedigreeDialog(pedigree-tree.tsx)가 담당.
  // horse/pedigree/siblings prop 은 호출부 호환을 위해 타입에만 남김(본문 미사용).

  return (
    <div className="space-y-10">
      <RaceResultsSection
        results={results}
        jockeyMap={jockeyMap}
        videoMap={videoMap}
      />
      {rankChanges.length > 0 && <RankChangesSection changes={rankChanges} />}
    </div>
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
        <Card className="py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-left">일자</TableHead>
                <TableHead className="text-center">착순</TableHead>
                <TableHead className="text-center">경주</TableHead>
                <TableHead className="text-center">기록</TableHead>
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
                    {/* 일자가 첫 열 — 예전엔 첫 열이 "경주 보기" 썸네일 버튼이고 일자는 툴팁에만 있어
                        언제 경주인지 표에서 알 수 없었다. 영상이 있으면 작은 표시만. */}
                    <TableCell className="text-left">
                      {raceHref ? (
                        <Link
                          href={raceHref}
                          className="inline-flex min-h-11 items-center gap-2 font-mono tabular-nums text-foreground underline-offset-4 hover:underline"
                        >
                          {r.race_date ?? "-"}
                          {video && (
                            <span className="rounded-sm border border-border px-1.5 font-sans text-small font-semibold text-muted-foreground">
                              ▶ 영상
                            </span>
                          )}
                        </Link>
                      ) : (
                        <span className="font-mono tabular-nums">{r.race_date ?? "-"}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      <RankBadge rank={r.rank} />
                    </TableCell>
                    <TableCell className="text-center whitespace-nowrap">
                      {r.meet ?? "-"} {r.race_no}R
                    </TableCell>
                    <TableCell className="text-center font-mono tabular-nums">
                      {r.record_time ?? "-"}
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
                <TableCell className="font-mono text-sm">{c.st_date}</TableCell>
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
                <TableCell className="text-sm text-muted-foreground">
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



