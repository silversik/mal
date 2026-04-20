import Link from "next/link";

import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  isStale,
  listScraperJobs,
  sourceLabel,
  type ScraperJobRow,
} from "@/lib/scrapers";

import { JobRow } from "./job-row";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const jobs = await listScraperJobs();
  const staleCount = jobs.filter(isStale).length;
  const failingCount = jobs.filter(
    (j) => j.last_status === "failed" && j.consecutive_failures > 0,
  ).length;

  // Group by source
  const bySource = new Map<string, ScraperJobRow[]>();
  for (const j of jobs) {
    const list = bySource.get(j.source) ?? [];
    list.push(j);
    bySource.set(j.source, list);
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">스크래퍼 모니터링</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            각 스크래퍼의 최근 실행 상태 · 지연 여부를 확인하고, 주기를 조정합니다.
          </p>
        </div>
      </div>

      {(staleCount > 0 || failingCount > 0) && (
        <div className="mb-6 rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-900">
          <div className="font-semibold">⚠️ 주의가 필요합니다</div>
          <ul className="mt-2 list-disc pl-5">
            {staleCount > 0 && (
              <li>
                <strong>{staleCount}</strong>개 스크래퍼가 기대 주기보다 오래
                실행되지 않았습니다 (STALE).
              </li>
            )}
            {failingCount > 0 && (
              <li>
                <strong>{failingCount}</strong>개 스크래퍼가 최근 실패 상태입니다.
              </li>
            )}
          </ul>
        </div>
      )}

      {[...bySource.entries()].map(([source, list]) => (
        <section key={source} className="mb-8">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            {sourceLabel(source)}
          </h2>
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-left">Job</TableHead>
                    <TableHead>마지막 상태</TableHead>
                    <TableHead>마지막 성공</TableHead>
                    <TableHead>소요</TableHead>
                    <TableHead>upsert</TableHead>
                    <TableHead>연속 실패</TableHead>
                    <TableHead>주기</TableHead>
                    <TableHead>활성</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {list.map((job) => (
                    <JobRow key={job.job_key} job={job} />
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
          <div className="mt-2 text-right text-[11px] text-muted-foreground">
            {list.map((j) => (
              <Link
                key={j.job_key}
                href={`/admin/runs/${j.job_key}`}
                className="ml-3 underline hover:text-foreground"
              >
                {j.job_key} 실행 이력
              </Link>
            ))}
          </div>
        </section>
      ))}

      {jobs.length === 0 && (
        <div className="rounded-md border border-dashed p-8 text-center text-muted-foreground">
          등록된 스크래퍼 job이 없습니다. <code>db/migrations/008_scraper_monitoring.sql</code> 을 적용했는지 확인하세요.
        </div>
      )}
    </div>
  );
}
