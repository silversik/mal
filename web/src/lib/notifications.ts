import { query } from "@/lib/db";

export type NotificationItem = {
  id: number;
  kind: string;
  title: string;
  body: string | null;
  href: string | null;
  read_at: string | null;
  created_at: string;
};

export async function getUnreadNotificationCount(userId: string): Promise<number> {
  const rows = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
       FROM notifications
      WHERE user_id = $1::bigint AND read_at IS NULL`,
    [userId],
  );
  return Number(rows[0]?.count ?? 0);
}

export async function listNotifications(
  userId: string,
  limit = 50,
): Promise<NotificationItem[]> {
  return query<NotificationItem>(
    `SELECT id, kind, title, body, href,
            to_char(read_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI') AS read_at,
            to_char(created_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI') AS created_at
       FROM notifications
      WHERE user_id = $1::bigint
      ORDER BY created_at DESC
      LIMIT $2`,
    [userId, limit],
  );
}

export async function markAllRead(userId: string): Promise<number> {
  const rows = await query<{ id: number }>(
    `UPDATE notifications
        SET read_at = NOW()
      WHERE user_id = $1::bigint AND read_at IS NULL
      RETURNING id`,
    [userId],
  );
  return rows.length;
}
