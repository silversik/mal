// 베팅 마감 시각 계산 — 클라이언트 카운트다운 보조용. 서버 측 진실원은 lib/bets.ts:getRaceLockState.
//
// races.start_time 이 있으면 그 시각, 없으면 race_date 자정(KST) fallback.
// `${raceDate}T${HH:MM}:00+09:00` 포맷으로 명시적 KST 오프셋을 박아서 timezone 모호성 제거.

export function computeCutoffMs(
  raceDate: string,
  startTime: string | null,
): number {
  if (startTime) {
    return Date.parse(`${raceDate}T${startTime}:00+09:00`);
  }
  // start_time 미제공 → 자정 KST = 다음날 00:00 KST
  const ms = Date.parse(`${raceDate}T00:00:00+09:00`);
  return ms + 24 * 60 * 60 * 1000;
}
