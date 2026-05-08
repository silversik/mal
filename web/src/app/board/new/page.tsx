import Link from "next/link";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { CONTENT_MAX, TITLE_MAX } from "@/lib/posts";

import { createPostAction } from "./actions";

export const metadata = {
  title: "새 글 쓰기 · 자유게시판",
};

type SearchParams = { error?: string };

export default async function NewPostPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const { error } = await searchParams;

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-10">
      <Link
        href="/board"
        className="group mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground transition hover:text-primary"
      >
        <span className="transition group-hover:-translate-x-0.5">&larr;</span>
        자유게시판
      </Link>

      <h1 className="mb-6 font-serif text-3xl font-bold tracking-tight text-primary">
        새 글 쓰기
      </h1>

      {error === "empty" && (
        <div className="mb-4 rounded-md border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-600">
          제목과 본문을 모두 입력해 주세요.
        </div>
      )}

      <form action={createPostAction} className="space-y-4">
        <div>
          <label
            htmlFor="title"
            className="mb-1.5 block text-xs font-semibold text-slate-grey"
          >
            제목
          </label>
          <input
            id="title"
            name="title"
            type="text"
            required
            maxLength={TITLE_MAX}
            placeholder="제목을 입력하세요"
            className="w-full rounded-md border border-foreground/15 bg-card px-3 py-2 text-[15px] outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
        </div>

        <div>
          <label
            htmlFor="content"
            className="mb-1.5 block text-xs font-semibold text-slate-grey"
          >
            본문
          </label>
          <textarea
            id="content"
            name="content"
            required
            maxLength={CONTENT_MAX}
            rows={14}
            placeholder="내용을 입력하세요"
            className="w-full rounded-md border border-foreground/15 bg-card px-3 py-2 text-[15px] leading-relaxed outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
        </div>

        <div className="flex items-center justify-end gap-2">
          <Link href="/board" className="btn-outline text-xs py-2 px-4">
            취소
          </Link>
          <button type="submit" className="btn-cta text-xs py-2 px-5 shadow-sm">
            등록
          </button>
        </div>
      </form>
    </main>
  );
}
