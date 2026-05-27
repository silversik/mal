import { query } from "@/lib/db";
import { PAGE_SIZE } from "@/lib/contact-shared";
export { TITLE_MAX, CONTENT_MAX, AUTHOR_MAX, PAGE_SIZE } from "@/lib/contact-shared";

export type ContactPost = {
  id: number;
  title: string;
  content: string;
  author_name: string;
  user_id: string | null;
  status: "pending" | "in_progress" | "resolved";
  created_at: string;
};

export async function listContactPosts(page: number): Promise<{
  posts: Omit<ContactPost, "content">[];
  total: number;
}> {
  const offset = (page - 1) * PAGE_SIZE;
  const [rows, countRows] = await Promise.all([
    query<Omit<ContactPost, "content">>(
      `SELECT id::int, title, author_name,
              status, to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at
         FROM contact_posts
        ORDER BY id DESC
        LIMIT $1 OFFSET $2`,
      [PAGE_SIZE, offset],
    ),
    query<{ count: number }>(`SELECT count(*)::int AS count FROM contact_posts`),
  ]);
  return { posts: rows, total: countRows[0]?.count ?? 0 };
}

export async function getContactPost(id: number): Promise<ContactPost | null> {
  const rows = await query<ContactPost>(
    `SELECT id::int, title, content, author_name, user_id::text,
            status, to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at
       FROM contact_posts
      WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function createContactPost(data: {
  title: string;
  content: string;
  author_name: string;
  user_id: string | null;
}): Promise<{ id: number }> {
  const rows = await query<{ id: number }>(
    `INSERT INTO contact_posts (title, content, author_name, user_id)
     VALUES ($1, $2, $3, $4)
     RETURNING id::int`,
    [data.title, data.content, data.author_name, data.user_id ?? null],
  );
  return { id: rows[0].id };
}
