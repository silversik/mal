"use client";

import { useActionState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createContactPostAction } from "@/app/actions/contact";
import { TITLE_MAX, CONTENT_MAX, AUTHOR_MAX } from "@/lib/contact-shared";

export default function ContactNewForm({ userName }: { userName: string | null }) {
  const router = useRouter();
  const [state, action, isPending] = useActionState(createContactPostAction, null);

  useEffect(() => {
    if (state?.id) {
      router.push(`/contact/${state.id}`);
    }
  }, [state, router]);

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 space-y-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">새 문의 작성</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          서비스 문의, 데이터 오류 신고, 기능 제안을 남겨주세요.
        </p>
      </div>

      <form action={action} className="space-y-4">
        {!userName ? (
          <div className="space-y-1.5">
            <label className="text-sm font-semibold" htmlFor="author_name">
              이름 <span className="text-destructive">*</span>
            </label>
            <input
              id="author_name"
              name="author_name"
              type="text"
              required
              maxLength={AUTHOR_MAX}
              placeholder="표시될 이름을 입력하세요"
              className="w-full rounded-[10px] border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 transition"
            />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            <span className="font-semibold text-foreground">{userName}</span>
            으로 등록됩니다.
          </p>
        )}

        <div className="space-y-1.5">
          <label className="text-sm font-semibold" htmlFor="title">
            제목 <span className="text-destructive">*</span>
          </label>
          <input
            id="title"
            name="title"
            type="text"
            required
            maxLength={TITLE_MAX}
            placeholder="문의 제목을 입력하세요"
            className="w-full rounded-[10px] border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 transition"
          />
        </div>

        <ContentField />

        {state?.error && (
          <p className="text-sm text-destructive">{state.error}</p>
        )}

        <div className="flex items-center gap-3 pt-2">
          <button
            type="submit"
            disabled={isPending}
            className="inline-flex items-center gap-2 rounded-[10px] bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
          >
            {isPending ? "등록 중…" : "문의 등록"}
          </button>
          <button
            type="button"
            onClick={() => router.back()}
            className="text-sm text-muted-foreground hover:text-foreground transition"
          >
            취소
          </button>
        </div>
      </form>
    </div>
  );
}

function ContentField() {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const countRef = useRef<HTMLSpanElement>(null);

  function handleInput() {
    const len = [...(textareaRef.current?.value ?? "")].length;
    if (countRef.current) countRef.current.textContent = String(len);
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label className="text-sm font-semibold" htmlFor="content">
          내용 <span className="text-destructive">*</span>
        </label>
        <span className="text-xs text-muted-foreground font-mono tabular-nums">
          <span ref={countRef}>0</span>/{CONTENT_MAX}
        </span>
      </div>
      <textarea
        ref={textareaRef}
        id="content"
        name="content"
        required
        rows={8}
        maxLength={CONTENT_MAX}
        onInput={handleInput}
        placeholder="문의 내용을 자세히 작성해 주세요. (최소 10자)"
        className="w-full resize-none rounded-[10px] border border-border bg-background px-3 py-2 text-sm leading-relaxed outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 transition"
      />
    </div>
  );
}
