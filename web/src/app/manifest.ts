import type { MetadataRoute } from "next";

// PWA-style 메타.  background_color/theme_color 는 globals.css 와 icon.svg 에서 따옴
// (브랜드 옐로 #fcdf68 / 네이비 #1d334e).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "mal.kr — 경마 데이터 아카이브",
    short_name: "mal.kr",
    description: "한국마사회 공공데이터 기반 경마 데이터 시각화 서비스",
    start_url: "/",
    display: "standalone",
    background_color: "#f0eee9",
    theme_color: "#1d334e",
    lang: "ko-KR",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
  };
}
