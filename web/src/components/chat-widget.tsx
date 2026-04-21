"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const ROOMS = ["전체", "서울", "제주", "부경"] as const;
type Room = (typeof ROOMS)[number];

const POST_ROOMS = ROOMS.filter((r) => r !== "전체");
const USERNAME_COOKIE = "mal_chat_username";
const USERNAME_MAX = 20;
const MESSAGE_MAX = 500;
const POLL_MS = 3000;

type Message = {
  id: number;
  room: Room;
  username: string;
  message: string;
  created_at: string;
};

function readCookie(name: string): string {
  if (typeof document === "undefined") return "";
  const needle = `${name}=`;
  const parts = document.cookie.split(";");
  for (const p of parts) {
    const s = p.trim();
    if (s.startsWith(needle)) {
      return decodeURIComponent(s.slice(needle.length));
    }
  }
  return "";
}

function writeCookie(name: string, value: string, days = 365) {
  if (typeof document === "undefined") return;
  const expires = new Date(Date.now() + days * 86400_000).toUTCString();
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Lax`;
}

function formatTime(iso: string): string {
  // ISO → "HH:mm"
  const m = /T(\d{2}):(\d{2})/.exec(iso);
  return m ? `${m[1]}:${m[2]}` : "";
}

export function ChatWidget() {
  const [room, setRoom] = useState<Room>("전체");
  const [postRoom, setPostRoom] = useState<Exclude<Room, "전체">>("서울");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [username, setUsername] = useState("");
  const [nameDraft, setNameDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const listRef = useRef<HTMLDivElement>(null);
  const lastIdRef = useRef(0);

  useEffect(() => {
    setUsername(readCookie(USERNAME_COOKIE));
  }, []);

  const saveUsername = useCallback(() => {
    const v = nameDraft.trim().slice(0, USERNAME_MAX);
    if (!v) return;
    writeCookie(USERNAME_COOKIE, v);
    setUsername(v);
  }, [nameDraft]);

  const fetchMessages = useCallback(
    async (opts: { reset?: boolean } = {}) => {
      const after = opts.reset ? 0 : lastIdRef.current;
      const url = `/api/chat?room=${encodeURIComponent(room)}&after=${after}`;
      try {
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { messages: Message[] };
        if (!data.messages?.length) return;
        const maxId = data.messages[data.messages.length - 1]?.id ?? after;
        lastIdRef.current = Math.max(lastIdRef.current, maxId);
        setMessages((prev) => {
          if (opts.reset) return data.messages;
          const seen = new Set(prev.map((m) => m.id));
          const add = data.messages.filter((m) => !seen.has(m.id));
          return add.length ? [...prev, ...add] : prev;
        });
      } catch {
        /* ignore transient network errors */
      }
    },
    [room],
  );

  // Reset + fetch when room changes.
  useEffect(() => {
    lastIdRef.current = 0;
    setMessages([]);
    fetchMessages({ reset: true });
  }, [room, fetchMessages]);

  // Poll for new messages.
  useEffect(() => {
    const iv = setInterval(() => fetchMessages(), POLL_MS);
    return () => clearInterval(iv);
  }, [fetchMessages]);

  // Auto-scroll to bottom.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  async function send() {
    setError(null);
    const text = input.trim();
    if (!text || !username || sending) return;
    setSending(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ room: postRoom, username, message: text }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        setError(data?.error ?? "메시지 전송에 실패했습니다.");
        return;
      }
      setInput("");
      await fetchMessages();
    } finally {
      setSending(false);
    }
  }

  const canSend = useMemo(
    () => !!username && input.trim().length > 0 && !sending,
    [username, input, sending],
  );

  return (
    <div className="flex h-full min-h-[420px] flex-col rounded-xl border border-white/10 bg-white/5 backdrop-blur-sm">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="relative flex size-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-champagne-gold/60"></span>
            <span className="relative inline-flex size-2 rounded-full bg-champagne-gold"></span>
          </span>
          <span className="text-sm font-semibold text-sand-ivory">
            경마 채팅
          </span>
        </div>
        <span className="text-[10px] font-bold uppercase tracking-widest text-white/50">
          Beta
        </span>
      </div>

      {/* 방 선택 탭 */}
      <div className="flex gap-1 border-b border-white/10 px-2 py-2">
        {ROOMS.map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setRoom(r)}
            className={`rounded-md px-2.5 py-1 text-xs font-semibold transition ${
              room === r
                ? "bg-champagne-gold text-primary"
                : "text-white/60 hover:bg-white/10 hover:text-white"
            }`}
          >
            {r}
          </button>
        ))}
      </div>

      {/* 메시지 목록 */}
      <div
        ref={listRef}
        className="flex-1 space-y-2 overflow-y-auto px-4 py-3"
      >
        {messages.length === 0 ? (
          <div className="flex h-full items-center justify-center text-center text-xs text-white/40">
            아직 메시지가 없습니다. 첫 메시지를 남겨보세요.
          </div>
        ) : (
          messages.map((m) => {
            const mine = m.username === username;
            return (
              <div
                key={m.id}
                className={`flex ${mine ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[85%] rounded-lg px-3 py-2 text-sm leading-snug ${
                    mine
                      ? "bg-champagne-gold text-primary"
                      : "bg-white/10 text-sand-ivory"
                  }`}
                >
                  <div
                    className={`mb-0.5 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider ${
                      mine ? "text-primary/70" : "text-white/50"
                    }`}
                  >
                    <span>{m.username}</span>
                    {room === "전체" && (
                      <span className="rounded bg-black/10 px-1 py-[1px] text-[9px]">
                        {m.room}
                      </span>
                    )}
                    <span className="ml-auto font-mono">
                      {formatTime(m.created_at)}
                    </span>
                  </div>
                  <div className="break-words whitespace-pre-wrap">
                    {m.message}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* 입력 영역 */}
      {!username ? (
        <form
          className="border-t border-white/10 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            saveUsername();
          }}
        >
          <label className="mb-2 block text-[11px] font-semibold uppercase tracking-widest text-white/50">
            닉네임을 입력하세요
          </label>
          <div className="flex items-center gap-2">
            <input
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              maxLength={USERNAME_MAX}
              placeholder="예) 경마팬1"
              className="h-9 flex-1 rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-sand-ivory placeholder:text-white/40 outline-none focus:border-champagne-gold/60"
            />
            <button
              type="submit"
              disabled={!nameDraft.trim()}
              className="h-9 rounded-lg bg-champagne-gold px-3 text-sm font-semibold text-primary transition hover:bg-champagne-gold/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              입장
            </button>
          </div>
        </form>
      ) : (
        <form
          className="space-y-2 border-t border-white/10 p-2"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <div className="flex items-center justify-between px-1 text-[11px] text-white/60">
            <span>
              <span className="text-white/40">닉네임:</span>{" "}
              <span className="font-semibold text-sand-ivory">{username}</span>
              <button
                type="button"
                onClick={() => {
                  writeCookie(USERNAME_COOKIE, "", -1);
                  setUsername("");
                  setNameDraft("");
                }}
                className="ml-2 text-white/40 underline-offset-2 hover:text-white hover:underline"
              >
                변경
              </button>
            </span>
            <label className="flex items-center gap-1">
              <span className="text-white/40">방:</span>
              <select
                value={postRoom}
                onChange={(e) =>
                  setPostRoom(e.target.value as Exclude<Room, "전체">)
                }
                className="rounded bg-white/10 px-1 py-0.5 text-[11px] font-semibold text-sand-ivory outline-none focus:ring-1 focus:ring-champagne-gold/60"
              >
                {POST_ROOMS.map((r) => (
                  <option key={r} value={r} className="text-primary">
                    {r}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="flex items-center gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              maxLength={MESSAGE_MAX}
              placeholder="메시지를 입력하세요…"
              className="h-9 flex-1 rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-sand-ivory placeholder:text-white/40 outline-none focus:border-champagne-gold/60"
            />
            <button
              type="submit"
              disabled={!canSend}
              className="h-9 rounded-lg bg-champagne-gold px-3 text-sm font-semibold text-primary transition hover:bg-champagne-gold/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              보내기
            </button>
          </div>
          {error && (
            <div className="px-1 text-[11px] text-red-300">{error}</div>
          )}
        </form>
      )}
    </div>
  );
}
