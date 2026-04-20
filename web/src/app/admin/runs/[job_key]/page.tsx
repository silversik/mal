import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { listRecentRuns, listScraperJobs } from "@/lib/scrapers";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ job_key: string }> };

function fmt(dt: string | null): string {
  if (!dt) return "—";
  return dt.replace("T", " ").replace(/\+0900$/, "");
}

export default async function RunsPage({ params }: Props) {
  const { job_key } = await params;
  const [jobs, runs] = await Promise.all([
    listScraperJobs(),
    listRecentRuns(job_key, 50),
  ]);
  const job = jobs.find((j) => j.job_key === job_key);
  if (!job) notFound();

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-8">
      <div className="mb-4">
        <Link
          href="/admin"
          className="text-sm text-muted-foreground hover:underline"
        >
          ← 모니터링 대시보드
        </Link>
      </div>
      <h1 className="text-xl font-bold">
        <span className="font-mono">{job.job_key}</span> 실행 이력
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {job.description} · 출처 {job.source}
      </p>

      <Card className="mt-6">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>시작</TableHead>
                <TableHead>종료</TableHead>
                <TableHead>상태</TableHead>
                <TableHead>소요</TableHead>
                <TableHead>upsert</TableHead>
                <TableHead className="text-left">에러</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-muted-foreground">
                    실행 이력이 없습니다.
                  </TableCell>
                </TableRow>
              )}
              {runs.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-xs">
                    {fmt(r.started_at)}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {fmt(r.finished_at)}
                  </TableCell>
                  <TableCell>
                    {r.status === "success" ? (
                      <Badge className="bg-emerald-100 text-emerald-800">
                        성공
                      </Badge>
                    ) : r.status === "failed" ? (
                      <Badge className="bg-red-100 text-red-800">실패</Badge>
                    ) : (
                      <Badge className="bg-amber-100 text-amber-800">
                        실행 중
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-xs">
                    {r.duration_ms !== null ? `${r.duration_ms} ms` : "—"}
                  </TableCell>
                  <TableCell className="text-xs">
                    {r.rows_upserted ?? "—"}
                  </TableCell>
                  <TableCell className="text-left">
                    {r.error_message ? (
                      <details className="text-xs">
                        <summary className="cursor-pointer text-red-700">
                          {r.error_message.split("\n")[0].slice(0, 80)}
                        </summary>
                        <pre className="mt-2 whitespace-pre-wrap rounded bg-zinc-100 p-2 text-[11px] text-zinc-800">
                          {r.error_message}
                        </pre>
                      </details>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
