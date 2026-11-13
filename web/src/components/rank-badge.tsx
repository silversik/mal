import { cn } from "@/lib/utils";

/**
 * 1·2·3위(착) 공용 배지 — 사이트 전체 단일 정의 (DESIGN.md "메달").
 * 색만으로 구분하지 않고 **형태**를 함께 쓴다(1=brown 채움 · 2=ink 테두리 · 3=brown-pale 채움),
 * 색맹·고령 사용자도 3단이 구분되도록. 모두 토큰 기반이라 다크에서도 자동 전환.
 * 예전엔 페이지마다 slate-400/amber-700 하드코딩(흰 글자 2.56:1)이 3가지 방식으로 흩어져 있었다.
 */
const MEDAL: Record<1 | 2 | 3, string> = {
  1: "bg-brown text-[var(--brown-fg)]",
  2: "border-2 border-foreground bg-card text-foreground",
  3: "bg-[var(--brown-pale)] text-foreground",
};

const SIZE = {
  sm: "h-6 w-6 text-small",
  md: "h-7 w-7 text-sm",
} as const;

export function RankBadge({
  rank,
  size = "md",
  rest = "plain",
  className,
}: {
  rank: number | null;
  size?: keyof typeof SIZE;
  /** 4위 이하 표시: plain = 숫자만, chip = 중립 원형 칩 */
  rest?: "plain" | "chip";
  className?: string;
}) {
  if (rank == null) {
    return <span className="text-muted-foreground">-</span>;
  }
  const base = cn(
    "inline-flex shrink-0 items-center justify-center rounded-full font-mono font-bold tabular-nums",
    SIZE[size],
    className,
  );
  if (rank >= 1 && rank <= 3) {
    return (
      <span className={cn(base, MEDAL[rank as 1 | 2 | 3])} aria-label={`${rank}위`}>
        {rank}
      </span>
    );
  }
  if (rest === "chip") {
    return <span className={cn(base, "bg-muted text-foreground")}>{rank}</span>;
  }
  return <span className="font-mono font-semibold tabular-nums text-foreground">{rank}</span>;
}

/** recent-form 류 소형 칩에서 쓰는 동일 3단 클래스 (크기는 호출부가 지정). */
export function medalClass(rank: number | null): string {
  if (rank != null && rank >= 1 && rank <= 3) return MEDAL[rank as 1 | 2 | 3];
  return "bg-muted text-foreground border border-border";
}
