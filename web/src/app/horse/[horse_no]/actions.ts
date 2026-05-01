"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { toggleHorseFavorite } from "@/lib/favorite_horses";

export async function toggleFavoriteAction(horseNo: string): Promise<{ favorited: boolean }> {
  const session = await auth();
  if (!session?.user?.id) {
    redirect(`/login?next=/horse/${horseNo}`);
  }
  const result = await toggleHorseFavorite(session.user.id, horseNo);
  revalidatePath(`/horse/${horseNo}`);
  return result;
}
