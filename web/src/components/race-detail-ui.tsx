import Link from "next/link";

import { Card, CardContent } from "@/components/ui/card";
import { RankBadge, medalClass } from "@/components/rank-badge";

/**
 * KRA 게이트 컬러 — 8가지 표준 (출전번호 9 이상은 mod 로 wrap).
 * 사용처: race detail 출전표, 인기 분포, 풀별 매출 인기 칩.
 */
const GATE_PALETTE: Record<number, { bg: string; color: string; border: string }> = {
  1: { bg: "#ffffff", color: "#111111", border: "#444444" },
  2: { bg: "#111111", color: "#ffffff", border: "#111111" },
  3: { bg: "#d22b2b", color: "#ffffff", border: "#d22b2b" },
  4: { bg: "#2867d8", color: "#ffffff", border: "#2867d8" },
  5: { bg: "#f5c11a", color: "#222222", border: "#d8a700" },
  6: { bg: "#1e8a3e", color: "#ffffff", border: "#1e8a3e" },
  7: { bg: "#ff7a00", color: "#ffffff", border: "#ff7a00" },
  8: { bg: "#ff8fb0", color: "#3a0014", border: "#cc6d8b" },
};

export function gatePalette(n: number) {
  const key = ((n - 1) % 8) + 1;
  return GATE_PALETTE[key];
}

export function GateNum({ n, size = 26 }: { n: number | null; size?: number }) {
  if (n == null) {
    return (
      <span
        className="inline-flex items-center justify-center rounded-md border border-border bg-muted font-mono text-sm font-bold tabular-nums text-muted-foreground"
        style={{ width: `${size / 16}rem`, height: `${size / 16}rem` }}
      >
        -
      </span>
    );
  }
  const p = gatePalette(n);
  return (
    <span
      className="inline-flex items-center justify-center rounded-md font-mono font-bold tabular-nums"
      style={{
        // rem — 큰글씨 모드에서 칩과 숫자가 함께 커진다. 숫자 최소 13px.
        width: `${size / 16}rem`,
        height: `${size / 16}rem`,
        background: p.bg,
        color: p.color,
        border: `1px solid ${p.border}`,
        fontSize: size <= 22 ? "0.8125rem" : "0.875rem",
      }}
    >
      {n}
    </span>
  );
}


/** 메달 (1·2·3착) — 게이트와 별개의 색 시스템. */
export function RankMedal({ rank }: { rank: number | null }) {
  return <RankBadge rank={rank} />;
}

/**
 * 마명 셀 옆에 노출하는 sex bullet — 수말(파랑)/암말(분홍)/거세마(회색).
 * `horse.sex` 가 "수4"·"암3"·"거6" 처럼 연령이 붙어 들어오므로 startsWith 매칭.
 */
export function SexBullet({ sex }: { sex: string | null }) {
  if (!sex) return null;
  const s = sex.trim();
  if (s.startsWith("암"))
    return <span className="font-bold text-foreground">암</span>;
  if (s.startsWith("거"))
    return <span className="font-bold text-muted-foreground">거</span>;
  if (s.startsWith("수"))
    return <span className="font-bold text-foreground">수</span>;
  return <span className="text-muted-foreground">{s}</span>;
}

/**
 * 출전표의 "최근 5전" 미니 도트. 1·2·3착 = 공용 메달(medalClass), 그외=muted.
 * 시각화 가벼움 — 마명 셀 인라인용.
 */
export function FormDots({ finishes }: { finishes: (number | null)[] }) {
  if (finishes.length === 0) return null;
  return (
    <span className="inline-flex items-center gap-[2px] align-middle">
      {finishes.map((r, i) => (
        <span
          key={i}
          className={`inline-block h-2.5 w-2.5 rounded-full ${medalClass(r)}`}
          title={r == null ? "미완주" : `${r}착`}
        />
      ))}
    </span>
  );
}

/** 마체중 ± 증감 칩. */
export function WeightDelta({ diff }: { diff: number | null }) {
  if (diff === null) return null;
  if (diff === 0) {
    return (
      <span className="ml-1 inline-block rounded bg-muted px-1 py-px font-mono text-small tabular-nums text-muted-foreground">
        ±0
      </span>
    );
  }
  const positive = diff > 0;
  return (
    <span
      className={`ml-1 inline-block rounded px-1 py-px font-mono text-small tabular-nums ${
        positive ? "bg-destructive/10 text-destructive" : "bg-positive/10 text-positive"
      }`}
    >
      {positive ? `+${diff}` : diff}
    </span>
  );
}

/**
 * 배당 (단승/연승) 인라인 막대 — 낮은 배당(인기) 일수록 막대가 길고 골드.
 * 최대 배당 60 기준 로그 스케일.
 */
