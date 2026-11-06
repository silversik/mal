import { afterEach, describe, expect, it, vi } from "vitest";
import { escapeHtml, sendTelegram } from "../telegram";

describe("escapeHtml — Telegram HTML parse_mode", () => {
  it("&, <, > 를 엔티티로", () => {
    expect(escapeHtml("a < b && c > d")).toBe("a &lt; b &amp;&amp; c &gt; d");
  });

  it("& 를 먼저 바꿔 이중 이스케이프하지 않는다", () => {
    expect(escapeHtml("&lt;")).toBe("&amp;lt;");
  });

  it("일반 한글·이모지는 그대로", () => {
    expect(escapeHtml("문의 📬 _test_ `x`")).toBe("문의 📬 _test_ `x`");
  });
});

describe("sendTelegram", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("env 없으면 호출하지 않는다", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
    vi.stubEnv("TELEGRAM_CHAT_ID", "");
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    await sendTelegram("x");
    expect(f).not.toHaveBeenCalled();
  });

  it("HTML parse_mode 로 보내고, 실패 응답은 throw 없이 로그만", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "t");
    vi.stubEnv("TELEGRAM_CHAT_ID", "c");
    const f = vi.fn().mockResolvedValue(new Response("bad", { status: 400 }));
    vi.stubGlobal("fetch", f);
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(sendTelegram("<b>hi</b>")).resolves.toBeUndefined();
    const body = JSON.parse(f.mock.calls[0][1].body);
    expect(body).toMatchObject({ chat_id: "c", text: "<b>hi</b>", parse_mode: "HTML" });
    expect(err).toHaveBeenCalled();
  });

  it("네트워크 에러도 삼킨다", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "t");
    vi.stubEnv("TELEGRAM_CHAT_ID", "c");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(sendTelegram("x")).resolves.toBeUndefined();
  });
});
