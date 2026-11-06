import { escapeXml, getSitemapIndexEntries, SITE } from "@/lib/sitemap-shared";

// build 단계는 placeholder DATABASE_URL 이라 DB 접근이 막혀 prerender 가 실패한다.
// 요청 시점에만 DB 를 친다.
export const dynamic = "force-dynamic";

/**
 * /sitemap.xml — sitemap index.
 *   /sitemap/0.xml        (정적 + jockey/trainer/owner/post)
 *   /sitemap/1..N.xml     (마필 chunk)
 *   /sitemap/races-K.xml  (경주 상세 chunk)
 *
 * Next.js 의 sitemap.ts(MetadataRoute) convention 은 generateSitemaps 를 쓰면
 * sub-sitemap 만 노출하고 root index 는 만들어주지 않아서 /sitemap.xml 이 404
 * 였다. 직접 route handler 로 작성해 index 응답을 보장한다.
 *
 * lastmod 는 chunk 내 데이터 기준(마필 updated_at 최대값 · 경주일 최대값).
 * 정적 chunk 는 lastmod 생략 — 매 요청 "now" 는 잘못된 신호.
 */
export async function GET() {
  const entries = await getSitemapIndexEntries();

  const parts: string[] = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
  ];
  for (const e of entries) {
    parts.push(
      `<sitemap>`,
      `<loc>${escapeXml(`${SITE}/sitemap/${e.id}.xml`)}</loc>`,
      ...(e.lastmod ? [`<lastmod>${e.lastmod}</lastmod>`] : []),
      `</sitemap>`,
    );
  }
  parts.push(`</sitemapindex>`);

  return new Response(parts.join("\n"), {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=0, must-revalidate",
    },
  });
}
