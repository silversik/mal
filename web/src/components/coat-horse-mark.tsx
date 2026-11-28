import { HORSE_SYMBOL_ID } from "@/components/brand/logo";
import { coatBodyHex } from "@/lib/coat";
import { cn } from "@/lib/utils";

type CoatHorseMarkProps = {
  coatColor: string | null | undefined;
  /** 가로 px (세로는 128:106 비율). */
  size?: number;
  className?: string;
};

// 말 아이콘 — 배경은 모든 말이 같은 중립 토큰(--muted + hairline 테두리),
// 모색(coat_color)은 말 실루엣 색에만 반영한다.
// 실루엣에는 muted-ink 윤곽선(paint-order: stroke → 바깥쪽 약 1px 만 보임)을
// 둘러, 배경과 명도가 비슷한 모색(라이트의 백색, 다크의 흑색·흑갈색)도 형태가 보이게 한다.
// path 는 layout 의 HorseMarkSymbolDefs <symbol> 을 <use> 로 참조.
export function CoatHorseMark({ coatColor, size = 40, className }: CoatHorseMarkProps) {
  const height = (size * 106) / 128;
  // symbol 안 path 는 0.875 배 축소 + viewBox 128 → size px. 화면에서 바깥 1px 이 되도록
  // (stroke 의 절반만 fill 밖에 보임) 2px 를 path 좌표로 환산.
  const strokeWidth = 2 / ((0.875 * size) / 128);
  const radius = Math.max(4, Math.round(size / 8));
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden border border-border bg-muted",
        className,
      )}
      style={{ width: size, height, borderRadius: radius }}
    >
      <svg viewBox="0 0 128 106" className="block h-full w-full">
        <use
          href={`#${HORSE_SYMBOL_ID}`}
          style={{
            fill: coatBodyHex(coatColor),
            stroke: "var(--muted-foreground)",
            strokeWidth,
            strokeLinejoin: "round",
            paintOrder: "stroke",
          }}
        />
      </svg>
    </span>
  );
}
