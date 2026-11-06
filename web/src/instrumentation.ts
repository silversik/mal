import type { Instrumentation } from "next";

import { escapeHtml, sendTelegram } from "@/lib/telegram";

// SSR/Server Action/Route Handler 에서 발생한 미캐치 에러를 Telegram 으로 push.
// env 누락 시 skip — 로컬 dev 노이즈 방지. crawler 와 동일한 변수 재사용.
// 에러 메시지·경로에 `_` · 백틱 · `<` 가 흔해서 Markdown 대신 이스케이프한 HTML 로 보낸다
// (Markdown 파싱 실패 시 Telegram 이 400 → 알림이 조용히 사라졌음).
export const onRequestError: Instrumentation.onRequestError = async (
  err,
  request,
  context,
) => {
  const error = err as Error & { digest?: string };
  console.error("[onRequestError]", {
    path: request.path,
    routePath: context.routePath,
    routeType: context.routeType,
    digest: error.digest,
    message: error.message,
    stack: error.stack,
  });

  const code = (s: string) => `<code>${escapeHtml(s)}</code>`;
  const html =
    `🚨 <b>mal.kr</b> SSR error\n` +
    `path: ${code(request.path)}\n` +
    `route: ${code(context.routePath)} (${escapeHtml(context.routeType)})\n` +
    `error: ${code(`${error.name}: ${error.message}`.slice(0, 500))}` +
    (error.digest ? `\ndigest: ${code(error.digest)}` : "");

  // sendTelegram 은 3초 타임아웃 + 실패 시 로그만 — 원본 에러 응답을 막지 않음.
  await sendTelegram(html);
};
