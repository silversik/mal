// 모의배팅 잔액 + 출석 + 거래원장 라이브러리.
//
// idem_key 규약:
//   SIGNUP_GRANT  — user_id::text
//   ATTENDANCE    — KST 일자 'YYYY-MM-DD'
//   BET_PLACED    — bet_id::text
//   BET_PAYOUT    — bet_id::text
//   BET_REFUND    — bet_id::text
//   ADJUST        — 호출자가 임의 부여

import type { PoolClient } from "pg";

import { query } from "./db";
import { withTransaction } from "./db_tx";

export const SIGNUP_BONUS_P = BigInt(1_000_000);
export const ATTENDANCE_BONUS_P = BigInt(10_000);

export type BalanceTxKind =
  | "SIGNUP_GRANT"
  | "ATTENDANCE"
  | "BET_PLACED"
  | "BET_PAYOUT"
  | "BET_REFUND"
  | "ADJUST";

export type UserBalance = {
  balance_p: bigint;
  last_attendance_date: string | null;
  lifetime_bet_total_p: bigint;
  lifetime_payout_p: bigint;
};

// 잔액 조회 — 없으면 null. 가입 보너스는 grantSignupBonusIfNeeded 가 처리.
export async function getBalance(userId: string): Promise<bigint> {
  const rows = await query<{ balance_p: string }>(
    `SELECT balance_p::text FROM user_balances WHERE user_id = $1::bigint`,
    [userId],
  );
  return rows[0] ? BigInt(rows[0].balance_p) : BigInt(0);
}

export async function getUserBalance(
  userId: string,
): Promise<UserBalance | null> {
  const rows = await query<{
    balance_p: string;
    last_attendance_date: string | null;
    lifetime_bet_total_p: string;
    lifetime_payout_p: string;
  }>(
    `SELECT balance_p::text,
            to_char(last_attendance_date, 'YYYY-MM-DD') AS last_attendance_date,
            lifetime_bet_total_p::text,
            lifetime_payout_p::text
       FROM user_balances WHERE user_id = $1::bigint`,
    [userId],
  );
  if (!rows[0]) return null;
  return {
    balance_p: BigInt(rows[0].balance_p),
    last_attendance_date: rows[0].last_attendance_date,
    lifetime_bet_total_p: BigInt(rows[0].lifetime_bet_total_p),
    lifetime_payout_p: BigInt(rows[0].lifetime_payout_p),
  };
}

// 가입 보너스: user 첫 row 생성 + SIGNUP_GRANT tx 멱등 적용.
// auth.signIn 콜백 끝에서 호출. 이미 row 가 있으면 no-op.
export async function grantSignupBonusIfNeeded(userId: string): Promise<void> {
  await withTransaction(async (c) => {
    // 1. user_balances 첫 row 생성 시도.
    const inserted = await c.query<{ user_id: string }>(
      `INSERT INTO user_balances (user_id, balance_p)
       VALUES ($1::bigint, $2::bigint)
       ON CONFLICT (user_id) DO NOTHING
       RETURNING user_id::text`,
      [userId, SIGNUP_BONUS_P.toString()],
    );
    if (inserted.rows.length === 0) return; // 이미 존재 → no-op

    // 2. 잔액 원장에 SIGNUP_GRANT 1회만 (UNIQUE 가 보호망).
    await c.query(
      `INSERT INTO balance_transactions
         (user_id, kind, delta_p, balance_after_p, idem_key)
       VALUES ($1::bigint, 'SIGNUP_GRANT', $2::bigint, $2::bigint, $3)
       ON CONFLICT (user_id, kind, idem_key) DO NOTHING`,
      [userId, SIGNUP_BONUS_P.toString(), userId],
    );
  });
}

// 출석 보너스: 같은 KST 일자에 한 번만 적용. 두 번째 클릭은 alreadyClaimed=true.
export async function claimAttendanceBonus(userId: string): Promise<{
  ok: boolean;
  alreadyClaimed: boolean;
  newBalance: bigint;
  todayKst: string;
}> {
  return await withTransaction(async (c) => {
    // 잔액 row 가 없으면 가입 보너스 안 받았던 케이스 — 같이 처리하지 말고 throw.
    const todayRows = await c.query<{ today: string }>(
      `SELECT to_char((NOW() AT TIME ZONE 'Asia/Seoul')::date, 'YYYY-MM-DD') AS today`,
    );
    const today = todayRows.rows[0].today;

    const upd = await c.query<{ balance_p: string }>(
      `UPDATE user_balances
          SET balance_p = balance_p + $2::bigint,
              last_attendance_date = $3::date
        WHERE user_id = $1::bigint
          AND (last_attendance_date IS NULL OR last_attendance_date < $3::date)
        RETURNING balance_p::text`,
      [userId, ATTENDANCE_BONUS_P.toString(), today],
    );

    if (upd.rows.length === 0) {
      // 이미 오늘 받았거나, balance row 자체가 없음.
      const cur = await c.query<{ balance_p: string }>(
        `SELECT balance_p::text FROM user_balances WHERE user_id = $1::bigint`,
        [userId],
      );
      return {
        ok: false,
        alreadyClaimed: cur.rows.length > 0,
        newBalance:
          cur.rows.length > 0 ? BigInt(cur.rows[0].balance_p) : BigInt(0),
        todayKst: today,
      };
    }

    const newBalance = BigInt(upd.rows[0].balance_p);
    await c.query(
      `INSERT INTO balance_transactions
         (user_id, kind, delta_p, balance_after_p, idem_key)
       VALUES ($1::bigint, 'ATTENDANCE', $2::bigint, $3::bigint, $4)
       ON CONFLICT (user_id, kind, idem_key) DO NOTHING`,
      [userId, ATTENDANCE_BONUS_P.toString(), newBalance.toString(), today],
    );

    return { ok: true, alreadyClaimed: false, newBalance, todayKst: today };
  });
}

