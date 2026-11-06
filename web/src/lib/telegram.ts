/** Telegram `parse_mode: "HTML"` 용 이스케이프 — 사용자 입력·에러 메시지는 반드시 통과시킨다.
 *  `<` 나 `&` 가 그대로 들어가면 Telegram 이 400 을 돌려주고 알림이 사라진다. */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const TIMEOUT_MS = 3_000;

/** 운영 알림 전송. env 누락 시 skip(로컬 dev), 실패는 로그만 남기고 메인 플로우를 막지 않는다.
 *  `html` 은 호출부가 escapeHtml 로 감싼 HTML 문자열이어야 한다. */
export async function sendTelegram(html: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: html, parse_mode: "HTML" }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      console.error("[telegram] sendMessage failed", res.status, await res.text().catch(() => ""));
    }
  } catch (e) {
    console.error("[telegram] sendMessage error", (e as Error).message);
  } finally {
    clearTimeout(timer);
  }
}
