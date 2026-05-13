import type { MetadataRoute } from "next";
import { query } from "@/lib/db";

// Dockerfile 의 build 단계는 placeholder DATABASE_URL 로 실행되므로 sitemap 을
// prerender 하면 SCRAM auth 에러로 빌드가 실패한다.  요청 시점에만 DB 를 친다.
export const dynamic = "force-dynamic";
// 크롤러가 자주 치지는 않으나 한 번 만들어 두면 1 시간 캐시.  (force-dynamic 일 때
// revalidate 는 무시되지만, 향후 정책이 바뀌어도 의도가 코드에 남도록 명시.)
export const revalidate = 3600;

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

  // 정적 공개 페이지. 개인화·인증 경로(/me, /login, /notifications, /board/new)는 제외.
  const staticPages: MetadataRoute.Sitemap = [
    { url: SITE,                       lastModified: now, changeFrequency: "daily",  priority: 1.0 },
    { url: `${SITE}/races`,            lastModified: now, changeFrequency: "daily",  priority: 0.9 },
    { url: `${SITE}/races/schedule`,   lastModified: now, changeFrequency: "weekly", priority: 0.7 },
    { url: `${SITE}/database`,         lastModified: now, changeFrequency: "daily",  priority: 0.8 },
    { url: `${SITE}/horses`,           lastModified: now, changeFrequency: "daily",  priority: 0.9 },
    { url: `${SITE}/jockeys`,          lastModified: now, changeFrequency: "weekly", priority: 0.7 },
    { url: `${SITE}/trainer`,          lastModified: now, changeFrequency: "weekly", priority: 0.6 },
    { url: `${SITE}/owner`,            lastModified: now, changeFrequency: "weekly", priority: 0.5 },
    { url: `${SITE}/analysis`,         lastModified: now, changeFrequency: "daily",  priority: 0.8 },
    { url: `${SITE}/rankings`,         lastModified: now, changeFrequency: "weekly", priority: 0.7 },
    { url: `${SITE}/records`,          lastModified: now, changeFrequency: "weekly", priority: 0.7 },
    { url: `${SITE}/compare`,          lastModified: now, changeFrequency: "monthly",priority: 0.5 },
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
