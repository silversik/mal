"use client";

import { useMemo, useState, useTransition } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  enumerateCombos,
  ORDERED,
  SLOTS,
  type BetKind,
  type BetPool,
} from "@/lib/bet_combinations";
import { POOL_LABEL, POOL_STYLE } from "@/lib/pool_style";

import { placeBetAction } from "./bet-actions";

const KIND_LABEL: Record<BetKind, string> = {
  STRAIGHT: "일반",
  BOX: "박스",
  FORMATION: "포메이션",
};

const DAILY_LIMIT_P = 750_000;
const TICKET_LIMIT_P = 100_000;

const ERROR_LABEL: Record<string, string> = {
  AUTH_REQUIRED: "로그인이 필요합니다",
  BAD_INPUT: "입력값이 올바르지 않습니다",
  RACE_NOT_FOUND: "경주를 찾을 수 없습니다",
  RACE_LOCKED: "베팅 마감된 경주입니다",
  RACE_FINISHED: "이미 종료된 경주입니다",
  PLC_NOT_AVAILABLE: "5두 미만 경주는 연승 발매되지 않습니다",
  UNKNOWN_HORSE: "출주마에 없는 마번입니다",
  UNIT_INVALID: "단위 금액은 100P, 100P 단위입니다",
  TICKET_LIMIT_EXCEEDED: "1매 한도(100,000P)를 초과합니다",
  DAILY_LIMIT_EXCEEDED: "1일 한도(750,000P)를 초과합니다",
  INSUFFICIENT_FUNDS: "잔액이 부족합니다",
};

export type BetFormProps = {
  raceDate: string;
  meet: string;
  raceNo: number;
  entries: { chul_no: number; horse_name: string }[];
  /** 'pre' = 베팅 가능, 'locked' = 마감, 'finished' = 결과 확정 */
  state: "pre" | "locked" | "finished";
  loggedIn: boolean;
  balanceP: bigint | null; // 비로그인 시 null
  /** 오늘 KST 기준 누적 베팅 (VOID 제외) — 1일 한도 시각화 */
  dailyTotalP: bigint | null;
};

const ALL_POOLS: BetPool[] = ["WIN", "PLC", "QNL", "QPL", "EXA", "TRI", "TLA"];
const UNIT_OPTIONS_P = [100, 500, 1_000, 5_000, 10_000, 50_000, 100_000];

