"use client";

import { useState, useTransition } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TableCell, TableRow } from "@/components/ui/table";
import {
  formatDuration,
  formatInterval,
  isStale,
  type ScraperJobRow,
} from "@/lib/scrapers-shared";

import { saveInterval, toggleEnabled } from "./actions";

type Props = { job: ScraperJobRow };

const UNITS: Array<{ label: string; sec: number }> = [
  { label: "분", sec: 60 },
  { label: "시간", sec: 3600 },
  { label: "일", sec: 86400 },
];

function pickUnit(sec: number): { value: number; unit: number } {
  for (const u of [...UNITS].reverse()) {
    if (sec % u.sec === 0) return { value: sec / u.sec, unit: u.sec };
  }
  return { value: Math.round(sec / 60), unit: 60 };
}

export function JobRow({ job }: Props) {
  const stale = isStale(job);
  const initial = pickUnit(job.expected_interval_sec);
  const [value, setValue] = useState<number>(initial.value);
  const [unit, setUnit] = useState<number>(initial.unit);
  const [pending, startTransition] = useTransition();

  const dirty = value * unit !== job.expected_interval_sec;

  const statusBadge = (() => {
    if (!job.last_status) {
      return <Badge className="bg-zinc-200 text-zinc-700">미실행</Badge>;
    }
    if (job.last_status === "success") {
      return <Badge className="bg-emerald-100 text-emerald-800">성공</Badge>;
    }
    if (job.last_status === "failed") {
      return <Badge className="bg-red-100 text-red-800">실패</Badge>;
    }
    return <Badge className="bg-amber-100 text-amber-800">실행 중</Badge>;
  })();

  return (
    <TableRow className={stale ? "bg-red-50/60" : ""}>
      <TableCell className="text-left font-mono text-xs">
        {job.job_key}
        {job.description && (
          <div className="mt-0.5 text-muted-foreground text-[11px]">
            {job.description}
          </div>
        )}
      </TableCell>

      <TableCell>{statusBadge}</TableCell>

      <TableCell className="text-xs">
        {formatDuration(job.since_success_sec)}
        {stale && (
          <Badge className="ml-2 bg-red-600 text-white">STALE</Badge>
        )}
      </TableCell>

      <TableCell className="text-xs">
        {job.last_duration_ms !== null ? `${job.last_duration_ms} ms` : "—"}
      </TableCell>

      <TableCell className="text-xs">
        {job.last_rows_upserted ?? "—"}
      </TableCell>

      <TableCell className="text-xs">
        {job.consecutive_failures > 0 ? (
          <span className="text-red-600 font-semibold">
            {job.consecutive_failures}
          </span>
        ) : (
          "0"
        )}
      </TableCell>

      <TableCell>
        <div className="flex items-center gap-1">
          <Input
            type="number"
            min={1}
            max={999}
            value={value}
            onChange={(e) => setValue(Number(e.target.value))}
            className="w-16 h-7 text-xs"
          />
          <select
            value={unit}
            onChange={(e) => setUnit(Number(e.target.value))}
            className="h-7 rounded border border-input bg-background px-1 text-xs"
          >
            {UNITS.map((u) => (
              <option key={u.sec} value={u.sec}>
                {u.label}
              </option>
            ))}
          </select>
          <Button
            size="sm"
            variant={dirty ? "default" : "ghost"}
            disabled={!dirty || pending}
            onClick={() =>
              startTransition(async () => {
                await saveInterval(job.job_key, value * unit);
              })
            }
            className="h-7 px-2 text-xs"
          >
            저장
          </Button>
        </div>
        <div className="mt-0.5 text-[10px] text-muted-foreground">
          현재 {formatInterval(job.expected_interval_sec)}
        </div>
      </TableCell>

      <TableCell>
        <Button
          size="sm"
          variant={job.enabled ? "outline" : "ghost"}
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              await toggleEnabled(job.job_key, !job.enabled);
            })
          }
          className="h-7 px-2 text-xs"
        >
          {job.enabled ? "ON" : "OFF"}
        </Button>
      </TableCell>
    </TableRow>
  );
}
