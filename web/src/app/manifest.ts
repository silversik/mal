import type { MetadataRoute } from "next";

// PWA-style 메타. 브랜드 = "가죽 배지"(DESIGN.md Brand): brown #7A4A2B 배지 + 크림 #EFE8DD 말.
// background/theme 은 헤더 배경(paper #EFE8DD)과 맞춰 주소창이 페이지와 이어지게.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "mal.kr — 경마 데이터 아카이브",
    short_name: "mal.kr",
    description: "한국마사회 공공데이터 기반 경마 데이터 시각화 서비스",
    start_url: "/",
    display: "standalone",
    background_color: "#EFE8DD",
    theme_color: "#EFE8DD",
    lang: "ko-KR",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
  };
}
