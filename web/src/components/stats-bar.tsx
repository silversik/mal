/**
 * 통산 출전 + 1·2·3착을 하나의 가로 stacked bar 로 묶어서 보여주는 위젯.
 * 우측 상단에 승률 + 입상률 (TOP3 도달률).
 *
 * 사용: 마필/기수 ProfileCard 의 KPI 5개 row 를 대체.
 */
// 1착 brown → 2착 brown 55% → 3착 brown-pale 의 단색 순차 램프. 예전 2착 muted-ink 는
// 1착 brown 과 휘도가 같아(1.12:1) 막대에서 1·2착이 한 덩어리로 보였다.
const SECOND = "color-mix(in srgb, var(--brown) 55%, var(--surface))";

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
          <span className="text-caption font-semibold uppercase tracking-wider text-muted-foreground">
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
            className="h-full border-r border-card"
            style={{ width: widthFor(win), background: "var(--color-gold)" }}
            title={`1착 ${win}회 (${winRate.toFixed(1)}%)`}
          />
        )}
        {place > 0 && (
          <div
            className="h-full border-r border-card"
            style={{ width: widthFor(place), background: SECOND }}
            title={`2착 ${place}회 (${placeRate.toFixed(1)}%)`}
          />
        )}
        {show > 0 && (
          <div
            className="h-full border-r border-card"
            style={{ width: widthFor(show), background: "var(--brown-pale)" }}
            title={`3착 ${show}회 (${showRate.toFixed(1)}%)`}
          />
        )}
      </div>

      {/* 범례 + 카운트 */}
      <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-small sm:grid-cols-4">
        <LegendItem
          color="var(--color-gold)"
          label="1착"
          count={win}
          rate={winRate}
        />
        <LegendItem color={SECOND} label="2착" count={place} rate={placeRate} />
        <LegendItem color="var(--brown-pale)" label="3착" count={show} rate={showRate} />
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
    <div className="flex min-w-0 items-center gap-1.5">
      <span
        aria-hidden
        className={`inline-block h-3 w-3 shrink-0 rounded-sm ${
          neutral ? "border border-border" : ""
        }`}
        style={{ background: color }}
      />
      <span className="shrink-0 font-semibold text-muted-foreground">{label}</span>
      <span className="ml-auto font-mono tabular-nums text-foreground">
        {count.toLocaleString()}
      </span>
      <span className="shrink-0 font-mono text-muted-foreground tabular-nums">
        {rate.toFixed(0)}%
      </span>
    </div>
  );
}
