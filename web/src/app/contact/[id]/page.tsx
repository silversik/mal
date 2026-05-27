import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getContactPost } from "@/lib/contact";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  pending:     { label: "접수됨",  cls: "bg-muted text-muted-foreground" },
  in_progress: { label: "처리중",  cls: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" },
  resolved:    { label: "완료",    cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" },
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const post = await getContactPost(Number(id));
  if (!post) return { title: "문의 없음" };
  return {
    title: post.title,
    alternates: { canonical: `/contact/${id}` },
  };
}

export default async function ContactPostPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const post = await getContactPost(Number(id));
  if (!post) notFound();

  const s = STATUS_LABEL[post.status] ?? STATUS_LABEL.pending;

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <Link
          href="/contact"
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          ← 목록으로
        </Link>
        <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${s.cls}`}>
          {s.label}
        </span>
      </div>

      <div className="rounded-[10px] border border-border bg-card p-6 space-y-4">
        <div className="space-y-2">
          <h1 className="text-lg font-bold tracking-tight leading-snug">{post.title}</h1>
          <div className="flex items-center gap-3 text-xs text-muted-foreground font-mono tabular-nums">
            <span>{post.author_name}</span>
            <span>·</span>
            <span>{post.created_at.slice(0, 10)}</span>
            <span>·</span>
            <span>#{post.id}</span>
          </div>
        </div>

        <hr className="border-border" />

        <p className="text-sm leading-relaxed whitespace-pre-wrap text-foreground/90">
          {post.content}
        </p>
      </div>

      {post.status === "resolved" && (
        <div className="rounded-[10px] border border-emerald-200 bg-emerald-50 dark:border-emerald-900/50 dark:bg-emerald-900/20 px-5 py-4">
          <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">처리 완료</p>
          <p className="mt-1 text-xs text-emerald-600 dark:text-emerald-500">
            해당 문의가 처리되었습니다. 추가 문의가 있으시면 새 글을 작성해 주세요.
          </p>
        </div>
      )}
    </div>
  );
}
