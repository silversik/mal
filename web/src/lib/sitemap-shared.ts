/**
 * Sitemap 분할용 공유 helper.
 *
 * 단일 sitemap.xml 이 6MB · 42k URL 로 커져서 Google Search Console 이
 * fetch 타임아웃을 겪었다. /sitemap.xml 을 index 로 만들고 chunk 를 분리해
 * 응답 크기·시간을 줄인다.
 *
 * id 매핑 (/sitemap/<id>.xml)
 *   0        → 정적 페이지 + 소규모 엔티티(jockey/trainer/owner/post)
 *   1..N     → 마필 chunk (OFFSET=(id-1)*HORSE_CHUNK_SIZE)
 *   races-K  → 경주 상세 chunk (OFFSET=K*RACE_CHUNK_SIZE). 마필 수가 늘어도
 *              경주 chunk 번호가 밀리지 않도록 별도 prefix 를 쓴다.
 *
 * lastmod 는 데이터에서 온 값만 쓴다(마필 updated_at · 경주일). 매 요청 "now"
 * 는 크롤러에 잘못된 신호라 정적 페이지는 lastmod 를 생략한다.
 * timestamptz → "...Z" 문자열은 반드시 `AT TIME ZONE 'UTC'` 로 변환 후 포맷한다
 * (세션 TimeZone 이 KST 면 to_char 가 KST 벽시계에 Z 를 붙여 9시간 어긋난다).
 */
import { query } from "@/lib/db";
import { raceDetailPath } from "@/lib/race-seo";

export const SITE = "https://mal.kr";

// Google 단일 sitemap 한도: 50,000 URL · 50MB. 크롤러 fetch 타임아웃 여유를 두고
// 15k 단위 chunk 로 분할.
export const HORSE_CHUNK_SIZE = 15000;
// 경주 URL 은 쿼리스트링(인코딩된 venue)이 길어 더 작게 자른다.
export const RACE_CHUNK_SIZE = 5000;

// 모든 race_date 비교는 KST 기준 (races.ts 와 동일).
const KST_TODAY = `(NOW() AT TIME ZONE 'Asia/Seoul')::date`;

export type SitemapUrl = {
  loc: string;
  lastmod?: string;
  changefreq: "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never";
  priority: number;
};

export type SitemapChunkId =
  | { kind: "static" }
  | { kind: "horse"; index: number }
  | { kind: "race"; index: number };

export type SitemapIndexEntry = { id: string; lastmod?: string };

/**
 * chunk index → OFFSET. index 쿼리의 `(row_number - 1) / size` 와 짝이 맞아야
 * index 의 chunk 개수·lastmod 가 실제 chunk 내용과 일치한다.
 */
export function chunkOffset(index: number, size: number): number {
  return index * size;
}

/** 1-based row_number 가 속하는 chunk index (index SQL 과 동일한 정수 나눗셈). */
export function chunkIndexOfRow(rowNumber: number, size: number): number {
  return Math.floor((rowNumber - 1) / size);
}

/** "0.xml" · "3.xml" · "races-2.xml" → chunk 종류/인덱스. 그 외 null(404). */
export function parseSitemapId(raw: string): SitemapChunkId | null {
  const s = raw.replace(/\.xml$/, "");
  const race = /^races-(0|[1-9]\d*)$/.exec(s);
  if (race) return { kind: "race", index: Number(race[1]) };
  if (!/^(0|[1-9]\d*)$/.test(s)) return null;
  const n = Number(s);
  return n === 0 ? { kind: "static" } : { kind: "horse", index: n - 1 };
}

/** chunk → index 에 노출할 id (parseSitemapId 의 역). */
export function sitemapChunkId(c: SitemapChunkId): string {
  if (c.kind === "static") return "0";
  if (c.kind === "horse") return String(c.index + 1);
  return `races-${c.index}`;
}

/** index 에 노출할 chunk 목록 — 정적(0) + 마필 chunk + 경주 chunk 순. */
export function buildSitemapIndexEntries(
  horseChunkLastmods: (string | undefined)[],
  raceChunkLastmods: (string | undefined)[],
): SitemapIndexEntry[] {
  return [
    { id: sitemapChunkId({ kind: "static" }) },
    ...horseChunkLastmods.map((lastmod, index) => ({
      id: sitemapChunkId({ kind: "horse", index }),
      lastmod,
    })),
    ...raceChunkLastmods.map((lastmod, index) => ({
      id: sitemapChunkId({ kind: "race", index }),
      lastmod,
    })),
  ];
}

/**
 * chunk 별 lastmod(= chunk 내 최대 갱신시각/경주일) 를 한 번에 계산.
 * chunk 분할 기준(ORDER BY)은 build*Chunk 와 반드시 동일해야 한다.
 */
async function getHorseChunkLastmods(): Promise<(string | undefined)[]> {
  const rows = await query<{ chunk: number; lastmod: string | null }>(
    `SELECT ((rn - 1) / $1)::int AS chunk,
            to_char(max(updated_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS lastmod
       FROM (SELECT updated_at, row_number() OVER (ORDER BY horse_no) AS rn
               FROM horses) t
      GROUP BY 1
      ORDER BY 1`,
    [HORSE_CHUNK_SIZE],
  );
  return rows.map((r) => r.lastmod ?? undefined);
}