// 1일 누적 베팅액 (KST 자정 경계 기준). 한도 검증용.
export async function getDailyBetTotalP(
  userId: string,
  kstDate: string,
): Promise<bigint> {
  const rows = await query<{ total: string }>(
    `SELECT COALESCE(SUM(total_amount_p), 0)::text AS total
       FROM bets
      WHERE user_id = $1::bigint
        AND status <> 'VOID'
        AND ((placed_at AT TIME ZONE 'Asia/Seoul')::date) = $2::date`,
    [userId, kstDate],
  );
  return BigInt(rows[0]?.total ?? "0");
}

// 트랜잭션 내부 잔액 변경 + 원장 기록. CHECK 제약 위반 시 throw.
//   delta < 0 인 경우 잔액 부족 → INSUFFICIENT_FUNDS Error.
export async function applyDelta(
  client: PoolClient,
  userId: string,
  deltaP: bigint,
  kind: BalanceTxKind,
  idemKey: string,
  refBetId?: bigint | string | null,
): Promise<{ balanceAfter: bigint; applied: boolean }> {
  // 멱등성: 같은 (user, kind, idem_key) 두 번째 호출이면 적용 X.
  const existing = await client.query<{ balance_after_p: string }>(
    `SELECT balance_after_p::text
       FROM balance_transactions
      WHERE user_id = $1::bigint AND kind = $2 AND idem_key = $3
      LIMIT 1`,
    [userId, kind, idemKey],
  );
  if (existing.rows.length > 0) {
    return {
      balanceAfter: BigInt(existing.rows[0].balance_after_p),
      applied: false,
    };
  }

  let updRows: { balance_p: string }[];
  try {
    const r = await client.query<{ balance_p: string }>(
      `UPDATE user_balances
          SET balance_p = balance_p + $2::bigint
        WHERE user_id = $1::bigint
        RETURNING balance_p::text`,
      [userId, deltaP.toString()],
    );
    updRows = r.rows;
  } catch (e: unknown) {
    if (
      typeof e === "object" &&
      e !== null &&
      "code" in e &&
      (e as { code?: string }).code === "23514"
    ) {
      throw new Error("INSUFFICIENT_FUNDS");
    }
    throw e;
  }

  if (updRows.length === 0) {
    throw new Error("BALANCE_ROW_MISSING");
  }
  const balanceAfter = BigInt(updRows[0].balance_p);

  await client.query(
    `INSERT INTO balance_transactions
       (user_id, kind, delta_p, balance_after_p, ref_bet_id, idem_key)
     VALUES ($1::bigint, $2, $3::bigint, $4::bigint, $5, $6)`,
    [
      userId,
      kind,
      deltaP.toString(),
      balanceAfter.toString(),
      refBetId == null ? null : refBetId.toString(),
      idemKey,
    ],
  );

  return { balanceAfter, applied: true };
}

// 거래 내역 조회 (마이페이지용)
export type BalanceTxRow = {
  id: string;
  kind: BalanceTxKind;
  delta_p: bigint;
  balance_after_p: bigint;
  ref_bet_id: string | null;
  created_at: string;
};

export async function getBalanceHistory(
  userId: string,
  limit = 50,
): Promise<BalanceTxRow[]> {
  const rows = await query<{
    id: string;
    kind: BalanceTxKind;
    delta_p: string;
    balance_after_p: string;
    ref_bet_id: string | null;
    created_at: string;
  }>(
    `SELECT id::text, kind, delta_p::text, balance_after_p::text,
            ref_bet_id::text, created_at::text
       FROM balance_transactions
      WHERE user_id = $1::bigint
      ORDER BY created_at DESC
      LIMIT $2`,
    [userId, limit],
  );
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    delta_p: BigInt(r.delta_p),
    balance_after_p: BigInt(r.balance_after_p),
    ref_bet_id: r.ref_bet_id,
    created_at: r.created_at,
  }));
}

