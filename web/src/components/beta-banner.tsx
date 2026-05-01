"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "beta-banner-dismissed-v1";

/**
 * 사이트 최상단 베타 안내 띠. 사용자가 × 로 닫으면 localStorage 에 기록해
 * 같은 브라우저에서는 다시 표시하지 않는다 (버전 키를 바꾸면 재노출).
 *
 * SSR 시점에는 항상 그려두고, 클라이언트 마운트 직후 dismissed 상태면 숨김 —
 * 깜빡임을 줄이려고 첫 페인트는 살짝 투명. 정상 흐름이면 거의 인식 불가.
 */
export function BetaBanner() {
  const [dismissed, setDismissed] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(STORAGE_KEY) === "1") setDismissed(true);
    } catch {
      // 사파리 프라이빗 모드 등 — 그냥 노출.
    }
    setHydrated(true);
  }, []);

  if (dismissed) return null;

  return (
    <div
      role="status"
      className={
        "border-b border-amber-300/50 bg-amber-50 text-amber-900 transition-opacity " +
        (hydrated ? "opacity-100" : "opacity-90")
      }
    >
      <div className="mx-auto flex w-full max-w-6xl items-center justify-center gap-2 px-6 py-2 text-xs sm:text-[13px]">
        <span className="shrink-0 rounded bg-amber-500/25 px-1.5 py-0.5 font-bold tracking-wide">
          BETA
        </span>
        <span className="text-center">
          현재 서비스는 <strong>베타 테스트 중</strong>입니다 — 일부 데이터·기능이 변경되거나
          일시 중단될 수 있습니다.
        </span>
        <button
          type="button"
          aria-label="배너 닫기"
          onClick={() => {
            try {
              localStorage.setItem(STORAGE_KEY, "1");
            } catch {
              // ignore
            }
            setDismissed(true);
          }}
          className="ml-1 shrink-0 rounded p-1 text-amber-900/60 transition hover:bg-amber-500/15 hover:text-amber-900"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    </div>
  );
}
