"use client";

import { useState } from "react";

import { SafeImage } from "@/components/safe-image";
import {
  formatDuration,
  type VideoItem,
  youtubeEmbedUrl,
  youtubeWatchUrl,
} from "@/lib/video-helpers";

/** 컴팩트 한 줄 row (no own border — 부모 컨테이너의 divide-y가 구분선 담당). */
export function VideoRow({ video }: { video: VideoItem }) {
  const [open, setOpen] = useState(false);
  const dur = formatDuration(video.duration_sec);

  return (
    <>
      <div
        className="group flex cursor-pointer items-center gap-3 px-4 py-3 transition hover:bg-muted/40"
        onClick={() => setOpen(true)}
        role="button"
        tabIndex={0}
        aria-label={video.title}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        <div className="relative h-14 w-24 shrink-0 overflow-hidden rounded bg-muted">
          {video.thumbnail_url ? (
            <SafeImage
              src={video.thumbnail_url}
              className="h-full w-full object-cover transition group-hover:scale-[1.04]"
              loading="lazy"
            />
          ) : null}
          {/* YouTube 아이콘 — 항상 노출하여 영상임을 표시 */}
          <span
            className="absolute top-1 left-1 inline-flex items-center justify-center rounded-sm bg-[#FF0000] px-1 py-0.5 shadow"
            aria-label="YouTube"
          >
            <YoutubeIcon />
          </span>
          {dur && (
            <span className="absolute right-0.5 bottom-0.5 rounded bg-black/80 px-1 py-px font-mono text-[11px] leading-none text-white">
              {dur}
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-semibold leading-snug">
            {video.title}
          </h3>
          <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
            <span>{formatRelativeKst(video.published_at)}</span>
            <span>·</span>
            <span>{video.channel_title ?? "KRBC 한국마사회 경마방송"}</span>
          </div>
        </div>
      </div>

      {open && <VideoModal video={video} onClose={() => setOpen(false)} />}
    </>
  );
}

function VideoModal({ video, onClose }: { video: VideoItem; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={video.title}
    >
      <div className="relative w-full max-w-4xl" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          onClick={onClose}
          className="absolute -top-10 right-0 text-sm text-white/80 transition hover:text-white"
          aria-label="닫기"
        >
          닫기 ✕
        </button>
        <div className="aspect-video w-full overflow-hidden rounded-xl bg-black">
          <iframe
            src={`${youtubeEmbedUrl(video.video_id)}&autoplay=1`}
            title={video.title}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            className="h-full w-full"
          />
        </div>
        <div className="mt-3 flex items-start justify-between gap-4 text-white">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold leading-snug">{video.title}</h2>
            <p className="mt-1 text-xs text-white/60">
              {video.channel_title ?? "KRBC 한국마사회 경마방송"} ·{" "}
              {formatRelativeKst(video.published_at)}
            </p>
          </div>
          <a
            href={youtubeWatchUrl(video.video_id)}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 text-xs text-white/70 underline-offset-2 hover:text-white hover:underline"
          >
            유튜브에서 보기 ↗
          </a>
        </div>
      </div>
    </div>
  );
}

function YoutubeIcon() {
  // 미니 YouTube 로고 (재생 삼각형 + 라운드 직사각형)
  return (
    <svg width="14" height="10" viewBox="0 0 24 17" aria-hidden="true">
      <path
        d="M23.5 2.65A3 3 0 0 0 21.4.55C19.55 0 12 0 12 0S4.45 0 2.6.55A3 3 0 0 0 .5 2.65 31.4 31.4 0 0 0 0 8.5a31.4 31.4 0 0 0 .5 5.85A3 3 0 0 0 2.6 16.45C4.45 17 12 17 12 17s7.55 0 9.4-.55a3 3 0 0 0 2.1-2.1A31.4 31.4 0 0 0 24 8.5a31.4 31.4 0 0 0-.5-5.85z"
        fill="white"
      />
      <path d="M9.6 12.15 15.85 8.5 9.6 4.85z" fill="#FF0000" />
    </svg>
  );
}

function formatRelativeKst(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso.slice(0, 10);
  const diffSec = (Date.now() - then) / 1000;
  if (diffSec < 60) return "방금 전";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}분 전`;
  if (diffSec < 86_400) return `${Math.floor(diffSec / 3600)}시간 전`;
  if (diffSec < 86_400 * 7) return `${Math.floor(diffSec / 86_400)}일 전`;
  return iso.slice(0, 10);
}
