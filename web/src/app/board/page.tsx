import Link from "next/link";

import { auth } from "@/auth";
import { Card, CardContent } from "@/components/ui/card";
import { countPosts, listPosts, type CommunityPost } from "@/lib/posts";

export const metadata = {
  title: "자유게시판",
  description: "mal.kr 자유게시판 — 경마 팬 커뮤니티 글타래.",
  alternates: { canonical: "/board" },
};

const PAGE_SIZE = 20;

type SearchParams = { page?: string };

export default async function BoardPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { page: pageParam } = await searchParams;
  const parsed = Number(pageParam);
  const page = Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : 1;
  const offset = (page - 1) * PAGE_SIZE;

  const [posts, total, session] = await Promise.all([
    listPosts({ limit: PAGE_SIZE, offset }),
    countPosts(),
    auth(),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-10">
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl font-bold tracking-tight text-primary">
            자유게시판
          </h1>
          <p className="mt-2 text-sm text-slate-grey">
            경마 팬들이 나누는 생각과 이야기
          </p>
        </div>
        {session?.user ? (
          <Link href="/board/new" className="btn-cta text-xs py-1.5 px-4 shadow-sm">
            글쓰기
          </Link>
        ) : (
          <Link href="/login" className="btn-outline text-xs py-1.5 px-4">
            로그인 후 글쓰기
          </Link>
        )}
      </div>

      {posts.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-16 text-center text-sm text-muted-foreground">
            아직 작성된 글이 없습니다. 첫 글을 남겨보세요.
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="overflow-hidden rounded-xl border border-foreground/10 bg-card divide-y divide-foreground/10">
            {posts.map((p) => (
              <PostRow key={p.id} post={p} />
            ))}
          </div>
          <Pagination page={page} totalPages={totalPages} />
        </>
      )}
    </main>
  );
}

function PostRow({ post }: { post: CommunityPost }) {
  return (
    <Link
      href={`/board/${post.id}`}
      className="group flex items-center gap-3 px-4 py-3 transition hover:bg-muted/40"
    >
      <div className="min-w-0 flex-1">
        <h3 className="truncate text-base font-semibold leading-snug group-hover:text-primary transition-colors">
          {post.title}
        </h3>
        <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
          <span className="font-semibold">
            {post.author_name ?? "익명"}
          </span>
          <span>·</span>
          <span className="font-mono tabular-nums">
            {formatKstDate(post.created_at)}
          </span>
        </div>
      </div>
    </Link>
  );
}

function Pagination({ page, totalPages }: { page: number; totalPages: number }) {
  if (totalPages <= 1) return null;

  const pageHref = (p: number) => (p === 1 ? "/board" : `/board?page=${p}`);

  return (
    <nav
      className="mt-6 flex items-center justify-center gap-1"
      aria-label="페이지 이동"
    >
      <PageLink href={pageHref(page - 1)} disabled={page <= 1}>
        ‹
      </PageLink>
      <span className="px-3 text-sm text-muted-foreground tabular-nums">
        {page} / {totalPages}
      </span>
      <PageLink href={pageHref(page + 1)} disabled={page >= totalPages}>
        ›
      </PageLink>
    </nav>
  );
}

function PageLink({
  href,
  disabled,
  children,
}: {
  href: string;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  const base =
    "inline-flex h-9 min-w-9 items-center justify-center rounded-md border px-3 text-sm transition";
  if (disabled) {
    return (
      <span
        className={`${base} border-border bg-card text-muted-foreground/40 pointer-events-none`}
      >
        {children}
      </span>
    );
  }
  return (
    <Link
      href={href}
      className={`${base} border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground`}
    >
      {children}
    </Link>
  );
}

function formatKstDate(iso: string): string {
  if (!iso) return "";
  return iso.slice(0, 16).replace("T", " ");
}
