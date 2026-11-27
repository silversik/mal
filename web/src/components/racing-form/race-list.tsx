import {
  finishRankOf,
  formRacePath,
  MARK_LABEL,
  pickOutcome,
  RULE_LABEL,
  RULE_ORDER,
  type ConsensusPickV1,
  type FrontRaceV1,
  type FrontRunnerV1,
  type OutcomeRow,
} from "@/lib/racing_form-shared";

import { RaceListRows } from "./race-list-rows";

export type RaceRowResult =
  | { kind: "rank"; rank: number | null }
  | { kind: "void" };

/** 주목마 한 마리 — 1면 버튼과 팝업이 함께 쓴다 (직렬화되는 평문만). */
export type RacePickView = {
  chulNo: number;
  horseName: string;
  /** 예상을 낸 기준이 모두 고름 → "주목" 뱃지. 그 밖의 주목마는 뱃지 없이 버튼만. */
  strong: boolean;
  /** 고른 기준 — 기준 고정 순서로 "레이팅 1순위" (기호 대신 글자) */
  marks: string[];
  /** 근거 (최대 2) */
  reasons: string[];
  reasonsMore: number;
  /** 이 말의 결과 (정산 행이 있을 때만) */
  result: RaceRowResult | null;
};

export type RaceListRow = {
  raceNo: number;
  /** 경주면 */
  href: string;
  /** 대상경주 이름 (일반 경주명은 싣지 않는다) */
  stakes: string | null;
  /** 주목마 — 1순위 먼저, 최대 2. 없거나(혼전·기준 부족·소두수) 예상을 숨긴 호면 [] — 행을 비운다. */
  picks: RacePickView[];
};

/** 1면 경주 한 줄 재료 — payload(1면 조각) + 정산. */
export function buildRaceRows(args: {
  date: string;
  meet: string;
  races: readonly FrontRaceV1[];
  runners: readonly FrontRunnerV1[];
  outcomes: readonly OutcomeRow[];
  hidePicks: boolean;
}): RaceListRow[] {
  const nameOf = (raceNo: number, horseNo: string) =>
    args.runners.find((u) => u.race_no === raceNo && u.horse_no === horseNo)?.horse_name ?? horseNo;
  return args.races.map((r) => {
    const outcome = args.outcomes.find((o) => o.race_no === r.race_no) ?? null;
    const view = (p: ConsensusPickV1): RacePickView => {
      let result: RaceRowResult | null = null;
      if (outcome) {
        result =
          pickOutcome(p.horse_no, outcome) === "void"
            ? { kind: "void" }
            : { kind: "rank", rank: finishRankOf(outcome, p.horse_no) };
      }
      return {
        chulNo: p.chul_no,
        horseName: nameOf(r.race_no, p.horse_no),
        strong: p.votes === r.consensus.active_rules,
        marks: RULE_ORDER.flatMap((k) => {
          const m = p.marks[k];
          return m === undefined ? [] : [`${RULE_LABEL[k]} ${MARK_LABEL[m]}`];
        }),
        reasons: [...p.reasons],
        reasonsMore: p.reasons_more,
        result,
      };
    };
    const picks =
      args.hidePicks || r.consensus.status !== "picked"
        ? []
        : [...r.consensus.picks].sort((a, b) => a.mark - b.mark).map(view);
    return {
      raceNo: r.race_no,
      href: formRacePath(args.date, args.meet, r.race_no),
      stakes: r.stakes ? `${r.stakes.name}${r.stakes.grade ? ` (${r.stakes.grade})` : ""}` : null,
      picks,
    };
  });
}

/**
 * 1면 경주별 주목마 (DESIGN.md Decisions Log 2026-11-27) — 1R 부터 한 줄씩.
 * "3R · [3 글로벌히트] 주목 · 결과" — 라운드(경주면 링크) + 주목마 버튼(누르면 요약 팝업).
 * 주목마가 없는 경주는 설명 없이 비운다. 발주 시각·"기준 n개 중 m개" 문구는 싣지 않는다
 * (고른 기준과 근거는 팝업에). 단일 DOM — 좁은 화면에서는 같은 행이 접힌다.
 */
export function RaceList({ rows }: { rows: readonly RaceListRow[] }) {
  return <RaceListRows rows={rows} />;
}
