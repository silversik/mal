import type { FormBreakdown, FormRow, HorseCompareSummary } from "./horses";

/**
 * 기록 요약 (룰베이스) — 마필 통계 사실만으로 한 단락 한국어 요약.
 *
 * 외부 LLM 호출 없음. 숫자가 보여주는 것 이상의 평가어(상승·안정·검증 등)는 쓰지 않는다.
 * 비율은 분수와 % 를 함께 표기 ("입상 3/5 (60%)").
 *
 * 입력은 lib/horses.ts 의 기존 함수 결과를 그대로 사용.
 */

export type CommentInput = {
  horse_name: string;
  total_race_count: number;
  first_place_count: number;
  recent_finishes: (number | null)[];
  form: FormBreakdown;
  /** 부마 자손 통계 (옵셔널, 혈통 적성 카드 데이터) */
  sire_aggregate?: {
    parent_name: string;
    /** 자손 중 1승 이상 경험한 자손 비율 (winners / total_children) — 경주 승률 아님. */
    win_rate: number;
    /** 1승 이상 경험한 자손 수. */
    winners: number;
    total_children: number;
  } | null;
};

const pct = (rate: number) => `${(rate * 100).toFixed(0)}%`;
const inMoneyCount = (r: FormRow) => r.win + r.place + r.show;

export function generateHorseComment(input: CommentInput): string {
  const lines: string[] = [];

  // 통산 한줄
  if (input.total_race_count > 0) {
    const winRate = input.first_place_count / input.total_race_count;
    const winSummary =
      input.first_place_count === 0
        ? `통산 ${input.total_race_count}전 우승 무.`
        : `통산 ${input.total_race_count}전 ${input.first_place_count}승 (승률 ${pct(winRate)}).`;
    lines.push(winSummary);
  }

  // 최근 폼 — 사실만 (평가어 없음)
  const recentValid = input.recent_finishes.filter((r): r is number => r !== null);
  if (recentValid.length > 0) {
    const wins = recentValid.filter((r) => r === 1).length;
    const inMoney = recentValid.filter((r) => r >= 1 && r <= 3).length;
    if (wins >= 2) {
      lines.push(`최근 ${recentValid.length}전 ${wins}승.`);
    } else if (inMoney >= recentValid.length * 0.6 || (wins === 0 && inMoney <= 1)) {
      lines.push(`최근 ${recentValid.length}전 입상 ${inMoney}회.`);
    }
  }

  // 거리 — 1승 이상 있는 거리 중 입상률 최고
  const bestDistance = pickBestBucket(input.form.by_distance, { minWins: 1 });
  if (bestDistance) {
    lines.push(
      `거리별 입상률 최고 ${bestDistance.bucket} — 입상 ${inMoneyCount(bestDistance)}/${bestDistance.starts} (${pct(bestDistance.in_money_rate)}), ${bestDistance.win}승.`,
    );
  }

  // 주로
  const bestTrack = pickBestBucket(input.form.by_track_type);
  if (bestTrack && bestTrack.in_money_rate > 0.5) {
    lines.push(
      `${bestTrack.bucket} 주로 입상 ${inMoneyCount(bestTrack)}/${bestTrack.starts} (${pct(bestTrack.in_money_rate)}).`,
    );
  }

  // 혈통 — 자손 중 우승 경험 비율 (경주 승률 아님)
  const sire = input.sire_aggregate;
  if (sire && sire.total_children >= 5 && sire.winners >= 1) {
    lines.push(
      `부마 ${sire.parent_name} 자손 ${sire.total_children}두 중 우승 경험 ${sire.winners}두 (${pct(sire.winners / sire.total_children)}).`,
    );
  }

  if (lines.length === 0) {
    return "통계가 부족해 자동 코멘트를 생성할 수 없습니다.";
  }

  return lines.join(" ");
}

/**
 * 버킷 비교 — minStarts 이상 출전한 버킷이 2개 이상일 때만 (1개면 비교 대상 없음),
 * minWins 를 만족하는 버킷 중 입상률 → 승률 → 출전수 순으로 최고 row.
 */
function pickBestBucket(
  rows: FormRow[],
  { minStarts = 3, minWins = 0 }: { minStarts?: number; minWins?: number } = {},
): FormRow | null {
  const eligible = rows.filter((r) => r.starts >= minStarts);
  if (eligible.length < 2) return null;
  const candidates = eligible.filter((r) => r.win >= minWins);
  if (candidates.length === 0) return null;
  return [...candidates].sort(
    (a, b) =>
      b.in_money_rate - a.in_money_rate ||
      b.win_rate - a.win_rate ||
      b.starts - a.starts,
  )[0];
}

/** 비교 페이지용 — 두 마필 비교 코멘트. */
export function generateCompareComment(
  a: HorseCompareSummary,
  b: HorseCompareSummary,
): string {
  const aWinRate = a.total_race_count > 0 ? a.first_place_count / a.total_race_count : 0;
  const bWinRate = b.total_race_count > 0 ? b.first_place_count / b.total_race_count : 0;
  const winnerByRate = aWinRate > bWinRate ? a : b;

  const parts: string[] = [];
  parts.push(
    `${winnerByRate.horse_name} 의 통산 승률이 더 높음 (${(((winnerByRate === a ? aWinRate : bWinRate)) * 100).toFixed(0)}% vs ${(((winnerByRate === a ? bWinRate : aWinRate)) * 100).toFixed(0)}%).`,
  );
  return parts.join(" ");
}
