import type { MetadataRoute } from "next";
import { query } from "@/lib/db";

const SITE = "https://mal.kr";

// 현재 규모(마필 ~수천, 기수/조교사/마주 ~수백, 게시글 N) 는 sitemap 1 개로 충분
// (Google 한도 50k URL). 규모 초과 시 generateSitemaps 로 분할.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [horses, jockeys, trainers, owners, posts] = await Promise.all([
    query<{ horse_no: string; updated_at: string }>(
      `SELECT horse_no, to_char(updated_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS updated_at
         FROM horses`,
    ),
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

  const now = new Date();

  const staticPages: MetadataRoute.Sitemap = [
    { url: SITE,                       lastModified: now, changeFrequency: "daily",  priority: 1.0 },
    { url: `${SITE}/horses`,           lastModified: now, changeFrequency: "daily",  priority: 0.9 },
    { url: `${SITE}/races`,            lastModified: now, changeFrequency: "daily",  priority: 0.9 },
    { url: `${SITE}/races/schedule`,   lastModified: now, changeFrequency: "weekly", priority: 0.7 },
    { url: `${SITE}/jockeys`,          lastModified: now, changeFrequency: "weekly", priority: 0.7 },
    { url: `${SITE}/news`,             lastModified: now, changeFrequency: "daily",  priority: 0.6 },
    { url: `${SITE}/board`,            lastModified: now, changeFrequency: "hourly", priority: 0.5 },
  ];

  const horsePages: MetadataRoute.Sitemap = horses.map((h) => ({
    url: `${SITE}/horse/${h.horse_no}`,
    lastModified: h.updated_at,
    changeFrequency: "weekly",
    priority: 0.7,
  }));
  const jockeyPages: MetadataRoute.Sitemap = jockeys.map((j) => ({
    url: `${SITE}/jockey/${j.jk_no}`,
    lastModified: j.updated_at,
    changeFrequency: "weekly",
    priority: 0.6,
  }));
  const trainerPages: MetadataRoute.Sitemap = trainers.map((t) => ({
    url: `${SITE}/trainer/${t.tr_no}`,
    lastModified: t.updated_at,
    changeFrequency: "weekly",
    priority: 0.6,
  }));
  const ownerPages: MetadataRoute.Sitemap = owners.map((o) => ({
    url: `${SITE}/owner/${o.ow_no}`,
    lastModified: o.updated_at,
    changeFrequency: "weekly",
    priority: 0.4,
  }));
  const postPages: MetadataRoute.Sitemap = posts.map((p) => ({
    url: `${SITE}/board/${p.id}`,
    lastModified: p.updated_at,
    changeFrequency: "monthly",
    priority: 0.4,
  }));

  return [
    ...staticPages,
    ...horsePages,
    ...jockeyPages,
    ...trainerPages,
    ...ownerPages,
    ...postPages,
  ];
}