export function OddsBar({
  value,
  kind = "win",
}: {
  value: string | null;
  kind?: "win" | "plc";
}) {
  if (value == null) {
    return <span className="text-sm text-muted-foreground">-</span>;
  }
  const v = parseFloat(value);
  if (!Number.isFinite(v) || v <= 0) {
    return (
      <span className="font-mono text-sm tabular-nums text-muted-foreground">
        {value}
      </span>
    );
  }
  const MAX = 60;
  const pct = Math.max(6, Math.min(100, 100 - (Math.log(v) / Math.log(MAX)) * 100));
  const fav = v < 4;
  return (
    <span className="inline-flex items-center justify-end gap-1.5 font-mono text-sm tabular-nums">
      <span className="relative h-2 w-12 max-w-[48px] flex-1 overflow-hidden rounded-full bg-muted">
        <span
          className="absolute inset-y-0 left-0 rounded-full"
          style={{
            width: `${pct}%`,
            // 단색(그라디언트·slate 리터럴 제거): 단승=brown, 연승=muted-ink.
            background: kind === "plc" ? "var(--muted-ink)" : "var(--brown)",
          }}
        />
      </span>
      <span className={`min-w-[36px] text-right font-semibold ${fav ? "text-primary" : "text-foreground"}`}>
        {value}
      </span>
    </span>
  );
}

/**
 * 라운드 배지 — navy bg + 흰 숫자. 헤더 좌측 식별자.
 */
export function RoundBadge({ no, size = 46 }: { no: number; size?: number }) {
  return (
    <div
      className="flex items-center justify-center rounded-[9px] bg-primary text-white"
      style={{ width: size, height: size }}
    >
      <span
        className="font-mono font-extrabold leading-none tabular-nums"
        style={{ fontSize: size * 0.43 }}
      >
        {no}
      </span>
    </div>
  );
}

/** 작은 메타 칩. */
export function RaceChip({
  label,
  value,
  tone = "default",
}: {
  label?: string;
  value: React.ReactNode;
  tone?: "default" | "gold" | "condition";
}) {
  const cls =
    tone === "gold"
      ? "border-secondary/40 bg-secondary/15 text-secondary"
      : tone === "condition"
        ? "border-transparent bg-muted text-foreground"
        : "border-transparent bg-muted text-foreground";
  return (
    <span
      className={`inline-flex h-6 items-center gap-1 rounded-md border px-2 text-sm font-semibold ${cls}`}
    >
      {label && <span className="font-medium text-muted-foreground">{label}</span>}
      <span className="font-semibold">{value}</span>
    </span>
  );
}

/* ── 풀별 매출 타일 그리드 ─────────────────────────────────────── */

const POOL_DISPLAY: Record<string, { name: string; code: string }> = {
  단승: { name: "단승", code: "WIN" },
  연승: { name: "연승", code: "PLC" },
  복승: { name: "복승", code: "QNL" },
  복연승: { name: "복연승", code: "QPL" },
  쌍승: { name: "쌍승", code: "EXA" },
  삼복승: { name: "삼복승", code: "TRI" },
  삼쌍승: { name: "삼쌍승", code: "TLA" },
};

function formatAmount(amountStr: string): string {
  const n = Number(amountStr);
  if (!Number.isFinite(n) || n === 0) return "-";
  if (n >= 100_000_000) return `${(n / 100_000_000).toFixed(2)}억`;
  if (n >= 10_000) return `${Math.round(n / 10_000).toLocaleString("ko-KR")}만`;
  return n.toLocaleString("ko-KR");
}

/**
 * 풀별 매출 타일 — 각 타일에 풀명/코드, 매출액, 비중 막대.
 * KRA 의 `odds_summary` 가 "5번(2.4) · 3번(3.1) · 1번(4.8)" 형태로 들어와
 * 정규식으로 상위 3개를 파싱해 칩으로 노출.
 *
 * `compact` — 사이드바용 1열 가로 배치 (풀명·매출·비중·인기칩 한 행).
 */
