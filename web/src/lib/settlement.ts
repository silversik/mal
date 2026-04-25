// 모의배팅 정산 — 결과(race_results) + 배당(race_dividends, race_combo_dividends)
// 으로 PENDING bets 를 SETTLED_HIT/SETTLED_MISS/VOID 로 확정.
//
// 진실원 한 곳: settlement.ts. crawler 잡은 /api/internal/settle 호출만.
//
// race_settlements PK 가드 + balance_transactions UNIQUE (user, kind, idem_key)
// 로 같은 race 두 번째 정산은 0건 처리.

import { applyDelta } from "./balances";
import { canonicalComboKey, type BetPool } from "./bet_combinations";
import { query } from "./db";
import { withTransaction } from "./db_tx";

export type RaceFinishers = {
  first: number;
  second: number | null;
  third: number | null;
  entryCount: number;
};

// race_results.rank 로 1·2·3 위 chul_no 추출. 결과 row 가 0건이면 null.
export async function getRaceFinishers(
  raceDate: string,
  meet: string,
  raceNo: number,
): Promise<RaceFinishers | null> {
  const rows = await query<{ rank: number | null; chul_no: number | null }>(
    `SELECT rank,
            CASE WHEN raw->>'chulNo' ~ '^[0-9]+$' THEN (raw->>'chulNo')::int END
              AS chul_no
       FROM race_results
      WHERE race_date = $1::date AND meet = $2 AND race_no = $3`,
    [raceDate, meet, raceNo],
  );
  if (rows.length === 0) return null;
  const ranked = rows.filter((r) => r.rank !== null && r.chul_no !== null);
  if (ranked.length === 0) return null;
  ranked.sort((a, b) => (a.rank as number) - (b.rank as number));
  const find = (k: number) =>
    ranked.find((r) => r.rank === k)?.chul_no ?? null;
  return {
    first: find(1) as number, // rank=1 은 결과 있는 race 라면 무조건 존재 가정
    second: find(2),
    third: find(3),
    entryCount: rows.length,
  };
}

// 한국 마권 적중 룰. PLC 는 entryCount 분기.
export function isHit(
  pool: BetPool,
  combo: number[],
  f: RaceFinishers,
): boolean {
  switch (pool) {
    case "WIN":
      return combo[0] === f.first;
    case "PLC": {
      // <5 두는 placeBet 단계에서 차단 — 여기 도달하면 5두 이상.
      // 5~7 두 → 1·2위, 8두 이상 → 1·2·3위.
      const podium: number[] = [f.first];
      if (f.second !== null) podium.push(f.second);
      if (f.entryCount >= 8 && f.third !== null) podium.push(f.third);
      return podium.includes(combo[0]);
    }
    case "QNL":
    case "QPL": {
      if (f.second === null) return false;
      const set12 = new Set([f.first, f.second]);
      return (
        combo.length === 2 && set12.has(combo[0]) && set12.has(combo[1])
      );
    }
    case "EXA":
      return combo[0] === f.first && combo[1] === f.second;
    case "TRI": {
      if (f.second === null || f.third === null) return false;
      const set123 = new Set([f.first, f.second, f.third]);
      return combo.length === 3 && combo.every((c) => set123.has(c));
    }
    case "TLA":
      return (
        combo[0] === f.first &&
        combo[1] === f.second &&
        combo[2] === f.third
      );
  }
}

// pool 별 배당 lookup table — race_dividends + race_combo_dividends 한꺼번에 로드.
export type OddsMap = {
  win: Map<number, number>; // chul_no -> odds
  plc: Map<number, number>;
  combo: Map<BetPool, Map<string, number>>; // pool -> canonical key -> odds
};

const COMBO_POOLS: BetPool[] = ["QNL", "QPL", "EXA", "TRI", "TLA"];

export async function loadOddsMap(
  raceDate: string,
  meet: string,
  raceNo: number,
): Promise<OddsMap> {
  const winRows = await query<{
    horse_no: string;
    win_rate: string | null;
    plc_rate: string | null;
  }>(
    `SELECT horse_no, win_rate::text, plc_rate::text
       FROM race_dividends
      WHERE race_date = $1::date AND meet = $2 AND race_no = $3`,
    [raceDate, meet, raceNo],
  );
  const win = new Map<number, number>();
  const plc = new Map<number, number>();
  for (const r of winRows) {
    const ch = Number.parseInt(r.horse_no, 10);
    if (!Number.isInteger(ch)) continue;
    if (r.win_rate !== null) win.set(ch, Number(r.win_rate));
    if (r.plc_rate !== null) plc.set(ch, Number(r.plc_rate));
  }

  const comboRows = await query<{
    pool: string;
    combo_key: string;
    odds: string | null;
  }>(
    `SELECT pool, combo_key, odds::text
       FROM race_combo_dividends
      WHERE race_date = $1::date AND meet = $2 AND race_no = $3`,
    [raceDate, meet, raceNo],
  );
  const combo = new Map<BetPool, Map<string, number>>();
  for (const p of COMBO_POOLS) combo.set(p, new Map());
  for (const r of comboRows) {
    if (!COMBO_POOLS.includes(r.pool as BetPool)) continue;
    if (r.odds === null) continue;
    combo.get(r.pool as BetPool)!.set(r.combo_key, Number(r.odds));
  }

  return { win, plc, combo };
}

