"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { CONTENT_MAX, TITLE_MAX, createPost } from "@/lib/posts";

export async function createPostAction(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  const titleRaw = formData.get("title");
  const contentRaw = formData.get("content");

  const title =
    typeof titleRaw === "string" ? titleRaw.trim().slice(0, TITLE_MAX) : "";
  const content =
    typeof contentRaw === "string"
      ? contentRaw.trim().slice(0, CONTENT_MAX)
      : "";

  if (!title || !content) {
    // 빈 값이면 new 페이지로 돌려보내고 에러 노출 (간단 구현).
    redirect("/board/new?error=empty");
  }

  const post = await createPost({
    user_id: session.user.id,
    title,
    content,
  });

  revalidatePath("/board");
  revalidatePath("/");
  redirect(`/board/${post.id}`);
}
