import { query } from "./db";

export type NewsItem = {
  id: number;
  guid: string;
  title: string;
  summary: string | null;
  link: string;
  category: string | null;
  image_url: string | null;
  published_at: string;
  source: string;
};

const NEWS_COLUMNS = `
  id, guid, title, summary, link, category, image_url, source,
  to_char(published_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD"T"HH24:MI:SSOF') AS published_at
`;

export async function getLatestNews(limit = 20, offset = 0): Promise<NewsItem[]> {
  return query<NewsItem>(
    `SELECT ${NEWS_COLUMNS}
       FROM kra_news
      ORDER BY published_at DESC, id DESC
      LIMIT $1 OFFSET $2`,
    [limit, offset],
  );
}

export async function countNews(): Promise<number> {
  const rows = await query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM kra_news`);
  return Number(rows[0]?.count ?? 0);
}
