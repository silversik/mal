import { getSitemapChunkCount, SITE, escapeXml } from "@/lib/sitemap-shared";

// build 단계는 placeholder DATABASE_URL 이라 DB 접근이 막혀 prerender 가 실패한다.
// 요청 시점에만 DB 를 친다.
export const dynamic = "force-dynamic";

/**
 * /sitemap.xml — sitemap index.
 *   /sitemap/0.xml   (정적 + jockey/trainer/owner/post)
 *   /sitemap/1..N.xml (마필 chunk)
 *
 * Next.js 의 sitemap.ts(MetadataRoute) convention 은 generateSitemaps 를 쓰면
 * sub-sitemap 만 노출하고 root index 는 만들어주지 않아서 /sitemap.xml 이 404
 * 였다. 직접 route handler 로 작성해 index 응답을 보장한다.
 */
export async function GET() {
  const horseChunks = await getSitemapChunkCount();
  const lastmod = new Date().toISOString();
  const ids = [0, ...Array.from({ length: horseChunks }, (_, i) => i + 1)];

  const parts: string[] = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
  ];
  for (const id of ids) {
    parts.push(
      `<sitemap>`,
      `<loc>${escapeXml(`${SITE}/sitemap/${id}.xml`)}</loc>`,
      `<lastmod>${lastmod}</lastmod>`,
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
