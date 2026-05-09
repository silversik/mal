import type { Metadata } from "next";
import Link from "next/link";

import { SafeImage } from "@/components/safe-image";
import { VideoRow } from "@/components/video-card";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { countNews, getLatestNews, type NewsItem } from "@/lib/news";
import { countVideos, getLatestVideos } from "@/lib/videos";
import type { VideoItem } from "@/lib/video-helpers";

export const metadata: Metadata = {
  title: "뉴스 · 영상",
  description:
    "한국 경마 뉴스와 KRBC 경주 영상 피드 — 최신 소식과 하이라이트를 한눈에.",
  alternates: { canonical: "/news" },
};

type FeedItem =
  | { kind: "news"; published_at: string; data: NewsItem }
  | { kind: "video"; published_at: string; data: VideoItem };

const PAGE_SIZE = 20;

type SearchParams = { page?: string };

export default async function NewsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { page: pageParam } = await searchParams;
  const parsed = Number(pageParam);
  const page = Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : 1;

  /*
   * 두 소스(뉴스/비디오)가 published_at DESC로 정렬되어 있으므로,
   * 병합된 DESC 시퀀스의 상위 N개는 각 소스의 상위 N개에서만 나올 수 있다.
   * 따라서 page*PAGE_SIZE 만큼씩만 가져와 병합하면 해당 페이지 슬라이스를 얻을 수 있다.
   */
  const poolSize = page * PAGE_SIZE;
  const [news, videos, newsTotal, videosTotal] = await Promise.all([
    getLatestNews(poolSize),
    getLatestVideos(poolSize),
    countNews(),
    countVideos(),
  ]);

  const feed: FeedItem[] = [
    ...news.map<FeedItem>((n) => ({ kind: "news", published_at: n.published_at, data: n })),
    ...videos.map<FeedItem>((v) => ({ kind: "video", published_at: v.published_at, data: v })),
  ].sort((a, b) => (a.published_at < b.published_at ? 1 : -1));

  const total = newsTotal + videosTotal;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const start = (page - 1) * PAGE_SIZE;
  const pageItems = feed.slice(start, start + PAGE_SIZE);

  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-10">
      <h1 className="mb-6 text-3xl font-bold tracking-tight">뉴스</h1>

      {pageItems.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          <div className="overflow-hidden rounded-xl border border-foreground/10 bg-card divide-y divide-foreground/10">
            {pageItems.map((item) =>
              item.kind === "news" ? (
                <NewsRow key={`n-${item.data.id}`} item={item.data} />
              ) : (
                <VideoRow key={`v-${item.data.id}`} video={item.data} />
              ),
            )}
          </div>

          <Pagination page={page} totalPages={totalPages} />
        </>
      )}
    </main>
  );
}

/* ── News row (compact, thumbnail only if image present) ── */

function NewsRow({ item }: { item: NewsItem }) {
  return (
    <a
      href={item.link}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex items-center gap-3 px-4 py-3 transition hover:bg-muted/40"
    >
      {item.image_url && (
        <div className="relative h-14 w-24 shrink-0 overflow-hidden rounded bg-muted">
          <SafeImage
            src={item.image_url}
            className="h-full w-full object-cover transition group-hover:scale-[1.04]"
            loading="lazy"
          />
        </div>
      )}

      <div className="min-w-0 flex-1">
        <h3 className="truncate text-base font-semibold leading-snug">{item.title}</h3>
        <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
          {item.category && (
            <Badge variant="outline" className="h-5 px-1.5 py-0 text-[11px] font-normal">
              {item.category}
            </Badge>
          )}
          <span>{formatKstDate(item.published_at)}</span>
          <span>·</span>
          <span>{item.source || "네이버 뉴스"}</span>
        </div>
      </div>

      <ExternalIcon />
    </a>
  );
}

/* ── Pagination ─────────────────────────────────────────── */

function Pagination({ page, totalPages }: { page: number; totalPages: number }) {
  if (totalPages <= 1) return null;

  const pages = getPageWindow(page, totalPages);

  const pageHref = (p: number) => (p === 1 ? "/news" : `/news?page=${p}`);

  return (
    <nav
      className="mt-6 flex items-center justify-center gap-1"
      aria-label="페이지 이동"
    >
      <PageLink
        href={pageHref(page - 1)}
        disabled={page <= 1}
        aria-label="이전 페이지"
      >
        ‹
      </PageLink>

      {pages.map((p, i) =>
        p === "…" ? (
          <span
            key={`ellipsis-${i}`}
            className="px-2 text-sm text-muted-foreground select-none"
          >
            …
          </span>
        ) : (
          <PageLink
            key={p}
            href={pageHref(p)}
            active={p === page}
            aria-label={`${p} 페이지`}
            aria-current={p === page ? "page" : undefined}
          >
            {p}
          </PageLink>
        ),
      )}

      <PageLink
        href={pageHref(page + 1)}
        disabled={page >= totalPages}
        aria-label="다음 페이지"
      >
        ›
      </PageLink>
    </nav>
  );
}

function PageLink({
  href,
  active,
  disabled,
  children,
  ...rest
}: {
  href: string;
  active?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
} & Omit<React.ComponentProps<"a">, "href">) {
  const base =
    "inline-flex h-9 min-w-9 items-center justify-center rounded-md border px-3 text-sm transition";
  const cls = active
    ? `${base} border-primary bg-primary text-primary-foreground`
    : disabled
      ? `${base} border-border bg-card text-muted-foreground/40 pointer-events-none`
      : `${base} border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground`;

  if (disabled) {
    return (
      <span className={cls} aria-disabled="true" {...rest}>
        {children}
      </span>
    );
  }

  return (
    <Link href={href} className={cls} {...rest}>
      {children}
    </Link>
  );
}

function getPageWindow(page: number, totalPages: number): (number | "…")[] {
  const result: (number | "…")[] = [];
  const add = (v: number | "…") => result.push(v);

  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) add(i);
    return result;
  }

  add(1);
  if (page > 4) add("…");

  const start = Math.max(2, page - 1);
  const end = Math.min(totalPages - 1, page + 1);
  for (let i = start; i <= end; i++) add(i);

  if (page < totalPages - 3) add("…");
  add(totalPages);
  return result;
}

/* ── helpers ──────────────────────────────────────────── */

function EmptyState() {
  return (
    <Card className="border-dashed">
      <CardContent className="py-10 text-center text-sm text-muted-foreground">
        아직 수집된 항목이 없습니다.
      </CardContent>
    </Card>
  );
}

function formatKstDate(iso: string): string {
  if (!iso) return "";
  return iso.slice(0, 16).replace("T", " ");
}

function ExternalIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0 text-muted-foreground"
      aria-hidden="true"
    >
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}
