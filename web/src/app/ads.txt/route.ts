// AdSense 사이트 소유권 확인용 ads.txt.
// 게시자 ID 는 GA gaId 처럼 하드코딩 — layout.tsx 의 adsbygoogle.js src 와 동일 ID.
const ADS_TXT = "google.com, pub-7113131922880460, DIRECT, f08c47fec0942fa0\n";

export function GET(): Response {
  return new Response(ADS_TXT, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
