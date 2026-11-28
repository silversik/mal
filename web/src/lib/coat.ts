// 말 모색(coat color) → 실루엣 색 / 라벨 helper.
// 아이콘 렌더링은 components/coat-horse-mark 가 담당한다. 배경은 모든 말이 같은
// 중립 토큰(--muted + hairline 테두리)이고, 모색은 말 실루엣 fill 에만 쓴다 —
// 밝은 모색(백색)·어두운 모색(흑색, 다크 모드)은 실루엣 윤곽선으로 배경과 구분.

const COAT_BODY: Record<string, string> = {
  갈색: "#7A5030", // bay
  밤색: "#7A3200", // chestnut
  흑갈색: "#3C2416", // dark bay
  흑색: "#242424", // black
  회색: "#7C8A96", // gray
  백색: "#D2C7B9", // white — 윤곽선이 배경과 구분
  청색: "#3E5A68", // blue roan
  월모: "#A05040", // red roan
  얼룩: "#7A5030", // piebald
};

const DEFAULT_BODY = "#6C5040";

export function coatBodyHex(coatColor: string | null | undefined): string {
  if (!coatColor || coatColor === "-") return DEFAULT_BODY;
  return COAT_BODY[coatColor.trim()] ?? DEFAULT_BODY;
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
