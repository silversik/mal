"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { auth, signOut } from "@/auth";
import { claimAttendanceBonus } from "@/lib/balances";
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

// 마이페이지 "출석 보너스" 카드 클릭 → 같은 KST 일자 1회만 적립 (10,000P).
export async function claimAttendanceBonusAction() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const result = await claimAttendanceBonus(session.user.id);
  revalidatePath("/me");
  revalidatePath("/", "layout"); // 헤더 BalanceChip 갱신.
  if (result.alreadyClaimed) {
    redirect("/me?attendance=already");
  }
  if (!result.ok) {
    redirect("/me?attendance=error");
  }
  redirect("/me?attendance=ok");
}
