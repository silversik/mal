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
import {
  listRacePlanYears,
  listRacePlans,
  TIER_ORDER,
  type RacePlan,
  type Tier,
} from "@/lib/race_plans";

type SearchParams = { year?: string; meet?: string; tier?: string };

// races 테이블은 "부경" / race_plans 테이블은 "부산경남" — 내부 선택값은 race_plans 기준.
const MEET_OPTIONS = ["서울", "부산경남", "제주"] as const;
const MEET_DISPLAY: Record<string, string> = {
  서울: "서울",
  부산경남: "부경",
  제주: "제주",
};

function isTier(v: string | undefined): v is Tier {
  return v === "G1" || v === "G2" || v === "G3" || v === "L" || v === "특";
}

function tierBadge(tier: Tier | null) {
  if (!tier) return null;
  const color =
    tier === "G1"
      ? "bg-primary text-primary-foreground"
      : tier === "G2"
        ? "bg-champagne-gold/80 text-foreground"
        : tier === "G3"
          ? "bg-champagne-gold/30 text-foreground"
          : "bg-muted text-muted-foreground";
  return (
    <Badge className={`${color} font-mono`} variant="default">
      {tier}
    </Badge>
  );
}

export default async function RaceSchedulePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const years = await listRacePlanYears();
  const currentYear = sp.year ? Number(sp.year) : (years[0] ?? new Date().getFullYear());
  const selectedMeet = sp.meet && MEET_OPTIONS.includes(sp.meet as (typeof MEET_OPTIONS)[number])
    ? sp.meet
    : null;
  const selectedTier = isTier(sp.tier) ? sp.tier : null;

  const plans = await listRacePlans({
    year: currentYear,
    meet: selectedMeet ?? undefined,
  });
  const filtered = selectedTier
    ? plans.filter((p) => p.tier === selectedTier)
    : plans;

  const byMeet = new Map<string, RacePlan[]>();
  for (const p of filtered) {
    if (!byMeet.has(p.meet)) byMeet.set(p.meet, []);
    byMeet.get(p.meet)!.push(p);
  }

  const qs = (over: Partial<SearchParams>) => {
    const out: Record<string, string> = {};
    if (over.year ?? String(currentYear)) out.year = over.year ?? String(currentYear);
    const m = over.meet !== undefined ? over.meet : selectedMeet ?? "";
    if (m) out.meet = m;
    const t = over.tier !== undefined ? over.tier : selectedTier ?? "";
    if (t) out.tier = t;
    const s = new URLSearchParams(out).toString();
    return s ? `?${s}` : "";
  };

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8">
      <Link
        href="/races"
        className="group mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground transition hover:text-primary"
      >
        <span className="transition group-hover:-translate-x-0.5">&larr;</span>
        경기 일람으로
      </Link>
      <h1 className="mb-2 text-2xl font-bold tracking-tight">대상경주 일정</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        KRA 가 연초에 고시하는 특별·대상(G1/G2/G3/L) 경주 연간 계획.
        시행일이 확정되지 않은 경주는 이름만 노출됩니다.
      </p>

      {/* ── 필터 바 ─────────────────────────── */}
      <div className="mb-6 flex flex-wrap items-center gap-x-6 gap-y-3">
        {/* 연도 */}
        {years.length > 0 && (
          <div className="flex items-center gap-1.5">
            <span className="text-xs uppercase tracking-wider text-muted-foreground">
              연도
            </span>
            {years.map((y) => (
              <Link
                key={y}
                href={`/races/schedule${qs({ year: String(y) })}`}
                className={
                  y === currentYear
                    ? "rounded-md bg-primary px-2 py-1 text-xs font-semibold text-primary-foreground"
                    : "rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
                }
              >
                {y}
              </Link>
            ))}
          </div>
        )}

        {/* 경마장 */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs uppercase tracking-wider text-muted-foreground">
            경마장
          </span>
          <Link
            href={`/races/schedule${qs({ meet: "" })}`}
            className={
              !selectedMeet
                ? "rounded-md bg-primary px-2 py-1 text-xs font-semibold text-primary-foreground"
                : "rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
            }
          >
            전체
          </Link>
          {MEET_OPTIONS.map((m) => (
            <Link
              key={m}
              href={`/races/schedule${qs({ meet: m })}`}
              className={
                selectedMeet === m
                  ? "rounded-md bg-primary px-2 py-1 text-xs font-semibold text-primary-foreground"
                  : "rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
              }
            >
              {MEET_DISPLAY[m] ?? m}
            </Link>
          ))}
        </div>

        {/* 등급 */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs uppercase tracking-wider text-muted-foreground">
            등급
          </span>
          <Link
            href={`/races/schedule${qs({ tier: "" })}`}
            className={
              !selectedTier
                ? "rounded-md bg-primary px-2 py-1 text-xs font-semibold text-primary-foreground"
                : "rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
            }
          >
            전체
          </Link>
          {TIER_ORDER.map((t) => (
            <Link
              key={t}
              href={`/races/schedule${qs({ tier: t })}`}
              className={
                selectedTier === t
                  ? "rounded-md bg-primary px-2 py-1 text-xs font-mono font-semibold text-primary-foreground"
                  : "rounded-md px-2 py-1 text-xs font-mono text-muted-foreground hover:bg-muted"
              }
            >
              {t}
            </Link>
          ))}
        </div>
      </div>

      {/* ── 결과 ─────────────────────────── */}
      {filtered.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            조건에 맞는 대상경주 계획이 없습니다.
          </CardContent>
        </Card>
      ) : (
        [...byMeet.entries()].map(([meet, list]) => (
          <section key={meet} className="mb-8">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              {MEET_DISPLAY[meet] ?? meet}
              <Badge variant="outline" className="font-normal">
                {list.length} 개
              </Badge>
            </h2>
            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>경주명</TableHead>
                    <TableHead>등급</TableHead>
                    <TableHead className="text-right">거리</TableHead>
                    <TableHead>주로</TableHead>
                    <TableHead>연령 조건</TableHead>
                    <TableHead>시행일</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {list.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium">
                        {p.race_name.replace(/\s*\((G[123]|L|특)\)\s*/g, "")}
                      </TableCell>
                      <TableCell>{tierBadge(p.tier) ?? <span className="text-muted-foreground">-</span>}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {p.distance != null ? `${p.distance}m` : "-"}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {p.track_type ?? "-"}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {p.age_cond ?? "-"}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {p.race_date ?? <span className="text-muted-foreground">미정</span>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          </section>
        ))
      )}
    </main>
  );
}
