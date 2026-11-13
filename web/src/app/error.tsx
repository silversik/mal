"use client"; // error boundary 는 Client Component 여야 함 (Next 16 error.js 규약)

import Link from "next/link";
import { useEffect } from "react";

// 루트 세그먼트 error boundary — 페이지 렌더/데이터 오류 시 헤더·푸터는 유지한 채 이 화면.
// 루트 layout 자체 오류는 global-error.tsx 가 처리.
export default function RootError({
  error,
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  useEffect(() => {
    console.error("[error]", error);
  }, [error]);

  // 서버 컴포넌트 오류는 prod 에서 message 가 가려지고 digest 만 온다 → 서버 로그 대조용.
  const digest =
    error instanceof Error && "digest" in error && typeof error.digest === "string"
      ? error.digest
      : null;

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-16 space-y-6">
      <div className="space-y-3">
        <h1 className="text-[1.3125rem] font-bold tracking-tight text-balance">
          페이지를 불러오지 못했습니다
        </h1>
        <p className="text-base leading-relaxed text-muted-foreground">
          일시적인 문제일 수 있습니다. 잠시 후 다시 시도해 주세요.
        </p>
        {digest && (
          <p className="text-small font-mono tabular-nums text-muted-foreground">
            오류 코드: {digest}
          </p>
        )}
      </div>
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => retry()}
          className="inline-flex min-h-[max(44px,2.75rem)] items-center justify-center rounded-[6px] bg-secondary px-4 text-base font-semibold text-secondary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          다시 시도
        </button>
        <Link
          href="/"
          className="inline-flex min-h-[max(44px,2.75rem)] items-center justify-center rounded-[6px] border border-border bg-card px-4 text-base font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          홈으로
        </Link>
      </div>
    </div>
  );
}
