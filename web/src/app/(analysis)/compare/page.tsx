import type { Metadata } from "next";
import Link from "next/link";

import { Card } from "@/components/ui/card";
import { RankBadge } from "@/components/rank-badge";
import { RecentFormStrip } from "@/components/recent-form-strip";
import { query } from "@/lib/db";
import {
  getHorseCompareSummaries,
  getHorseByNo,
  searchHorses,
  type HorseCompareSummary,
} from "@/lib/horses";

export const metadata: Metadata = {
  title: "마필 비교",
  description: "여러 마필을 한 번에 비교 — 통산 성적·최근 폼·맞대결 기록",
  alternates: { canonical: "/compare" },
};

const MAX_HORSES = 5;

function parseHorseParams(input: string | string[] | undefined): string[] {
  if (!input) return [];
  const arr = Array.isArray(input) ? input : [input];
  // ?h=A,B,C 형태도 허용.
  const flat = arr.flatMap((s) => s.split(",")).map((s) => s.trim()).filter(Boolean);
  return [...new Set(flat)].slice(0, MAX_HORSES);
}

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<{ h?: string | string[]; q?: string }>;
}) {
  const sp = await searchParams;
  const horseNos = parseHorseParams(sp.h);
  const q = (sp.q ?? "").trim();

  const [summaries, masters, hits] = await Promise.all([
    horseNos.length > 0 ? getHorseCompareSummaries(horseNos) : Promise.resolve([]),
    Promise.all(horseNos.map((no) => getHorseByNo(no))),
    q ? searchHorses(q, 8).then((r) => r.rows) : Promise.resolve([]),
  ]);
  const masterByNo = Object.fromEntries(masters.map((m, i) => [horseNos[i], m]));
  const full = horseNos.length >= MAX_HORSES;

  return (
    <div>
      <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">마필 비교</h1>
      <p className="mt-1 text-base text-muted-foreground">
        마명으로 찾아 최대 {MAX_HORSES}두까지 나란히 비교합니다.
      </p>

      {/* 마필 추가 — 예전엔 URL ?h=마번 을 직접 입력해야만 비교가 가능했다. */}
      <Card className="mt-4 gap-0 py-0">
        <div className="p-4">
          <form action="/compare" method="get" className="flex gap-2">
            {horseNos.map((no) => (
              <input key={no} type="hidden" name="h" value={no} />
            ))}
            <label htmlFor="compare-q" className="sr-only">
              마명 검색
            </label>
            <input
              id="compare-q"
              name="q"
              defaultValue={q}
              disabled={full}
              placeholder={full ? `최대 ${MAX_HORSES}두까지 비교할 수 있습니다` : "마명 입력 (예: 녹색신호)"}
              className="min-h-11 min-w-0 flex-1 rounded-md border border-input bg-card px-3 text-base placeholder:text-muted-foreground disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={full}
              className="btn-cta min-h-11 shrink-0 px-4 text-base disabled:opacity-60"
            >
              찾기
            </button>
          </form>

          {q && !full && (
            <div className="mt-3">
              {hits.length === 0 ? (
                <p className="text-base text-muted-foreground">
                  &lsquo;{q}&rsquo; 와(과) 일치하는 마필이 없습니다.
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {hits.map((h) => {
                    const added = horseNos.includes(h.horse_no);
                    return (
                      <li key={h.horse_no} className="flex min-h-12 items-center gap-3 py-2">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-base font-semibold">{h.horse_name}</span>
                          <span className="block truncate text-small text-muted-foreground">
                            {[h.country, h.sex, h.sire_name && `부 ${h.sire_name}`].filter(Boolean).join(" · ")}
                          </span>
                        </span>
                        {added ? (
                          <span className="shrink-0 text-small font-semibold text-muted-foreground">추가됨</span>
                        ) : (
                          <Link
                            href={compareHref([...horseNos, h.horse_no])}
                            className="inline-flex min-h-11 shrink-0 items-center rounded-md border border-border px-3 text-base font-semibold hover:bg-muted"
                          >
                            + 추가
                          </Link>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}

          {horseNos.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2 border-t border-border pt-3">
              {summaries.map((s) => (
                <Link
                  key={s.horse_no}
                  href={compareHref(horseNos.filter((n) => n !== s.horse_no))}
                  className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border bg-muted px-4 text-base font-semibold hover:border-foreground"
                  aria-label={`${s.horse_name} 비교에서 빼기`}
                >
                  {s.horse_name}
                  <span aria-hidden="true" className="text-muted-foreground">✕</span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </Card>

      {summaries.length === 0 ? (
        <p className="mt-6 text-center text-base text-muted-foreground">
          위에서 마명을 검색해 비교할 마필을 추가하세요.
        </p>
      ) : (
        <div className="mt-6 space-y-6">
          <CompareSummary summaries={summaries} masterByNo={masterByNo} />
          <CompareHeadToHead horseNos={horseNos} />
        </div>
      )}
    </div>
  );
}

function compareHref(nos: string[]): string {
  if (nos.length === 0) return "/compare";
  const sp = new URLSearchParams();
  for (const n of nos) sp.append("h", n);
  return `/compare?${sp.toString()}`;
}

function pct(n: number, d: number): string {
  return d > 0 ? `${((n / d) * 100).toFixed(1)}%` : "-";
}

/**
 * 요약 비교 — 예전엔 "항목 × 말" nowrap 표(w-32 라벨 + 최대 5열)라 모바일에서 가로 스크롤만 됐다.
 * 말 1두 = 카드 1장으로 reflow(모바일 1열 → sm 2열 → lg 3열), 핵심 수치(승률·입상률)를 상단에 크게.
 */
function CompareSummary({
  summaries,
  masterByNo,
}: {
  summaries: HorseCompareSummary[];
  masterByNo: Record<string, Awaited<ReturnType<typeof getHorseByNo>>>;
}) {
  return (
    <section aria-labelledby="compare-summary">
      <h2 id="compare-summary" className="mb-2 text-lg font-bold">
        요약 비교
      </h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {summaries.map((s) => {
          const m = masterByNo[s.horse_no];
          const top3 = s.first_place_count + s.second_place_count + s.third_place_count;
          return (
            <Card key={s.horse_no} className="gap-0 py-0">
              <div className="p-4">
                <Link
                  href={`/horse/${s.horse_no}`}
                  className="block truncate text-lg font-bold text-foreground underline-offset-4 hover:underline"
                >
                  {s.horse_name}
                </Link>
                <p className="truncate text-small text-muted-foreground">
                  {[m?.country, m?.sex, `마번 ${s.horse_no}`].filter(Boolean).join(" · ")}
                </p>

                <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
                  <Stat label="출전" value={String(s.total_race_count)} />
                  <Stat label="승률" value={pct(s.first_place_count, s.total_race_count)} />
                  <Stat label="입상률" value={pct(top3, s.total_race_count)} />
                </dl>

                <dl className="mt-3 space-y-1 border-t border-border pt-3 text-base">
                  <Row label="1-2-3착">
                    <span className="font-mono tabular-nums">
                      {s.first_place_count}-{s.second_place_count}-{s.third_place_count}
                    </span>
                  </Row>
                  <Row label="부마">{m?.sire_name ?? "-"}</Row>
                  <Row label="모마">{m?.dam_name ?? "-"}</Row>
                  <Row label="최근 5전">
                    <RecentFormStrip finishes={s.recent_finishes} />
                  </Row>
                </dl>
              </div>
            </Card>
          );
        })}
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-muted px-2 py-2">
      <dt className="text-small text-muted-foreground">{label}</dt>
      <dd className="font-mono text-lg font-bold tabular-nums text-foreground">{value}</dd>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-8 items-center justify-between gap-3">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate text-right font-semibold">{children}</dd>
    </div>
  );
}

async function CompareHeadToHead({ horseNos }: { horseNos: string[] }) {
  if (horseNos.length < 2) return null;
  // 동시 출주: 같은 (race_date, meet, race_no) 에 모두 등장한 race.
  const placeholders = horseNos.map((_, i) => `$${i + 1}`).join(",");
  const rows = await query<{
    race_date: string;
    meet: string | null;
    race_no: number;
    payload: { horse_no: string; horse_name: string; rank: number | null }[];
  }>(
    `SELECT to_char(rr.race_date, 'YYYY-MM-DD') AS race_date,
            rr.meet,
            rr.race_no,
            jsonb_agg(jsonb_build_object(
              'horse_no', rr.horse_no,
              'horse_name', h.horse_name,
              'rank', rr.rank
            ) ORDER BY rr.rank NULLS LAST) AS payload
       FROM race_results rr
       JOIN horses h ON h.horse_no = rr.horse_no
      WHERE rr.horse_no IN (${placeholders})
      GROUP BY rr.race_date, rr.meet, rr.race_no
     HAVING COUNT(DISTINCT rr.horse_no) = ${horseNos.length}
      ORDER BY rr.race_date DESC, rr.race_no DESC
      LIMIT 20`,
    horseNos,
  );

  if (rows.length === 0) {
    return (
      <p className="text-center text-base text-muted-foreground">
        이 마필들이 함께 출주한 경기는 아직 없습니다.
      </p>
    );
  }

  return (
    <section aria-labelledby="compare-h2h">
      <h2 id="compare-h2h" className="mb-2 text-lg font-bold">
        맞대결 기록 <span className="font-mono text-base font-semibold tabular-nums text-muted-foreground">{rows.length}경기</span>
      </h2>
      <Card className="gap-0 py-0">
        <ul className="divide-y divide-border">
          {rows.map((r) => (
            <li key={`${r.race_date}-${r.meet}-${r.race_no}`} className="px-4 py-3">
              <div className="flex items-baseline gap-3">
                <span className="font-mono text-base tabular-nums text-muted-foreground">{r.race_date}</span>
                <Link
                  href={`/races?date=${r.race_date}&venue=${encodeURIComponent(r.meet ?? "")}&race=${r.race_no}`}
                  className="text-base font-semibold underline-offset-4 hover:underline"
                >
                  {r.meet} {r.race_no}R
                </Link>
              </div>
              {/* 착순 순 결과 — 한 셀 nowrap 대신 칩으로 줄바꿈 허용. */}
              <ol className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
                {r.payload.map((p) => (
                  <li key={p.horse_no} className="inline-flex items-center gap-2">
                    <RankBadge size="sm" rest="chip" rank={p.rank} />
                    <Link
                      href={`/horse/${p.horse_no}`}
                      className="text-base underline-offset-4 hover:underline"
                    >
                      {p.horse_name}
                    </Link>
                  </li>
                ))}
              </ol>
            </li>
          ))}
        </ul>
      </Card>
    </section>
  );
}
