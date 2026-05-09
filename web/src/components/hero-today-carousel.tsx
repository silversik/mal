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

const VENUE_FILTERS = ["전체", "서울", "제주", "부경"] as const;
type VenueFilter = (typeof VENUE_FILTERS)[number];

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

  // 기본 탭은 서울 — 단, 서울 경기가 없으면 데이터가 있는 첫 번째 venue 로 폴백.
  const defaultTab: VenueFilter = useMemo(() => {
    if (meetMap.has("서울")) return "서울";
    if (meetMap.has("제주")) return "제주";
    if (meetMap.has("부경")) return "부경";
    return "전체";
  }, [meetMap]);

  const [tab, setTab] = useState<VenueFilter>(defaultTab);

  const slides: Slide[] = useMemo(() => {
    const visibleMeets =
      tab === "전체"
        ? (["서울", "제주", "부경"] as const).filter((m) => meetMap.has(m))
        : meetMap.has(tab)
          ? [tab]
          : [];
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
  }, [tab, meetMap]);

  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [page, setPage] = useState(0);
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

    // 가장 왼쪽으로 보이는 슬라이드의 인덱스 — 슬라이드 폭이 가변(반응형) 이라 단순
    // scrollLeft / clientWidth 로 계산하면 부정확.
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
    setPage(bestIdx);
  }, []);

  // 탭 전환 시 스크롤 위치 초기화. el.scrollLeft = 0 이 scroll 이벤트를 발생시켜
  // sync() 가 호출되므로 여기서 setPage 를 직접 부를 필요 없음.
  useEffect(() => {
    const el = scrollerRef.current;
    if (el) el.scrollLeft = 0;
  }, [tab]);

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

  function scrollToIdx(i: number) {
    const el = scrollerRef.current;
    if (!el) return;
    const tile = el.querySelector<HTMLElement>(`[data-slide-idx="${i}"]`);
    if (!tile) return;
    el.scrollTo({ left: tile.offsetLeft, behavior: "smooth" });
  }

  function step(dir: -1 | 1) {
    const next = Math.max(0, Math.min(slides.length - 1, page + dir));
    scrollToIdx(next);
  }

  const tabs: VenueFilter[] = useMemo(() => {
    // 데이터가 있는 venue + 전체 만 노출 — 비어있는 탭은 숨김.
    const available = new Set<VenueFilter>(["전체"]);
    for (const v of ["서울", "제주", "부경"] as const) {
      if (meetMap.has(v)) available.add(v);
    }
    return VENUE_FILTERS.filter((v) => available.has(v));
  }, [meetMap]);

  return (
    <div>
      {/* 탭 */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {tabs.map((v) => {
          const active = tab === v;
          return (
            <button
              key={v}
              type="button"
              onClick={() => setTab(v)}
              className={`rounded-full border px-3.5 py-1 text-xs font-semibold transition ${
                active
                  ? "border-champagne-gold bg-champagne-gold text-primary"
                  : "border-white/20 bg-white/5 text-white/70 hover:border-champagne-gold/40 hover:text-champagne-gold"
              }`}
            >
              {v === "전체" ? "전체" : null}
              {v !== "전체" && (
                <span className="inline-flex items-center gap-1">
                  <VenueIcon meet={v} size={12} />
                  {v}
                </span>
              )}
            </button>
          );
        })}
      </div>

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

      {/* 라운드 표시가 들어간 페이지네이션 */}
      {slides.length > 1 && (
        <div
          className="mt-3 flex flex-wrap justify-center gap-1.5"
          role="tablist"
          aria-label="라운드 선택"
        >
          {slides.map((s, i) => {
            const active = i === page;
            return (
              <button
                key={`${s.meet}-${s.race.race_no}-dot`}
                type="button"
                role="tab"
                aria-selected={active}
                aria-label={`${s.meet} ${s.race.race_no}R 로 이동`}
                onClick={() => scrollToIdx(i)}
                className={`rounded-full border px-2 py-0.5 font-mono text-[10px] font-bold tabular-nums transition ${
                  active
                    ? "border-champagne-gold bg-champagne-gold text-primary"
                    : "border-white/20 bg-white/5 text-white/60 hover:border-champagne-gold/40 hover:text-champagne-gold"
                }`}
              >
                {s.race.race_no}R
              </button>
            );
          })}
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
  // 다중 venue(전체) 일 때는 한 슬라이드 안에서 어떤 경마장 경주인지 한눈에 봐야 함 →
  // 헤더에 VenueIcon + meet 명을 함께 노출.
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl bg-white/95 shadow-lg ring-1 ring-white/20">
      <div className="flex flex-col gap-1 border-b border-primary/10 bg-primary/5 px-3 py-2">
        <div className="flex items-center gap-2">
          <Link
            href={href}
            className="flex h-7 w-11 shrink-0 items-center justify-center rounded bg-primary/10 text-xs font-bold text-primary tabular-nums hover:bg-primary/20"
          >
            {race.race_no}R
          </Link>
          <div className="flex min-w-0 items-center gap-1.5 text-[11px] font-semibold text-primary">
            <VenueIcon meet={meet} size={12} className="opacity-70" />
            <span>{meet}</span>
          </div>
          {race.race_name && (
            <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
              {race.race_name}
            </span>
          )}
          <span
            className={`ml-auto shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${
              phase === "post"
                ? "bg-muted text-slate-grey"
                : "bg-champagne-gold/20 text-gold-ink"
            }`}
          >
            {phase === "post" ? "결과" : "출전"}
          </span>
        </div>
        {/* 발주시각 · 거리 — KRA API187 (HorseRaceInfo) 에서 수집한 메타. 한쪽이라도 있으면 줄을 노출. */}
        {(race.start_time || race.distance) && (
          <div className="flex items-center gap-2 pl-[52px] text-[10px] text-muted-foreground">
            {race.start_time && (
              <span className="inline-flex items-center gap-1 font-mono tabular-nums">
                <ClockIcon />
                {race.start_time}
              </span>
            )}
            {race.start_time && race.distance && (
              <span className="text-muted-foreground/40">·</span>
            )}
            {race.distance && (
              <span className="font-mono tabular-nums">{race.distance}m</span>
            )}
          </div>
        )}
      </div>

      {entries.length === 0 ? (
        <p className="px-4 py-6 text-center text-xs text-muted-foreground">출전 정보 없음</p>
      ) : (
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-primary/5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
              <th className="w-10 px-2 py-1.5 text-center">{phase === "post" ? "착순" : "#"}</th>
              <th className="px-2 py-1.5 text-center">기수</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e, i) => (
              <tr key={i} className={i % 2 === 0 ? "" : "bg-muted/30"}>
                <td className="px-2 py-1 text-center font-mono font-bold tabular-nums text-muted-foreground">
                  {phase === "post"
                    ? e.rank ?? "-"
                    : e.chul_no ?? "-"}
                </td>
                <td className="px-2 py-1 text-center text-muted-foreground">
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

function ClockIcon() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

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
