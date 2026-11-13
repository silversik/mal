import Link from "next/link";

import { AuthMenu } from "@/components/auth-menu";
import { DisplaySettings, TextSizeToggle } from "@/components/display-settings";
import { NavLinks } from "@/components/nav-links";

/**
 * 상단 헤더 — 단일 반응형 트리.
 * 모바일: 로고 + "글씨 크게" 토글만 (주 내비는 하단 고정 바). 스크롤 시 따라오지 않아 화면을 덜 먹는다.
 * md+: sticky, 로고 + 주 내비 + 글씨 토글 + 화면 설정 + 로그인.
 */
export function Navbar() {
  return (
    <header className="theme-v2 w-full border-b border-border bg-background/90 backdrop-blur-md md:sticky md:top-0 md:z-40">
      <div className="mx-auto flex h-14 w-full max-w-[1080px] items-center justify-between gap-3 px-4 md:h-16 md:px-6">
        <div className="flex items-center gap-6">
          <Link
            href="/"
            className="font-serif text-xl font-bold tracking-tight transition-opacity hover:opacity-80 md:text-2xl"
          >
            <span className="text-brown">MAL</span>.KR
          </Link>

          <NavLinks />
        </div>

        <div className="flex items-center gap-2">
          <TextSizeToggle />
          <div className="hidden items-center gap-2 md:flex">
            <DisplaySettings />
            {/* Suspense 로 감싸지 말 것: auth()(cookies) 가 Suspense 밖에 있어야 모든 페이지가
                요청 시 렌더(ƒ)로 유지된다. 감싸면 Next 16 이 DB 를 쓰는 페이지(/analysis 등)를
                빌드 시점에 프리렌더하려다, DB 없는 Docker 빌드에서 실패한다 (2026-11 배포 미반영 사고). */}
            <AuthMenu />
          </div>
        </div>
      </div>
    </header>
  );
}
