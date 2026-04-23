import Link from "next/link";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { Card, CardContent } from "@/components/ui/card";
import {
  NICKNAME_MAX,
  NICKNAME_MIN,
  getUserById,
  type NicknameValidationError,
} from "@/lib/users";

import { logoutAction, updateNicknameAction } from "./actions";
import { DeleteAccountForm } from "./delete-account-form";

export const metadata = {
  title: "마이페이지 · mal.kr",
};

type SearchParams = {
  error?: string;
  ok?: string;
};

const ERROR_MESSAGES: Record<NicknameValidationError, string> = {
  required: "닉네임을 입력해 주세요.",
  too_short: `닉네임은 ${NICKNAME_MIN}자 이상이어야 합니다.`,
  too_long: `닉네임은 ${NICKNAME_MAX}자 이하여야 합니다.`,
  invalid_chars: "한글·영문·숫자·_ · - · . 만 사용할 수 있어요.",
  taken: "이미 사용 중인 닉네임입니다.",
};

function isKnownError(v: string | undefined): v is NicknameValidationError {
  return (
    v === "required" ||
    v === "too_short" ||
    v === "too_long" ||
    v === "invalid_chars" ||
    v === "taken"
  );
}

export default async function MePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const { error, ok } = await searchParams;
  const profile = await getUserById(session.user.id);
  if (!profile) {
    // 세션은 유효한데 users 행이 사라진 희귀 케이스 (탈퇴 직후 등). 안전하게 로그아웃 유도.
    redirect("/login");
  }

  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-10">
      <Link
        href="/"
        className="group mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground transition hover:text-primary"
      >
        <span className="transition group-hover:-translate-x-0.5">&larr;</span>
        메인으로
      </Link>

      <h1 className="mb-2 font-serif text-3xl font-bold tracking-tight text-primary">
        마이페이지
      </h1>
      <p className="mb-8 text-sm text-slate-grey">
        계정 정보와 닉네임을 관리할 수 있어요.
      </p>

      {ok === "1" && (
        <div className="mb-4 rounded-md border border-green-500/30 bg-green-500/5 px-4 py-3 text-sm text-green-700">
          변경 사항이 저장되었습니다.
        </div>
      )}
      {isKnownError(error) && (
        <div className="mb-4 rounded-md border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-600">
          {ERROR_MESSAGES[error]}
        </div>
      )}

      {/* 계정 개요 */}
      <Card className="mb-6">
        <CardContent className="space-y-3 p-6">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-grey">
              이메일
            </div>
            <div className="mt-1 text-sm">
              {profile.email ?? (
                <span className="text-muted-foreground">
                  제공되지 않음
                </span>
              )}
            </div>
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-grey">
              연결된 이름
            </div>
            <div className="mt-1 text-sm">
              {profile.name ?? (
                <span className="text-muted-foreground">-</span>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 닉네임 수정 */}
      <Card className="mb-6">
        <CardContent className="p-6">
          <h2 className="mb-1 font-serif text-lg font-bold text-primary">
            닉네임
          </h2>
          <p className="mb-4 text-xs text-slate-grey">
            커뮤니티에 표시되는 이름입니다. {NICKNAME_MIN}~{NICKNAME_MAX}자,
            한글·영문·숫자·_ · - · . 사용 가능.
          </p>
          <form action={updateNicknameAction} className="flex flex-wrap gap-2">
            <input
              type="text"
              name="nickname"
              defaultValue={profile.nickname ?? ""}
              minLength={NICKNAME_MIN}
              maxLength={NICKNAME_MAX}
              placeholder="닉네임"
              required
              className="min-w-0 flex-1 rounded-md border border-foreground/15 bg-card px-3 py-2 text-[15px] outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
            <button type="submit" className="btn-cta text-xs py-2 px-5 shadow-sm">
              저장
            </button>
          </form>
        </CardContent>
      </Card>

      {/* 세션 / 탈퇴 */}
      <Card>
        <CardContent className="space-y-4 p-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="font-serif text-lg font-bold text-primary">
                로그아웃
              </h2>
              <p className="text-xs text-slate-grey">
                현재 기기에서 로그아웃합니다.
              </p>
            </div>
            <form action={logoutAction}>
              <button type="submit" className="btn-outline text-xs py-2 px-5">
                로그아웃
              </button>
            </form>
          </div>

          <div className="border-t border-foreground/10 pt-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="font-serif text-lg font-bold text-red-600">
                  회원 탈퇴
                </h2>
                <p className="text-xs text-slate-grey">
                  계정과 작성한 글이 모두 즉시 삭제되며 복구할 수 없어요.
                </p>
              </div>
              <DeleteAccountForm />
            </div>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
