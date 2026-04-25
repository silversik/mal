import Link from "next/link";

import { auth } from "@/auth";
import { getUserBalance } from "@/lib/balances";

// KST 기준 오늘 일자 (출석 가능 여부 판단용).
function todayKst(): string {
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return now.toISOString().slice(0, 10);
}

function formatP(p: bigint): string {
  return p.toLocaleString("en-US");
}

// 우상단 잔액 표시 chip. 출석 미수령일 때 빨간 점으로 알림.
//   md+: "1,000,000 P" + 점, sm: "1M P"
export async function BalanceChip() {
  const session = await auth();
  if (!session?.user?.id) return null;

  const balance = await getUserBalance(session.user.id);
  if (!balance) return null;

  const claimable = balance.last_attendance_date !== todayKst();

  return (
    <Link
      href="/me"
      className="relative inline-flex items-center gap-1 rounded-full bg-foreground/5 px-3 py-1 text-xs font-semibold text-primary transition hover:bg-foreground/10"
      title={claimable ? "출석 보너스 수령 가능" : "잔액"}
    >
      <span className="tabular-nums">{formatP(balance.balance_p)}</span>
      <span className="text-[10px] font-bold text-primary/60">P</span>
      {claimable && (
        <span
          aria-hidden
          className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-red-500 ring-2 ring-background"
        />
      )}
    </Link>
  );
}
