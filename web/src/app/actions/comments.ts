"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import {
  createComment,
  deleteComment,
  resolveEntityName,
  isEntityType,
  CONTENT_MAX,
  type EntityType,
} from "@/lib/comments";
import { commentRateLimiter } from "@/lib/rate_limit";

// 생성·삭제 공통 — 엔티티 상세 페이지 재검증 (홈 "/" 은 호출부에서 별도).
function revalidateEntity(entityType: EntityType, entityId: string): void {
  switch (entityType) {
    case "horse":   revalidatePath(`/horse/${entityId}`);   break;
    case "jockey":  revalidatePath(`/jockey/${entityId}`);  break;
    case "trainer": revalidatePath(`/trainer/${entityId}`); break;
    case "owner":   revalidatePath(`/owner/${entityId}`);   break;
    case "race":    revalidatePath("/races");               break;
  }
}

export async function createCommentAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("로그인이 필요합니다.");

  if (commentRateLimiter.check(session.user.id) === "RATE_LIMITED") {
    throw new Error("잠시 후 다시 시도해 주세요.");
  }

  const entityType = formData.get("entityType");
  const entityId = String(formData.get("entityId") ?? "").trim();
  const content = String(formData.get("content") ?? "").trim();

  if (!isEntityType(entityType) || !entityId) {
    throw new Error("잘못된 요청입니다.");
  }
  // 코드포인트 기준 길이 — DB char_length CHECK 와 일치(이모지 과잉제한 방지).
  if (!content || [...content].length > CONTENT_MAX) {
    throw new Error("댓글 내용을 확인해 주세요.");
  }

  // 클라 entityName 불신뢰 — 서버에서 entityId 로 표시명 결정 + 실재 검증.
  const entityName = await resolveEntityName(entityType, entityId);
  if (entityName === null) throw new Error("존재하지 않는 대상입니다.");

  await createComment({
    entityType,
    entityId,
    entityName,
    userId: session.user.id,
    content,
  });

  revalidatePath("/");
  revalidateEntity(entityType, entityId);
}

export async function deleteCommentAction(id: number): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("로그인이 필요합니다.");

  const deleted = await deleteComment(id, session.user.id);
  revalidatePath("/");
  if (deleted) revalidateEntity(deleted.entity_type, deleted.entity_id);
}
