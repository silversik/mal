"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";

import { VenueIcon } from "@/components/venue-icon";
import type { RaceInfo, TopFinisher } from "@/lib/races";
import type { VideoItem } from "@/lib/video-helpers";

const MEETS = ["서울", "제주", "부경"] as const;
type Meet = (typeof MEETS)[number];

const RANK_STYLE: Record<number, string> = {
  1: "bg-champagne-gold text-white",
  2: "bg-slate-400 text-white",
  3: "bg-amber-700 text-white",
};

function videoKey(date: string, meet: string | null, raceNo: number): string {
  return `${date}|${meet ?? ""}|${raceNo}`;
}

type Props = {
  races: RaceInfo[];
  finishers: TopFinisher[];
  videos: Array<{ key: string; video: VideoItem }>;
};

export function RecentRacesTabs({ races, finishers, videos }: Props) {
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

  // 경마장별 그룹
  const byMeet = useMemo(() => {
    const groups: Record<Meet, RaceInfo[]> = { 서울: [], 제주: [], 부경: [] };
    for (const r of races) {
      if (r.meet === "서울" || r.meet === "제주" || r.meet === "부경") {
        groups[r.meet].push(r);
      }
    }
    return groups;
  }, [races]);

  return (
    <>
      {/* 모바일: 탭 + 1열 */}
      <MobileView byMeet={byMeet} finishersMap={finishersMap} videosMap={videosMap} />

      {/* 데스크탑: 경마장별 3줄 가로 스크롤 */}
      <DesktopView byMeet={byMeet} finishersMap={finishersMap} videosMap={videosMap} />
    </>
  );
}

/* ── 모바일: 탭 인터페이스 ──────────────────── */

function MobileView({
  byMeet,
  finishersMap,
  videosMap,
}: {
  byMeet: Record<Meet, RaceInfo[]>;
  finishersMap: Map<string, TopFinisher[]>;
  videosMap: Map<string, VideoItem>;
}) {
  const [tab, setTab] = useState<Meet>("서울");
  const list = byMeet[tab];

  return (
    <div className="md:hidden">
      <div className="mb-4 flex gap-1 border-b border-primary/10">
        {MEETS.map((m) => {
          const active = tab === m;
          return (
            <button
              key={m}
              type="button"
              onClick={() => setTab(m)}
              className={`flex flex-1 items-center justify-center gap-1.5 px-3 py-2.5 text-sm font-semibold transition border-b-2 -mb-[2px] ${
                active
                  ? "border-primary text-primary"
                  : "border-transparent text-slate-grey hover:text-primary"
              }`}
            >
              <VenueIcon meet={m} size={14} className="opacity-70" />
              {m}
              <span className={`text-[11px] font-mono tabular-nums ${active ? "text-primary/70" : "text-slate-grey/60"}`}>
                {byMeet[m].length}
              </span>
            </button>
          );
        })}
      </div>

      {list.length === 0 ? (
        <div className="rounded-lg border border-dashed border-primary/10 py-8 text-center text-sm text-slate-grey">
          최근 경기가 없습니다.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {list.map((r) => {
            const k = videoKey(r.race_date, r.meet, r.race_no);
            return (
              <RecentRaceCard
                key={r.id}
                race={r}
                finishers={finishersMap.get(k) ?? []}
                video={videosMap.get(k) ?? null}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ── 데스크탑: 경마장별 3줄 ──────────────────── */

function DesktopView({
  byMeet,
  finishersMap,
  videosMap,
}: {
  byMeet: Record<Meet, RaceInfo[]>;
  finishersMap: Map<string, TopFinisher[]>;
  videosMap: Map<string, VideoItem>;
}) {
  return (
    <div className="hidden space-y-8 md:block">
      {MEETS.map((m) => (
        <MeetScrollRow
          key={m}
          meet={m}
          list={byMeet[m]}
          finishersMap={finishersMap}
          videosMap={videosMap}
        />
      ))}
    </div>
  );
}

function MeetScrollRow({
  meet,
  list,
  finishersMap,
  videosMap,
}: {
  meet: Meet;
  list: RaceInfo[];
  finishersMap: Map<string, TopFinisher[]>;
  videosMap: Map<string, VideoItem>;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const dragScrollLeft = useRef(0);

  const onMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    isDragging.current = true;
    dragStartX.current = e.pageX - (scrollRef.current?.offsetLeft ?? 0);
    dragScrollLeft.current = scrollRef.current?.scrollLeft ?? 0;
    if (scrollRef.current) scrollRef.current.style.cursor = "grabbing";
  };

  const onMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDragging.current) return;
    e.preventDefault();
    const x = e.pageX - (scrollRef.current?.offsetLeft ?? 0);
    const walk = (x - dragStartX.current) * 1.2;
    if (scrollRef.current) scrollRef.current.scrollLeft = dragScrollLeft.current - walk;
  };

  const stopDrag = () => {
    isDragging.current = false;
    if (scrollRef.current) scrollRef.current.style.cursor = "grab";
  };

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <VenueIcon meet={meet} size={16} className="opacity-70" />
        <h3 className="text-base font-bold text-primary">{meet}</h3>
        <span className="font-mono text-xs text-slate-grey/70 tabular-nums">{list.length}</span>
      </div>

      {list.length === 0 ? (
        <div className="rounded-lg border border-dashed border-primary/10 py-6 text-center text-xs text-slate-grey">
          최근 경기가 없습니다.
        </div>
      ) : (
        <div className="relative">
          <div
            ref={scrollRef}
            className="-mx-2 overflow-x-auto px-2 scrollbar-hide"
            style={{ scrollSnapType: "x mandatory", cursor: "grab", userSelect: "none" }}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={stopDrag}
            onMouseLeave={stopDrag}
          >
            <div className="flex gap-4 pb-2">
              {list.map((r) => {
                const k = videoKey(r.race_date, r.meet, r.race_no);
                return (
                  <div key={r.id} className="w-72 shrink-0" style={{ scrollSnapAlign: "start" }}>
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
          {/* 우측 페이드 — 더 있다는 시각적 단서 */}
          <div className="pointer-events-none absolute inset-y-0 -right-2 w-14 bg-gradient-to-l from-background to-transparent" />
        </div>
      )}
    </div>
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
      {/* 썸네일 — aspect-video 16:9 */}
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
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-primary/5 to-primary/10">
            <VenueIcon meet={r.meet} size={40} className="opacity-30" />
          </div>
        )}
        {/* 라운드 뱃지 — 오버레이만 */}
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

      {/* 1·2·3위만 */}
      <div className="space-y-1 p-3">
        {finishers.length === 0 ? (
          <div className="py-2 text-center text-[11px] text-slate-grey/70">결과 미확정</div>
        ) : (
          finishers.slice(0, 3).map((f) => (
            <div key={f.horse_no} className="flex items-center gap-2 text-xs">
              <span
                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                  RANK_STYLE[f.rank] ?? "bg-muted text-foreground"
                }`}
              >
                {f.rank}
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
