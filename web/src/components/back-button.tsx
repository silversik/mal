"use client";

import { useRouter } from "next/navigation";

/**
 * 뒤로 가기 버튼 — 히스토리가 있으면 router.back(),
 * 직접 접속(referrer 없음/타도메인)이면 fallback URL 로 이동.
 */
export function BackButton({
  fallback = "/",
  label = "뒤로",
  className = "",
}: {
  fallback?: string;
  label?: string;
  className?: string;
}) {
  const router = useRouter();

  function onClick() {
    const hasReferrer =
      typeof document !== "undefined" &&
      document.referrer &&
      new URL(document.referrer).origin === window.location.origin;
    if (hasReferrer && window.history.length > 1) {
      router.back();
    } else {
      router.push(fallback);
    }
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-semibold text-muted-foreground transition hover:border-primary/40 hover:text-primary ${className}`}
    >
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M15 6l-6 6 6 6" />
      </svg>
      {label}
    </button>
  );
}
