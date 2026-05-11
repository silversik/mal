import type { ReactNode } from "react";

/**
 * 디자인 시안의 SectionHead — 작은 navy 칩 + 라벨 + 구분선 + 우측 옵션.
 */
export function SectionHead({
  icon,
  label,
  right,
}: {
  icon?: ReactNode;
  label: string;
  right?: ReactNode;
}) {
  return (
    <div className="mb-3 flex items-center gap-2">
      {icon && (
        <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-primary text-secondary">
          {icon}
        </span>
      )}
      <h3 className="text-sm font-bold tracking-tight">{label}</h3>
      <span className="h-px flex-1 bg-border" />
      {right}
    </div>
  );
}

/**
 * KpiTile — 라벨 + 큰 mono 값 + 단위 + 우상단 흐릿한 아이콘.
 */
export function KpiTile({
  label,
  value,
  sub,
  icon,
  accent,
}: {
  label: string;
  value: ReactNode;
  sub?: string;
  icon?: ReactNode;
  /** mono 숫자의 색상 토큰. 기본 = foreground. */
  accent?: "navy" | "gold";
}) {
  const valueColor =
    accent === "gold"
      ? "text-[var(--color-gold-ink)]"
      : accent === "navy"
        ? "text-primary"
        : "text-foreground";
  return (
    <div className="relative overflow-hidden rounded-[10px] border border-border bg-card px-3 py-2">
      {icon && (
        <span className="pointer-events-none absolute right-2 top-2 text-muted-foreground opacity-30">
          {icon}
        </span>
      )}
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div
        className={`mt-0.5 font-mono text-[19px] font-bold leading-tight tabular-nums ${valueColor}`}
      >
        {value}
        {sub && (
          <span className="ml-1 align-baseline text-[11px] font-medium text-muted-foreground">
            {sub}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * MetaTile — 좌측 작은 아이콘 박스 + (라벨 / 값).
 */
export function MetaTile({
  icon,
  label,
  value,
  sub,
}: {
  icon?: ReactNode;
  label: string;
  value: ReactNode;
  sub?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 rounded-[10px] border border-border bg-muted px-2.5 py-2">
      {icon && (
        <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-border bg-card text-primary">
          {icon}
        </span>
      )}
      <div className="min-w-0">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </div>
        <div className="truncate text-[13px] font-semibold text-foreground">
          {value}
          {sub && (
            <span className="ml-1 text-[11px] font-medium text-muted-foreground">
              {sub}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * ProfileTag — gold / navy / muted / solid-navy 4종 톤 칩.
 */
export function ProfileTag({
  tone = "muted",
  icon,
  children,
}: {
  tone?: "gold" | "navy" | "muted" | "solid-navy";
  icon?: ReactNode;
  children: ReactNode;
}) {
  const cls = {
    gold: "bg-[rgba(252,223,104,0.25)] text-[var(--color-gold-ink)] border-[rgba(251,212,54,0.55)]",
    navy: "bg-[rgba(29,51,78,0.05)] text-primary border-[rgba(29,51,78,0.14)]",
    muted: "bg-muted text-muted-foreground border-border",
    "solid-navy": "bg-primary text-secondary border-primary",
  }[tone];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-[2px] text-[11px] font-semibold ${cls}`}
    >
      {icon}
      {children}
    </span>
  );
}

/**
 * BreadCrumb — 작은 muted 브레드크럼.
 */
export function BreadCrumb({
  items,
}: {
  items: { label: string; href?: string }[];
}) {
  return (
    <nav className="mb-3 flex items-center gap-1.5 text-xs text-muted-foreground">
      {items.map((it, i) => (
        <span key={i} className="inline-flex items-center gap-1.5">
          {it.href ? (
            <a href={it.href} className="hover:text-primary">
              {it.label}
            </a>
          ) : (
            <span
              className={
                i === items.length - 1 ? "font-semibold text-foreground" : ""
              }
            >
              {it.label}
            </span>
          )}
          {i < items.length - 1 && (
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 6l6 6-6 6" />
            </svg>
          )}
        </span>
      ))}
    </nav>
  );
}

/* 작은 lucide-스타일 아이콘 — 디자인 시안에서 쓰이는 것들만. */
const Ico = ({ children, size = 14 }: { children: ReactNode; size?: number }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
);

export const IconCalendar = (p: { size?: number }) => (
  <Ico size={p.size}>
    <rect x="3" y="4" width="18" height="17" rx="2" />
    <path d="M3 9h18M8 2v4M16 2v4" />
  </Ico>
);
export const IconFlag = (p: { size?: number }) => (
  <Ico size={p.size}>
    <path d="M4 21V4M4 4h12l-2 4 2 4H4" />
  </Ico>
);
export const IconHash = (p: { size?: number }) => (
  <Ico size={p.size}>
    <path d="M5 9h14M5 15h14M10 3l-2 18M16 3l-2 18" />
  </Ico>
);
export const IconUser = (p: { size?: number }) => (
  <Ico size={p.size}>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21c0-4 4-7 8-7s8 3 8 7" />
  </Ico>
);
export const IconUserPlus = (p: { size?: number }) => (
  <Ico size={p.size}>
    <circle cx="9" cy="8" r="4" />
    <path d="M2 21c0-4 3-7 7-7s7 3 7 7M18 8v6M15 11h6" />
  </Ico>
);
export const IconHorseshoe = (p: { size?: number }) => (
  <Ico size={p.size}>
    <path d="M6 4v9a6 6 0 0 0 12 0V4" />
    <path d="M6 16l-1 4M18 16l1 4M5 7h1M5 11h1M18 7h1M18 11h1" />
  </Ico>
);
export const IconCrown = (p: { size?: number }) => (
  <Ico size={p.size}>
    <path d="M3 8l4 4 5-7 5 7 4-4-2 12H5z" />
  </Ico>
);
export const IconTrend = (p: { size?: number }) => (
  <Ico size={p.size}>
    <path d="M3 17l6-6 4 4 8-9" />
    <path d="M14 6h7v7" />
  </Ico>
);
export const IconTrophy = (p: { size?: number }) => (
  <Ico size={p.size}>
    <path d="M8 4h8v6a4 4 0 0 1-8 0V4z" />
    <path d="M8 6H5v2a3 3 0 0 0 3 3M16 6h3v2a3 3 0 0 1-3 3M10 16h4l-1 4h-2z" />
  </Ico>
);
export const IconTarget = (p: { size?: number }) => (
  <Ico size={p.size}>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="5" />
    <circle cx="12" cy="12" r="1.5" fill="currentColor" />
  </Ico>
);
export const IconActivity = (p: { size?: number }) => (
  <Ico size={p.size}>
    <path d="M3 12h4l2-7 4 14 2-7h6" />
  </Ico>
);
export const IconBars = (p: { size?: number }) => (
  <Ico size={p.size}>
    <rect x="3" y="13" width="4" height="8" rx="1" />
    <rect x="10" y="9" width="4" height="12" rx="1" />
    <rect x="17" y="5" width="4" height="16" rx="1" />
  </Ico>
);
export const IconStar = (p: { size?: number }) => (
  <Ico size={p.size}>
    <path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9L12 3z" />
  </Ico>
);
export const IconArrowUp = (p: { size?: number }) => (
  <Ico size={p.size}>
    <path d="M12 19V5M5 12l7-7 7 7" />
  </Ico>
);
export const IconArrowDown = (p: { size?: number }) => (
  <Ico size={p.size}>
    <path d="M12 5v14M5 12l7 7 7-7" />
  </Ico>
);
