import type { FormBreakdown, FormRow, HorseCompareSummary } from "./horses";

/**
 * 룰베이스 마필 코멘트 자동 생성 — timeform 식 한 단락 한국어 요약.
 *
 * Phase E 의 1차: 외부 LLM 호출 없이 통계 사실로 코멘트 작성.
 * 향후 LLM API 연결 시 본 함수의 입력을 그대로 prompt 에 박으면 됨.
 *
 * 입력은 lib/horses.ts 의 기존 함수 결과를 그대로 사용.
 */

export type CommentInput = {
  horse_name: string;
  total_race_count: number;
  first_place_count: number;
  recent_finishes: (number | null)[];
  avg_msf: number | null;
  best_msf: number | null;
  form: FormBreakdown;
  /** 부마 자손 통계 (옵셔널, 혈통 적성 카드 데이터) */
  sire_aggregate?: {
    parent_name: string;
    win_rate: number;
    total_children: number;
  } | null;
};

export function generateHorseComment(input: CommentInput): string {
  const lines: string[] = [];

  // 통산 한줄
  if (input.total_race_count > 0) {
    const winRate = input.first_place_count / input.total_race_count;
    const winSummary =
      input.first_place_count === 0
        ? `통산 ${input.total_race_count}전 우승 무.`
        : `통산 ${input.total_race_count}전 ${input.first_place_count}승 (승률 ${(winRate * 100).toFixed(0)}%).`;
    lines.push(winSummary);
  }

  // 최근 폼
  if (input.recent_finishes.length > 0) {
    const recentValid = input.recent_finishes.filter((r): r is number => r !== null);
    if (recentValid.length > 0) {
      const wins = recentValid.filter((r) => r === 1).length;
      const inMoney = recentValid.filter((r) => r >= 1 && r <= 3).length;
      if (wins >= 2) {
        lines.push(`최근 ${recentValid.length}전 ${wins}승 — 상승 흐름.`);
      } else if (inMoney >= recentValid.length * 0.6) {
        lines.push(
          `최근 ${recentValid.length}전 입상 ${inMoney}회 — 안정적 폼.`,
        );
      } else if (wins === 0 && inMoney <= 1) {
        lines.push(
          `최근 ${recentValid.length}전 입상 ${inMoney}회 — 폼 회복 필요.`,
        );
      }
    }
  }

  // mal지수
  if (input.avg_msf !== null && input.best_msf !== null) {
    if (input.avg_msf >= 98) {
      lines.push(
        `mal지수 평균 ${input.avg_msf.toFixed(1)} — 매 경기 1착권 근처.`,
      );
    } else if (input.avg_msf >= 95) {
      lines.push(
        `mal지수 평균 ${input.avg_msf.toFixed(1)} (최고 ${input.best_msf.toFixed(1)}) — 정상권.`,
      );
    } else if (input.avg_msf < 90) {
      lines.push(
        `mal지수 평균 ${input.avg_msf.toFixed(1)} — 1착군과 격차 존재.`,
      );
    }
  }

  // 거리 적성
  const bestDistance = pickBestForm(input.form.by_distance);
  if (bestDistance) {
    lines.push(
      `${bestDistance.bucket} 에서 ${bestDistance.starts}전 ${bestDistance.win}승 (승률 ${(bestDistance.win_rate * 100).toFixed(0)}%) — 선호 거리.`,
    );
  }

  // 주로 적성
  const bestTrack = pickBestForm(input.form.by_track_type);
  if (bestTrack && bestTrack.in_money_rate > 0.5) {
    lines.push(
      `${bestTrack.bucket} 주로에서 입상률 ${(bestTrack.in_money_rate * 100).toFixed(0)}% — 적성 우세.`,
    );
  }

  // 혈통
  if (input.sire_aggregate && input.sire_aggregate.total_children >= 5) {
    if (input.sire_aggregate.win_rate >= 0.5) {
      lines.push(
        `부마 ${input.sire_aggregate.parent_name} 자손 우승률 ${(input.sire_aggregate.win_rate * 100).toFixed(0)}% — 혈통 검증됨.`,
      );
    }
  }

  if (lines.length === 0) {
    return "통계가 부족해 자동 코멘트를 생성할 수 없습니다.";
  }

  return lines.join(" ");
}

function pickBestForm(rows: FormRow[]): FormRow | null {
  // 최소 3전 이상에서 win_rate 가 가장 높은 row.
  const candidates = rows.filter((r) => r.starts >= 3);
  if (candidates.length === 0) return null;
  return [...candidates].sort((a, b) => b.win_rate - a.win_rate)[0];
}

/** 비교 페이지용 — 두 마필 비교 코멘트. */
export function generateCompareComment(
  a: HorseCompareSummary,
  b: HorseCompareSummary,
): string {
  const aWinRate = a.total_race_count > 0 ? a.first_place_count / a.total_race_count : 0;
  const bWinRate = b.total_race_count > 0 ? b.first_place_count / b.total_race_count : 0;
  const winnerByRate = aWinRate > bWinRate ? a : b;
  const winnerByMsf =
    (a.avg_msf ?? 0) > (b.avg_msf ?? 0) ? a : b;

  const parts: string[] = [];
  parts.push(
    `${winnerByRate.horse_name} 의 통산 승률이 더 높음 (${(((winnerByRate === a ? aWinRate : bWinRate)) * 100).toFixed(0)}% vs ${(((winnerByRate === a ? bWinRate : aWinRate)) * 100).toFixed(0)}%).`,
  );
  if (winnerByMsf.avg_msf !== null && winnerByMsf !== winnerByRate) {
    parts.push(
      `다만 평균 mal지수는 ${winnerByMsf.horse_name} 가 우위 (${winnerByMsf.avg_msf.toFixed(1)}).`,
    );
  }
  return parts.join(" ");
}
