// 모의배팅 핵심 비즈니스 로직: placeBet (생성·검증·잔액차감), 조회.
// 정산은 settlement.ts 에서 분리.

import { query } from "./db";
import { withTransaction } from "./db_tx";
import {
  applyDelta,
  getDailyBetTotalP,
} from "./balances";
import {
  enumerateCombos,
  SLOTS,
  type BetKind,
  type BetPool,
  type SelectionInput,
} from "./bet_combinations";

// 한도 (사용자 합의: Derbyon 동일)
export const MAX_PER_TICKET_P = BigInt(100_000); // 1매 ≤ 10만P
export const MAX_DAILY_P = BigInt(750_000); // 1일 ≤ 75만P
export const MIN_UNIT_P = BigInt(100); // 단위 100P

export type BetStatus = "PENDING" | "SETTLED_HIT" | "SETTLED_MISS" | "VOID";

export type PlaceBetInput = {
  raceDate: string;     // 'YYYY-MM-DD'
  meet: string;         // 서울/제주/부경
  raceNo: number;
  pool: BetPool;
  kind: BetKind;
  selection: SelectionInput;  // STRAIGHT/BOX/FORMATION 분기
  unitAmountP: bigint;        // 1조합 단위 금액 (>=100, %100==0)
};

export type PlaceBetError =
  | "BAD_INPUT"
  | "RACE_NOT_FOUND"
  | "RACE_LOCKED"
  | "RACE_FINISHED"
  | "PLC_NOT_AVAILABLE"
  | "UNKNOWN_HORSE"
  | "UNIT_INVALID"
  | "TICKET_LIMIT_EXCEEDED"
  | "DAILY_LIMIT_EXCEEDED"
  | "INSUFFICIENT_FUNDS";

export type PlaceBetResult =
  | { ok: true; betId: string; comboCount: number; totalAmountP: bigint }
  | { ok: false; error: PlaceBetError; detail?: string };

// 마감 검증 — start_time 이 있으면 그 시각 직전까지, 없으면 race_date 자정 KST.
//   결과(race_results) 가 1건이라도 있으면 즉시 마감 처리 (안전망).
async function getRaceLockState(
  raceDate: string,
  meet: string,
  raceNo: number,
): Promise<
  | { state: "OPEN"; entryCount: number }
  | { state: "LOCKED" }
  | { state: "FINISHED" }
  | { state: "NOT_FOUND" }
