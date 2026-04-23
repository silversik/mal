import { query } from "./db";

export const TITLE_MAX = 120;
export const CONTENT_MAX = 10_000;

export type CommunityPost = {
  id: number;
  user_id: string;
  title: string;
  content: string;
  author_name: string | null;
  created_at: string;
  updated_at: string;
};

// 작성자 표시 이름은 닉네임 우선, 미설정이면 OAuth 이름으로 fallback.
// users 가 삭제돼도(ON DELETE CASCADE 로 post 도 같이 사라지긴 하나) LEFT JOIN 유지.
const POST_COLUMNS = `
  p.id::int AS id,
  p.user_id::text AS user_id,
  p.title,
  p.content,
  COALESCE(u.nickname, u.name) AS author_name,
  to_char(p.created_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD"T"HH24:MI:SSOF') AS created_at,
  to_char(p.updated_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD"T"HH24:MI:SSOF') AS updated_at
`;

export async function listPosts(opts: {
  limit?: number;
  offset?: number;
} = {}): Promise<CommunityPost[]> {
  const limit = Math.min(opts.limit ?? 20, 100);
  const offset = opts.offset ?? 0;
  return query<CommunityPost>(
    `SELECT ${POST_COLUMNS}
       FROM community_posts p
       LEFT JOIN users u ON u.id = p.user_id
      ORDER BY p.created_at DESC, p.id DESC
      LIMIT $1 OFFSET $2`,
    [limit, offset],
  );
}

export async function getRecentPosts(limit = 5): Promise<CommunityPost[]> {
  return listPosts({ limit, offset: 0 });
}

export async function countPosts(): Promise<number> {
  const rows = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM community_posts`,
  );
  return Number(rows[0]?.count ?? 0);
}

export async function getPost(id: number): Promise<CommunityPost | null> {
  if (!Number.isFinite(id) || id <= 0) return null;
  const rows = await query<CommunityPost>(
    `SELECT ${POST_COLUMNS}
       FROM community_posts p
       LEFT JOIN users u ON u.id = p.user_id
      WHERE p.id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function createPost(opts: {
  user_id: string;
  title: string;
  content: string;
}): Promise<CommunityPost> {
  const rows = await query<CommunityPost>(
    `WITH inserted AS (
       INSERT INTO community_posts (user_id, title, content)
       VALUES ($1::bigint, $2, $3)
       RETURNING id, user_id, title, content, created_at, updated_at
     )
     SELECT ${POST_COLUMNS}
       FROM inserted p
       LEFT JOIN users u ON u.id = p.user_id`,
    [opts.user_id, opts.title, opts.content],
  );
  return rows[0];
}
