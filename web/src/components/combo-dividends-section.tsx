"use client";

import { useState } from "react";
import { Dialog } from "radix-ui";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

// `@/lib/race_combo_dividends` 는 server-only (pg) 를 끌어들이므로
// 클라이언트 컴포넌트에서는 import 하지 않고 동일 타입/라벨을 인라인 유지.
// 키만 같으면 페이지에서 직렬화돼 넘어오는 객체와 그대로 호환된다.
type ComboPool = "QNL" | "QPL" | "EXA" | "TRI" | "TLA";

type RaceComboDividend = {
  pool: ComboPool;
  horse_no_1: string;
  horse_no_2: string;
  horse_no_3: string | null;
  horse_name_1: string | null;
  horse_name_2: string | null;
  horse_name_3: string | null;
  odds: string | null;
};

const POOL_LABEL: Record<ComboPool, string> = {
  QNL: "복승",
  QPL: "쌍승식",
  EXA: "쌍승",
  TRI: "삼복승",
  TLA: "삼쌍승",
};

const POOL_ORDERED: Record<ComboPool, boolean> = {
  QNL: false,
  QPL: false,
  EXA: true,
  TRI: false,
  TLA: true,
};

const POOL_ORDER: ComboPool[] = ["QNL", "QPL", "EXA", "TRI", "TLA"];
// 카드 안에 기본 노출 개수. 상삼복(TRI)·삼쌍단(TLA) 처럼 조합이 폭발적인
// 풀은 행이 수십~수백 개라 카드 높이가 페이지를 잡아먹어서, 20개 + "더보기" 모달로 분리.
const DEFAULT_LIMIT = 20;

function formatCombo(d: RaceComboDividend): string {
  const sep = POOL_ORDERED[d.pool] ? " → " : ", ";
  const parts = [
    d.horse_name_1 ? `${d.horse_no_1} ${d.horse_name_1}` : d.horse_no_1,
    d.horse_name_2 ? `${d.horse_no_2} ${d.horse_name_2}` : d.horse_no_2,
  ];
  if (d.horse_no_3) {
    parts.push(
      d.horse_name_3 ? `${d.horse_no_3} ${d.horse_name_3}` : d.horse_no_3,
    );
  }
  return parts.join(sep);
}

function formatOdds(odds: string | null): string {
  if (odds === null) return "-";
  const n = Number(odds);
  if (Number.isNaN(n)) return odds;
  return n.toFixed(1);
}

/**
 * 배당 구간 버킷.
 *   veryLow (0.0)      — 미적중·미산정 placeholder
 *   main   (< 20)      — 실제 적중 가능성 높은 메인 분석 대상
 *   mid    (20 - 70)   — 중간 배당
 *   high   (70 - 9999) — 고배당
 *   veryHigh (= 9999.9)— KRA 상한 표기 (사실상 placeholder)
 *
 * null/parse 실패는 별도 처리하지 않고 main 으로 흡수 — 일반적으로
 * race_combo_dividends 의 odds 는 항상 채워져 있어 폴백 경로다.
 */
type Bucket = "veryLow" | "main" | "mid" | "high" | "veryHigh";

const BUCKETS: Bucket[] = ["main", "mid", "high", "veryHigh", "veryLow"];

const BUCKET_LABEL: Record<Bucket, string> = {
  veryLow: "초저배당",
  main: "메인",
  mid: "중배당",
  high: "고배당",
  veryHigh: "초고배당",
};

const BUCKET_RANGE: Record<Bucket, string> = {
  veryLow: "0.0",
  main: "< 20",
  mid: "20-70",
  high: "70-9999",
  veryHigh: "9999.9",
};

function classify(d: RaceComboDividend): Bucket {
  if (d.odds === null) return "main";
  const n = Number(d.odds);
  if (!Number.isFinite(n)) return "main";
  if (n === 0) return "veryLow";
  if (n >= 9999.9) return "veryHigh";
  if (n < 20) return "main";
  if (n < 70) return "mid";
  return "high";
}

