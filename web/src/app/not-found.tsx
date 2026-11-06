import type { Metadata } from "next";
import Link from "next/link";

// notFound() 호출 + 매칭 안 되는 URL 공용 404. noindex 는 Next 가 자동 주입.
export const metadata: Metadata = {
  title: "페이지를 찾을 수 없습니다",
};

export default function NotFound() {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-16 space-y-6">
      <div className="space-y-3">
        <p className="text-small font-mono tabular-nums text-muted-foreground">404</p>
        <h1 className="text-[1.3125rem] font-bold tracking-tight text-balance">
          페이지를 찾을 수 없습니다
        </h1>
        <p className="text-base leading-relaxed text-muted-foreground">
          주소가 바뀌었거나 삭제된 페이지입니다. 아래에서 다시 찾아보세요.
        </p>
      </div>
      <div className="flex flex-wrap gap-3">
        <Link
          href="/races"
          className="inline-flex min-h-[max(44px,2.75rem)] items-center justify-center rounded-[6px] bg-secondary px-5 text-base font-semibold text-secondary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          경주 결과 보기
        </Link>
        <Link
          href="/"
          className="inline-flex min-h-[max(44px,2.75rem)] items-center justify-center rounded-[6px] border border-border bg-card px-5 text-base font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          홈으로
        </Link>
      </div>
    </div>
  );
}