async function getRaceChunkLastmods(): Promise<(string | undefined)[]> {
  const rows = await query<{ chunk: number; lastmod: string }>(
    `SELECT ((rn - 1) / $1)::int AS chunk,
            to_char(max(race_date), 'YYYY-MM-DD') AS lastmod
       FROM (SELECT race_date,
                    row_number() OVER (ORDER BY race_date, meet, race_no) AS rn
               FROM races
              WHERE race_date <= ${KST_TODAY}) t
      GROUP BY 1
      ORDER BY 1`,
    [RACE_CHUNK_SIZE],
  );
  return rows.map((r) => r.lastmod);
}

export async function getSitemapIndexEntries(): Promise<SitemapIndexEntry[]> {
  const [horse, race] = await Promise.all([
    getHorseChunkLastmods(),
    getRaceChunkLastmods(),
  ]);
  // 마필 0건이어도 기존처럼 /sitemap/1.xml 은 index 에 남긴다(빈 응답은 404).
  return buildSitemapIndexEntries(horse.length > 0 ? horse : [undefined], race);
}

export async function buildStaticAndSmallChunk(): Promise<SitemapUrl[]> {
  const [jockeys, trainers, owners] = await Promise.all([
    query<{ jk_no: string; updated_at: string }>(
      `SELECT jk_no, to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS updated_at
         FROM jockeys`,
    ),
    query<{ tr_no: string; updated_at: string }>(
      `SELECT tr_no, to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS updated_at
         FROM trainers`,
    ),
    query<{ ow_no: string; updated_at: string }>(
      `SELECT ow_no, to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS updated_at
         FROM owners`,
    ),
  ]);

  // 정적 공개 페이지. 개인화·인증 경로(/me, /login, /notifications) 제외.
  const staticPages: SitemapUrl[] = [
    { loc: SITE,                     changefreq: "daily",   priority: 1.0 },
    { loc: `${SITE}/races`,          changefreq: "daily",   priority: 0.9 },
    { loc: `${SITE}/races/schedule`, changefreq: "weekly",  priority: 0.7 },
    { loc: `${SITE}/database`,       changefreq: "daily",   priority: 0.8 },
    { loc: `${SITE}/horses`,         changefreq: "daily",   priority: 0.9 },
    { loc: `${SITE}/jockeys`,        changefreq: "weekly",  priority: 0.7 },
    { loc: `${SITE}/trainer`,        changefreq: "weekly",  priority: 0.6 },
    { loc: `${SITE}/owner`,          changefreq: "weekly",  priority: 0.5 },
    { loc: `${SITE}/analysis`,       changefreq: "daily",   priority: 0.8 },
    { loc: `${SITE}/rankings`,       changefreq: "weekly",  priority: 0.7 },
    { loc: `${SITE}/records`,        changefreq: "weekly",  priority: 0.7 },
    { loc: `${SITE}/compare`,        changefreq: "monthly", priority: 0.5 },
    { loc: `${SITE}/news`,           changefreq: "daily",   priority: 0.6 },
    { loc: `${SITE}/about`,          changefreq: "yearly",  priority: 0.5 },
    { loc: `${SITE}/privacy`,        changefreq: "yearly",  priority: 0.3 },
    { loc: `${SITE}/terms`,          changefreq: "yearly",  priority: 0.3 },
    { loc: `${SITE}/contact`,        changefreq: "yearly",  priority: 0.3 },
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
  ];
}

export async function buildHorseChunk(chunkIndex: number): Promise<SitemapUrl[]> {
  const horses = await query<{ horse_no: string; updated_at: string }>(
    `SELECT horse_no,
            to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS updated_at
       FROM horses
       ORDER BY horse_no
       OFFSET $1 LIMIT $2`,
    [chunkOffset(chunkIndex, HORSE_CHUNK_SIZE), HORSE_CHUNK_SIZE],
  );
  return horses.map((h) => ({
    loc: `${SITE}/horse/${h.horse_no}`,
    lastmod: h.updated_at,
    changefreq: "weekly" as const,
    priority: 0.7,
  }));
}

/**
 * 경주 상세 chunk. 과거→최근 순으로 고정 정렬해 신규 경주는 마지막 chunk 에만
 * 붙고 이전 chunk 내용·lastmod 는 안정적으로 유지된다. 미래 경주는 제외.
 */
export async function buildRaceChunk(chunkIndex: number): Promise<SitemapUrl[]> {
  const races = await query<{ race_date: string; meet: string; race_no: number }>(
    `SELECT to_char(race_date, 'YYYY-MM-DD') AS race_date, meet, race_no
       FROM races
      WHERE race_date <= ${KST_TODAY}
      ORDER BY race_date, meet, race_no
      OFFSET $1 LIMIT $2`,
    [chunkOffset(chunkIndex, RACE_CHUNK_SIZE), RACE_CHUNK_SIZE],
  );
  return races.map((r) => ({
    loc: `${SITE}${raceDetailPath(r.race_date, r.meet, r.race_no)}`,
    // races 에 updated_at 이 없어 경주일을 lastmod 로 사용 (결과는 immutable).
    lastmod: r.race_date,
    changefreq: "monthly" as const,
    priority: 0.6,
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
      ...(u.lastmod ? [`<lastmod>${u.lastmod}</lastmod>`] : []),
      `<changefreq>${u.changefreq}</changefreq>`,
      `<priority>${u.priority}</priority>`,
      `</url>`,
    );
  }
  parts.push(`</urlset>`);
  return parts.join("\n");
}
