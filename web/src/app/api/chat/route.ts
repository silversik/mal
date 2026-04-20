import type { NextRequest } from "next/server";

import {
  MESSAGE_MAX,
  USERNAME_MAX,
  insertMessage,
  isChatRoom,
  listMessages,
} from "@/lib/chat";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const room = searchParams.get("room") ?? "전체";
  const afterRaw = searchParams.get("after");
  const limitRaw = searchParams.get("limit");

  if (!isChatRoom(room)) {
    return Response.json({ error: "invalid room" }, { status: 400 });
  }

  const after = afterRaw ? Number(afterRaw) : 0;
  const limit = limitRaw ? Number(limitRaw) : 50;
  if (!Number.isFinite(after) || after < 0) {
    return Response.json({ error: "invalid after" }, { status: 400 });
  }

  const messages = await listMessages({ room, after, limit });
  return Response.json({ messages });
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }

  const { room, username, message } = (body ?? {}) as {
    room?: unknown;
    username?: unknown;
    message?: unknown;
  };

  if (!isChatRoom(room) || room === "전체") {
    return Response.json(
      { error: "room must be 서울 · 제주 · 부경" },
      { status: 400 },
    );
  }

  const name =
    typeof username === "string" ? username.trim().slice(0, USERNAME_MAX) : "";
  const text =
    typeof message === "string" ? message.trim().slice(0, MESSAGE_MAX) : "";
  if (!name) {
    return Response.json({ error: "username required" }, { status: 400 });
  }
  if (!text) {
    return Response.json({ error: "message required" }, { status: 400 });
  }

  const created = await insertMessage({ room, username: name, message: text });
  return Response.json({ message: created }, { status: 201 });
}
