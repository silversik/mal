import { query } from "./db";

export const CHAT_ROOMS = ["전체", "서울", "제주", "부경"] as const;
export type ChatRoom = (typeof CHAT_ROOMS)[number];

export function isChatRoom(v: unknown): v is ChatRoom {
  return typeof v === "string" && (CHAT_ROOMS as readonly string[]).includes(v);
}

export const USERNAME_MAX = 20;
export const MESSAGE_MAX = 500;

export type ChatMessage = {
  id: number;
  room: ChatRoom;
  username: string;
  message: string;
  created_at: string;
};

const COLUMNS = `
  id::int AS id, room, username, message,
  to_char(created_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD"T"HH24:MI:SSOF') AS created_at
`;

export async function listMessages(opts: {
  room: ChatRoom;
  after?: number;
  limit?: number;
}): Promise<ChatMessage[]> {
  const limit = Math.min(opts.limit ?? 50, 200);
  const after = opts.after ?? 0;

  if (opts.room === "전체") {
    const rows = await query<ChatMessage>(
      `SELECT ${COLUMNS}
         FROM chat_messages
        WHERE id > $1
        ORDER BY id DESC
        LIMIT $2`,
      [after, limit],
    );
    return rows.reverse();
  }

  const rows = await query<ChatMessage>(
    `SELECT ${COLUMNS}
       FROM chat_messages
      WHERE room = $1 AND id > $2
      ORDER BY id DESC
      LIMIT $3`,
    [opts.room, after, limit],
  );
  return rows.reverse();
}

export async function insertMessage(opts: {
  room: ChatRoom;
  username: string;
  message: string;
}): Promise<ChatMessage> {
  if (opts.room === "전체") {
    // "전체" 뷰는 읽기 전용 집계 — 쓰기는 지역방으로만.
    throw new Error("cannot post to '전체' room");
  }
  const rows = await query<ChatMessage>(
    `INSERT INTO chat_messages (room, username, message)
     VALUES ($1, $2, $3)
     RETURNING ${COLUMNS}`,
    [opts.room, opts.username, opts.message],
  );
  return rows[0];
}
