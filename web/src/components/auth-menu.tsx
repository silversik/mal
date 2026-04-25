import Link from "next/link";

import { auth, signOut } from "@/auth";
import { getUserById } from "@/lib/users";

import { BalanceChip } from "./balance-chip";

// 우측 상단 로그인/로그아웃 영역.
// 로그인 상태면 닉네임(없으면 OAuth 이름) + 로그아웃, 아니면 LOGIN 버튼.
// 닉네임은 DB 에서 직접 읽는다 — JWT 는 로그인 시점 스냅샷이라 수정 즉시 반영되지 않음.
export async function AuthMenu() {
  const session = await auth();

  if (session?.user?.id) {
    const profile = await getUserById(session.user.id);
    const displayName =
      profile?.display_name ?? session.user.name ?? "회원";
    return (
      <div className="flex items-center gap-3">
        <BalanceChip />
        <Link
          href="/me"
          className="hidden text-xs font-semibold text-slate-grey transition hover:text-primary md:inline"
          title="마이페이지"
        >
          {displayName}
        </Link>
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/" });
          }}
        >
          <button type="submit" className="btn-outline text-xs py-1.5 px-4">
            LOGOUT
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-4">
      <Link href="/login" className="btn-cta text-xs py-1.5 px-4 shadow-sm">
        LOGIN
      </Link>
    </div>
  );
}
