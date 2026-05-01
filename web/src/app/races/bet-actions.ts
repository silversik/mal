"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import {
  placeBet,
  type PlaceBetError,
  type PlaceBetInput,
} from "@/lib/bets";
import type {
  BetKind,
  BetPool,
  SelectionInput,
} from "@/lib/bet_combinations";
import { betRateLimiter } from "@/lib/rate_limit";

const POOLS: BetPool[] = ["WIN", "PLC", "QNL", "QPL", "EXA", "TRI", "TLA"];
const KINDS: BetKind[] = ["STRAIGHT", "BOX", "FORMATION"];

export type PlaceBetActionResult =
  | { ok: true; betId: string; comboCount: number; totalAmountP: string }
  | {
      ok: false;
      error: PlaceBetError | "AUTH_REQUIRED" | "BAD_INPUT" | "RATE_LIMITED";
      detail?: string;
    };

function parsePool(v: unknown): BetPool | null {
  return typeof v === "string" && (POOLS as string[]).includes(v)
    ? (v as BetPool)
    : null;
}
function parseKind(v: unknown): BetKind | null {
  return typeof v === "string" && (KINDS as string[]).includes(v)
    ? (v as BetKind)
    : null;
}

function parseHorseList(v: unknown): number[] | null {
  if (typeof v !== "string") return null;
  const parts = v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const nums: number[] = [];
  for (const p of parts) {
    const n = Number.parseInt(p, 10);
    if (!Number.isInteger(n) || n <= 0 || n > 99) return null;
    nums.push(n);
  }
  return nums;
}

function parseFormationSlots(v: unknown): number[][] | null {
  // "1,2|3|4,5,6" 형식 — 슬롯 사이는 |, 같은 슬롯 내부는 ,
  if (typeof v !== "string") return null;
  const slots = v.split("|").map((s) => parseHorseList(s));
  if (slots.some((s) => s === null || s.length === 0)) return null;
  return slots as number[][];
}

export async function placeBetAction(
  formData: FormData,
): Promise<PlaceBetActionResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "AUTH_REQUIRED" };

  if (betRateLimiter.check(session.user.id) === "RATE_LIMITED") {
    return { ok: false, error: "RATE_LIMITED" };
  }

  const raceDate = String(formData.get("raceDate") ?? "");
  const meet = String(formData.get("meet") ?? "");
  const raceNoRaw = String(formData.get("raceNo") ?? "");
  const raceNo = Number.parseInt(raceNoRaw, 10);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(raceDate) ||
    !meet ||
    !Number.isInteger(raceNo)
  ) {
    return { ok: false, error: "BAD_INPUT", detail: "race meta" };
  }

  const pool = parsePool(formData.get("pool"));
  const kind = parseKind(formData.get("kind"));
  if (!pool || !kind) {
    return { ok: false, error: "BAD_INPUT", detail: "pool/kind" };
  }

  const unitRaw = String(formData.get("unitAmountP") ?? "");
  const unitAmountP = (() => {
    try {
      return BigInt(unitRaw);
    } catch {
      return null;
    }
  })();
  if (unitAmountP === null) {
    return { ok: false, error: "BAD_INPUT", detail: "unit" };
  }

  let selection: SelectionInput;
  if (kind === "STRAIGHT") {
    const horses = parseHorseList(formData.get("horses"));
    if (!horses) return { ok: false, error: "BAD_INPUT", detail: "horses" };
    selection = { kind: "STRAIGHT", horses };
  } else if (kind === "BOX") {
    const horses = parseHorseList(formData.get("horses"));
    if (!horses) return { ok: false, error: "BAD_INPUT", detail: "horses" };
    selection = { kind: "BOX", horses };
  } else {
    const slots = parseFormationSlots(formData.get("slots"));
    if (!slots) return { ok: false, error: "BAD_INPUT", detail: "slots" };
    selection = { kind: "FORMATION", slots };
  }

  const input: PlaceBetInput = {
    raceDate,
    meet,
    raceNo,
    pool,
    kind,
    selection,
    unitAmountP,
  };

  const result = await placeBet(session.user.id, input);
  if (!result.ok) {
    return { ok: false, error: result.error, detail: result.detail };
  }

  // 마이페이지·헤더 잔액 갱신
  revalidatePath("/me");
  revalidatePath("/me/bets");
  revalidatePath("/races");
  return {
    ok: true,
    betId: result.betId,
    comboCount: result.comboCount,
    totalAmountP: result.totalAmountP.toString(),
  };
}