// pool/combo → odds (없으면 null = 미적중 또는 미발매).
export function lookupOdds(
  pool: BetPool,
  combo: number[],
  odds: OddsMap,
): number | null {
  if (pool === "WIN") return odds.win.get(combo[0]) ?? null;
  if (pool === "PLC") return odds.plc.get(combo[0]) ?? null;
  const key = canonicalComboKey(pool, combo);
  return odds.combo.get(pool)?.get(key) ?? null;
}

// payout_p = floor(unit_p × odds). odds 는 .1 단위, unit 은 100 배수 → 정확.
export function calcPayoutP(unitP: bigint, odds: number): bigint {
  const oddsX10 = BigInt(Math.round(odds * 10));
  return (unitP * oddsX10) / BigInt(10);
}

export type SettleRaceResult =
  | {
      ok: true;
      raceDate: string;
      meet: string;
      raceNo: number;
      bets_settled: number;
      bets_void: number;
      already: boolean;
    }
  | {
      ok: false;
      raceDate: string;
      meet: string;
      raceNo: number;
      reason: "NO_RESULTS" | "NOT_FOUND";
    };

// 한 race 의 PENDING bets 모두 정산. race_settlements 에 row 가 이미 있으면 already=true.
export async function settleRace(
  raceDate: string,
  meet: string,
  raceNo: number,
): Promise<SettleRaceResult> {
  // 1. 결과 + 배당 로드
  const finishers = await getRaceFinishers(raceDate, meet, raceNo);
  if (!finishers) {
    return {
      ok: false,
      raceDate,
      meet,
      raceNo,
      reason: "NO_RESULTS",
    };
  }
  const odds = await loadOddsMap(raceDate, meet, raceNo);

  // 2. race_settlements 에 placeholder INSERT — 다른 호출과의 경합 방지.
  //    이미 row 가 있으면 already=true 로 끝낸다 (재실행은 멱등성 보장).
  const settle = await query<{ inserted: boolean }>(
    `INSERT INTO race_settlements (race_date, meet, race_no)
       VALUES ($1::date, $2, $3)
       ON CONFLICT (race_date, meet, race_no) DO NOTHING
       RETURNING TRUE AS inserted`,
    [raceDate, meet, raceNo],
  );
  if (settle.length === 0) {
    return {
      ok: true,
      raceDate,
      meet,
      raceNo,
      bets_settled: 0,
      bets_void: 0,
      already: true,
    };
  }

  // 3. PENDING bet 목록.
  const bets = await query<{
    id: string;
    user_id: string;
    pool: BetPool;
    unit_amount_p: string;
    total_amount_p: string;
    combo_count: number;
  }>(
    `SELECT id::text, user_id::text, pool, unit_amount_p::text,
            total_amount_p::text, combo_count
       FROM bets
      WHERE race_date = $1::date AND meet = $2 AND race_no = $3
        AND status = 'PENDING'
      ORDER BY id`,
    [raceDate, meet, raceNo],
  );

  let settled = 0;
  let voided = 0;
  for (const bet of bets) {
    const r = await settleSingleBet(bet, finishers, odds);
    if (r === "VOID") voided++;
    else settled++;
  }

  // 4. race_settlements 카운트 갱신.
  await query(
    `UPDATE race_settlements
        SET bets_settled = $4, bets_void = $5
      WHERE race_date = $1::date AND meet = $2 AND race_no = $3`,
    [raceDate, meet, raceNo, settled, voided],
  );

  return {
    ok: true,
    raceDate,
    meet,
    raceNo,
    bets_settled: settled,
    bets_void: voided,
    already: false,
  };
}

type BetRow = {
  id: string;
  user_id: string;
  pool: BetPool;
  unit_amount_p: string;
  total_amount_p: string;
  combo_count: number;
};

