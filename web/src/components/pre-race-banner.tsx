"use client";

import { useEffect, useState } from "react";

/**
 * 경주 시작 전 배너 — gold-tinted bg + 1초 단위 카운트다운.
 * start_time 이 없으면 단순 안내 텍스트만 노출.
 */
export function PreRaceBanner({
  raceDate,
  startTime,
}: {
  raceDate: string;
  startTime: string | null;
}) {
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    if (!startTime) return;
    // start_time 은 "HH:MM" 또는 "HH:MM:SS" 형식. KST(Asia/Seoul) 기준 race_date 발주 시각.
    const [hStr, mStr, sStr] = startTime.split(":");
    const h = Number(hStr);
    const m = Number(mStr);
    const s = sStr ? Number(sStr) : 0;
    if (!Number.isFinite(h) || !Number.isFinite(m)) return;

    const target = new Date(`${raceDate}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}+09:00`).getTime();

    const tick = () => {
      const diff = target - Date.now();
      setRemaining(diff);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [raceDate, startTime]);

  return (
    // 그라디언트·깜빡이는 ping 점 제거(DESIGN: 장식 그라디언트·장식 모션 금지) — 단색 카드 + 상태 점.
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border bg-card px-4 py-3 text-base text-foreground">
      <span aria-hidden="true" className="inline-flex h-2.5 w-2.5 rounded-full bg-brown" />
      <span>
        <strong>출전표</strong> · 경주 시작 전, 결과는 발주 직후 갱신됩니다.
      </span>
      {remaining !== null && (
        <span className="ml-auto font-mono font-bold tabular-nums text-brown">
          {formatCountdown(remaining)}
        </span>
      )}
    </div>
  );
}

function formatCountdown(ms: number): string {
  if (ms <= 0) return "발주 시간 도달";
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `발주까지 ${h}시간 ${String(m).padStart(2, "0")}분`;
  if (m > 0) return `발주까지 ${m}분 ${String(s).padStart(2, "0")}초`;
  return `발주까지 ${s}초`;
}
