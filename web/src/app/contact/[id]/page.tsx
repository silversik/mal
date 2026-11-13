import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getContactPost } from "@/lib/contact";
import { parsePositiveInt } from "@/lib/params";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  pending:     { label: "접수됨",  cls: "bg-muted text-muted-foreground" },
  in_progress: { label: "처리중",  cls: "border border-brown/40 bg-card text-brown" },
  resolved:    { label: "완료",    cls: "border border-positive/40 bg-card text-positive" },
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const id = parsePositiveInt((await params).id);
  // 숫자 아닌 id 는 DB 로 보내지 않는다 (bigint 캐스팅 실패 → 500).
  const post = id === null ? null : await getContactPost(id);
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
  const id = parsePositiveInt((await params).id);
  if (id === null) notFound();
  const post = await getContactPost(id);
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
        <span className={`inline-flex items-center rounded-full px-2 py-1 text-sm font-semibold ${s.cls}`}>
          {s.label}
        </span>
      </div>

      <div className="rounded-[10px] border border-border bg-card p-6 space-y-4">
        <div className="space-y-2">
          <h1 className="text-lg font-bold tracking-tight leading-snug">{post.title}</h1>
          <div className="flex items-center gap-3 text-sm text-muted-foreground font-mono tabular-nums">
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
        <div className="rounded-[10px] border border-positive/40 bg-card px-4 py-4">
          <p className="text-base font-semibold text-positive">처리 완료</p>
          <p className="mt-1 text-base text-foreground">
            해당 문의가 처리되었습니다. 추가 문의가 있으시면 새 글을 작성해 주세요.
          </p>
        </div>
      )}
    </div>
  );
}