// bet 한 건 정산 — 트랜잭션 내부에서:
//   bet_selections 갱신 → bet 갱신 → 잔액 PAYOUT/REFUND tx 적용.
async function settleSingleBet(
  bet: BetRow,
  finishers: RaceFinishers,
  odds: OddsMap,
): Promise<"HIT" | "MISS" | "VOID"> {
  return await withTransaction(async (c) => {
    // 1. 이 bet 의 selections 모두 hit/odds 계산.
    const sels = await c.query<{
      combo_index: number;
      chul_no_1: number;
      chul_no_2: number | null;
      chul_no_3: number | null;
    }>(
      `SELECT combo_index, chul_no_1, chul_no_2, chul_no_3
         FROM bet_selections
        WHERE bet_id = $1::bigint
        ORDER BY combo_index`,
      [bet.id],
    );

    const unit = BigInt(bet.unit_amount_p);
    let bet_void = false; // odds 누락 = 미발매 → 환급
    let any_hit = false;
    let payout_total = BigInt(0);

    type SelUpdate = {
      combo_index: number;
      is_hit: boolean;
      matched_odds: number | null;
      payout_p: bigint;
    };
    const updates: SelUpdate[] = [];

    for (const s of sels.rows) {
      const combo = [s.chul_no_1];
      if (s.chul_no_2 !== null) combo.push(s.chul_no_2);
      if (s.chul_no_3 !== null) combo.push(s.chul_no_3);

      const hit = isHit(bet.pool, combo, finishers);
      let matched_odds: number | null = null;
      let payout = BigInt(0);
      if (hit) {
        matched_odds = lookupOdds(bet.pool, combo, odds);
        if (matched_odds === null) {
          // 적중인데 배당이 없으면 데이터 누락 → bet 전체 VOID.
          bet_void = true;
        } else {
          payout = calcPayoutP(unit, matched_odds);
          payout_total += payout;
          any_hit = true;
        }
      }
      updates.push({
        combo_index: s.combo_index,
        is_hit: hit,
        matched_odds,
        payout_p: payout,
      });
    }

    // PLC 가 발매 안 된 경우 (5두 미만) — placeBet 에서 막지만 안전장치.
    if (bet.pool === "PLC" && finishers.entryCount < 5) {
      bet_void = true;
    }

    // 2. bet_selections 갱신 — UNNEST batch.
    if (updates.length > 0) {
      await c.query(
        `UPDATE bet_selections AS s
            SET is_hit = u.is_hit,
                matched_odds = u.matched_odds,
                payout_p = u.payout_p::bigint
           FROM UNNEST(
                  $2::int[], $3::bool[], $4::numeric[], $5::numeric[]
                ) AS u(combo_index, is_hit, matched_odds, payout_p)
          WHERE s.bet_id = $1::bigint AND s.combo_index = u.combo_index`,
        [
          bet.id,
          updates.map((u) => u.combo_index),
          updates.map((u) => u.is_hit),
          updates.map((u) => u.matched_odds),
          updates.map((u) => u.payout_p.toString()),
        ],
      );
    }

    // 3. bet 상태 / 잔액 트랜잭션
    let status: "SETTLED_HIT" | "SETTLED_MISS" | "VOID";
    let returnP = BigInt(0);
    let txKind: "BET_PAYOUT" | "BET_REFUND" | null = null;

    if (bet_void) {
      status = "VOID";
      returnP = BigInt(bet.total_amount_p); // 베팅액 전액 환급
      txKind = "BET_REFUND";
    } else if (any_hit) {
      status = "SETTLED_HIT";
      returnP = payout_total;
      txKind = "BET_PAYOUT";
    } else {
      status = "SETTLED_MISS";
    }

    await c.query(
      `UPDATE bets
          SET status = $2,
              payout_p = $3::bigint,
              settled_at = NOW()
        WHERE id = $1::bigint`,
      [bet.id, status, returnP.toString()],
    );

    if (txKind && returnP > BigInt(0)) {
      await applyDelta(c, bet.user_id, returnP, txKind, bet.id, bet.id);
      // lifetime_payout_p 누적 (PAYOUT 만; REFUND 는 누적 안 함)
      if (txKind === "BET_PAYOUT") {
        await c.query(
          `UPDATE user_balances
              SET lifetime_payout_p = lifetime_payout_p + $2::bigint
            WHERE user_id = $1::bigint`,
          [bet.user_id, returnP.toString()],
        );
      }
    }

    return status === "VOID" ? "VOID" : status === "SETTLED_HIT" ? "HIT" : "MISS";
  });
}

// 정산 잡 진입점 — 결과 있는 race 중 race_settlements 에 없는 것들 모두 처리.
//   각 race 는 별도 트랜잭션이라 부분 실패해도 나머지는 정산.
export async function settlePendingForFinishedRaces(
  limit = 50,
): Promise<{ races: number; bets_settled: number; bets_void: number }> {
  const rows = await query<{
    race_date: string;
    meet: string;
    race_no: number;
  }>(
    `SELECT to_char(rr.race_date, 'YYYY-MM-DD') AS race_date,
            rr.meet, rr.race_no
       FROM race_results rr
       LEFT JOIN race_settlements rs
              ON rs.race_date = rr.race_date
             AND rs.meet = rr.meet
             AND rs.race_no = rr.race_no
      WHERE rr.rank IS NOT NULL
        AND rs.race_date IS NULL
      GROUP BY rr.race_date, rr.meet, rr.race_no
      ORDER BY rr.race_date DESC, rr.meet, rr.race_no
      LIMIT $1`,
    [limit],
  );

  let races = 0;
  let bets_settled = 0;
  let bets_void = 0;
  for (const r of rows) {
    const result = await settleRace(r.race_date, r.meet, r.race_no);
    if (result.ok) {
      races++;
      bets_settled += result.bets_settled;
      bets_void += result.bets_void;
    }
  }
  return { races, bets_settled, bets_void };
}