export function PoolSalesTiles({
  rows,
  totalAmount,
  compact = false,
}: {
  rows: { pool: string; amount: string; odds_summary: string | null }[];
  totalAmount: number;
  compact?: boolean;
}) {
  if (compact) {
    return (
      <Card className="py-0">
        <CardContent className="p-2">
          <ul className="divide-y divide-border/40">
            {rows.map((r) => {
              const amt = Number(r.amount);
              const pct = totalAmount > 0 ? (amt / totalAmount) * 100 : 0;
              const display = POOL_DISPLAY[r.pool] ?? { name: r.pool, code: "" };
              const popular = parsePopularChips(r.odds_summary);
              return (
                <li key={r.pool} className="px-1.5 py-1.5">
                  <div className="flex items-center gap-2">
                    <span className="w-12 shrink-0 text-small font-semibold text-muted-foreground">
                      {display.name}
                    </span>
                    <span className="flex-1 font-mono text-sm font-bold tabular-nums">
                      {formatAmount(r.amount)}
                    </span>
                    <span className="w-10 shrink-0 text-right font-mono text-small tabular-nums text-muted-foreground">
                      {pct.toFixed(1)}%
                    </span>
                  </div>
                  <span className="mt-1 block h-[3px] rounded-sm bg-muted">
                    <span
                      className="block h-full rounded-sm bg-primary"
                      style={{ width: `${Math.min(100, pct * 3.5)}%` }}
                    />
                  </span>
                  {popular.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {popular.map((p, i) => (
                        <PopChip key={i} rank={i + 1} num={p.num} odd={p.odd} />
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="py-0">
      <CardContent className="p-3">
        <div
          className="grid gap-px overflow-hidden rounded-lg bg-border"
          style={{ gridTemplateColumns: `repeat(${Math.min(rows.length, 7)}, minmax(0, 1fr))` }}
        >
          {rows.map((r) => {
            const amt = Number(r.amount);
            const pct = totalAmount > 0 ? (amt / totalAmount) * 100 : 0;
            const display = POOL_DISPLAY[r.pool] ?? { name: r.pool, code: "" };
            const popular = parsePopularChips(r.odds_summary);
            return (
              <div key={r.pool} className="flex flex-col gap-1 bg-card p-3">
                <span className="text-small font-semibold text-muted-foreground">
                  {display.name}
                  {display.code && (
                    <span className="ml-1 font-mono text-small">
                      {display.code}
                    </span>
                  )}
                </span>
                <span className="font-mono text-[0.9375rem] font-bold tabular-nums">
                  {formatAmount(r.amount)}
                </span>
                <span className="font-mono text-small tabular-nums text-muted-foreground">
                  {pct.toFixed(1)}%
                </span>
                <span className="block h-1 rounded-sm bg-muted">
                  <span
                    className="block h-full rounded-sm bg-primary"
                    style={{ width: `${Math.min(100, pct * 3.5)}%` }}
                  />
                </span>
                {popular.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5 border-t border-dashed border-border pt-1.5">
                    {popular.map((p, i) => (
                      <PopChip key={i} rank={i + 1} num={p.num} odd={p.odd} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function PopChip({ rank, num, odd }: { rank: number; num: string; odd: string }) {
  const style =
    rank === 1
      ? { bg: "var(--brown)", color: "var(--brown-fg)", border: "var(--brown-deep)" }
      : rank === 2
        ? { bg: "var(--muted)", color: "var(--muted-foreground)", border: "var(--hairline)" }
        : { bg: "var(--brown-pale)", color: "var(--ink)", border: "var(--brown-deep)" };
  return (
    <span className="inline-flex items-center gap-1 text-small">
      <span
        className="inline-flex h-[1.125rem] min-w-[1.125rem] items-center justify-center rounded-full px-1 font-mono text-small font-bold tabular-nums"
        style={{ background: style.bg, color: style.color, border: `1px solid ${style.border}` }}
      >
        {num}
      </span>
      <span className="font-mono font-semibold text-muted-foreground tabular-nums">
        {odd}
      </span>
    </span>
  );
}

/**
 * `odds_summary` 문자열에서 상위 인기 (마번, 배당) 추출.
 * 입력 예: "5번(2.4) · 3번(3.1) · 1번(4.8)" → [{num:"5", odd:"2.4"}, ...]
 *          "3·7(12.4) · 3·5(14.2)" → [{num:"3·7", odd:"12.4"}, ...]
 */
function parsePopularChips(summary: string | null): { num: string; odd: string }[] {
  if (!summary) return [];
  const out: { num: string; odd: string }[] = [];
  const re = /([0-9·→]+(?:번)?)\s*\(([0-9.]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(summary)) !== null && out.length < 3) {
    out.push({ num: m[1].replace(/번/g, ""), odd: m[2] });
  }
  return out;
}

/* ── 인기 분포 차트 (단승 기준 가로 막대) ─────────────────────── */

export function PopularityChart({
  entries,
}: {
  entries: { chul_no: number | null; horse_no: string; horse_name: string; win_rate: string | null }[];
}) {
  const rows = entries
    .map((e) => {
      const win = e.win_rate ? parseFloat(e.win_rate) : null;
      return win != null && Number.isFinite(win) && win > 0
        ? { ...e, win }
        : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => a.win - b.win);

  if (rows.length === 0) {
    return (
      <Card className="py-0">
        <CardContent className="py-6 text-center text-base text-muted-foreground">
          단승 배당 정보가 없습니다.
        </CardContent>
      </Card>
    );
  }

  const minOdds = rows[0].win;

  // 막대 안에 숫자를 넣으면 짧은 막대(인기 하위)에서 숫자가 트랙 위로 넘쳐 안 보였다 —
  // 숫자는 막대 오른쪽 고정 열로 분리. 색은 단색 + 1번 인기만 강조.
  return (
    <Card className="py-0">
      <CardContent className="p-4">
        <div className="flex flex-col gap-2">
          {rows.map((r, i) => {
            const widthPct = Math.max(4, Math.min(100, (minOdds / r.win) * 100));
            const isFav = i === 0;
            return (
              <div key={r.horse_no} className="flex items-center gap-2">
                <div className="flex w-[7.5rem] flex-none items-center gap-2">
                  <GateNum n={r.chul_no} size={22} />
                  <span className="truncate text-sm font-semibold">{r.horse_name}</span>
                </div>
                <div className="relative h-3 min-w-0 flex-1 overflow-hidden rounded-sm bg-muted">
                  <div
                    className="absolute inset-y-0 left-0 rounded-sm"
                    style={{
                      width: `${widthPct}%`,
                      background: isFav ? "var(--brown)" : "var(--brown-pale)",
                    }}
                  />
                </div>
                <span className="w-12 flex-none text-right font-mono text-sm font-semibold tabular-nums">
                  {r.win.toFixed(1)}
                </span>
                <span className="w-9 flex-none text-right font-mono text-small tabular-nums text-muted-foreground">
                  <strong className="text-foreground">{i + 1}</strong>위
                </span>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

/* ── 결과 시상대 (1·2·3착) ───────────────────────────────────── */

export type PodiumEntry = {
  rank: number;
  chul_no: number | null;
  horse_no: string;
  horse_name: string;
  jockey_name: string | null;
  jockey_no: string | null;
  win_rate: string | null;
  record_time: string | null;
};

/**
 * 시상대 카드 틴트 — 순위 자체는 RankMedal 숫자가 인코딩(색 단독 아님), 틴트는 보조.
 * 테마 flip 되는 토큰 위에 color-mix 로 얹어 다크에서도 ink/muted-ink 대비 ≥ 4.9:1.
 */
const PODIUM_TINT: Record<1 | 2 | 3, string> = {
  1: "color-mix(in srgb, var(--brown) 12%, var(--card))",
  2: "var(--muted)",
  3: "color-mix(in srgb, var(--brown-pale) 22%, var(--card))",
};

/**
 * 결과(post) 직후 가장 먼저 보고 싶은 정보는 1·2·3착.
 * 헤더 바로 아래에 podium 카드로 노출해 출전표까지 스크롤할 필요를 없앤다.
 *
 * 색상: PODIUM_TINT (brown 12% / muted / brown-pale 22%) — 토큰 기반이라 다크에서 flip. 순위는 RankMedal 숫자.
 */
export function PodiumCard({ podium }: { podium: PodiumEntry[] }) {
  if (podium.length === 0) return null;
  const sorted = [...podium].sort((a, b) => a.rank - b.rank);

  return (
    <Card className="overflow-hidden py-0">
      <CardContent className="p-0">
        <div className="grid grid-cols-1 divide-y divide-border sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          {sorted.map((e) => {
            const tint = PODIUM_TINT[e.rank as 1 | 2 | 3] ?? "var(--card)";
            return (
              <div
                key={e.horse_no}
                className="flex items-center gap-3 p-3"
                style={{ background: tint }}
              >
                <RankMedal rank={e.rank} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <GateNum n={e.chul_no} size={22} />
                    <Link
                      href={`/horse/${e.horse_no}`}
                      className="truncate text-sm font-bold text-primary hover:underline"
                    >
                      {e.horse_name}
                    </Link>
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-small text-muted-foreground">
                    {e.jockey_name &&
                      (e.jockey_no ? (
                        <Link
                          href={`/jockey/${e.jockey_no}`}
                          className="truncate hover:text-primary hover:underline"
                        >
                          {e.jockey_name}
                        </Link>
                      ) : (
                        <span className="truncate">{e.jockey_name}</span>
                      ))}
                    {e.record_time && (
                      <>
                        <span className="h-[3px] w-[3px] rounded-full bg-current opacity-40" />
                        <span className="font-mono tabular-nums">{e.record_time}</span>
                      </>
                    )}
                  </div>
                </div>
                {e.win_rate && (
                  <div className="text-right">
                    <div className="text-small font-semibold uppercase tracking-wider text-muted-foreground">
                      단승
                    </div>
                    <div className="font-mono text-sm font-bold tabular-nums">
                      {e.win_rate}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
