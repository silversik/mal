"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { VenueIcon } from "@/components/venue-icon";
import type { RaceInfo, TopFinisher } from "@/lib/races";
import type { VideoItem } from "@/lib/video-helpers";

const MEETS = ["서울", "제주", "부경"] as const;
type Meet = (typeof MEETS)[number];

const RANK_MEDAL: Record<number, string> = {
  1: "🥇",
  2: "🥈",
  3: "🥉",
};

const MAX_DOTS = 8;
const SCROLL_DURATION_MS = 350;

function videoKey(date: string, meet: string | null, raceNo: number): string {
  return `${date}|${meet ?? ""}|${raceNo}`;
}

function smoothScrollLeft(el: HTMLElement, target: number) {
  const start = el.scrollLeft;
  const dist = target - start;
  if (Math.abs(dist) < 1) return;
  const t0 = performance.now();
  let ticked = false;
  function step(now: number) {
    ticked = true;
    const t = Math.min(1, (now - t0) / SCROLL_DURATION_MS);
    const ease = 1 - Math.pow(1 - t, 3);
    el.scrollLeft = start + dist * ease;
    if (t < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
  // rAF is throttled in some environments (background tabs, headless). Ensure a final position.
  setTimeout(() => {
    if (!ticked) el.scrollLeft = target;
  }, 80);
}

type Props = {
  races: RaceInfo[];
  finishers: TopFinisher[];
  videos: Array<{ key: string; video: VideoItem }>;
};

export function RecentRacesSwiper({ races, finishers, videos }: Props) {
  const finishersMap = useMemo(() => {
    const map = new Map<string, TopFinisher[]>();
    for (const f of finishers) {
      const k = videoKey(f.race_date, f.meet, f.race_no);
      const arr = map.get(k) ?? [];
      arr.push(f);
      map.set(k, arr);
    }
    return map;
  }, [finishers]);

  const videosMap = useMemo(() => {
    const map = new Map<string, VideoItem>();
    for (const v of videos) map.set(v.key, v.video);
    return map;
  }, [videos]);

  const byMeet = useMemo(() => {
    const groups: Record<Meet, RaceInfo[]> = { 서울: [], 제주: [], 부경: [] };
    for (const r of races) {
      if (r.meet === "서울" || r.meet === "제주" || r.meet === "부경") {
        groups[r.meet].push(r);
      }
    }
    return groups;
  }, [races]);

  // 데이터가 있는 첫 meet 을 기본 탭으로. 셋 다 비어있으면 서울.
  const initialMeet =
    MEETS.find((m) => byMeet[m].length > 0) ?? "서울";
  const [activeMeet, setActiveMeet] = useState<Meet>(initialMeet);

  return (
    <div>
      {/* ── 경마장 탭바 (한 줄) — 이전 디자인은 meet 별 row 가 3개 세로로 쌓여
            페이지를 길게 잡아먹었다. 한 줄 탭으로 압축하고 swiper 1개만 노출. */}
      <div className="mb-4 flex items-center gap-1 border-b border-primary/10">
        {MEETS.map((m) => {
          const count = byMeet[m].length;
          const active = m === activeMeet;
          const disabled = count === 0;
          return (
            <button
              key={m}
              type="button"
              onClick={() => !disabled && setActiveMeet(m)}
              disabled={disabled}
              aria-selected={active}
              role="tab"
              className={`-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-bold transition ${
                active
                  ? "border-primary text-primary"
                  : disabled
                    ? "border-transparent text-muted-foreground/40"
                    : "border-transparent text-muted-foreground hover:text-primary"
              }`}
            >
              <VenueIcon
                meet={m}
                size={14}
                className={active ? "" : "opacity-70"}
              />
              <span>{m}</span>
              <span className="font-mono text-xs tabular-nums opacity-60">
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* key 로 탭 전환 시 스크롤·페이지 state 리셋 */}
      <MeetSwiper
        key={activeMeet}
        meet={activeMeet}
        races={byMeet[activeMeet]}
        finishersMap={finishersMap}
        videosMap={videosMap}
      />
    </div>
  );
}

/* ── 경마장별 가로 슬라이더 ──────────────────── */

function MeetSwiper({
  meet,
  races,
  finishersMap,
  videosMap,
}: {
  meet: Meet;
  races: RaceInfo[];
  finishersMap: Map<string, TopFinisher[]>;
  videosMap: Map<string, VideoItem>;
}) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [page, setPage] = useState(0);
  const [pageCount, setPageCount] = useState(1);
  const [canPrev, setCanPrev] = useState(false);
  const [canNext, setCanNext] = useState(false);

  const updateNav = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const w = el.clientWidth;
    const sw = el.scrollWidth;
    const sl = el.scrollLeft;
    setCanPrev(sl > 4);
    setCanNext(sl + w < sw - 4);
    if (w > 0) {
      const count = Math.max(1, Math.ceil(sw / w));
      const p = Math.min(count - 1, Math.round(sl / w));
      setPageCount(count);
      setPage(p);
    }
  }, []);

  useEffect(() => {
    updateNav();
    const el = scrollerRef.current;
    if (!el) return;
    el.addEventListener("scroll", updateNav, { passive: true });
    const ro = new ResizeObserver(updateNav);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", updateNav);
      ro.disconnect();
    };
  }, [updateNav, races.length]);

  function scrollByPage(dir: number) {
    const el = scrollerRef.current;
    if (!el) return;
    const max = Math.max(0, el.scrollWidth - el.clientWidth);
    const target = Math.max(0, Math.min(max, el.scrollLeft + dir * el.clientWidth));
    smoothScrollLeft(el, target);
    setTimeout(updateNav, 100);
    setTimeout(updateNav, SCROLL_DURATION_MS + 50);
  }
  function scrollToPage(p: number) {
    const el = scrollerRef.current;
    if (!el) return;
    const max = Math.max(0, el.scrollWidth - el.clientWidth);
    const target = Math.max(0, Math.min(max, p * el.clientWidth));
    smoothScrollLeft(el, target);
    setTimeout(updateNav, 100);
    setTimeout(updateNav, SCROLL_DURATION_MS + 50);
  }

  const showDots = pageCount > 1 && pageCount <= MAX_DOTS;

  return (
    <div>
      {/* meet 이름·카운트는 상위 탭바에 노출. 여기는 데스크탑 화살표만. */}
      {races.length > 0 && (
        <div className="mb-2 hidden justify-end gap-1 sm:flex">
          <SwiperArrow direction="prev" disabled={!canPrev} onClick={() => scrollByPage(-1)} />
          <SwiperArrow direction="next" disabled={!canNext} onClick={() => scrollByPage(1)} />
        </div>
      )}

      {races.length === 0 ? (
        <div className="rounded-lg border border-dashed border-primary/10 py-6 text-center text-xs text-slate-grey">
          최근 경기가 없습니다.
        </div>
      ) : (
        <div className="relative">
          {/* 모바일 화살표 — 카드 위 오버레이 */}
          <SwiperOverlayArrow
            direction="prev"
            visible={canPrev}
            onClick={() => scrollByPage(-1)}
          />
          <SwiperOverlayArrow
            direction="next"
            visible={canNext}
            onClick={() => scrollByPage(1)}
          />

          <div
            ref={scrollerRef}
            className="-mx-2 overflow-x-auto px-2 scrollbar-hide"
          >
            <div className="flex gap-3 pb-2 sm:gap-4">
              {races.map((r) => {
                const k = videoKey(r.race_date, r.meet, r.race_no);
                return (
                  <div key={r.id} className="w-[55%] shrink-0 sm:w-48">
                    <RecentRaceCard
                      race={r}
                      finishers={finishersMap.get(k) ?? []}
                      video={videosMap.get(k) ?? null}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {showDots && (
        <div className="mt-3 flex justify-center gap-1.5" role="tablist" aria-label={`${meet} 페이지 선택`}>
          {Array.from({ length: pageCount }).map((_, i) => {
            const active = i === page;
            return (
              <button
                key={i}
                type="button"
                role="tab"
                aria-selected={active}
                aria-label={`${i + 1}페이지로 이동`}
                onClick={() => scrollToPage(i)}
                className={`h-1.5 rounded-full transition-all ${
                  active ? "w-5 bg-primary" : "w-1.5 bg-primary/20 hover:bg-primary/40"
                }`}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ── 화살표 버튼 ──────────────────── */

function SwiperArrow({
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
      className="flex h-8 w-8 items-center justify-center rounded-full border border-primary/15 bg-white text-primary transition hover:border-primary/40 hover:bg-primary hover:text-white disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-white disabled:hover:text-primary"
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
        {direction === "prev" ? <polyline points="15 18 9 12 15 6" /> : <polyline points="9 18 15 12 9 6" />}
      </svg>
    </button>
  );
}

function SwiperOverlayArrow({
  direction,
  visible,
  onClick,
}: {
  direction: "prev" | "next";
  visible: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={direction === "prev" ? "이전" : "다음"}
      tabIndex={visible ? 0 : -1}
      aria-hidden={!visible}
      className={`absolute top-1/2 z-10 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-white shadow-md backdrop-blur-sm transition-opacity sm:hidden ${
        direction === "prev" ? "left-1" : "right-1"
      } ${visible ? "opacity-100" : "pointer-events-none opacity-0"}`}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {direction === "prev" ? <polyline points="15 18 9 12 15 6" /> : <polyline points="9 18 15 12 9 6" />}
      </svg>
    </button>
  );
}

/* ── 카드 ──────────────────── */

function RecentRaceCard({
  race: r,
  finishers,
  video,
}: {
  race: RaceInfo;
  finishers: TopFinisher[];
  video: VideoItem | null;
}) {
  const href = `/races?date=${r.race_date}&venue=${encodeURIComponent(r.meet)}&race=${r.race_no}`;
  return (
    <Link
      href={href}
      className="group block overflow-hidden rounded-xl border border-primary/8 bg-white transition-all hover:border-primary/20 hover:shadow-md"
    >
      <div className="relative aspect-video overflow-hidden bg-muted">
        {video ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={video.thumbnail_url}
            alt={video.title}
            className="absolute inset-0 h-full w-full object-cover transition-transform group-hover:scale-105"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-primary/5">
            <VenueIcon meet={r.meet} size={40} className="opacity-30" />
          </div>
        )}
        <div className="absolute bottom-1.5 left-1.5">
          <span className="rounded bg-black/70 px-1.5 py-0.5 font-mono text-[10px] font-bold text-white tabular-nums">
            {r.race_no}R
          </span>
        </div>
        {video && (
          <div className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-600 text-white">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M8 5v14l11-7z" />
              </svg>
            </div>
          </div>
        )}
      </div>

      <div className="space-y-1 p-3">
        {finishers.length === 0 ? (
          <div className="py-2 text-center text-[11px] text-slate-grey/70">결과 수집 대기</div>
        ) : (
          finishers.slice(0, 3).map((f) => (
            <div key={f.horse_no} className="flex items-center gap-2 text-xs">
              <span
                className="inline-flex h-4 w-4 shrink-0 items-center justify-center text-sm leading-none"
                aria-label={`${f.rank}위`}
              >
                {RANK_MEDAL[f.rank] ?? f.rank}
              </span>
              <span className="min-w-0 flex-1 truncate font-semibold text-foreground group-hover:text-primary">
                {f.horse_name}
              </span>
              {f.jockey_name && (
                <span className="shrink-0 truncate text-[11px] text-slate-grey">{f.jockey_name}</span>
              )}
            </div>
          ))
        )}
      </div>
    </Link>
  );
}
