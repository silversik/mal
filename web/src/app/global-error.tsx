"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error("[global-error]", error);
  }, [error]);

  return (
    <html lang="ko">
      <body className="min-h-screen flex flex-col items-center justify-center bg-background text-foreground p-6">
        <div className="max-w-md text-center space-y-4">
          <h1 className="text-2xl font-bold">문제가 발생했습니다</h1>
          <p className="text-muted-foreground text-sm">
            잠시 후 다시 시도해 주세요. 계속되면 운영자에게 알림이 전달됩니다.
          </p>
          {error.digest && (
            <p className="text-xs text-muted-foreground font-mono">
              digest: {error.digest}
            </p>
          )}
          <button
            onClick={() => unstable_retry()}
            className="mt-4 inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            다시 시도
          </button>
        </div>
      </body>
    </html>
  );
}
