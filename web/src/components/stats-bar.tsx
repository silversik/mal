/**
 * 통산 출전 + 1·2·3착을 하나의 가로 stacked bar 로 묶어서 보여주는 위젯.
 * 우측 상단에 승률 + 입상률 (TOP3 도달률).
 *
 * 사용: 마필/기수 ProfileCard 의 KPI 5개 row 를 대체.
 */
export function StatsBar({
  total,
  win,
  place,
  show,
}: {
  total: number;
  win: number;
  place: number;
  show: number;
}) {
  const safeTotal = Math.max(0, total);
  const other = Math.max(0, safeTotal - win - place - show);

  const pct = (n: number) =>
    safeTotal === 0 ? 0 : Math.round((n / safeTotal) * 1000) / 10;

  const winRate = pct(win);
  const placeRate = pct(place);
  const showRate = pct(show);
  const top3Rate = Math.round(((win + place + show) / Math.max(1, safeTotal)) * 1000) / 10;

  const widthFor = (n: number) =>
    safeTotal === 0 ? "0%" : `${(n / safeTotal) * 100}%`;

  return (
    <div className="rounded-[10px] border border-border bg-card p-4">
      {/* 상단: 출전 + 승률 / 입상률 */}
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            통산 출전
          </span>
          <span className="font-mono text-2xl font-bold tabular-nums text-foreground">
            {safeTotal.toLocaleString()}
          </span>
          <span className="text-xs font-medium text-muted-foreground">회</span>
        </div>
        <div className="flex items-baseline gap-3 text-xs">
          <span className="inline-flex items-baseline gap-1">
            <span className="font-semibold uppercase tracking-wider text-muted-foreground">
              승률
            </span>
            <span className="font-mono text-base font-bold tabular-nums text-primary">
              {winRate.toFixed(1)}
            </span>
            <span className="text-muted-foreground">%</span>
          </span>
          <span className="h-3 w-px self-center bg-border" aria-hidden />
          <span className="inline-flex items-baseline gap-1">
            <span className="font-semibold uppercase tracking-wider text-muted-foreground">
              입상률
            </span>
            <span className="font-mono text-base font-bold tabular-nums text-[var(--color-gold-ink)]">
              {top3Rate.toFixed(1)}
            </span>
            <span className="text-muted-foreground">%</span>
          </span>
        </div>
      </div>

      {/* Stacked bar */}
      <div
        className="flex h-7 w-full overflow-hidden rounded-md border border-border bg-muted"
        role="img"
        aria-label={`1착 ${win}회, 2착 ${place}회, 3착 ${show}회, 미입상 ${other}회`}
      >
        {win > 0 && (
          <div
            className="h-full"
            style={{ width: widthFor(win), background: "var(--color-gold)" }}
            title={`1착 ${win}회 (${winRate.toFixed(1)}%)`}
          />
        )}
        {place > 0 && (
          <div
            className="h-full"
            style={{ width: widthFor(place), background: "#cbd5e1" }}
            title={`2착 ${place}회 (${placeRate.toFixed(1)}%)`}
          />
        )}
        {show > 0 && (
          <div
            className="h-full"
            style={{ width: widthFor(show), background: "#b45309" }}
            title={`3착 ${show}회 (${showRate.toFixed(1)}%)`}
          />
        )}
      </div>

      {/* 범례 + 카운트 */}
      <div className="mt-2 grid grid-cols-4 gap-2 text-[11px]">
        <LegendItem
          color="var(--color-gold)"
          label="1착"
          count={win}
          rate={winRate}
        />
        <LegendItem color="#cbd5e1" label="2착" count={place} rate={placeRate} />
        <LegendItem color="#b45309" label="3착" count={show} rate={showRate} />
        <LegendItem
          color="var(--muted)"
          label="미입상"
          count={other}
          rate={pct(other)}
          neutral
        />
      </div>
    </div>
  );
}

function LegendItem({
  color,
  label,
  count,
  rate,
  neutral,
}: {
  color: string;
  label: string;
  count: number;
  rate: number;
  neutral?: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span
        aria-hidden
        className={`inline-block h-2.5 w-2.5 shrink-0 rounded-sm ${
          neutral ? "border border-border" : ""
        }`}
        style={{ background: color }}
      />
      <span className="font-semibold text-muted-foreground">{label}</span>
      <span className="ml-auto font-mono tabular-nums text-foreground">
        {count.toLocaleString()}
      </span>
      <span className="font-mono text-muted-foreground tabular-nums">
        {rate.toFixed(0)}%
      </span>
    </div>
  );
}
