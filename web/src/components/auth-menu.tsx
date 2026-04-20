import Link from "next/link";

import { auth, signOut } from "@/auth";

// 우측 상단 로그인/로그아웃 영역.
// 로그인 상태면 이름 + 로그아웃, 아니면 LOGIN/MEMBERSHIP 버튼 노출.
export async function AuthMenu() {
  const session = await auth();

  if (session?.user) {
    const name = session.user.name ?? "회원";
    return (
      <div className="flex items-center gap-3">
        <span className="hidden text-xs font-semibold text-slate-grey md:inline">
          {name}
        </span>
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
      <Link href="/login" className="btn-outline text-xs py-1.5 px-4">
        MEMBERSHIP
      </Link>
      <Link href="/login" className="btn-cta text-xs py-1.5 px-4 shadow-sm">
        LOGIN
      </Link>
    </div>
  );
}
