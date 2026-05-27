import type { Metadata } from "next";
import Link from "next/link";
import { listContactPosts, PAGE_SIZE } from "@/lib/contact";

export const metadata: Metadata = {
  title: "문의 게시판",
  description: "mal.kr 서비스 관련 문의, 데이터 오류 신고, 제안 사항을 남겨주세요.",
  alternates: { canonical: "/contact" },
};

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  pending:     { label: "접수됨",  cls: "bg-muted text-muted-foreground" },
  in_progress: { label: "처리중",  cls: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" },
  resolved:    { label: "완료",    cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" },
};

export default async function ContactPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page: pageStr } = await searchParams;
  const page = Math.max(1, parseInt(pageStr ?? "1", 10) || 1);
  const { posts, total } = await listContactPosts(page);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">문의 게시판</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            서비스 문의, 데이터 오류 신고, 기능 제안을 남겨주세요.
          </p>
        </div>
        <Link
          href="/contact/new"
          className="inline-flex items-center gap-1.5 rounded-[10px] bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
        >
          새 문의 작성
        </Link>
      </div>

      {posts.length === 0 ? (
        <div className="rounded-[10px] border border-border bg-card py-16 text-center text-sm text-muted-foreground">
          아직 등록된 문의가 없습니다.
        </div>
      ) : (
        <div className="rounded-[10px] border border-border bg-card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/40">
              <tr>
                <th className="px-4 py-3 text-left font-semibold text-muted-foreground w-14 font-mono tabular-nums">번호</th>
                <th className="px-4 py-3 text-left font-semibold text-muted-foreground">제목</th>
                <th className="px-4 py-3 text-left font-semibold text-muted-foreground hidden sm:table-cell w-24">작성자</th>
                <th className="px-4 py-3 text-left font-semibold text-muted-foreground hidden md:table-cell w-28">날짜</th>
                <th className="px-4 py-3 text-left font-semibold text-muted-foreground w-20">상태</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {posts.map((post) => {
                const s = STATUS_LABEL[post.status] ?? STATUS_LABEL.pending;
                const date = post.created_at.slice(0, 10);
                return (
                  <tr key={post.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 font-mono tabular-nums text-muted-foreground">
                      {post.id}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/contact/${post.id}`}
                        className="font-medium hover:text-primary transition-colors line-clamp-1"
                      >
                        {post.title}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell truncate max-w-[6rem]">
                      {post.author_name}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs tabular-nums text-muted-foreground hidden md:table-cell">
                      {date}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${s.cls}`}>
                        {s.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-1">
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
            <Link
              key={p}
              href={`/contact?page=${p}`}
              className={`inline-flex h-8 w-8 items-center justify-center rounded-md text-sm font-mono tabular-nums transition ${
                p === page
                  ? "bg-primary text-primary-foreground"
                  : "hover:bg-muted text-muted-foreground"
              }`}
            >
              {p}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
