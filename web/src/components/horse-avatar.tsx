/**
 * 말 모색(coat color) + 특징(characteristics) 기반 SVG 아바타.
 *
 * 모색 팔레트:   raw->>'color'  (갈색·밤색·흑갈색·흑색·회색·백색·청색…)
 * 얼굴 마킹:     raw->>'char1..4'  중 아래 토큰 파싱
 *   - 유성/소유성/난유성/성        → 이마 흰별 (크기가 다름)
 *   - 비량백/비량세백/단비량세백   → 콧등 세로 흰줄
 *   - 비백/비세백/비소백/단비소백  → 코끝 흰 반점
 *
 * 다리 마킹(좌전장백 등)이나 가마(cowlick) 는 실루엣에 드러나지 않으므로
 * 아바타에서는 생략하고 상세페이지에서 텍스트 배지로 노출한다.
 */

type CoatPalette = {
  body: string;
  mane: string;
  bg: string;
};

const COAT_PALETTES: Record<string, CoatPalette> = {
  갈색:   { body: "#8B5E3C", mane: "#2C1810", bg: "#F5EDE4" }, // bay
  밤색:   { body: "#8B3A00", mane: "#3D1A00", bg: "#F5E8DF" }, // chestnut
  흑갈색: { body: "#4A2E1C", mane: "#1A0F08", bg: "#EDE5DD" }, // dark bay
  흑색:   { body: "#2A2A2A", mane: "#111111", bg: "#E8E8E8" }, // black
  회색:   { body: "#7A8C96", mane: "#37474F", bg: "#ECF0F2" }, // gray
  백색:   { body: "#B0A090", mane: "#7A6A5A", bg: "#F5F2EE" }, // white (beige so it shows)
  청색:   { body: "#4A6370", mane: "#263238", bg: "#E8EEF1" }, // blue roan
  월모:   { body: "#A85C4A", mane: "#5E2E24", bg: "#F3E5E0" }, // red roan
  얼룩:   { body: "#8B5E3C", mane: "#F4EDE4", bg: "#F2EAE0" }, // piebald (spotted)
};

const DEFAULT_PALETTE: CoatPalette = {
  body: "#7A6050",
  mane: "#3D2B1F",
  bg: "#F0EBE5",
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
  /** 이마의 흰별 — 반지름 (없으면 0) */
  starRadius: number;
  /** 콧등 세로 흰줄 — 너비 (없으면 0) */
  stripeWidth: number;
  /** 코끝 흰반점 — 반지름 (없으면 0) */
  nosePatch: number;
};

/** 특징 토큰 → 얼굴 마킹 형태. 없으면 모두 0. */
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
 * 플랫 기하학 말 아이콘 (오른쪽 방향).
 *
 * 구성:
 *   원(배경)
 *   사다리꼴(목) + 삼각형(갈기)
 *   둥근 직사각형(머리/주둥이) + 삼각형×2(귀) + 삼각형(정수리 갈기)
 *   원(눈·콧구멍·유성·비백) + 사각형(비량백·입)
 */
export function HorseAvatar({
  coatColor,
  characteristics,
  size = 40,
  className = "",
}: HorseAvatarProps) {
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
      {/* 배경 원 */}
      <circle cx="20" cy="20" r="20" fill={p.bg} />

      {/* 갈기 (목 뒤 삼각형) — 본체 뒤에 깔림 */}
      <polygon points="4,17 11,13 8,40 3,40" fill={p.mane} />

      {/* 목 (사다리꼴) */}
      <polygon points="10,16 16,14 17,40 7,40" fill={p.body} />

      {/* 머리 + 주둥이 (가로 둥근 사각형) */}
      <rect x="12" y="10" width="24" height="14" rx="4" ry="4" fill={p.body} />

      {/* 뒷귀 (삼각형) */}
      <polygon points="14.5,10 17,2.5 19.5,10" fill={p.body} />
      {/* 앞귀 (삼각형) */}
      <polygon points="22.5,10 25,2.5 27.5,10" fill={p.body} />

      {/* 귀 안쪽 (더 작은 삼각형, 배경색으로 파낸 느낌) */}
      <polygon points="16,8.5 17,4.5 18,8.5" fill={p.bg} />
      <polygon points="24,8.5 25,4.5 26,8.5" fill={p.bg} />

      {/* 정수리 앞머리 (작은 삼각형) */}
      <polygon points="19,10 20.5,13 22,10" fill={p.mane} />

      {/* 콧등 흰줄 (비량백) — 둥근 사각형 */}
      {marks.stripeWidth > 0 && (
        <rect
          x={22}
          y={11 - marks.stripeWidth / 2 + 1.2}
          width={12}
          height={marks.stripeWidth}
          rx={marks.stripeWidth / 2}
          fill={whiteMark}
        />
      )}

      {/* 이마 흰별 (유성/성) — 원 */}
      {marks.starRadius > 0 && (
        <circle cx="18.5" cy="15.5" r={marks.starRadius} fill={whiteMark} />
      )}

      {/* 코끝 흰반점 (비백) — 원 */}
      {marks.nosePatch > 0 && (
        <circle cx="33" cy="19.5" r={marks.nosePatch} fill={whiteMark} />
      )}

      {/* 눈 (원) */}
      <circle cx="27" cy="15" r="1.3" fill={p.mane} />

      {/* 콧구멍 (원) */}
      <circle cx="33" cy="20" r="0.85" fill={p.mane} />

      {/* 입 (가로 둥근 사각형) */}
      <rect x="28.5" y="21.6" width="5.5" height="1" rx="0.5" fill={p.mane} opacity="0.5" />
    </svg>
  );
}

/** 모색 이름 반환 (없으면 null) */
export function coatColorLabel(coatColor: string | null | undefined): string | null {
  if (!coatColor || coatColor === "-") return null;
  return coatColor.trim();
}
