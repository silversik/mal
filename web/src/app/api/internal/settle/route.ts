// crawler 의 정산 잡 진입점. X-Crawler-Secret 헤더 timing-safe 검증.
//
// 호출 형태:
//   POST /api/internal/settle              → 결과 있는 모든 race 일괄 정산
//   POST /api/internal/settle  body {date,meet,raceNo}  → 한 race 만
import { timingSafeEqual } from "node:crypto";

import type { NextRequest } from "next/server";

import {
  settlePendingForFinishedRaces,
  settleRace,
} from "@/lib/settlement";

export const dynamic = "force-dynamic";

function isAuthorized(req: NextRequest): boolean {
  const expected = process.env.CRAWLER_SECRET;
  if (!expected) return false;
  const got = req.headers.get("x-crawler-secret") ?? "";
  const a = Buffer.from(expected);
  const b = Buffer.from(got);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { raceDate?: unknown; meet?: unknown; raceNo?: unknown } = {};
  try {
    const len = Number(req.headers.get("content-length") ?? "0");
    if (len > 0) body = await req.json();
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }

  const raceDate = typeof body.raceDate === "string" ? body.raceDate : null;
  const meet = typeof body.meet === "string" ? body.meet : null;
  const raceNoRaw = body.raceNo;
  const raceNo =
    typeof raceNoRaw === "number" && Number.isInteger(raceNoRaw)
      ? raceNoRaw
      : null;

  if (raceDate || meet || raceNo) {
    if (!raceDate || !meet || raceNo === null) {
      return Response.json(
        { error: "raceDate, meet, raceNo must all be provided together" },
        { status: 400 },
      );
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raceDate)) {
      return Response.json(
        { error: "raceDate must be YYYY-MM-DD" },
        { status: 400 },
      );
    }
    const result = await settleRace(raceDate, meet, raceNo);
    return Response.json(result);
  }

  const summary = await settlePendingForFinishedRaces(50);
  return Response.json(summary);
}
