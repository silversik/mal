"use server";

import { auth } from "@/auth";
import { createContactPost } from "@/lib/contact";
import { TITLE_MAX, CONTENT_MAX, AUTHOR_MAX } from "@/lib/contact-shared";
import { contactRateLimiter } from "@/lib/rate_limit";
import { sendTelegram } from "@/lib/telegram";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

function countCodePoints(s: string) {
  return [...s].length;
}

export async function createContactPostAction(
  _prev: { error?: string } | null,
  formData: FormData,
): Promise<{ error?: string; id?: number }> {
  const session = await auth();

  const ip = (await headers()).get("x-forwarded-for") ?? "unknown";
  const rateLimitKey = session?.user?.id ? `uid:${session.user.id}` : `ip:${ip}`;
  if (contactRateLimiter.check(rateLimitKey) === "RATE_LIMITED") {
    return { error: "잠시 후 다시 시도해 주세요. (5분에 3건 제한)" };
  }

  const title = (formData.get("title") as string | null)?.trim() ?? "";
  const content = (formData.get("content") as string | null)?.trim() ?? "";
  const authorInput = (formData.get("author_name") as string | null)?.trim() ?? "";

  // 로그인 사용자는 세션 닉네임 사용
  const author_name = session?.user?.name
    ? session.user.name.slice(0, AUTHOR_MAX)
    : authorInput;

  if (countCodePoints(title) < 1 || countCodePoints(title) > TITLE_MAX) {
    return { error: `제목은 1~${TITLE_MAX}자 이내로 입력해 주세요.` };
  }
  if (countCodePoints(content) < 10 || countCodePoints(content) > CONTENT_MAX) {
    return { error: `내용은 10~${CONTENT_MAX}자 이내로 입력해 주세요.` };
  }
  if (!session?.user?.name) {
    if (countCodePoints(author_name) < 1 || countCodePoints(author_name) > AUTHOR_MAX) {
      return { error: `이름은 1~${AUTHOR_MAX}자 이내로 입력해 주세요.` };
    }
  }

  const { id } = await createContactPost({
    title,
    content,
    author_name,
    user_id: session?.user?.id ?? null,
  });

  // 텔레그램 알림 (실패해도 무시)
  await sendTelegram(
    `📬 <b>새 문의가 등록되었습니다</b>\n\n` +
    `<b>제목:</b> ${title}\n` +
    `<b>작성자:</b> ${author_name}\n` +
    `<b>내용:</b>\n${content.slice(0, 300)}${content.length > 300 ? "…" : ""}\n\n` +
    `https://mal.kr/contact/${id}`,
  );

  revalidatePath("/contact");
  return { id };
}
