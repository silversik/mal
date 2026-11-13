import { ImageResponse } from "next/og";

import { HORSE_PATH } from "@/components/brand/logo";

// 사이트 전체 기본 OG 이미지 (1200×630). 카카오톡/X/Facebook 공유 시 미리보기.
// 페이지별 OG 이미지가 필요하면 같은 디렉터리에 opengraph-image.tsx 를 추가하면
// 가까운 것이 우선 (Next 16 file convention).
// 브랜드 "가죽 배지"(DESIGN.md Brand): paper 단색 배경 + brown 배지 마크 + ink 제목.
// 그라디언트·투명 텍스트 없음 — 작은 썸네일로 줄어도 읽히도록 대비 우선.
export const alt = "mal.kr — 경마 데이터 아카이브";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const PAPER = "#EFE8DD";
const INK = "#2A1C12";
const MUTED = "#5C4C3E";
const BROWN = "#7A4A2B";

export default async function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          padding: "0 96px",
          gap: 64,
          background: PAPER,
          color: INK,
        }}
      >
        <div
          style={{
            width: 280,
            height: 280,
            borderRadius: 48,
            background: BROWN,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <svg width="230" height="161" viewBox="-3 17 106 74">
            <path fillRule="evenodd" clipRule="evenodd" d={HORSE_PATH} fill={PAPER} />
          </svg>
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              fontSize: 150,
              fontWeight: 800,
              letterSpacing: "-0.04em",
              lineHeight: 1,
              color: INK,
            }}
          >
            mal.kr
          </div>
          <div style={{ marginTop: 28, fontSize: 52, fontWeight: 700, color: BROWN }}>
            경마 데이터 아카이브
          </div>
          <div style={{ marginTop: 14, fontSize: 34, color: MUTED }}>
            한국마사회 공공데이터 기반 시각화
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
