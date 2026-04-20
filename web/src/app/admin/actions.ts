"use server";

import { revalidatePath } from "next/cache";

import { updateJobEnabled, updateJobInterval } from "@/lib/scrapers";

const MIN_INTERVAL_SEC = 60;            // 1분
const MAX_INTERVAL_SEC = 60 * 60 * 24 * 30; // 30일

export async function saveInterval(jobKey: string, intervalSec: number) {
  if (!Number.isFinite(intervalSec)) {
    throw new Error("invalid interval");
  }
  const sec = Math.max(MIN_INTERVAL_SEC, Math.min(MAX_INTERVAL_SEC, Math.floor(intervalSec)));
  await updateJobInterval(jobKey, sec);
  revalidatePath("/admin");
}

export async function toggleEnabled(jobKey: string, enabled: boolean) {
  await updateJobEnabled(jobKey, enabled);
  revalidatePath("/admin");
}
