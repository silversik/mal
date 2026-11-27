import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { PageContainer } from "@/components/page-container";
import { PaperSheet } from "@/components/racing-form/paper-sheet";

import { parseEditionParams } from "../../_lib/load";

/**
 * URL 조각(날짜·경마장 slug)을 검증하고 지면(PaperSheet)으로 감싸는 레이아웃 — DB 를 읽지 않는다.
 * 1면(`(front)/`)·경주면(`[race]/`)의 loading.tsx(Suspense) 바깥에서 돌아 스트리밍 전에 notFound() 가
 * 나가므로 형식이 틀린 주소는 실제 404 상태가 된다. 1면의 page·loading 을 (front) 그룹에 둔 것은
 * 그 loading 이 [race] 까지 감싸지 않게 하려는 것 — 경주 번호는 [race]/layout.tsx 가 같은 방식으로 본다.
 * (페이지 안의 notFound 는 스켈레톤을 보낸 뒤라 200 + noindex 로 나간다 — 계획 없음·출시 전처럼
 * DB 를 봐야 아는 경우.)
 */
export default async function FormEditionLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ date: string; meet: string }>;
}) {
  const p = parseEditionParams(await params);
  if (!p) notFound();
  // 지면(종이 한 장) — 1면(요약)과 경주면(라운드)이 같은 제호 아래 놓인다. 모바일은 화면 폭을 다 쓴다.
  // 아래 여백은 하단에 떠 있는 지면 넘기기 막대(EditionPager) 자리.
  return (
    <PageContainer className="theme-v2 px-0 pt-4 pb-28 md:px-6 md:pt-8 md:pb-32">
      <PaperSheet date={p.date} meet={p.meet}>
        {children}
      </PaperSheet>
    </PageContainer>
  );
}
