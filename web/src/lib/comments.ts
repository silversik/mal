import { query } from "./db";

export const CONTENT_MAX = 500;

export type EntityType = "horse" | "jockey" | "trainer" | "owner" | "race";

export type Comment = {
  id: number;
  entity_type: EntityType;
  entity_id: string;
  entity_name: string;
  user_id: string;
  content: string;
  author_name: string | null;
  created_at: string;
};

export type RecentComment = Comment & {
  entity_href: string;
};

const COMMENT_COLUMNS = `
  c.id::int         AS id,
  c.entity_type,
  c.entity_id,
  c.entity_name,
  c.user_id::text   AS user_id,
  c.content,
  COALESCE(u.nickname, u.name) AS author_name,
  to_char(c.created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at
`;

function entityHref(type: EntityType, id: string): string {
  switch (type) {
    case "horse":   return `/horse/${id}`;
    case "jockey":  return `/jockey/${id}`;
    case "trainer": return `/trainer/${id}`;
    case "owner":   return `/owner/${id}`;
    case "race": {
      // id format: "YYYY-MM-DD_meet_raceno"
      const parts = id.split("_");
      if (parts.length >= 3) {
        const raceno = parts[parts.length - 1];
        const meet = parts[parts.length - 2];
        const date = parts.slice(0, parts.length - 2).join("-");
        return `/races?date=${date}&venue=${encodeURIComponent(meet)}&race=${raceno}`;
      }
      return "/races";
    }
  }
}

export async function listComments(
  entityType: EntityType,
  entityId: string,
  limit = 50,
): Promise<Comment[]> {
  return query<Comment>(
    `SELECT ${COMMENT_COLUMNS}
       FROM entity_comments c
       LEFT JOIN users u ON u.id = c.user_id
      WHERE c.entity_type = $1 AND c.entity_id = $2
      ORDER BY c.id DESC
      LIMIT $3`,
    [entityType, entityId, limit],
  );
}

export async function getRecentComments(limit = 10): Promise<RecentComment[]> {
  const rows = await query<Comment>(
    `SELECT ${COMMENT_COLUMNS}
       FROM entity_comments c
       LEFT JOIN users u ON u.id = c.user_id
      ORDER BY c.created_at DESC
      LIMIT $1`,
    [limit],
  );
  return rows.map((r) => ({
    ...r,
    entity_href: entityHref(r.entity_type, r.entity_id),
  }));
}

export async function createComment(opts: {
  entityType: EntityType;
  entityId: string;
  entityName: string;
  userId: string;
  content: string;
}): Promise<void> {
  await query(
    `INSERT INTO entity_comments (entity_type, entity_id, entity_name, user_id, content)
     VALUES ($1, $2, $3, $4::bigint, $5)`,
    [opts.entityType, opts.entityId, opts.entityName, opts.userId, opts.content],
  );
}

export async function deleteComment(id: number, userId: string): Promise<void> {
  await query(
    `DELETE FROM entity_comments WHERE id = $1 AND user_id = $2::bigint`,
    [id, userId],
  );
}
