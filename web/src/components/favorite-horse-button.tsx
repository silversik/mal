"use client";

import { useState, useTransition } from "react";

import { toggleFavoriteAction } from "@/app/horse/[horse_no]/actions";

type Props = {
  horseNo: string;
  initialFavorited: boolean;
  /** 비로그인 사용자도 ★ 보이지만 클릭 시 /login 으로. */
  loggedIn: boolean;
  className?: string;
};

/**
 * 마필 즐겨찾기 토글 버튼.
 * - 비로그인: 클릭 시 server action 이 /login?next=… 로 redirect.
 * - 로그인: 옵티미스틱 토글 후 server action 호출.
 */
export function FavoriteHorseButton({
  horseNo,
  initialFavorited,
  loggedIn,
  className = "",
}: Props) {
  const [favorited, setFavorited] = useState(initialFavorited);
  const [pending, startTransition] = useTransition();

  const onClick = () => {
    // 비로그인은 옵티미스틱 토글하지 않고 그대로 server action — redirect 가 일어남.
    if (loggedIn) setFavorited((v) => !v);
    startTransition(async () => {
      try {
        const r = await toggleFavoriteAction(horseNo);
        setFavorited(r.favorited);
      } catch {
        // server action redirect 는 throw 로 흐름 종료 — 상태 롤백 불필요.
      }
    });
  };

  const label = favorited ? "즐겨찾기 해제" : "즐겨찾기 추가";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      aria-label={label}
      title={loggedIn ? label : "로그인 후 즐겨찾기"}
      className={
        "inline-flex items-center justify-center rounded-full p-2 transition " +
        "hover:bg-accent disabled:opacity-50 " +
        (favorited ? "text-yellow-500" : "text-muted-foreground/60 hover:text-yellow-500") +
        (className ? ` ${className}` : "")
      }
    >
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill={favorited ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
      </svg>
    </button>
  );
}
