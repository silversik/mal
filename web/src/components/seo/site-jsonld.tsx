// 루트 layout 에 1회 삽입.  Organization + WebSite (potentialAction 으로
// Google 사이트링크 검색 박스) JSON-LD.
const SITE = "https://mal.kr";

const ORG = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "mal.kr",
  url: SITE,
  logo: `${SITE}/icon.svg`,
};

const WEBSITE = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: "mal.kr",
  url: SITE,
  inLanguage: "ko-KR",
  potentialAction: {
    "@type": "SearchAction",
    target: `${SITE}/horses?q={search_term_string}`,
    "query-input": "required name=search_term_string",
  },
};

export function SiteJsonLd() {
  return (
    <script
      type="application/ld+json"
      // Schema.org 권장: 객체 배열을 한 번에 dump.
      dangerouslySetInnerHTML={{ __html: JSON.stringify([ORG, WEBSITE]) }}
    />
  );
}
