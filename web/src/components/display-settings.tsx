"use client";

import * as React from "react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

type Theme = "auto" | "light" | "dark";
// 글씨 크기는 2단(보통/크게). "작게(14px)"는 50~60대+ 코호트와 반대 방향이라 제거(2026-11).
// 남아 있는 mal-scale=sm 쿠키는 layout.tsx 인라인 스크립트가 md 로 폴백.
type Scale = "md" | "lg";

const THEMES: { value: Theme; label: string }[] = [
  { value: "auto", label: "자동" },
  { value: "light", label: "밝게" },
  { value: "dark", label: "어둡게" },
];

const SCALES: { value: Scale; label: string }[] = [
  { value: "md", label: "보통" },
  { value: "lg", label: "크게" },
];

const ONE_YEAR = 60 * 60 * 24 * 365;

function setCookie(name: string, value: string) {
  // non-httpOnly so the inline theme script can read it on next load.
  // Secure only over https (omitted on http://localhost so dev still works).
  const secure = location.protocol === "https:" ? "; secure" : "";
  document.cookie = `${name}=${value}; path=/; max-age=${ONE_YEAR}; samesite=lax${secure}`;
}

function resolveDark(theme: Theme): boolean {
  if (theme === "dark") return true;
  if (theme === "light") return false;
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-color-scheme: dark)").matches
  );
}

function readScale(): Scale {
  return document.documentElement.getAttribute("data-scale") === "lg" ? "lg" : "md";
}

function readTheme(): Theme {
  const t = document.documentElement.getAttribute("data-theme");
  return t === "light" || t === "dark" ? t : "auto";
}

// <html data-*> 가 단일 진실원(인라인 스크립트가 쿠키로 첫 페인트 전에 세팅). 컨트롤들은
// useSyncExternalStore 로 그 속성을 구독 — 헤더 토글 ↔ 화면 설정 팝오버가 항상 동기.
const CHANGE = "mal-display-change";
function subscribe(cb: () => void) {
  window.addEventListener(CHANGE, cb);
  return () => window.removeEventListener(CHANGE, cb);
}

function applyScale(next: Scale) {
  setCookie("mal-scale", next);
  document.documentElement.setAttribute("data-scale", next);
  window.dispatchEvent(new Event(CHANGE));
}

function useScale(): [Scale, (s: Scale) => void] {
  const scale = React.useSyncExternalStore(subscribe, readScale, () => "md" as Scale);
  return [scale, applyScale];
}

/**
 * 헤더에 바로 노출하는 "글씨 크게" 토글 — 노안 사용자가 설정 메뉴를 열지 않고 한 번에 찾도록.
 * 화면 설정 팝오버의 글씨 크기와 같은 상태(쿠키 mal-scale)를 공유.
 */
export function TextSizeToggle({ className = "" }: { className?: string }) {
  const [scale, setScale] = useScale();
  const large = scale === "lg";
  return (
    <button
      type="button"
      aria-pressed={large}
      onClick={() => setScale(large ? "md" : "lg")}
      className={`inline-flex min-h-[max(44px,2.75rem)] items-center gap-1.5 rounded-md border px-3 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${
        large
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-card text-foreground hover:bg-accent"
      } ${className}`}
    >
      <span aria-hidden="true" className="text-base font-extrabold leading-none">
        가<span className="text-small align-super">+</span>
      </span>
      글씨 크게
    </button>
  );
}

export function DisplaySettings() {
  const theme = React.useSyncExternalStore(subscribe, readTheme, () => "auto" as Theme);
  const [scale, pickScale] = useScale();

  // OS-scheme-change handling is owned by the inline theme script (layout.tsx),
  // which reads the live data-theme attribute and persists for the page lifetime
  // (including across App Router client navigations). No duplicate listener here.

  function pickTheme(next: Theme) {
    setCookie("mal-theme", next);
    const d = document.documentElement;
    d.setAttribute("data-theme", next);
    d.classList.toggle("dark", resolveDark(next));
    window.dispatchEvent(new Event(CHANGE));
  }

  return (
    <Popover>
      <PopoverTrigger
        className="inline-flex min-h-[max(44px,2.75rem)] items-center gap-1.5 rounded-md border border-border px-3 text-sm font-semibold text-foreground transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        aria-label="화면 설정 — 테마와 글씨 크기"
      >
        <EyeIcon />
        화면 설정
      </PopoverTrigger>
      <PopoverContent align="end" className="gap-4">
        <SettingGroup
          legend="테마"
          options={THEMES}
          value={theme}
          onPick={pickTheme}
        />
        <SettingGroup
          legend="글씨 크기"
          options={SCALES}
          value={scale}
          onPick={pickScale}
        />
      </PopoverContent>
    </Popover>
  );
}

function SettingGroup<T extends string>({
  legend,
  options,
  value,
  onPick,
}: {
  legend: string;
  options: { value: T; label: string }[];
  value: T;
  onPick: (v: T) => void;
}) {
  return (
    <fieldset>
      <legend className="mb-1.5 text-small font-semibold text-muted-foreground">
        {legend}
      </legend>
      <div
        role="radiogroup"
        aria-label={legend}
        className="grid auto-cols-fr grid-flow-col gap-1 rounded-md bg-muted p-1"
      >
        {options.map((opt) => {
          const active = opt.value === value;
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onPick(opt.value)}
              className={`min-h-[max(44px,2.75rem)] rounded-[6px] px-2 text-base font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${
                active
                  ? "bg-card text-foreground shadow-subtle ring-1 ring-secondary"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

function EyeIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
