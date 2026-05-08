/**
 * 말 모색(coat color) + 특징(characteristics) 기반 SVG 아바타.
 *
 * 모색 팔레트:   raw->>'color'  (갈색·밤색·흑갈색·흑색·회색·백색·청색…)
 * 얼굴 마킹:     raw->>'char1..4'  중 아래 토큰 파싱
 *   - 유성/소유성/난유성/성        → 이마 흰별 (크기가 다름)
 *   - 비량백/비량세백/단비량세백   → 콧등 세로 흰줄
 *   - 비백/비세백/비소백/단비소백  → 코끝 흰 반점
 */

import { useId } from "react";

type CoatPalette = {
  body: string;
  mane: string;
  bg: string;
};

const COAT_PALETTES: Record<string, CoatPalette> = {
  갈색:   { body: "#7A5030", mane: "#2E1508", bg: "#F4EDE2" }, // bay
  밤색:   { body: "#7A3200", mane: "#3A1400", bg: "#F4E6DA" }, // chestnut
  흑갈색: { body: "#3C2416", mane: "#180C06", bg: "#ECE4DA" }, // dark bay
  흑색:   { body: "#242424", mane: "#0E0E0E", bg: "#E8E8E6" }, // black
  회색:   { body: "#6E8090", mane: "#344048", bg: "#ECF0F2" }, // gray
  백색:   { body: "#A09080", mane: "#6A5A4A", bg: "#F5F0EA" }, // white
  청색:   { body: "#3E5A68", mane: "#22323C", bg: "#E6EEF2" }, // blue roan
  월모:   { body: "#A05040", mane: "#562820", bg: "#F2E2DC" }, // red roan
  얼룩:   { body: "#7A5030", mane: "#EDE4D6", bg: "#F0E8DC" }, // piebald
};

const DEFAULT_PALETTE: CoatPalette = {
  body: "#6C5040",
  mane: "#362018",
  bg: "#F0E8E0",
};

function getPalette(coatColor: string | null | undefined): CoatPalette {
  if (!coatColor || coatColor === "-") return DEFAULT_PALETTE;
  return COAT_PALETTES[coatColor.trim()] ?? DEFAULT_PALETTE;
}

/** 특징 배열을 flat 한 토큰 배열로 정규화 (쉼표 분리 + 공백 제거). */
export function normalizeCharacteristics(
  raw: string[] | null | undefined,
): string[] {
  if (!raw) return [];
  const out: string[] = [];
  for (const cell of raw) {
    for (const t of cell.split(",")) {
      const tok = t.trim();
      if (tok && tok !== "-") out.push(tok);
    }
  }
  return out;
}

type FaceMarkings = {
  starRadius: number;
  stripeWidth: number;
  nosePatch: number;
};

function parseFaceMarkings(tokens: string[]): FaceMarkings {
  const has = (needle: string) => tokens.some((t) => t.includes(needle));

  let starRadius = 0;
  if (has("대유성")) starRadius = 3.4;
  else if (has("난유성")) starRadius = 3.2;
  else if (has("소유성")) starRadius = 1.7;
  else if (has("유성")) starRadius = 2.4;
  else if (tokens.some((t) => t === "성")) starRadius = 1.5;

  let stripeWidth = 0;
  if (has("비량백") && !has("비량세백")) stripeWidth = 2.2;
  else if (has("비량세백") || has("단비량세백")) stripeWidth = 1.1;

  let nosePatch = 0;
  if (has("비백") && !has("비세백") && !has("비소백")) nosePatch = 1.8;
  else if (has("비소백") || has("단비소백")) nosePatch = 1.3;
  else if (has("비세백")) nosePatch = 1.0;

  return { starRadius, stripeWidth, nosePatch };
}

interface HorseAvatarProps {
  coatColor: string | null | undefined;
  characteristics?: string[] | null;
  size?: number;
  className?: string;
}

/**
 * 고전 메달리온 스타일 말 아바타 (오른쪽 방향).
 *
 * 구성:
 *   원(배경) + 이중 테두리 링
 *   곡선 경로(목 + 머리 실루엣)
 *   갈기(목 뒤 유선형) + 앞머리(poll 갈기)
 *   귀 안쪽(bg 하이라이트)
 *   눈·콧구멍·마킹(유성·비량백·비백)
 */
