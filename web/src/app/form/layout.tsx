/**
 * /form/** 공통 레이아웃 — 아무것도 얹지 않는다 (2026-11-27: '경기' 서브탭을 뺐다).
 * DB 를 읽지 않는다 (URL 검증 레이아웃·각 페이지의 loading 은 이 아래에서 그대로 동작).
 */
export default function FormLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
