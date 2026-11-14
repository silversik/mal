import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { normalizeFormRaceNo } from "@/lib/racing_form-shared";

/**
 * 경주 번호 조각(1~30, "03" 은 3) 검증만 하는 레이아웃 — DB 를 읽지 않는다.
 * 같은 세그먼트의 loading.tsx(Suspense) 바깥에서 돌아 스트리밍 전에 notFound() 가 나가므로
 * /form/{날짜}/{경마장}/abc · /0 · /31 은 실제 404 상태가 된다. 날짜·경마장은 위 [meet]/layout.tsx 가
 * 본다. (1면의 loading.tsx 는 (front) 그룹 안에 있어 이 세그먼트를 감싸지 않는다.)
 * 그 호에 없는 경주처럼 DB 를 봐야 아는 경우는 페이지 안의 notFound — 200 + noindex.
 */
export default async function FormRaceLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ race: string }>;
}) {
  if (normalizeFormRaceNo((await params).race) === null) notFound();
  return <>{children}</>;
}
