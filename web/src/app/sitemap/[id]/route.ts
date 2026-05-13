import {
  buildHorseChunk,
  buildStaticAndSmallChunk,
  renderUrlSet,
} from "@/lib/sitemap-shared";

export const dynamic = "force-dynamic";

/**
 * /sitemap/[id].xml — 개별 sub-sitemap.
 *   id=0       정적 + 소규모 엔티티
 *   id=1..N    마필 chunk
 *
 * Next.js 의 dynamic segment 는 `0.xml`·`1.xml` 처럼 확장자를 포함한
 * 단일 segment 로 들어온다. 끝 `.xml` 을 떼고 number 로 변환.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: rawId } = await params;
  const idStr = rawId.replace(/\.xml$/, "");
  const id = Number(idStr);
  if (!Number.isInteger(id) || id < 0) {
    return new Response("Not Found", { status: 404 });
  }

  const urls =
    id === 0 ? await buildStaticAndSmallChunk() : await buildHorseChunk(id - 1);

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
