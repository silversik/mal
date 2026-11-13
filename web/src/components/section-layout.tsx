import { PageContainer } from "@/components/page-container";

/**
 * (analysis)·(database) 공용 셸 — 섹션 내비 + 본문.
 * 섹션 제목은 내비 안의 라벨로만 두고, 각 페이지의 h1 이 페이지의 유일한 h1.
 * (예전엔 layout h1 + page h1 이 같은 크기로 이중 노출돼 첫 화면 ~120px 을 먹었다.)
 */
export function SectionLayout({
  nav,
  children,
}: {
  nav: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <PageContainer className="theme-v2 py-4 md:py-8">
      <div className="flex flex-col gap-4 md:grid md:grid-cols-[176px_minmax(0,1fr)] md:gap-8">
        {nav}
        <div className="min-w-0">{children}</div>
      </div>
    </PageContainer>
  );
}
