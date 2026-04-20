import { redirect } from "next/navigation";

import { auth, signIn } from "@/auth";
import { Card, CardContent } from "@/components/ui/card";

export const metadata = {
  title: "로그인 · mal.kr",
};

// 로그인 / 회원가입 통합 페이지.
// OAuth 첫 로그인 시 자동으로 users 행이 생성되므로 별도 회원가입 폼이 없다.
export default async function LoginPage() {
  const session = await auth();
  if (session) redirect("/");

  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center px-6 py-16">
      <h1 className="font-serif text-3xl font-bold tracking-tight text-primary">
        mal.kr 시작하기
      </h1>
      <p className="mt-3 text-sm text-slate-grey">
        소셜 계정 한 번이면 로그인과 회원가입이 모두 끝나요.
      </p>

      <Card className="mt-10 w-full">
        <CardContent className="flex flex-col gap-3 p-6">
          <form
            action={async () => {
              "use server";
              await signIn("kakao", { redirectTo: "/" });
            }}
          >
            <button
              type="submit"
              className="flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-[#FEE500] text-[15px] font-semibold text-[#191919] transition hover:brightness-95"
            >
              카카오로 시작하기
            </button>
          </form>

          <button
            type="button"
            disabled
            className="flex h-12 w-full items-center justify-center gap-2 rounded-lg border border-border bg-background text-[15px] font-semibold text-slate-grey opacity-60"
          >
            구글로 시작하기 · 준비 중
          </button>

          <button
            type="button"
            disabled
            className="flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-black text-[15px] font-semibold text-white opacity-60"
          >
            Apple 로 시작하기 · 준비 중
          </button>
        </CardContent>
      </Card>

      <p className="mt-6 text-xs text-slate-grey">
        계속 진행하면 mal.kr 의 서비스 이용 약관과 개인정보 처리방침에
        동의하는 것으로 간주됩니다.
      </p>
    </div>
  );
}
