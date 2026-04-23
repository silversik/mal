import Link from "next/link";
import { notFound } from "next/navigation";

import { getPost } from "@/lib/posts";

type Params = { id: string };

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}) {
  const { id } = await params;
  const post = await getPost(Number(id));
  return {
    title: post ? `${post.title} · 자유게시판 · mal.kr` : "글 · mal.kr",
  };
}

export default async function PostDetailPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { id } = await params;
  const parsed = Number(id);
  if (!Number.isFinite(parsed)) notFound();

  const post = await getPost(parsed);
  if (!post) notFound();

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-10">
      <Link
        href="/board"
        className="group mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground transition hover:text-primary"
      >
        <span className="transition group-hover:-translate-x-0.5">&larr;</span>
        자유게시판
      </Link>

      <article className="rounded-xl border border-foreground/10 bg-card">
        <header className="border-b border-foreground/10 px-6 py-5">
          <h1 className="font-serif text-2xl font-bold tracking-tight text-primary">
            {post.title}
          </h1>
          <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
            <span className="font-semibold">
              {post.author_name ?? "익명"}
            </span>
            <span>·</span>
            <span className="font-mono tabular-nums">
              {formatKstDateTime(post.created_at)}
            </span>
          </div>
        </header>

        <div className="whitespace-pre-wrap break-words px-6 py-6 text-[15px] leading-relaxed text-foreground">
          {post.content}
        </div>
      </article>
    </main>
  );
}

function formatKstDateTime(iso: string): string {
  if (!iso) return "";
  return iso.slice(0, 16).replace("T", " ");
}
