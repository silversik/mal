import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // standalone output — Dockerfile 의 multi-stage runtime 에서 `.next/standalone` 을 그대로
  // 복사해 server.js 하나로 기동한다. 이게 없으면 Dockerfile 의 runtime 이 비어 터진다.
  output: "standalone",
  turbopack: {
    // 워크트리 환경: node_modules 심볼릭 링크가 ../../../.. (Documents/mal) 아래 있으므로
    // 공통 상위 디렉토리를 root 로 지정해야 Turbopack 이 심볼릭 링크를 따라갈 수 있음.
    root: path.resolve(__dirname, "../../../.."),
  },
};

export default nextConfig;
