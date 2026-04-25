// 모의배팅 7종 풀 색상·라벨 — bet-form, /me/bets 등에서 공통 사용.

import type { BetPool } from "./bet_combinations";

export const POOL_LABEL: Record<BetPool, string> = {
  WIN: "단승",
  PLC: "연승",
  QNL: "복승",
  QPL: "쌍승식",
  EXA: "쌍승",
  TRI: "삼복승",
  TLA: "삼쌍승",
};

// Tailwind 토큰 — 풀별 정체성. 활성/배지/테두리 3종 변형.
// active: 풀 탭이 선택된 상태 (배경 채움)
// chip:   /me/bets 의 작은 풀 배지
// soft:   미선택 상태에서 호버시 살짝 보이는 색상 (현재 미사용 — 확장 여지)
type PoolStyle = {
  active: string;
  chip: string;
};

export const POOL_STYLE: Record<BetPool, PoolStyle> = {
  WIN: {
    active: "border-rose-500 bg-rose-500 text-white",
    chip: "border-rose-500/40 bg-rose-500/10 text-rose-700",
  },
  PLC: {
    active: "border-orange-500 bg-orange-500 text-white",
    chip: "border-orange-500/40 bg-orange-500/10 text-orange-700",
  },
  QNL: {
    active: "border-amber-500 bg-amber-500 text-white",
    chip: "border-amber-500/40 bg-amber-500/10 text-amber-700",
  },
  QPL: {
    active: "border-lime-600 bg-lime-600 text-white",
    chip: "border-lime-600/40 bg-lime-600/10 text-lime-700",
  },
  EXA: {
    active: "border-emerald-600 bg-emerald-600 text-white",
    chip: "border-emerald-600/40 bg-emerald-600/10 text-emerald-700",
  },
  TRI: {
    active: "border-sky-600 bg-sky-600 text-white",
    chip: "border-sky-600/40 bg-sky-600/10 text-sky-700",
  },
  TLA: {
    active: "border-violet-600 bg-violet-600 text-white",
    chip: "border-violet-600/40 bg-violet-600/10 text-violet-700",
  },
};
