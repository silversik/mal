"use client";

import type { FormEvent } from "react";

import { deleteAccountAction } from "./actions";

// Server Action 을 호출하기 직전 window.confirm 으로 2 차 확인.
// Server Component 에서 바로 form action 에 서버 액션을 붙이면 onSubmit 확인을
// 걸 수 없어서 Client wrapper 로 감싼다.
export function DeleteAccountForm() {
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    const ok = window.confirm(
      "정말 탈퇴하시겠어요?\n계정과 작성한 글이 모두 삭제되며 복구할 수 없습니다.",
    );
    if (!ok) {
      event.preventDefault();
    }
  }

  return (
    <form action={deleteAccountAction} onSubmit={handleSubmit}>
      <button
        type="submit"
        className="rounded-md border border-red-500/40 bg-red-500/5 px-5 py-2 text-xs font-semibold text-red-600 transition hover:bg-red-500/10"
      >
        탈퇴하기
      </button>
    </form>
  );
}
