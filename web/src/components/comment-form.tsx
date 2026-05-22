"use client";

import { useRef, useState, useTransition } from "react";
import { createCommentAction } from "@/app/actions/comments";

// Keep in sync with CONTENT_MAX in lib/comments.ts
const CONTENT_MAX = 500;

type EntityType = "horse" | "jockey" | "trainer" | "owner" | "race";

type Props = {
  entityType: EntityType;
  entityId: string;
  entityName: string;
};

export function CommentForm({ entityType, entityId, entityName }: Props) {
  const [content, setContent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!content.trim()) return;
    setError(null);
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      try {
        await createCommentAction(fd);
        setContent("");
        formRef.current?.reset();
      } catch (err) {
        setError(err instanceof Error ? err.message : "오류가 발생했습니다.");
      }
    });
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="space-y-2">
      <input type="hidden" name="entityType" value={entityType} />
      <input type="hidden" name="entityId" value={entityId} />
      <input type="hidden" name="entityName" value={entityName} />
      <div className="relative">
        <textarea
          name="content"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          maxLength={CONTENT_MAX}
          rows={3}
          placeholder="댓글을 입력하세요"
          disabled={isPending}
          className="w-full resize-none rounded-lg border border-primary/15 bg-white px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-60"
        />
        <span className="absolute bottom-2 right-3 text-[10px] text-muted-foreground tabular-nums">
          {content.length}/{CONTENT_MAX}
        </span>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex justify-end">
        <button
          type="submit"
          disabled={isPending || !content.trim()}
          className="rounded-md bg-primary px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-primary/90 disabled:opacity-50"
        >
          {isPending ? "등록 중…" : "등록"}
        </button>
      </div>
    </form>
  );
}
