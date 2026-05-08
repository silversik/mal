import { ImageResponse } from "next/og";

// 사이트 전체 기본 OG 이미지 (1200×630).  카카오톡/X/Facebook 공유 시 미리보기.
// 페이지별 OG 이미지가 필요하면 같은 디렉터리에 opengraph-image.tsx 를 추가하면
// 가까운 것이 우선 (Next 16 file convention).
export const alt = "mal.kr — 경마 데이터 아카이브";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background:
            "linear-gradient(135deg, #fcdf68 0%, #fcdf68 55%, #f5d44a 100%)",
          color: "#1d334e",
          fontFamily: "serif",
        }}
      >
        <div
          style={{
            fontSize: 200,
            fontWeight: 800,
            letterSpacing: "-0.04em",
            lineHeight: 1,
          }}
        >
          mal.kr
        </div>
        <div
          style={{
            marginTop: 32,
            fontSize: 44,
            fontWeight: 600,
            opacity: 0.8,
          }}
        >
          경마 데이터 아카이브
        </div>
        <div
          style={{
            marginTop: 16,
            fontSize: 28,
            opacity: 0.65,
          }}
        >
          한국마사회 공공데이터 기반 시각화
        </div>
      </div>
    ),
    { ...size },
  );
}