> {
  // races + race_results 한 쿼리.
  const rows = await query<{
    start_time: string | null;
    entry_count: number | null;
    has_results: boolean;
    is_past_cutoff: boolean;
  }>(
    `SELECT r.start_time,
            r.entry_count,
            EXISTS (SELECT 1 FROM race_results rr
                     WHERE rr.race_date = r.race_date
                       AND rr.meet = r.meet
                       AND rr.race_no = r.race_no
                       AND rr.rank IS NOT NULL) AS has_results,
            CASE
              WHEN r.start_time IS NOT NULL THEN
                ((r.race_date::text || ' ' || r.start_time)::timestamp AT TIME ZONE 'Asia/Seoul') <= NOW()
              ELSE
                ((r.race_date + INTERVAL '1 day')::timestamp AT TIME ZONE 'Asia/Seoul') <= NOW()
            END AS is_past_cutoff
       FROM races r
      WHERE r.race_date = $1::date AND r.meet = $2 AND r.race_no = $3
      LIMIT 1`,
    [raceDate, meet, raceNo],
  );
  if (rows.length === 0) return { state: "NOT_FOUND" };
  const row = rows[0];
  if (row.has_results) return { state: "FINISHED" };
  if (row.is_past_cutoff) return { state: "LOCKED" };
  // entry_count 가 NULL 이면 race_entries 에서 직접 카운트.
  let entryCount = row.entry_count ?? 0;
  if (!entryCount) {
    const er = await query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM race_entries
        WHERE race_date = $1::date AND meet = $2 AND race_no = $3`,
      [raceDate, meet, raceNo],
    );
    entryCount = Number(er[0]?.c ?? "0");
  }
  return { state: "OPEN", entryCount };
}

// UI 용 — 베팅 폼에 노출할 상태. NOT_FOUND 면 null 반환.
export async function getRaceBetState(
  raceDate: string,
  meet: string,
  raceNo: number,
): Promise<"pre" | "locked" | "finished" | null> {
  const lock = await getRaceLockState(raceDate, meet, raceNo);
  if (lock.state === "NOT_FOUND") return null;
  if (lock.state === "OPEN") return "pre";
  if (lock.state === "LOCKED") return "locked";
  return "finished";
}

// 출주마 chul_no 가 실재하는지 확인 — race_entries OR race_results 에 1건이라도.
async function getValidChulNos(
  raceDate: string,
  meet: string,
  raceNo: number,
): Promise<Set<number>> {
  const rows = await query<{ chul_no: number }>(
    `SELECT DISTINCT chul_no FROM (
       SELECT chul_no FROM race_entries
        WHERE race_date = $1::date AND meet = $2 AND race_no = $3
          AND chul_no IS NOT NULL
       UNION
       SELECT (raw->>'chulNo')::int AS chul_no FROM race_results
        WHERE race_date = $1::date AND meet = $2 AND race_no = $3
          AND raw->>'chulNo' ~ '^[0-9]+$'
     ) u`,
    [raceDate, meet, raceNo],
  );
  return new Set(rows.map((r) => r.chul_no));
}

export async function placeBet(
  userId: string,
  input: PlaceBetInput,
): Promise<PlaceBetResult> {
  // 1. 단위 금액 검증
  const unit = input.unitAmountP;
  if (unit < MIN_UNIT_P || unit % MIN_UNIT_P !== BigInt(0)) {
    return { ok: false, error: "UNIT_INVALID" };
  }

  // 2. 조합 enumerate (입력 검증 포함)
  let combos: number[][];
  try {
    combos = enumerateCombos(input.pool, input.selection);
  } catch (e) {
    return {
      ok: false,
      error: "BAD_INPUT",
      detail: e instanceof Error ? e.message : String(e),
    };
  }
  if (combos.length === 0) return { ok: false, error: "BAD_INPUT" };

  // 3. 총액 계산 + 1매 한도
  const total = unit * BigInt(combos.length);
  if (total > MAX_PER_TICKET_P) {
    return { ok: false, error: "TICKET_LIMIT_EXCEEDED" };
  }

  // 4. 경기 마감 상태
  const lock = await getRaceLockState(input.raceDate, input.meet, input.raceNo);
  if (lock.state === "NOT_FOUND") return { ok: false, error: "RACE_NOT_FOUND" };
  if (lock.state === "FINISHED") return { ok: false, error: "RACE_FINISHED" };
  if (lock.state === "LOCKED") return { ok: false, error: "RACE_LOCKED" };

  // 5. PLC 출전두수 (한국 룰: 5두 이상 시행)
  if (input.pool === "PLC" && lock.entryCount < 5) {
    return { ok: false, error: "PLC_NOT_AVAILABLE" };
  }

  // 6. chul_no 실재 검증
  const valid = await getValidChulNos(input.raceDate, input.meet, input.raceNo);
  if (valid.size > 0) {
    for (const c of combos) {
      for (const n of c) {
        if (!valid.has(n)) {
          return { ok: false, error: "UNKNOWN_HORSE", detail: String(n) };
        }
      }
    }
  }

  // 7. 1일 한도 (KST 기준 오늘)
  const todayRows = await query<{ today: string }>(
    `SELECT to_char((NOW() AT TIME ZONE 'Asia/Seoul')::date, 'YYYY-MM-DD') AS today`,
  );
  const today = todayRows[0].today;
  const dailyTotal = await getDailyBetTotalP(userId, today);
  if (dailyTotal + total > MAX_DAILY_P) {
    return { ok: false, error: "DAILY_LIMIT_EXCEEDED" };
  }

  // 8. 트랜잭션: bets insert → bet_selections bulk insert → 잔액 차감 + tx 원장
  const slotsCount = SLOTS[input.pool];
  let formationMeta: object | null = null;
  if (input.selection.kind === "FORMATION") {
    formationMeta = { slots: input.selection.slots };
  } else if (input.selection.kind === "BOX") {
    formationMeta = { box: input.selection.horses };
  }

  try {
    return await withTransaction(async (c) => {
      // bets 행 먼저 생성 — id 받아서 idem_key 로 사용.
      const betRows = await c.query<{ id: string }>(
        `INSERT INTO bets
           (user_id, race_date, meet, race_no, pool, bet_kind,
            formation_meta, unit_amount_p, combo_count, total_amount_p)
         VALUES ($1::bigint, $2::date, $3, $4, $5, $6,
                 $7::jsonb, $8::bigint, $9, $10::bigint)
         RETURNING id::text`,
        [
          userId,
          input.raceDate,
          input.meet,
          input.raceNo,
          input.pool,
          input.kind,
          formationMeta ? JSON.stringify(formationMeta) : null,
          unit.toString(),
          combos.length,
          total.toString(),
        ],
      );
      const betId = betRows.rows[0].id;

      // bet_selections — 한 번에 INSERT (UNNEST)
      const indexes: number[] = [];
      const c1: number[] = [];
      const c2: (number | null)[] = [];
      const c3: (number | null)[] = [];
      combos.forEach((combo, i) => {
        indexes.push(i);
        c1.push(combo[0]);
        c2.push(slotsCount >= 2 ? combo[1] : null);
        c3.push(slotsCount >= 3 ? combo[2] : null);
      });
      await c.query(
        `INSERT INTO bet_selections (bet_id, combo_index, chul_no_1, chul_no_2, chul_no_3)
         SELECT $1::bigint, idx, n1, n2, n3
           FROM UNNEST($2::int[], $3::int[], $4::int[], $5::int[])
                AS t(idx, n1, n2, n3)`,
        [betId, indexes, c1, c2, c3],
      );

      // 잔액 차감 — INSUFFICIENT_FUNDS 면 throw → ROLLBACK
      await applyDelta(
        c,
        userId,
        -total,
        "BET_PLACED",
        betId,
        betId,
      );

      // lifetime_bet_total_p 누적
      await c.query(
        `UPDATE user_balances
            SET lifetime_bet_total_p = lifetime_bet_total_p + $2::bigint
          WHERE user_id = $1::bigint`,
        [userId, total.toString()],
      );

      return {
        ok: true as const,
        betId,
        comboCount: combos.length,
        totalAmountP: total,
      };
    });
  } catch (e: unknown) {
    if (e instanceof Error && e.message === "INSUFFICIENT_FUNDS") {
      return { ok: false, error: "INSUFFICIENT_FUNDS" };
    }
    throw e;
  }
}

export type BetSummary = {
  id: string;
  race_date: string;
  meet: string;
  race_no: number;
  race_name: string | null;
  pool: BetPool;
  bet_kind: BetKind;
  unit_amount_p: bigint;
  combo_count: number;
  total_amount_p: bigint;
  status: BetStatus;
  payout_p: bigint;
  placed_at: string;
  settled_at: string | null;
};

export async function getUserBets(
  userId: string,
  opts: { limit?: number; status?: BetStatus } = {},
): Promise<BetSummary[]> {
  const limit = opts.limit ?? 50;
  const where = opts.status ? "AND b.status = $2" : "";
  const params: unknown[] = [userId];
  if (opts.status) params.push(opts.status);
  params.push(limit);

  const rows = await query<{
    id: string;
    race_date: string;
    meet: string;
    race_no: number;
    race_name: string | null;
    pool: BetPool;
    bet_kind: BetKind;
    unit_amount_p: string;
    combo_count: number;
    total_amount_p: string;
    status: BetStatus;
    payout_p: string;
    placed_at: string;
    settled_at: string | null;
  }>(
    `SELECT b.id::text,
            to_char(b.race_date, 'YYYY-MM-DD') AS race_date,
            b.meet, b.race_no, r.race_name,
            b.pool, b.bet_kind,
            b.unit_amount_p::text,
            b.combo_count,
            b.total_amount_p::text,
            b.status,
            b.payout_p::text,
            b.placed_at::text,
            b.settled_at::text
       FROM bets b
       LEFT JOIN races r
              ON r.race_date = b.race_date
             AND r.meet = b.meet
             AND r.race_no = b.race_no
      WHERE b.user_id = $1::bigint
        ${where}
      ORDER BY b.placed_at DESC
      LIMIT $${params.length}`,
    params,
  );
  return rows.map((r) => ({
    ...r,
    unit_amount_p: BigInt(r.unit_amount_p),
    total_amount_p: BigInt(r.total_amount_p),
    payout_p: BigInt(r.payout_p),
  }));
}

export type BetSelectionRow = {
  combo_index: number;
  chul_no_1: number;
  chul_no_2: number | null;
  chul_no_3: number | null;
  is_hit: boolean | null;
  matched_odds: string | null;
  payout_p: bigint;
};

export async function getBetSelections(
  betId: string,
): Promise<BetSelectionRow[]> {
  const rows = await query<{
    combo_index: number;
    chul_no_1: number;
    chul_no_2: number | null;
    chul_no_3: number | null;
    is_hit: boolean | null;
    matched_odds: string | null;
    payout_p: string;
  }>(
    `SELECT combo_index, chul_no_1, chul_no_2, chul_no_3,
            is_hit, matched_odds::text, payout_p::text
       FROM bet_selections
      WHERE bet_id = $1::bigint
      ORDER BY combo_index`,
    [betId],
  );
  return rows.map((r) => ({ ...r, payout_p: BigInt(r.payout_p) }));
}

export type UserStats = {
  total_bets: number;
  total_amount_p: bigint;
  total_payout_p: bigint;
  hit_bets: number;
  pending_bets: number;
  // 통산 회수율(%) = 환급/베팅 * 100. 베팅 0이면 null.
  return_rate: number | null;
  // 적중률(%) = 적중/(정산완료) * 100.
  hit_rate: number | null;
};

export async function getUserStats(userId: string): Promise<UserStats> {
  const rows = await query<{
    total_bets: string;
    total_amount_p: string;
    total_payout_p: string;
    hit_bets: string;
    pending_bets: string;
    settled_bets: string;
  }>(
    `SELECT COUNT(*)::text AS total_bets,
            COALESCE(SUM(total_amount_p), 0)::text AS total_amount_p,
            COALESCE(SUM(payout_p), 0)::text AS total_payout_p,
            COUNT(*) FILTER (WHERE status = 'SETTLED_HIT')::text AS hit_bets,
            COUNT(*) FILTER (WHERE status = 'PENDING')::text AS pending_bets,
            COUNT(*) FILTER (WHERE status IN ('SETTLED_HIT','SETTLED_MISS'))::text AS settled_bets
       FROM bets
      WHERE user_id = $1::bigint`,
    [userId],
  );
  const r = rows[0];
  const total_bets = Number(r.total_bets);
  const total_amount_p = BigInt(r.total_amount_p);
  const total_payout_p = BigInt(r.total_payout_p);
  const hit_bets = Number(r.hit_bets);
  const pending_bets = Number(r.pending_bets);
  const settled_bets = Number(r.settled_bets);
  const return_rate =
    total_amount_p > BigInt(0)
      ? Number((total_payout_p * BigInt(10000)) / total_amount_p) / 100
      : null;
  const hit_rate = settled_bets > 0 ? (hit_bets / settled_bets) * 100 : null;
  return {
    total_bets,
    total_amount_p,
    total_payout_p,
    hit_bets,
    pending_bets,
    return_rate,
    hit_rate,
  };
}