export function BetForm(props: BetFormProps) {
  const { entries, state, loggedIn, balanceP, dailyTotalP } = props;
  const [pool, setPool] = useState<BetPool>("WIN");
  const [kind, setKind] = useState<BetKind>("STRAIGHT");
  // 슬롯별 선택. STRAIGHT/BOX 는 slot[0] 만 사용. FORMATION 은 SLOTS[pool] 만큼.
  const [slotSelections, setSlotSelections] = useState<number[][]>([[]]);
  const [unitP, setUnitP] = useState<number>(100);
  const [resultMsg, setResultMsg] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [isPending, startTransition] = useTransition();

  const slotsCount = SLOTS[pool];
  // pool/kind 가 바뀌면 슬롯 모양을 다시 만든다.
  // STRAIGHT/BOX → 1슬롯 (모든 마번을 한 슬롯에서 선택)
  // FORMATION    → SLOTS[pool] 슬롯
  function resetSelections(p: BetPool, k: BetKind) {
    const n = k === "FORMATION" ? SLOTS[p] : 1;
    setSlotSelections(Array.from({ length: n }, () => []));
  }

  function changePool(p: BetPool) {
    setPool(p);
    // PLC/WIN 은 박스/포메이션 의미가 약함 — 강제 일반으로
    const newKind = SLOTS[p] === 1 ? "STRAIGHT" : kind;
    setKind(newKind);
    resetSelections(p, newKind);
    setResultMsg(null);
    setConfirming(false);
  }

  function changeKind(k: BetKind) {
    setKind(k);
    resetSelections(pool, k);
    setResultMsg(null);
    setConfirming(false);
  }

  function toggleHorse(slotIdx: number, chulNo: number) {
    setSlotSelections((prev) => {
      const next = prev.map((s) => s.slice());
      const arr = next[slotIdx];
      const i = arr.indexOf(chulNo);
      if (i >= 0) arr.splice(i, 1);
      else arr.push(chulNo);
      arr.sort((a, b) => a - b);
      return next;
    });
    setConfirming(false);
  }

  // 미리보기 계산
  const preview = useMemo(() => {
    const horses = slotSelections[0] ?? [];
    try {
      if (kind === "STRAIGHT") {
        if (horses.length !== slotsCount) return null;
        return enumerateCombos(pool, { kind: "STRAIGHT", horses });
      }
      if (kind === "BOX") {
        if (horses.length < slotsCount) return null;
        return enumerateCombos(pool, { kind: "BOX", horses });
      }
      // FORMATION
      const slots = slotSelections;
      if (slots.length !== slotsCount) return null;
      if (slots.some((s) => s.length === 0)) return null;
      return enumerateCombos(pool, { kind: "FORMATION", slots });
    } catch {
      return null;
    }
  }, [pool, kind, slotSelections, slotsCount]);

  const comboCount = preview?.length ?? 0;
  const totalP = comboCount * unitP;
  const overTicketLimit = totalP > TICKET_LIMIT_P;
  const overBalance = balanceP != null && BigInt(totalP) > balanceP;
  const dailyUsedP = Number(dailyTotalP ?? BigInt(0));
  const dailyAfterP = dailyUsedP + totalP;
  const overDailyLimit = dailyAfterP > DAILY_LIMIT_P;
  const dailyPctUsed = Math.min(100, (dailyUsedP / DAILY_LIMIT_P) * 100);
  const dailyPctPlanned = Math.min(
    100,
    Math.max(0, ((dailyAfterP - dailyUsedP) / DAILY_LIMIT_P) * 100),
  );
  const canSubmit =
    loggedIn &&
    state === "pre" &&
    comboCount > 0 &&
    !overTicketLimit &&
    !overBalance &&
    !overDailyLimit &&
    !isPending;

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canSubmit) return;
    // 1단계: 미확인 → 확인 버튼으로 전환만.
    if (!confirming) {
      setConfirming(true);
      return;
    }
    const fd = new FormData();
    fd.set("raceDate", props.raceDate);
    fd.set("meet", props.meet);
    fd.set("raceNo", String(props.raceNo));
    fd.set("pool", pool);
    fd.set("kind", kind);
    fd.set("unitAmountP", String(unitP));
    if (kind === "FORMATION") {
      fd.set("slots", slotSelections.map((s) => s.join(",")).join("|"));
    } else {
      fd.set("horses", slotSelections[0].join(","));
    }
    setResultMsg(null);
    startTransition(async () => {
      const result = await placeBetAction(fd);
      if (result.ok) {
        setResultMsg(
          `구매 완료! ${result.comboCount}조합 × ${unitP.toLocaleString()}P = ${Number(
            result.totalAmountP,
          ).toLocaleString()}P 차감.`,
        );
        resetSelections(pool, kind);
      } else {
        setResultMsg(
          ERROR_LABEL[result.error] ??
            `오류: ${result.error}${result.detail ? ` (${result.detail})` : ""}`,
        );
      }
      setConfirming(false);
    });
  }

  if (!loggedIn) {
    return (
      <Card className="mt-6 border-dashed">
        <CardContent className="py-6 text-center text-sm text-muted-foreground">
          로그인하면 가입 보너스 1,000,000P 와 매일 출석 10,000P 로 모의배팅을
          체험할 수 있습니다.
        </CardContent>
      </Card>
    );
  }

  if (state !== "pre") {
    return (
      <Card className="mt-6 border-dashed">
        <CardContent className="py-6 text-center text-sm text-muted-foreground">
          {state === "locked"
            ? "이 경주는 베팅이 마감되었습니다."
            : "이미 종료된 경주입니다."}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="mt-6">
      <CardContent className="py-5">
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">모의배팅</h3>
            <span className="text-xs text-muted-foreground">
              잔액 {balanceP?.toLocaleString() ?? "-"} P
            </span>
          </div>

          {/* 풀 선택 — 풀별 컬러 (활성시 채움, 비활성은 풀 컬러 인디케이터) */}
          <div className="flex flex-wrap gap-1.5">
            {ALL_POOLS.map((p) => {
              const sty = POOL_STYLE[p];
              const isActive = pool === p;
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => changePool(p)}
                  className={`rounded-md border px-2.5 py-1 text-xs font-semibold transition ${
                    isActive
                      ? sty.active
                      : "border-border bg-background hover:bg-muted"
                  }`}
                >
                  {POOL_LABEL[p]}
                </button>
              );
            })}
          </div>

          {/* kind 선택 — 1슬롯 풀(WIN/PLC) 은 STRAIGHT 만 */}
          <div className="flex gap-1.5">
            {(SLOTS[pool] === 1
              ? (["STRAIGHT"] as BetKind[])
              : (["STRAIGHT", "BOX", "FORMATION"] as BetKind[])
            ).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => changeKind(k)}
                className={`rounded-md border px-2.5 py-1 text-xs transition ${
                  kind === k
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-background hover:bg-muted"
                }`}
              >
                {KIND_LABEL[k]}
              </button>
            ))}
          </div>

          {/* 마번 그리드 — STRAIGHT/BOX: 1슬롯, FORMATION: SLOTS[pool] 슬롯 */}
          <div className="space-y-2">
            {Array.from({ length: kind === "FORMATION" ? slotsCount : 1 }).map(
              (_, slotIdx) => (
                <div key={slotIdx}>
                  {kind === "FORMATION" && (
                    <div className="mb-1 text-xs text-muted-foreground">
                      {ORDERED[pool]
                        ? `${slotIdx + 1}착`
                        : `슬롯 ${slotIdx + 1}`}
                    </div>
                  )}
                  <div className="flex flex-wrap gap-1">
                    {entries.map((e) => {
                      const sel =
                        slotSelections[slotIdx]?.includes(e.chul_no) ?? false;
                      return (
                        <button
                          key={e.chul_no}
                          type="button"
                          onClick={() => toggleHorse(slotIdx, e.chul_no)}
                          title={e.horse_name}
                          className={`flex h-9 w-9 items-center justify-center rounded-md border text-sm font-mono tabular-nums transition ${
                            sel
                              ? "border-primary bg-primary text-white"
                              : "border-border bg-background hover:bg-muted"
                          }`}
                        >
                          {e.chul_no}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ),
            )}
          </div>

          {/* 단위 금액 */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">단위</span>
            {UNIT_OPTIONS_P.map((u) => (
              <button
                key={u}
                type="button"
                onClick={() => setUnitP(u)}
                className={`rounded-md border px-2 py-1 text-xs transition ${
                  unitP === u
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-background hover:bg-muted"
                }`}
              >
                {u.toLocaleString()}P
              </button>
            ))}
          </div>

          {/* 1일 한도 진행바 — 누적(밝게) + 이번 베팅 가산분(연하게 같은 톤) */}
          <div className="space-y-1 pt-2">
            <div className="flex items-baseline justify-between text-[11px] text-muted-foreground">
              <span>오늘 누적</span>
              <span className="font-mono tabular-nums">
                {dailyUsedP.toLocaleString()}
                {totalP > 0 && (
                  <span className={overDailyLimit ? "text-destructive" : "text-primary/70"}>
                    {" "}
                    + {totalP.toLocaleString()}
                  </span>
                )}
                <span className="opacity-60"> / {DAILY_LIMIT_P.toLocaleString()} P</span>
              </span>
            </div>
            <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="absolute left-0 top-0 h-full bg-primary/70 transition-all"
                style={{ width: `${dailyPctUsed}%` }}
              />
              <div
                className={`absolute top-0 h-full transition-all ${
                  overDailyLimit ? "bg-destructive/60" : "bg-primary/30"
                }`}
                style={{
                  left: `${dailyPctUsed}%`,
                  width: `${dailyPctPlanned}%`,
                }}
              />
            </div>
          </div>

          {/* 미리보기 + 제출 */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Badge variant="secondary" className="font-normal">
                {comboCount}조합
              </Badge>
              <span className="font-mono tabular-nums">
                = {totalP.toLocaleString()} P
              </span>
              {overTicketLimit && (
                <span className="text-destructive">1매 한도 초과</span>
              )}
              {overBalance && (
                <span className="text-destructive">잔액 부족</span>
              )}
              {overDailyLimit && !overTicketLimit && (
                <span className="text-destructive">1일 한도 초과</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {confirming && !isPending && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setConfirming(false)}
                >
                  취소
                </Button>
              )}
              <Button type="submit" size="sm" disabled={!canSubmit}>
                {isPending
                  ? "구매 중..."
                  : confirming
                    ? `정말 ${totalP.toLocaleString()}P 베팅`
                    : "베팅 확정"}
              </Button>
            </div>
          </div>

          {resultMsg && (
            <div
              className={`rounded-md border px-3 py-2 text-xs ${
                resultMsg.startsWith("구매 완료")
                  ? "border-green-500/30 bg-green-500/5 text-green-700"
                  : "border-destructive/30 bg-destructive/5 text-destructive"
              }`}
            >
              {resultMsg}
            </div>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
