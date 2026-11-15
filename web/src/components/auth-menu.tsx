import Link from "next/link";

import { auth, signOut } from "@/auth";
import { getUserById } from "@/lib/users";

import { NotificationsBell } from "./notifications-bell";

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
      <div className="flex items-center gap-2">
        <NotificationsBell />
        <Link
          href="/me"
          className="hidden h-11 items-center px-1 text-sm font-semibold text-muted-foreground transition hover:text-foreground md:inline-flex"
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
          <button type="submit" className="btn-outline inline-flex h-11 items-center rounded-md py-0 px-4 text-sm">
            LOGOUT
          </button>
        </form>
      </div>
    );
  }

  return (
    // 헤더 우측 컨트롤은 모두 높이 44px(h-11)·rounded-md 로 통일 — 화면 설정 아이콘 버튼과 나란히.
    <div className="flex items-center">
      <Link href="/login" className="btn-cta inline-flex h-11 items-center rounded-md py-0 px-4 text-sm">
        LOGIN
      </Link>
    </div>
  );
}
