"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import {
  createComment,
  deleteComment,
  CONTENT_MAX,
  type EntityType,
} from "@/lib/comments";

export async function createCommentAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("로그인이 필요합니다.");

  const entityType = formData.get("entityType") as EntityType;
  const entityId = String(formData.get("entityId") ?? "").trim();
  const entityName = String(formData.get("entityName") ?? "").trim();
  const content = String(formData.get("content") ?? "").trim();

  if (!entityType || !entityId || !entityName) throw new Error("잘못된 요청입니다.");
  if (!content || content.length > CONTENT_MAX) throw new Error("댓글 내용을 확인해 주세요.");

  await createComment({
    entityType,
    entityId,
    entityName,
    userId: session.user.id,
    content,
  });

  revalidatePath("/");

  switch (entityType) {
    case "horse":   revalidatePath(`/horse/${entityId}`);   break;
    case "jockey":  revalidatePath(`/jockey/${entityId}`);  break;
    case "trainer": revalidatePath(`/trainer/${entityId}`); break;
    case "owner":   revalidatePath(`/owner/${entityId}`);   break;
    case "race":    revalidatePath("/races");               break;
  }
}

export async function deleteCommentAction(id: number): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("로그인이 필요합니다.");
  await deleteComment(id, session.user.id);
  revalidatePath("/");
}
