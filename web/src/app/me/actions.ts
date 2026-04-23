"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { auth, signOut } from "@/auth";
import {
  deleteUser,
  updateNickname,
  validateNicknameShape,
} from "@/lib/users";

export async function updateNicknameAction(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const raw = formData.get("nickname");
  const input = typeof raw === "string" ? raw : "";
  const v = validateNicknameShape(input);
  if (!v.ok) {
    redirect(`/me?error=${v.error}`);
  }

  const result = await updateNickname(session.user.id, v.value);
  if (!result.ok) {
    redirect(`/me?error=${result.error}`);
  }

  // 커뮤니티 목록/상세 모두 작성자 표기가 바뀌므로 재검증.
  revalidatePath("/me");
  revalidatePath("/board");
  revalidatePath("/");
  redirect("/me?ok=1");
}

export async function deleteAccountAction() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  await deleteUser(session.user.id);
  // 세션 쿠키 정리 + 홈으로.
  await signOut({ redirectTo: "/" });
}

export async function logoutAction() {
  await signOut({ redirectTo: "/" });
}
