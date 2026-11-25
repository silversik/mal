import { PageContainer } from "@/components/page-container";
import { RacesSubnav } from "@/components/races-subnav";

/**
 * /form/** 공통 — '경기' 서브탭(경기 일람 | 경마지 | 대상경주 일정)만 얹는다.
 * DB 를 읽지 않는다 (URL 검증 레이아웃·각 페이지의 loading 은 이 아래에서 그대로 동작).
 */
export default function FormLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PageContainer className="theme-v2 pt-4 md:pt-6">
        <RacesSubnav />
      </PageContainer>
      {children}
    </>
  );
}
