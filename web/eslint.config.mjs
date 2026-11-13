import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const PX_FONT = {
  re: "text-\\[[0-9.]+px\\]",
  message:
    "px 폰트 리터럴 금지 — text-small / text-sm… 또는 text-[Nrem] (DESIGN.md 글씨크기 축).",
};
const SMALL_FONT = {
  re: "(^|[^\\w-])text-(caption|xs)(?![\\w-])",
  message: "13px 미만 글씨 금지 — 최소 text-small(13px), 데이터는 text-sm 이상 (DESIGN.md 타이포 하한).",
};
const FADED_TEXT = {
  re: "text-(muted-foreground|slate-grey|foreground|primary)\\/[1-7]0(?![0-9])",
  message: "투명도로 흐린 텍스트 금지 — text-muted-foreground 그대로 쓰거나 text-foreground 로 (DESIGN.md 대비).",
};
const RAW_PALETTE = {
  re: "(text|bg|border|ring|fill|stroke|from|to|via)-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-[0-9]{2,3}",
  message: "Tailwind 원색 팔레트 금지 — brown / positive / negative / muted 토큰 사용 (DESIGN.md 적은 컬러).",
};

function designGuards({ all }) {
  const guards = all ? [PX_FONT, SMALL_FONT, FADED_TEXT, RAW_PALETTE] : [PX_FONT];
  return guards.flatMap(({ re, message }) => [
    { selector: `Literal[value=/${re}/]`, message },
    { selector: `TemplateElement[value.raw=/${re}/]`, message },
  ]);
}

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  // DESIGN.md 가드 (Tailwind 린트 플러그인이 없어 core no-restricted-syntax 로).
  //  1. px 폰트 리터럴(text-[11px]) — [data-scale] 큰글씨에서 안 커짐 (2026-09, 132곳 정리)
  //  2. 13px 미만 글씨(text-caption 11px / text-xs 12px) — 노안 코호트 하한 13px (2026-11, 187곳 정리)
  //  3. 투명도로 흐린 텍스트(text-muted-foreground/60 등) — muted 위에 또 흐리면 대비 1.8~3.1:1
  //  4. Tailwind 원색 팔레트(slate-400, amber-700…) — 토큰(brown/positive/negative/muted) 만 사용
  // 2~4 는 shadcn 원본(components/ui)에는 적용하지 않는다.
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/components/ui/**"],
    rules: {
      "no-restricted-syntax": ["error", ...designGuards({ all: true })],
    },
  },
  {
    files: ["src/components/ui/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": ["error", ...designGuards({ all: false })],
    },
  },
]);

export default eslintConfig;
