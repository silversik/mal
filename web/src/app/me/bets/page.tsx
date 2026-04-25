import Link from "next/link";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { Card, CardContent } from "@/components/ui/card";
import { type BetPool } from "@/lib/bet_combinations";
import {
  type BetSummary,
  getUserBets,
} from "@/lib/bets";
import { POOL_LABEL, POOL_STYLE } from "@/lib/pool_style";

export const metadata = {
  title: "베팅 내역 · mal.kr",
};

const KIND_LABEL: Record<string, string> = {
  STRAIGHT: "일반",
  BOX: "박스",
  FORMATION: "포메이션",
};

const STATUS_LABEL: Record<BetSummary["status"], { text: string; color: string }> = {
  PENDING: { text: "대기", color: "bg-amber-500/15 text-amber-700" },
  SETTLED_HIT: { text: "적중", color: "bg-green-500/15 text-green-700" },
  SETTLED_MISS: { text: "미적중", color: "bg-foreground/10 text-foreground/60" },
  VOID: { text: "환급", color: "bg-blue-500/15 text-blue-700" },
};

function MeetBadge({ meet }: { meet: string }) {
  return (
    <span className="rounded bg-foreground/5 px-1.5 py-0.5 text-[10px] font-semibold text-slate-grey">
      {meet}
    </span>
  );
}

function fmtP(p: bigint): string {
  return p.toLocaleString("en-US");
}

function fmtKstDate(iso: string): string {
  // iso ex: '2026-04-25 14:30:00+09'
  return iso.slice(5, 16).replace(" ", " ");
}

export default async function MyBetsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const bets = await getUserBets(session.user.id, { limit: 100 });

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-10">
      <Link
        href="/me"
        className="group mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground transition hover:text-primary"
      >
        <span className="transition group-hover:-translate-x-0.5">&larr;</span>
        마이페이지
      </Link>

      <h1 className="mb-2 font-serif text-3xl font-bold tracking-tight text-primary">
        베팅 내역
      </h1>
      <p className="mb-8 text-sm text-slate-grey">
        최근 100건. 정산은 결과 확정 직후 자동 처리돼요.
      </p>

      {bets.length === 0 ? (
        <Card>
          <CardContent className="px-6 py-10 text-center text-sm text-muted-foreground">
            아직 베팅 내역이 없어요.
            <div className="mt-3">
              <Link href="/races" className="btn-outline text-xs py-1.5 px-4">
                경주 보러가기
              </Link>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {bets.map((bet) => {
            const status = STATUS_LABEL[bet.status];
            const profit =
              bet.status === "SETTLED_HIT" || bet.status === "SETTLED_MISS"
                ? bet.payout_p - bet.total_amount_p
                : null;
            const profitClass =
              profit === null
                ? ""
                : profit > BigInt(0)
                  ? "text-green-700"
                  : profit < BigInt(0)
                    ? "text-red-600"
                    : "text-foreground/60";
            return (
              <Card key={bet.id} size="sm">
                <CardContent className="grid grid-cols-[auto_1fr_auto] items-center gap-3 px-4 py-3">
                  {/* 상태 배지 */}
                  <span
                    className={`rounded px-2 py-0.5 text-[10px] font-bold ${status.color}`}
                  >
                    {status.text}
                  </span>

                  {/* 핵심 정보 */}
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5 text-xs">
                      <Link
                        href={`/races?date=${bet.race_date}&meet=${bet.meet}&race=${bet.race_no}`}
                        className="font-semibold text-primary hover:underline"
                      >
                        {bet.race_date} {bet.race_no}R
                      </Link>
                      <MeetBadge meet={bet.meet} />
                      {bet.race_name && (
                        <span className="truncate text-slate-grey">
                          {bet.race_name}
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-grey">
                      <span
                        className={`rounded border px-1.5 py-0.5 text-[10px] font-bold ${
                          POOL_STYLE[bet.pool as BetPool]?.chip ??
                          "border-foreground/15 bg-foreground/5 text-foreground/70"
                        }`}
                      >
                        {POOL_LABEL[bet.pool as BetPool] ?? bet.pool}
                      </span>
                      <span>{KIND_LABEL[bet.bet_kind] ?? bet.bet_kind}</span>
                      <span>·</span>
                      <span>
                        {fmtP(bet.unit_amount_p)}P × {bet.combo_count}조합
                      </span>
                    </div>
                  </div>

                  {/* 금액 */}
                  <div className="text-right">
                    <div className="font-mono text-xs tabular-nums text-foreground/70">
                      −{fmtP(bet.total_amount_p)}P
                    </div>
                    {bet.payout_p > BigInt(0) && (
                      <div className="font-mono text-sm font-bold tabular-nums text-green-700">
                        +{fmtP(bet.payout_p)}P
                      </div>
                    )}
                    {profit !== null && (
                      <div className={`font-mono text-[10px] ${profitClass}`}>
                        {profit > BigInt(0) ? "+" : ""}
                        {fmtP(profit)}P
                      </div>
                    )}
                    <div className="mt-0.5 text-[10px] text-muted-foreground">
                      {fmtKstDate(bet.placed_at)}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </main>
  );
}
