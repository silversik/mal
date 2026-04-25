import Link from "next/link";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { Card, CardContent } from "@/components/ui/card";
import { ATTENDANCE_BONUS_P, getUserBalance } from "@/lib/balances";
import {
  NICKNAME_MAX,
  NICKNAME_MIN,
  getUserById,
  type NicknameValidationError,
} from "@/lib/users";

import {
  claimAttendanceBonusAction,
  logoutAction,
  updateNicknameAction,
} from "./actions";
import { DeleteAccountForm } from "./delete-account-form";

function todayKst(): string {
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return now.toISOString().slice(0, 10);
}

const ATTENDANCE_LABEL: Record<string, { ok: boolean; msg: string }> = {
  ok: { ok: true, msg: `출석 보너스 ${ATTENDANCE_BONUS_P.toLocaleString()}P 가 적립됐어요.` },
  already: { ok: false, msg: "오늘은 이미 출석 보너스를 받았어요." },
  error: { ok: false, msg: "출석 보너스 적립에 실패했어요. 잠시 후 다시 시도해 주세요." },
};

export const metadata = {
  title: "마이페이지 · mal.kr",
};

type SearchParams = {
  error?: string;
  ok?: string;
  attendance?: string;
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

  const { error, ok, attendance } = await searchParams;
  const [profile, balance] = await Promise.all([
    getUserById(session.user.id),
    getUserBalance(session.user.id),
  ]);
  if (!profile) {
    // 세션은 유효한데 users 행이 사라진 희귀 케이스 (탈퇴 직후 등). 안전하게 로그아웃 유도.
    redirect("/login");
  }

  const attendanceClaimable =
    !!balance && balance.last_attendance_date !== todayKst();
  const attendanceMsg = attendance ? ATTENDANCE_LABEL[attendance] : null;

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

      {/* 모의배팅 — 잔액·출석·내역·통계 */}
      <Card className="mb-6">
        <CardContent className="space-y-4 p-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="font-serif text-lg font-bold text-primary">
                모의배팅
              </h2>
              <p className="text-xs text-slate-grey">
                가상 화폐 P로 마권을 구매·정산해 볼 수 있어요.
              </p>
            </div>
            <div className="text-right">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-grey">
                잔액
              </div>
              <div className="font-mono text-lg font-bold tabular-nums text-primary">
                {balance ? balance.balance_p.toLocaleString() : "0"}
                <span className="ml-1 text-xs font-bold text-primary/60">P</span>
              </div>
            </div>
          </div>

          {attendanceMsg && (
            <div
              className={
                attendanceMsg.ok
                  ? "rounded-md border border-green-500/30 bg-green-500/5 px-3 py-2 text-xs text-green-700"
                  : "rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-700"
              }
            >
              {attendanceMsg.msg}
            </div>
          )}

          <form
            action={claimAttendanceBonusAction}
            className="flex items-center justify-between gap-3 rounded-md border border-foreground/10 bg-foreground/[0.02] px-3 py-2"
          >
            <div>
              <div className="text-xs font-semibold text-primary">
                출석 보너스
              </div>
              <div className="text-[11px] text-slate-grey">
                {attendanceClaimable
                  ? `오늘 +${ATTENDANCE_BONUS_P.toLocaleString()}P 받을 수 있어요`
                  : "오늘 출석 완료"}
              </div>
            </div>
            <button
              type="submit"
              disabled={!attendanceClaimable}
              className="btn-cta text-xs py-1.5 px-4 shadow-sm disabled:cursor-not-allowed disabled:opacity-40"
            >
              {attendanceClaimable ? "받기" : "완료"}
            </button>
          </form>

          <div className="grid grid-cols-2 gap-2">
            <Link
              href="/me/bets"
              className="rounded-md border border-foreground/10 bg-card px-3 py-2 text-center text-xs font-semibold text-primary transition hover:bg-foreground/5"
            >
              베팅 내역 →
            </Link>
            <Link
              href="/me/stats"
              className="rounded-md border border-foreground/10 bg-card px-3 py-2 text-center text-xs font-semibold text-primary transition hover:bg-foreground/5"
            >
              통계·수익률 →
            </Link>
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
