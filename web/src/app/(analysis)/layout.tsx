import { AnalysisSidebar } from "@/components/analysis-sidebar";

export default function AnalysisLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 md:px-6 md:py-8">
      <header className="mb-5">
        <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">
          분석 대시보드
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          축적된 경주 데이터를 활용한 분석 도구. 좌측 메뉴에서 도구를 선택하세요.
        </p>
      </header>

      <div className="grid gap-5 md:grid-cols-[200px_minmax(0,1fr)]">
        <AnalysisSidebar />
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
