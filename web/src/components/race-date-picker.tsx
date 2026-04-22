"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ko } from "date-fns/locale";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

/** YYYY-MM-DD (local) → Date (midnight local) */
function parseYmd(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** Date → YYYY-MM-DD (local) */
function fmtYmd(d: Date): string {
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");
}

function formatTriggerLabel(dateStr: string): string {
  const d = parseYmd(dateStr);
  const dow = ["일", "월", "화", "수", "목", "금", "토"][d.getDay()];
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${dow})`;
}

export function RaceDatePicker({
  currentDate,
  raceDates,
}: {
  /** YYYY-MM-DD */
  currentDate: string;
  /** YYYY-MM-DD 배열 — 경주가 있는 날짜. 달력에 금색 강조 */
  raceDates: string[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const today = fmtYmd(new Date());

  const raceDateSet = useMemo(() => new Set(raceDates), [raceDates]);

  const selected = parseYmd(currentDate);

  const hasRace = (d: Date) => raceDateSet.has(fmtYmd(d));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className="h-9 gap-1.5 px-3 text-sm font-semibold whitespace-nowrap"
        >
          {formatTriggerLabel(currentDate)}
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            fill="none"
            className="opacity-60"
          >
            <path
              d="M2 4l3 3 3-3"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={selected}
          defaultMonth={selected}
          locale={ko}
          captionLayout="dropdown"
          modifiers={{ hasRace }}
          modifiersClassNames={{
            hasRace:
              "font-bold text-champagne-gold after:absolute after:bottom-0.5 after:left-1/2 after:h-1 after:w-1 after:-translate-x-1/2 after:rounded-full after:bg-champagne-gold relative",
          }}
          onSelect={(d) => {
            if (!d) return;
            const ymd = fmtYmd(d);
            setOpen(false);
            // 오늘을 고르면 query 제거 (기본 경로로)
            router.push(ymd === today ? "/races" : `/races?date=${ymd}`);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
