import {
  buildHorseChunk,
  buildRaceChunk,
  buildStaticAndSmallChunk,
  parseSitemapId,
  renderUrlSet,
  type SitemapUrl,
} from "@/lib/sitemap-shared";

export const dynamic = "force-dynamic";

/**
 * /sitemap/[id].xml — 개별 sub-sitemap.
 *   id=0        정적 + 소규모 엔티티
 *   id=1..N     마필 chunk
 *   id=races-K  경주 상세 chunk
 *
 * Next.js 의 dynamic segment 는 `0.xml`·`races-0.xml` 처럼 확장자를 포함한
 * 단일 segment 로 들어온다. parseSitemapId 가 `.xml` 을 떼고 해석.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: rawId } = await params;
  const chunk = parseSitemapId(rawId);
  if (!chunk) {
    return new Response("Not Found", { status: 404 });
  }

  let urls: SitemapUrl[];
  if (chunk.kind === "static") urls = await buildStaticAndSmallChunk();
  else if (chunk.kind === "horse") urls = await buildHorseChunk(chunk.index);
  else urls = await buildRaceChunk(chunk.index);

  if (urls.length === 0) {
    return new Response("Not Found", { status: 404 });
  }

  return new Response(renderUrlSet(urls), {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=0, must-revalidate",
    },
  });
}
