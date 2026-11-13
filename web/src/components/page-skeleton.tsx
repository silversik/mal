import { PageContainer } from "@/components/page-container";

/**
 * 라우트 loading.tsx 용 스켈레톤 — 실제 레이아웃과 같은 뼈대(제목 → 요약 카드 → 표)를 먼저 그려
 * 진입 시 흰 화면/레이아웃 점프를 없앤다. 장식 모션 최소화: motion-safe 에서만 pulse.
 */
function Bar({ className }: { className: string }) {
  return <div className={`rounded-md bg-muted motion-safe:animate-pulse ${className}`} />;
}

function TableRows({ rows = 6 }: { rows?: number }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="border-b border-border bg-muted px-4 py-3">
        <Bar className="h-4 w-1/3 bg-border" />
      </div>
      <div className="divide-y divide-border">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-3">
            <Bar className="h-7 w-7 rounded-full" />
            <Bar className="h-4 flex-1" />
            <Bar className="h-4 w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** 섹션 레이아웃((analysis)·(database)) 안쪽 본문 — 컨테이너·내비는 layout 이 이미 그린다. */
export function SectionBodySkeleton() {
  return (
    <div aria-busy="true" aria-label="불러오는 중" className="space-y-4">
      <Bar className="h-8 w-40" />
      <Bar className="h-5 w-64" />
      <TableRows />
    </div>
  );
}

/** 마필·기수 상세 — 프로필 카드 + 기록 표. */
export function ProfileSkeleton() {
  return (
    <PageContainer aria-busy="true" aria-label="불러오는 중" className="space-y-6 py-6">
      <Bar className="h-4 w-40" />
      <div className="space-y-4 rounded-xl border border-border bg-card p-4">
        <div className="flex items-center gap-4">
          <Bar className="h-16 w-16 rounded-xl" />
          <div className="flex-1 space-y-2">
            <Bar className="h-7 w-48" />
            <Bar className="h-4 w-64" />
          </div>
        </div>
        <Bar className="h-20 w-full" />
        <div className="grid gap-2 sm:grid-cols-3">
          <Bar className="h-14" />
          <Bar className="h-14" />
          <Bar className="h-14" />
        </div>
      </div>
      <TableRows rows={8} />
    </PageContainer>
  );
}

/** 경기 일람 — 날짜 내비 + 경주 칩 + 출전표. */
export function RaceSkeleton() {
  return (
    <PageContainer aria-busy="true" aria-label="불러오는 중" className="space-y-6 py-6 md:py-8">
      <Bar className="h-8 w-32" />
      <div className="flex gap-2">
        <Bar className="h-11 w-11" />
        <Bar className="h-11 w-40" />
        <Bar className="h-11 w-11" />
      </div>
      <Bar className="h-24 w-full rounded-xl" />
      <TableRows rows={10} />
    </PageContainer>
  );
}
