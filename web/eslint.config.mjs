import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

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
  // DESIGN.md 글씨크기 축([data-scale] → 루트 14/16/20px)은 rem 만 따라간다. px 폰트
  // 리터럴(text-[11px])은 큰글씨에서 안 커지므로 금지 — text-caption(11px 상당) /
  // text-small(13px 상당) / text-xs 이상 표준 스케일 / text-[Nrem] 만 허용. 레포에 Tailwind
  // 린트 플러그인이 없어 core 룰로 가드. (2026-09 sweep 에서 132곳 정리, 재발 방지용)
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "Literal[value=/text-\\[[0-9.]+px\\]/]",
          message:
            "px 폰트 리터럴 금지 — text-caption / text-small / text-xs… 또는 text-[Nrem] (DESIGN.md 글씨크기 축).",
        },
        {
          selector: "TemplateElement[value.raw=/text-\\[[0-9.]+px\\]/]",
          message:
            "px 폰트 리터럴 금지 — text-caption / text-small / text-xs… 또는 text-[Nrem] (DESIGN.md 글씨크기 축).",
        },
      ],
    },
  },
]);

export default eslintConfig;
