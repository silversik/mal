import type { MetadataRoute } from "next";

// 운영 도메인은 mal.kr 단일. http://www.mal.kr 으로의 색인은 nginx 단에서 redirect.
const SITE = "https://mal.kr";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/api/",         // 내부/외부 API endpoint
          "/me/",          // 사용자 대시보드 (로그인 필요)
          "/me",
          "/notifications",
          "/login",
          "/board/new",    // 글쓰기 폼 — 본문 없음
        ],
      },
    ],
    sitemap: `${SITE}/sitemap.xml`,
    host: SITE,
  };
}
