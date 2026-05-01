import type { Instrumentation } from "next";

// SSR/Server Action/Route Handler 에서 발생한 미캐치 에러를 Telegram 으로 push.
// env 누락 시 silent skip — 로컬 dev 노이즈 방지. crawler 와 동일한 변수 재사용.
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

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;

  const text =
    `🚨 *mal.kr* SSR error\n` +
    `path: \`${request.path}\`\n` +
    `route: \`${context.routePath}\` (${context.routeType})\n` +
    `error: \`${error.name}: ${error.message}\`` +
    (error.digest ? `\ndigest: \`${error.digest}\`` : "");

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3_000);
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "Markdown",
      }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
  } catch {
    // alerting 자체 실패는 무시 — 원본 에러 응답을 막지 않음
  }
};
