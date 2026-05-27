import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "서비스 소개",
  description:
    "mal.kr은 한국마사회(KRA) 공공데이터를 기반으로 경마 데이터를 아카이빙하고 분석하는 서비스입니다.",
  alternates: { canonical: "/about" },
};

export default function AboutPage() {
  return (
    <div className="max-w-2xl mx-auto px-4 py-10 space-y-8">
      <header>
        <h1 className="text-xl font-bold tracking-tight">서비스 소개</h1>
        <p className="mt-2 text-sm text-muted-foreground">mal.kr에 대해 알아보세요.</p>
      </header>

      <section className="space-y-3">
        <h2 className="text-base font-semibold">mal.kr이란?</h2>
        <p className="text-sm leading-relaxed text-foreground/90">
          mal.kr은 한국마사회(KRA)가 공공데이터포털(data.go.kr)을 통해 제공하는 경마 공공데이터를
          기반으로 마필·기수·조교사·마주의 성적과 혈통 정보를 체계적으로 아카이빙하고 분석하는
          서비스입니다. 서울·부산경남·제주 세 경마장의 경주 결과를 매일 수집하여 누구나 무료로
          조회할 수 있도록 제공합니다.
        </p>
        <p className="text-sm leading-relaxed text-foreground/90">
          단순한 데이터 나열을 넘어 마필 레이팅 추이, 기수-조교사 콤비 성적, 코스별 레코드 비교 등
          데이터 기반 인사이트를 시각화하여 경마 팬과 데이터 분석가 모두에게 유용한 레퍼런스를
          지향합니다.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold">주요 기능</h2>
        <ul className="text-sm leading-relaxed text-foreground/90 space-y-2 list-disc list-inside">
          <li>
            <strong>경주 결과 조회</strong> — 일자·경마장별 출전마, 기수, 조교사, 배당 정보를
            한 화면에서 확인
          </li>
          <li>
            <strong>마필 데이터베이스</strong> — 국내외 혈통, 통산 성적, 레이팅 추이, 영상
            기록을 마필별로 조회
          </li>
          <li>
            <strong>기수·조교사·마주 프로필</strong> — 승률·복승률·월별 성적 등 상세 통계
          </li>
          <li>
            <strong>분석 도구</strong> — 랭킹, 코스 레코드, 마필 비교 기능으로 데이터를 입체적으로 탐색
          </li>
          <li>
            <strong>비현금성 모의배팅</strong> — 카카오 로그인 후 실제 배당을 기반으로 한 시뮬레이션
            베팅(현금·포인트 거래 없음)
          </li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold">데이터 출처</h2>
        <p className="text-sm leading-relaxed text-foreground/90">
          경마 데이터는 한국마사회(KRA) OpenAPI 및 공공데이터포털(data.go.kr)에서 제공하는
          공공데이터를 수집·가공합니다. 기상 데이터는 기상청 ASOS를, 뉴스·영상은 네이버 검색 API 및
          YouTube Data API v3를 활용합니다. 수집된 데이터는 원천 제공기관의 이용조건에 따라
          비영리적 아카이빙·분석 목적으로만 사용됩니다.
        </p>
        <p className="text-sm leading-relaxed text-foreground/90">
          경주 결과는 KRA 공식 발표 이후 자동으로 수집되며, 실수 정정이 발생할 경우 별도
          corrections 기록을 통해 원본 데이터를 유지합니다. 경주 결과의 최종적인 공식 기록은
          한국마사회 공식 사이트를 우선 참고하시기 바랍니다.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold">면책 안내</h2>
        <p className="text-sm leading-relaxed text-foreground/90">
          mal.kr은 한국마사회(KRA)와 공식적인 제휴 관계에 있지 않습니다. 본 서비스는 공공데이터를
          활용한 독립적인 정보 제공 플랫폼입니다. 제공되는 데이터의 정확성에 최선을 다하나,
          데이터 오류·지연 등으로 인한 손해에 대해 책임지지 않습니다. 실제 경마 베팅은 한국마사회
          공식 채널을 이용하시기 바랍니다. 본 서비스의 모의배팅 기능은 어떠한 현금 또는 실물
          가치 거래도 수반하지 않는 순수 시뮬레이션입니다.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold">운영</h2>
        <p className="text-sm leading-relaxed text-foreground/90">
          mal.kr은 개인 개발자에 의해 운영됩니다. 서비스에 관한 문의는{" "}
          <a href="/contact" className="text-primary underline underline-offset-2 hover:opacity-80">
            문의 페이지
          </a>
          를 통해 주시기 바랍니다.
        </p>
      </section>
    </div>
  );
}
