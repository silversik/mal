/**
 * Sitemap 분할용 공유 helper.
 *
 * 단일 sitemap.xml 이 6MB · 42k URL 로 커져서 Google Search Console 이
 * fetch 타임아웃을 겪었다. /sitemap.xml 을 index 로 만들고 chunk 를 분리해
 * 응답 크기·시간을 줄인다.
 *
 * id 매핑
 *   id=0  → 정적 페이지 + 소규모 엔티티(jockey/trainer/owner/post)
 *   id≥1  → 마필 chunk (OFFSET=(id-1)*HORSE_CHUNK_SIZE)
 */
import { query } from "@/lib/db";

export const SITE = "https://mal.kr";

// Google 단일 sitemap 한도: 50,000 URL · 50MB. 크롤러 fetch 타임아웃 여유를 두고
// 15k 단위 chunk 로 분할.
export const HORSE_CHUNK_SIZE = 15000;

export type SitemapUrl = {
  loc: string;
  lastmod: string;
  changefreq: "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never";
  priority: number;
};

/** 현재 마필 수 기준으로 필요한 chunk 개수(=horse chunk 수). */
export async function getSitemapChunkCount(): Promise<number> {
  const rows = await query<{ count: number }>(
    `SELECT count(*)::int AS count FROM horses`,
  );
  const horseCount = rows[0]?.count ?? 0;
  return Math.max(1, Math.ceil(horseCount / HORSE_CHUNK_SIZE));
}

export async function buildStaticAndSmallChunk(): Promise<SitemapUrl[]> {
  const [jockeys, trainers, owners, posts] = await Promise.all([
    query<{ jk_no: string; updated_at: string }>(
      `SELECT jk_no, to_char(updated_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS updated_at
         FROM jockeys`,
    ),
    query<{ tr_no: string; updated_at: string }>(
      `SELECT tr_no, to_char(updated_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS updated_at
         FROM trainers`,
    ),
    query<{ ow_no: string; updated_at: string }>(
      `SELECT ow_no, to_char(updated_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS updated_at
         FROM owners`,
    ),
    query<{ id: number; updated_at: string }>(
      `SELECT id::int AS id,
              to_char(updated_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS updated_at
         FROM community_posts
        ORDER BY id DESC
        LIMIT 5000`,
    ),
  ]);

  const now = new Date().toISOString();

  // 정적 공개 페이지. 개인화·인증 경로(/me, /login, /notifications, /board/new) 제외.
  const staticPages: SitemapUrl[] = [
    { loc: SITE,                     lastmod: now, changefreq: "daily",   priority: 1.0 },
    { loc: `${SITE}/races`,          lastmod: now, changefreq: "daily",   priority: 0.9 },
    { loc: `${SITE}/races/schedule`, lastmod: now, changefreq: "weekly",  priority: 0.7 },
    { loc: `${SITE}/database`,       lastmod: now, changefreq: "daily",   priority: 0.8 },
    { loc: `${SITE}/horses`,         lastmod: now, changefreq: "daily",   priority: 0.9 },
    { loc: `${SITE}/jockeys`,        lastmod: now, changefreq: "weekly",  priority: 0.7 },
    { loc: `${SITE}/trainer`,        lastmod: now, changefreq: "weekly",  priority: 0.6 },
    { loc: `${SITE}/owner`,          lastmod: now, changefreq: "weekly",  priority: 0.5 },
    { loc: `${SITE}/analysis`,       lastmod: now, changefreq: "daily",   priority: 0.8 },
    { loc: `${SITE}/rankings`,       lastmod: now, changefreq: "weekly",  priority: 0.7 },
    { loc: `${SITE}/records`,        lastmod: now, changefreq: "weekly",  priority: 0.7 },
    { loc: `${SITE}/compare`,        lastmod: now, changefreq: "monthly", priority: 0.5 },
    { loc: `${SITE}/news`,           lastmod: now, changefreq: "daily",   priority: 0.6 },
    { loc: `${SITE}/board`,          lastmod: now, changefreq: "hourly",  priority: 0.5 },
  ];

  return [
    ...staticPages,
    ...jockeys.map((j) => ({
      loc: `${SITE}/jockey/${j.jk_no}`,
      lastmod: j.updated_at,
      changefreq: "weekly" as const,
      priority: 0.6,
    })),
    ...trainers.map((t) => ({
      loc: `${SITE}/trainer/${t.tr_no}`,
      lastmod: t.updated_at,
      changefreq: "weekly" as const,
      priority: 0.6,
    })),
    ...owners.map((o) => ({
      loc: `${SITE}/owner/${o.ow_no}`,
      lastmod: o.updated_at,
      changefreq: "weekly" as const,
      priority: 0.4,
    })),
    ...posts.map((p) => ({
      loc: `${SITE}/board/${p.id}`,
      lastmod: p.updated_at,
      changefreq: "monthly" as const,
      priority: 0.4,
    })),
  ];
}

export async function buildHorseChunk(chunkIndex: number): Promise<SitemapUrl[]> {
  const horses = await query<{ horse_no: string; updated_at: string }>(
    `SELECT horse_no,
            to_char(updated_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS updated_at
       FROM horses
       ORDER BY horse_no
       OFFSET $1 LIMIT $2`,
    [chunkIndex * HORSE_CHUNK_SIZE, HORSE_CHUNK_SIZE],
  );
  return horses.map((h) => ({
    loc: `${SITE}/horse/${h.horse_no}`,
    lastmod: h.updated_at,
    changefreq: "weekly" as const,
    priority: 0.7,
  }));
}

/** XML 텍스트 노드 이스케이프 (loc 에 &/< 가 섞일 가능성 대비). */
export function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function renderUrlSet(urls: SitemapUrl[]): string {
  const parts: string[] = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
  ];
  for (const u of urls) {
    parts.push(
      `<url>`,
      `<loc>${escapeXml(u.loc)}</loc>`,
      `<lastmod>${u.lastmod}</lastmod>`,
      `<changefreq>${u.changefreq}</changefreq>`,
      `<priority>${u.priority}</priority>`,
      `</url>`,
    );
  }
  parts.push(`</urlset>`);
  return parts.join("\n");
}
