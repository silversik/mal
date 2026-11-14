import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { parseEditionParams } from "../../_lib/load";

/**
 * URL 조각(날짜·경마장 slug) 검증만 하는 레이아웃 — DB 를 읽지 않는다.
 * 이 세그먼트의 loading.tsx(Suspense) 바깥에서 돌아 스트리밍 전에 notFound() 가 나가므로
 * 형식이 틀린 주소는 실제 404 상태가 된다. (페이지 안의 notFound 는 스켈레톤을 보낸 뒤라
 * 200 + noindex 로 나간다 — 계획 없음·출시 전처럼 DB 를 봐야 아는 경우.)
 */
export default async function FormEditionLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ date: string; meet: string }>;
}) {
  if (!parseEditionParams(await params)) notFound();
  return <>{children}</>;
}
