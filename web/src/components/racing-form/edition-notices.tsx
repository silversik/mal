import { publishStampKo, type FormNotice } from "@/lib/racing_form-shared";
import { cn } from "@/lib/utils";

/**
 * 철회 배너 — "철회됨 — 기록에 포함 ({시각}·{사유})" (계획 4.3). 예상은 그대로 보이고 집계에 들어간다.
 * 법적 사유(hide_picks)일 때만 예상을 숨긴다는 안내를 덧붙인다. 강조색 없이 ink 테두리.
 */
export function WithdrawnBanner({
  text,
  hidePicks,
  className,
}: {
  /** editionStateText(withdrawn) */
  text: string;
  hidePicks: boolean;
  className?: string;
}) {
  return (
    <div
      role="note"
      className={cn(
        "rounded-xl border-2 border-foreground bg-card px-4 py-3 text-base text-foreground",
        className,
      )}
    >
      <p className="font-semibold">{text}</p>
      <p className="mt-1 text-sm text-muted-foreground">
        {hidePicks
          ? "법적 사유로 이 호의 예상 기호를 화면에서 숨겼습니다. 기록 집계에는 그대로 들어갑니다."
          : "철회한 호도 예상은 발행한 그대로 남기고, 기록 집계에도 그대로 넣습니다."}
      </p>
    </div>
  );
}

/**
 * 정정 공지 목록 — 발행본은 고치지 않고 공지로만 알린다 (계약 §7). 정정은 호 단위(경주 범위 없음)라
 * 경주면에서는 label "이 호의 정정" 으로 그 경주의 변경과 구분한다.
 */
export function ErrataList({
  errata,
  label = "정정",
  className,
}: {
  errata: readonly FormNotice[];
  /** 머리 문구 앞부분 — "{label} n건 — …" */
  label?: string;
  className?: string;
}) {
  if (errata.length === 0) return null;
  return (
    <div
      role="note"
      className={cn("rounded-xl border border-border bg-card px-4 py-3 text-base", className)}
    >
      <p className="font-semibold text-foreground">
        {label} <span className="font-mono tabular-nums">{errata.length}</span>건 — 발행본은 고치지
        않고 공지로만 알립니다
      </p>
      <ul className="mt-1 space-y-1">
        {errata.map((n) => (
          <li key={n.id} className="text-sm leading-relaxed text-foreground">
            <span className="text-muted-foreground">{publishStampKo(n.noticed_at)} · </span>
            {n.public_text}
          </li>
        ))}
      </ul>
    </div>
  );
}