export function HorseAvatar({
  coatColor,
  characteristics,
  size = 40,
  className = "",
}: HorseAvatarProps) {
  const uid = useId();
  const clipId = `hc${uid.replace(/[^a-z0-9]/gi, "")}`;

  const p = getPalette(coatColor);
  const tokens = normalizeCharacteristics(characteristics);
  const marks = parseFaceMarkings(tokens);
  const whiteMark = "#F8F4EE";
  const label = [coatColor, ...tokens].filter(Boolean).join(" · ") || "말";

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label={label}
    >
      <defs>
        <clipPath id={clipId}>
          <circle cx="20" cy="20" r="19.5" />
        </clipPath>
      </defs>

      {/* 배경 원 */}
      <circle cx="20" cy="20" r="19.5" fill={p.bg} />

      <g clipPath={`url(#${clipId})`}>
        {/* 갈기 — 목 뒤 그림자 */}
        <path
          fill={p.mane}
          opacity="0.85"
          d="M 10,22 C 5,24 3,29 5,35 L 9,39 L 10,36 C 9,31 11,27 11,23 Z"
        />

        {/* 목 + 머리 실루엣 (베지어 곡선) */}
        <path
          fill={p.body}
          d="M 9,37
             C 7,30 9,22 15,17
             C 17,14 17,10 16,5
             L 18,2 L 22,9
             C 24,9 27,12 30,16
             C 33,20 36,23 37,27
             C 38,30 37,33 35,34
             C 32,35 29,34 26,32
             C 22,30 18,30 15,33
             C 12,35 10,38 9,37 Z"
        />

        {/* 앞머리 갈기 */}
        <path
          fill={p.mane}
          d="M 16,5 C 12,3 12,1 15,1 C 17,1 18,3 16,5 Z"
        />

        {/* 귀 안쪽 하이라이트 */}
        <polygon points="18,4 19.5,2 21,8" fill={p.bg} opacity="0.6" />

        {/* 유성 마킹 */}
        {marks.starRadius > 0 && (
          <circle cx="22" cy="14" r={marks.starRadius * 0.75} fill={whiteMark} />
        )}

        {/* 비량백 마킹 — 콧등 세로선 */}
        {marks.stripeWidth > 0 && (
          <rect
            x="30"
            y="19"
            width={marks.stripeWidth * 0.85}
            height="8"
            rx={marks.stripeWidth * 0.42}
            transform="rotate(35 31 23)"
            fill={whiteMark}
          />
        )}

        {/* 비백 마킹 */}
        {marks.nosePatch > 0 && (
          <circle cx="36" cy="28" r={marks.nosePatch * 0.85} fill={whiteMark} />
        )}

        {/* 눈 */}
        <ellipse cx="28" cy="16" rx="1.5" ry="1.2" fill={p.mane} />

        {/* 콧구멍 */}
        <ellipse cx="36" cy="28" rx="1.2" ry="0.85" fill={p.mane} />
      </g>

      {/* 메달리온 이중 테두리 */}
      <circle cx="20" cy="20" r="19" fill="none" stroke={p.mane} strokeWidth="0.9" opacity="0.3" />
      <circle cx="20" cy="20" r="17.5" fill="none" stroke={p.mane} strokeWidth="0.4" opacity="0.2" />
    </svg>
  );
}

/** 모색 이름 반환 (없으면 null) */
export function coatColorLabel(coatColor: string | null | undefined): string | null {
  if (!coatColor || coatColor === "-") return null;
  return coatColor.trim();
}

/**
 * 모색 색상만 사용하는 심플 원형 아바타.
 * SVG 없이 배경색 + border만으로 표현한다.
 */
export function HorseDot({
  coatColor,
  size = 40,
  className = "",
}: {
  coatColor: string | null | undefined;
  size?: number;
  className?: string;
}) {
  const p = getPalette(coatColor);
  return (
    <span
      className={`inline-flex shrink-0 rounded-full ${className}`}
      style={{
        width: size,
        height: size,
        backgroundColor: p.body,
        boxShadow: `inset 0 -2px 4px ${p.mane}55`,
        border: `2px solid ${p.mane}33`,
      }}
      aria-label={coatColor ?? "말"}
    />
  );
}
