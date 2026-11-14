import Link from "next/link";

import { AuthMenu } from "@/components/auth-menu";
import { DisplaySettings } from "@/components/display-settings";
import { NavLinks } from "@/components/nav-links";

/**
 * 상단 헤더 (md+ 전용, sticky): 로고 + 주 내비 + 화면 설정(테마·글씨 크기) + 로그인.
 * 모바일은 하단 고정 바(mobile-bottom-nav)가 내비·화면 설정(더보기)을 맡아 상단 바를 두지 않는다.
 */
export function Navbar() {
  return (
    <header className="theme-v2 sticky top-0 z-40 hidden w-full border-b border-border bg-background/90 backdrop-blur-md md:block">
      <div className="mx-auto flex h-16 w-full max-w-[1080px] items-center justify-between gap-3 px-4 md:px-6">
        <div className="flex items-center gap-6">
          <Link
            href="/"
            className="font-serif text-2xl font-bold tracking-tight transition-opacity hover:opacity-80"
          >
            <span className="text-brown">MAL</span>.KR
          </Link>

          <NavLinks />
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2">
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
