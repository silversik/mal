import type { NextConfig } from "next";
import path from "node:path";

/**
 * 보안 헤더 (CRITIQUE M-1). 전체 CSP 는 의도적으로 미적용:
 *  - layout.tsx 의 pre-paint 인라인 테마/글씨크기 스크립트(dangerouslySetInnerHTML)에 nonce 를
 *    붙일 수 없다 — 루트 레이아웃을 static 으로 유지하려고 cookies()/headers() 를 쓰지 않으므로
 *    per-request nonce 가 불가능하고, 번들 CSP 가이드도 nonce 는 dynamic rendering 을 요구한다.
 *  - AdSense Auto Ads · GA 가 googlesyndication/doubleclick/googletagmanager 등 다수 오리진에서
 *    inline script 와 iframe 을 동적 주입 → 'unsafe-inline' 없이는 깨지고, 있으면 CSP 가 무의미.
 *  → CSP 는 frame-ancestors(클릭재킹)만 두고 나머지는 개별 헤더로.
 * Permissions-Policy 에 browsing-topics 를 넣지 않는 것도 의도(AdSense Topics 수익).
 * HSTS preload 는 미신청 — 모든 서브도메인 HTTPS 확인 후 추가.
 * nginx(/srv/stack, 레포 외부)가 HSTS 를 이미 add_header 하면 중복 → 배포 후 curl -sI 로 확인.
 */
const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Frame-Options", value: "DENY" },
];

const nextConfig: NextConfig = {
  // standalone output — Dockerfile 의 multi-stage runtime 에서 `.next/standalone` 을 그대로
  // 복사해 server.js 하나로 기동한다. 이게 없으면 Dockerfile 의 runtime 이 비어 터진다.
  output: "standalone",
  // `x-powered-by: Next.js` 정보 노출 제거 (CRITIQUE L-5).
  poweredByHeader: false,
  turbopack: {
    root: path.join(__dirname),
  },
  async headers() {
    // `/:path*` 는 0개 이상 세그먼트 — `/` 포함 전 경로. 파일시스템/렌더 전에 적용되므로 404 에도 붙는다.
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
