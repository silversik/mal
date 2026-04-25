import Link from "next/link";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { Card, CardContent } from "@/components/ui/card";
import { getUserBalance } from "@/lib/balances";
import { getUserStats } from "@/lib/bets";

export const metadata = {
  title: "베팅 통계 · mal.kr",
};

function fmtP(p: bigint): string {
  return p.toLocaleString("en-US");
}

function fmtPct(v: number | null, digits = 1): string {
  return v === null ? "—" : `${v.toFixed(digits)}%`;
}

function StatRow({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="flex items-baseline justify-between border-b border-foreground/5 py-2 last:border-b-0">
      <div className="text-xs text-slate-grey">{label}</div>
      <div className="text-right">
        <div className="font-mono text-sm font-semibold tabular-nums text-primary">
          {value}
        </div>
        {sub && <div className="text-[10px] text-muted-foreground">{sub}</div>}
      </div>
    </div>
  );
}

export default async function MyStatsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const [stats, balance] = await Promise.all([
    getUserStats(session.user.id),
    getUserBalance(session.user.id),
  ]);

  const profit = stats.total_payout_p - stats.total_amount_p;
  const profitColor =
    profit > BigInt(0)
      ? "text-green-700"
      : profit < BigInt(0)
        ? "text-red-600"
        : "text-foreground/60";

  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-10">
      <Link
        href="/me"
        className="group mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground transition hover:text-primary"
      >
        <span className="transition group-hover:-translate-x-0.5">&larr;</span>
        마이페이지
      </Link>

      <h1 className="mb-2 font-serif text-3xl font-bold tracking-tight text-primary">
        베팅 통계
      </h1>
      <p className="mb-8 text-sm text-slate-grey">
        통산 베팅 실적과 회수율.
      </p>

      <div className="mb-6 grid grid-cols-2 gap-3">
        <Card>
          <CardContent className="space-y-1 p-4">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-grey">
              통산 회수율
            </div>
            <div className="font-mono text-3xl font-bold tabular-nums text-primary">
              {fmtPct(stats.return_rate)}
            </div>
            <div className="text-[11px] text-muted-foreground">
              환급 / 베팅 총액
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-1 p-4">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-grey">
              적중률
            </div>
            <div className="font-mono text-3xl font-bold tabular-nums text-primary">
              {fmtPct(stats.hit_rate)}
            </div>
            <div className="text-[11px] text-muted-foreground">
              적중 / 정산 완료
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="mb-6">
        <CardContent className="px-5 py-3">
          <h2 className="mb-1 font-serif text-base font-bold text-primary">
            손익
          </h2>
          <StatRow
            label="베팅 총액"
            value={`${fmtP(stats.total_amount_p)}P`}
            sub={`${stats.total_bets}건`}
          />
          <StatRow
            label="환급 총액"
            value={`${fmtP(stats.total_payout_p)}P`}
            sub={`적중 ${stats.hit_bets}건`}
          />
          <div className="flex items-baseline justify-between py-2">
            <div className="text-xs text-slate-grey">손익</div>
            <div
              className={`font-mono text-base font-bold tabular-nums ${profitColor}`}
            >
              {profit > BigInt(0) ? "+" : ""}
              {fmtP(profit)}P
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="px-5 py-3">
          <h2 className="mb-1 font-serif text-base font-bold text-primary">
            현재
          </h2>
          <StatRow
            label="잔액"
            value={`${balance ? fmtP(balance.balance_p) : "0"}P`}
          />
          <StatRow
            label="대기 중"
            value={`${stats.pending_bets}건`}
            sub="아직 정산되지 않은 베팅"
          />
        </CardContent>
      </Card>
    </main>
  );
}
