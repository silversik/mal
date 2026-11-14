import { notFound, redirect } from "next/navigation";

import { getEditionIndex, getFormCalendar, getLaunchAt } from "@/lib/racing_form";
import {
  editionState,
  FORM_MEETS,
  formEditionPath,
  normalizeFormDate,
} from "@/lib/racing_form-shared";

// 요청 시점에만 DB 를 친다 (빌드의 placeholder DATABASE_URL 로 프리렌더하지 않게).
export const dynamic = "force-dynamic";

/**
 * /form/{YYYY-MM-DD} — 그날 계획된 첫 경마장의 1면으로 보낸다 (서울 → 제주 → 부경, MEET_ORDER).
 * 계획이 없거나 출시 전이라 1면이 404 인 날은 404.
 */
export default async function FormDatePage({ params }: { params: Promise<{ date: string }> }) {
  const date = normalizeFormDate((await params).date);
  if (!date) notFound();
  const [calendar, editions, launchAt] = await Promise.all([
    getFormCalendar(date, date),
    getEditionIndex(date, date),
    getLaunchAt(),
  ]);
  const now = new Date();
  for (const { meet } of FORM_MEETS) {
    const planned = calendar.find((c) => c.meet === meet) ?? null;
    const edition = editions.find((e) => e.meet === meet) ?? null;
    if (!planned && !edition) continue;
    // 404 여부는 공지와 무관하다 (계획·발행본·출시 시각만 본다)
    const st = editionState({ planned, edition, notices: [], now, launchAt });
    if (!st.notFound) redirect(formEditionPath(date, meet));
  }
  notFound();
}
