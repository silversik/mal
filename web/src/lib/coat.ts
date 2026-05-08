// 말 모색(coat color) → 색상 hex / 라벨 helper.
// SVG 아바타 렌더링은 brand/HorseMark 가 담당하고, 여기서는 모색별 색상만 노출.

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

export function coatBodyHex(coatColor: string | null | undefined): string {
  return getPalette(coatColor).body;
}

export function coatBgHex(coatColor: string | null | undefined): string {
  return getPalette(coatColor).bg;
}

export function coatColorLabel(coatColor: string | null | undefined): string | null {
  if (!coatColor || coatColor === "-") return null;
  return coatColor.trim();
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
