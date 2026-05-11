import { DatabaseSidebar } from "@/components/database-sidebar";

export default function DatabaseLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 md:px-6 md:py-8">
      <header className="mb-5">
        <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">
          데이터베이스
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          한국마사회 공공데이터 기반 마필 · 기수 · 조교사 · 마주 정보를 한곳에서 탐색하세요.
        </p>
      </header>

      <div className="grid gap-5 md:grid-cols-[200px_minmax(0,1fr)]">
        <DatabaseSidebar />
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