export function ComboDividendsSection({
  rows,
}: {
  rows: RaceComboDividend[];
}) {
  // 기본은 노이즈성 buckets(초저배당 0.0 · 초고배당 9999.9) 두 개를 끈 상태.
  // 메인 분석·중배당·고배당만 우선 노출 → 사용자가 칩으로 켜서 확인.
  const [activeBuckets, setActiveBuckets] = useState<Set<Bucket>>(
    () => new Set<Bucket>(["main", "mid", "high"]),
  );
  const toggleBucket = (b: Bucket) => {
    setActiveBuckets((prev) => {
      const next = new Set(prev);
      if (next.has(b)) next.delete(b);
      else next.add(b);
      return next;
    });
  };

  // 버킷별 건수 — 칩에 함께 노출, 0 인 버킷은 칩 자체를 숨겨 노이즈 제거.
  const counts: Record<Bucket, number> = {
    veryLow: 0,
    main: 0,
    mid: 0,
    high: 0,
    veryHigh: 0,
  };
  for (const r of rows) counts[classify(r)]++;

  const filteredRows = rows.filter((r) => activeBuckets.has(classify(r)));
  const byPool = new Map<ComboPool, RaceComboDividend[]>();
  for (const r of filteredRows) {
    const arr = byPool.get(r.pool) ?? [];
    arr.push(r);
    byPool.set(r.pool, arr);
  }
  const activePools = POOL_ORDER.filter(
    (p) => (byPool.get(p)?.length ?? 0) > 0,
  );

  return (
    <div className="mt-6">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-2">
        <h3 className="text-sm font-semibold text-muted-foreground">
          복식 배당
        </h3>
        <div className="flex flex-wrap items-center gap-1.5">
          {BUCKETS.map((b) => {
            const count = counts[b];
            if (count === 0) return null;
            const isActive = activeBuckets.has(b);
            return (
              <button
                key={b}
                type="button"
                onClick={() => toggleBucket(b)}
                aria-pressed={isActive}
                title={`${BUCKET_LABEL[b]} 배당 (${BUCKET_RANGE[b]})`}
                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition ${
                  isActive
                    ? "border-primary/40 bg-primary/10 text-primary hover:bg-primary/15"
                    : "border-border bg-transparent text-muted-foreground opacity-50 hover:opacity-80"
                }`}
              >
                <span>{BUCKET_LABEL[b]}</span>
                <span className="font-mono tabular-nums opacity-70">
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      {/* 좌우 슬라이드 — 카드 폭을 줄여 데스크탑에서 한 화면에 더 많은 풀이 보이게.
          (이전: lg:w-[32%] → lg:w-[23%], sm:w-[46%] → sm:w-[40%]) */}
      <div className="-mx-4 overflow-x-auto px-4 scrollbar-hide sm:mx-0 sm:px-0">
        <div className="flex snap-x snap-mandatory gap-3 pb-2">
          {activePools.length > 0 ? (
            activePools.map((pool) => (
              <PoolCard key={pool} pool={pool} items={byPool.get(pool) ?? []} />
            ))
          ) : (
            <div className="w-full rounded-lg border border-dashed py-6 text-center text-xs text-muted-foreground">
              선택한 배당 구간에 해당하는 조합이 없습니다.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PoolCard({
  pool,
  items,
}: {
  pool: ComboPool;
  items: RaceComboDividend[];
}) {
  const visible = items.slice(0, DEFAULT_LIMIT);
  const hidden = Math.max(0, items.length - DEFAULT_LIMIT);

  return (
    <Card className="w-[70%] shrink-0 snap-start py-0 sm:w-[40%] lg:w-[23%]">
      <div className="flex items-baseline justify-between border-b bg-muted/40 px-3 py-2 text-xs font-semibold tracking-wide text-muted-foreground">
        <span>
          {POOL_LABEL[pool]}{" "}
          <span className="ml-1 font-mono opacity-70">{pool}</span>
        </span>
        <span className="font-mono text-[10px] opacity-60">
          {items.length}건
        </span>
      </div>
      <div className="divide-y divide-border/40">
        {visible.map((d, i) => (
          <ComboRow key={`${pool}-${i}`} d={d} />
        ))}
      </div>
      {hidden > 0 && (
        <div className="border-t bg-muted/20 px-3 py-2">
          <ComboMoreDialog pool={pool} items={items} hidden={hidden} />
        </div>
      )}
    </Card>
  );
}

function ComboRow({ d }: { d: RaceComboDividend }) {
  return (
    <div className="flex items-center justify-between px-3 py-1.5 text-xs">
      <span className="truncate">{formatCombo(d)}</span>
      <span className="ml-2 shrink-0 font-mono tabular-nums font-semibold">
        {formatOdds(d.odds)}
      </span>
    </div>
  );
}

function ComboMoreDialog({
  pool,
  items,
  hidden,
}: {
  pool: ComboPool;
  items: RaceComboDividend[];
  hidden: number;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          className="w-full rounded-md border border-dashed border-border bg-card px-2 py-1 text-[11px] font-semibold text-muted-foreground transition hover:border-primary/40 hover:bg-muted hover:text-primary"
        >
          +{hidden}건 더보기 →
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 flex h-[85vh] w-[92vw] max-w-md -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border bg-background shadow-xl focus:outline-none">
          <div className="flex items-start justify-between border-b p-4">
            <div>
              <Dialog.Title className="text-base font-semibold">
                {POOL_LABEL[pool]}{" "}
                <span className="ml-1 font-mono text-xs opacity-70">{pool}</span>
              </Dialog.Title>
              <Dialog.Description className="mt-0.5 text-xs text-muted-foreground">
                총 {items.length}건 · 배당 오름차순
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <Button variant="ghost" size="sm" aria-label="닫기">
                닫기
              </Button>
            </Dialog.Close>
          </div>
          <div className="min-h-0 flex-1 divide-y divide-border/40 overflow-y-auto">
            {items.map((d, i) => (
              <ComboRow key={`${pool}-all-${i}`} d={d} />
            ))}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
