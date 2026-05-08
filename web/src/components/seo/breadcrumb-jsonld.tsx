// Google 검색결과의 빵부스러기(breadcrumb) 표시용 JSON-LD.
// 상세 페이지에서 호출: <BreadcrumbJsonLd items={[{name:"홈",url:"/"},{name:"마필",url:"/horses"},{name:horse.horse_name,url:`/horse/${no}`}]} />.
const SITE = "https://mal.kr";

export type BreadcrumbItem = { name: string; url: string };

export function BreadcrumbJsonLd({ items }: { items: BreadcrumbItem[] }) {
  const data = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: it.name,
      item: it.url.startsWith("http") ? it.url : `${SITE}${it.url}`,
    })),
  };
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}
