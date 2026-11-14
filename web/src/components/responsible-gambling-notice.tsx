import { cn } from "@/lib/utils";

/**
 * 책임 고지 — 경마지(/form) 전용 (DESIGN.md Decisions Log 2026-11-13 "책임 고지 컴포넌트").
 *  - compact: 1면 머리·경주면 하단 한 줄. full: 1면·허브·기록 하단.
 *  - 토큰 색만, 기호(◎○△)에 기대지 않는 문장. "공식" 은 부정문에서만 쓴다.
 *  - 구매처·배당·영상 링크를 두지 않는다. ☎1336 만 tel: 링크 (터치 44px).
 *  - 문구는 계획 §8.3 그대로 — 최종 문구는 G1 법률 검토 후 이 파일에서만 바꾼다.
 */

/** compact 한 줄 — 끝의 "☎1336" 은 tel: 링크로 붙는다. */
export const NOTICE_COMPACT_TEXT =
  "참고용 데이터 정리입니다 · 적중을 보장하지 않고 마권 구매를 권하지 않습니다 · 청소년은 마권을 살 수 없습니다 · 도박 문제 상담";

type FullItem = { text: string; helpline?: { after: string } };

/** full 고지 ①~⑥. helpline 이 있는 항목은 text 뒤에 ☎1336 링크 + after 가 붙는다. */
export const NOTICE_FULL_ITEMS: readonly FullItem[] = [
  {
    text: "이 경마지는 한국마사회가 공개한 데이터를 mal.kr 이 미리 정한 기준으로 정리한 참고 자료입니다. 한국마사회의 공식 정보나 공식 예상이 아니며, mal.kr 은 독립 서비스입니다.",
  },
  { text: "예상 기호는 과거 기록을 기계적으로 정리한 것이며, 적중이나 수익을 보장하지 않습니다." },
  {
    text: "mal.kr 은 마권을 팔거나 대신 사 주지 않고, 마권 구매를 권하지 않으며, 적중에 대한 보상도 하지 않습니다.",
  },
  {
    text: "마권은 법정 연령 이상만 살 수 있습니다 — 경마장 만 19세 · 온라인 만 21세 (한국마사회 안내를 따릅니다).",
  },
  {
    text: "경마에 지나치게 몰입하지 않도록 주의하세요. 도박 문제 상담",
    helpline: { after: "(국번 없이 · 24시간 무료)" },
  },
  { text: "출전·기수 변경·경주 결과는 한국마사회 발표가 우선합니다." },
];

function HelplineLink() {
  return (
    <a
      href="tel:1336"
      aria-label="도박 문제 상담 전화 1336 (국번 없이, 24시간 무료)"
      className="inline-flex min-h-[max(44px,2.75rem)] items-center rounded-md px-1 font-mono font-bold tabular-nums text-foreground underline underline-offset-4 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      ☎1336
    </a>
  );
}

export function ResponsibleGamblingNotice({
  variant,
  className,
}: {
  variant: "compact" | "full";
  className?: string;
}) {
  if (variant === "compact") {
    return (
      <p
        className={cn(
          "rounded-md border border-border bg-card px-3 pt-2 text-sm leading-relaxed text-muted-foreground",
          className,
        )}
      >
        {NOTICE_COMPACT_TEXT} <HelplineLink />
      </p>
    );
  }
  return (
    <section
      aria-labelledby="rg-notice-title"
      className={cn("rounded-xl border border-border bg-card px-4 py-4", className)}
    >
      <h2 id="rg-notice-title" className="text-base font-bold text-foreground">
        꼭 읽어 주세요
      </h2>
      <ul className="mt-2 list-disc space-y-2 pl-5 text-sm leading-relaxed text-foreground">
        {NOTICE_FULL_ITEMS.map((it) => (
          <li key={it.text}>
            {it.text}
            {it.helpline ? (
              <>
                {" "}
                <HelplineLink /> {it.helpline.after}
              </>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
