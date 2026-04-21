import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // standalone output — Dockerfile 의 multi-stage runtime 에서 `.next/standalone` 을 그대로
  // 복사해 server.js 하나로 기동한다. 이게 없으면 Dockerfile 의 runtime 이 비어 터진다.
  output: "standalone",
  turbopack: {
    root: path.join(__dirname),
  },
};

export default nextConfig;
