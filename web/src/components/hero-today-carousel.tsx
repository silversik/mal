"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

import { VenueIcon } from "@/components/venue-icon";
import type { RaceInfo, RaceCardEntry } from "@/lib/races";

export type HeroMeetData = {
  meet: string;
  phase: "pre" | "post";
  races: RaceInfo[];
  byRace: Record<string, RaceCardEntry[]>;
};

const MEET_ORDER = ["서울", "제주", "부경"] as const;

type Slide = {
  meet: string;
  race: RaceInfo;
  entries: RaceCardEntry[];
  phase: "pre" | "post";
};

interface HeroTodayCarouselProps {
  date: string;
  meets: HeroMeetData[];
}

export function HeroTodayCarousel({ date, meets }: HeroTodayCarouselProps) {
  const meetMap = useMemo(() => {
    const m = new Map<string, HeroMeetData>();
    for (const it of meets) m.set(it.meet, it);
    return m;
  }, [meets]);

  const slides: Slide[] = useMemo(() => {
    const visibleMeets = MEET_ORDER.filter((m) => meetMap.has(m));
    const out: Slide[] = [];
    for (const m of visibleMeets) {
      const data = meetMap.get(m);
      if (!data) continue;
      for (const race of data.races) {
        out.push({
          meet: m,
          race,
          entries: data.byRace[String(race.race_no)] ?? [],
          phase: data.phase,
        });
      }
    }
    return out;
  }, [meetMap]);

  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const [canPrev, setCanPrev] = useState(false);
  const [canNext, setCanNext] = useState(false);

  // updateNav + activeIdx 산출을 한 번에 — 두 효과를 분리하면 setState 호출 간섭으로
  // 한 프레임 안에 cascading render 가 잡혀서 lint 가 경고. 단일 sync 함수로 통합.
  const sync = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const w = el.clientWidth;
    const sw = el.scrollWidth;
    const sl = el.scrollLeft;
    setCanPrev(sl > 4);
    setCanNext(sl + w < sw - 4);

    let bestIdx = 0;
    let bestDelta = Infinity;
    const tiles = el.querySelectorAll<HTMLElement>("[data-slide-idx]");
    tiles.forEach((tile) => {
      const idx = Number(tile.dataset.slideIdx);
      const delta = Math.abs(tile.offsetLeft - sl);
      if (delta < bestDelta) {
        bestDelta = delta;
        bestIdx = idx;
      }
    });
    setActiveIdx(bestIdx);
  }, []);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    sync();
    el.addEventListener("scroll", sync, { passive: true });
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", sync);
      ro.disconnect();
    };
  }, [sync, slides.length]);

  const scrollToIdx = useCallback((i: number) => {
    const el = scrollerRef.current;
    if (!el || i < 0) return;
    const tile = el.querySelector<HTMLElement>(`[data-slide-idx="${i}"]`);
    if (!tile) return;
    el.scrollTo({ left: tile.offsetLeft, behavior: "smooth" });
  }, []);

  function step(dir: -1 | 1) {
    const next = Math.max(0, Math.min(slides.length - 1, activeIdx + dir));
    scrollToIdx(next);
  }

  // (meet, race_no) → slide index lookup. 라운드 버튼 클릭 시 해당 슬라이드로 이동.
  const indexByKey = useMemo(() => {
    const m = new Map<string, number>();
    slides.forEach((s, i) => m.set(`${s.meet}-${s.race.race_no}`, i));
    return m;
  }, [slides]);

  const visibleMeets = useMemo(
    () => MEET_ORDER.filter((m) => meetMap.has(m)),
    [meetMap],
  );

  return (
    <div>
      {/* 경마장별 라운드 네비게이션 — 한 행에 한 경마장씩, 우측에 라운드 버튼 나열. */}
      {visibleMeets.length > 0 && (
        <div className="mb-5 space-y-1.5">
          {visibleMeets.map((m) => {
            const data = meetMap.get(m)!;
            return (
              <div
                key={m}
                className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/5 px-3 py-2"
              >
                <div className="flex w-14 shrink-0 items-center gap-1.5 text-xs font-bold text-white">
                  <VenueIcon meet={m} size={12} />
                  {m}
                </div>
                <div className="flex flex-1 flex-wrap gap-1.5">
                  {data.races.map((r) => {
                    const idx = indexByKey.get(`${m}-${r.race_no}`) ?? -1;
                    const active = idx === activeIdx;
                    return (
                      <button
                        key={r.race_no}
                        type="button"
                        onClick={() => scrollToIdx(idx)}
                        aria-label={`${m} ${r.race_no}R 로 이동`}
                        className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-semibold transition ${
                          active
                            ? "border-champagne-gold bg-champagne-gold text-primary"
                            : "border-white/15 bg-white/5 text-white/70 hover:border-champagne-gold/40 hover:text-champagne-gold"
                        }`}
                      >
                        <span className="font-mono tabular-nums">{r.race_no}R</span>
                        {r.start_time && (
                          <span className="font-mono text-[10px] tabular-nums opacity-80">
                            {r.start_time}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {slides.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/15 bg-white/5 py-10 text-center text-sm text-white/70">
          출전 정보가 아직 등록되지 않았습니다.
        </div>
      ) : (
        <div className="relative">
          <SlideArrow
            direction="prev"
            disabled={!canPrev}
            onClick={() => step(-1)}
          />
          <SlideArrow
            direction="next"
            disabled={!canNext}
            onClick={() => step(1)}
          />

          <div
            ref={scrollerRef}
            className="-mx-2 overflow-x-auto px-2 scrollbar-hide"
          >
            <div className="flex snap-x snap-mandatory gap-3 pb-2 sm:gap-4">
              {slides.map((s, i) => (
                <div
                  key={`${s.meet}-${s.race.race_no}`}
                  data-slide-idx={i}
                  className="w-[68%] shrink-0 snap-start sm:w-[40%] md:w-[32%] lg:w-[24%]"
                >
                  <RaceTile
                    meet={s.meet}
                    date={date}
                    race={s.race}
                    entries={s.entries}
                    phase={s.phase}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── 단일 라운드 타일 ──────────────────────────────────── */

function RaceTile({
  meet,
  date,
  race,
  entries,
  phase,
}: {
  meet: string;
  date: string;
  race: RaceInfo;
  entries: RaceCardEntry[];
  phase: "pre" | "post";
}) {
  const href = `/races?date=${date}&venue=${encodeURIComponent(meet)}&race=${race.race_no}`;
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl bg-white/95 shadow-lg ring-1 ring-white/20">
      {/* 헤더 — 한 줄: [경마장] [라운드] [거리] [flex 공간] [더보기]. 발주시각/race_name 은 라운드 네비/상세 페이지에 노출. */}
      <div className="flex items-center gap-2 border-b border-primary/10 bg-primary/5 px-3 py-2">
        <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold text-primary">
          <VenueIcon meet={meet} size={12} className="opacity-70" />
          {meet}
        </span>
        <span className="shrink-0 font-mono text-[11px] font-bold tabular-nums text-primary">
          {race.race_no}R
        </span>
        {race.distance && (
          <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
            {race.distance}m
          </span>
        )}
        <Link
          href={href}
          className="ml-auto inline-flex shrink-0 items-center gap-0.5 rounded bg-champagne-gold/20 px-2 py-0.5 text-[10px] font-bold text-gold-ink transition hover:bg-champagne-gold/30"
        >
          더보기
          <span aria-hidden>→</span>
        </Link>
      </div>

      {entries.length === 0 ? (
        <p className="px-4 py-6 text-center text-xs text-muted-foreground">출전 정보 없음</p>
      ) : (
        <table className="w-full table-fixed text-xs">
          <thead>
            <tr className="border-b border-primary/5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
              <th className="w-9 px-1.5 py-1.5 text-center">{phase === "post" ? "착순" : "#"}</th>
              <th className="px-1.5 py-1.5 text-center">마명</th>
              <th className="px-1.5 py-1.5 text-center">기수</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e, i) => (
              <tr key={i} className={i % 2 === 0 ? "" : "bg-muted/30"}>
                <td className="px-1.5 py-1 text-center font-mono font-bold tabular-nums text-muted-foreground">
                  {phase === "post"
                    ? e.rank ?? "-"
                    : e.chul_no ?? "-"}
                </td>
                <td className="truncate px-1.5 py-1 text-center text-foreground">
                  <Link
                    href={`/horse/${e.horse_no}`}
                    className="truncate text-primary hover:underline"
                    title={e.horse_name}
                  >
                    {e.horse_name}
                  </Link>
                </td>
                <td className="truncate px-1.5 py-1 text-center text-muted-foreground" title={e.jockey_name ?? undefined}>
                  {e.jockey_name ?? "-"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/* ── 좌우 화살표 (sm+ 데스크탑) ────────────────────────── */

function SlideArrow({
  direction,
  disabled,
  onClick,
}: {
  direction: "prev" | "next";
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={direction === "prev" ? "이전" : "다음"}
      className={`absolute top-1/2 z-10 hidden h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/95 text-primary shadow-md ring-1 ring-primary/10 backdrop-blur-sm transition disabled:cursor-not-allowed disabled:opacity-30 sm:flex ${
        direction === "prev" ? "-left-1" : "-right-1"
      }`}
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {direction === "prev" ? (
          <polyline points="15 18 9 12 15 6" />
        ) : (
          <polyline points="9 18 15 12 9 6" />
        )}
      </svg>
    </button>
  );
}
