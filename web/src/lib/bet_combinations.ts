// 한국 경마 마권 7종의 조합 enumeration + canonical key 생성.
// 순수 함수만 둠 (DB·React 의존성 없음 → 단위테스트 쉽게).

export type BetPool = "WIN" | "PLC" | "QNL" | "QPL" | "EXA" | "TRI" | "TLA";
export type BetKind = "STRAIGHT" | "BOX" | "FORMATION";

// 슬롯 수: 한 조합이 갖는 chul_no 자릿수
export const SLOTS: Record<BetPool, 1 | 2 | 3> = {
  WIN: 1,
  PLC: 1,
  QNL: 2,
  QPL: 2,
  EXA: 2,
  TRI: 3,
  TLA: 3,
};

// 순서 의미 여부 (race_combo_dividends.combo_key 규칙과 동일)
export const ORDERED: Record<BetPool, boolean> = {
  WIN: false,
  PLC: false,
  QNL: false,
  QPL: false,
  EXA: true,
  TRI: false,
  TLA: true,
};

export type StraightInput = { kind: "STRAIGHT"; horses: number[] };
export type BoxInput = { kind: "BOX"; horses: number[] };
// 포메이션: slots[i] = i+1 슬롯 후보 chul_no 목록 (EXA/TLA의 1·2(·3)착 축 형태)
// QNL/QPL/TRI 처럼 unordered pool 도 "1두 축 + 상대 다수" 형태를 지원하기 위해 슬롯 단위로 받음.
export type FormationInput = { kind: "FORMATION"; slots: number[][] };
export type SelectionInput = StraightInput | BoxInput | FormationInput;

// pool 별 입력 유효성 검사. 잘못되면 throw — 호출자가 BAD_INPUT 으로 변환.
export function validateSelection(pool: BetPool, sel: SelectionInput): void {
  const slots = SLOTS[pool];
  if (sel.kind === "STRAIGHT") {
    if (sel.horses.length !== slots) {
      throw new Error(`STRAIGHT ${pool} requires exactly ${slots} horses`);
    }
    assertUnique(sel.horses);
  } else if (sel.kind === "BOX") {
    if (sel.horses.length < slots) {
      throw new Error(`BOX ${pool} requires at least ${slots} horses`);
    }
    assertUnique(sel.horses);
  } else {
    if (sel.slots.length !== slots) {
      throw new Error(`FORMATION ${pool} requires exactly ${slots} slot lists`);
    }
    sel.slots.forEach((s, i) => {
      if (s.length === 0) throw new Error(`FORMATION slot ${i} is empty`);
      assertUnique(s);
    });
  }
}

function assertUnique(arr: number[]) {
  const set = new Set(arr);
  if (set.size !== arr.length) throw new Error("duplicate chul_no in selection");
}

// 조합 enumerate. 결과: number[][] — 각 inner 배열이 한 조합 (slots[pool] 길이).
export function enumerateCombos(
  pool: BetPool,
  sel: SelectionInput,
): number[][] {
  validateSelection(pool, sel);
  const slots = SLOTS[pool];
  const ordered = ORDERED[pool];

  if (sel.kind === "STRAIGHT") {
    return [sel.horses.slice()];
  }

  if (sel.kind === "BOX") {
    return enumerateBox(sel.horses, slots, ordered);
  }

  // FORMATION
  return enumerateFormation(sel.slots, ordered);
}

function enumerateBox(horses: number[], slots: 1 | 2 | 3, ordered: boolean): number[][] {
  const out: number[][] = [];
  const n = horses.length;
  if (slots === 1) {
    for (const h of horses) out.push([h]);
    return out;
  }
  if (slots === 2) {
    if (ordered) {
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          if (i === j) continue;
          out.push([horses[i], horses[j]]);
        }
      }
    } else {
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          out.push([horses[i], horses[j]]);
        }
      }
    }
    return out;
  }
  // slots === 3
  if (ordered) {
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        for (let k = 0; k < n; k++) {
          if (k === i || k === j) continue;
          out.push([horses[i], horses[j], horses[k]]);
        }
      }
    }
  } else {
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        for (let k = j + 1; k < n; k++) {
          out.push([horses[i], horses[j], horses[k]]);
        }
      }
    }
  }
  return out;
}

function enumerateFormation(slots: number[][], ordered: boolean): number[][] {
  // slots[i] 는 i번째 슬롯의 후보 chul_no 목록. unordered pool 도 슬롯 단위 입력을
  // 그대로 사용하되, 결과 조합을 canonical 정렬해 set 중복을 제거.
  const out: number[][] = [];
  const seen = new Set<string>();

  const recurse = (depth: number, picked: number[]) => {
    if (depth === slots.length) {
      const canonical = ordered ? picked.slice() : [...picked].sort((a, b) => a - b);
      const key = canonical.join("-");
      if (!seen.has(key)) {
        seen.add(key);
        out.push(picked.slice());
      }
      return;
    }
    for (const h of slots[depth]) {
      if (picked.includes(h)) continue; // 같은 말이 두 슬롯에 들어갈 수 없음
      picked.push(h);
      recurse(depth + 1, picked);
      picked.pop();
    }
  };
  recurse(0, []);
  return out;
}

// race_combo_dividends.combo_key 와 동일 규칙으로 canonical key 생성.
//   unordered (QNL/QPL/TRI): 오름차순 정렬 후 "-" join
//   ordered (EXA/TLA): 원순서 그대로 "-" join
//   WIN/PLC: 단일 chul_no
export function canonicalComboKey(pool: BetPool, combo: number[]): string {
  const arr = ORDERED[pool] ? combo : [...combo].sort((a, b) => a - b);
  return arr.join("-");
}

export function comboCount(pool: BetPool, sel: SelectionInput): number {
  return enumerateCombos(pool, sel).length;
}
