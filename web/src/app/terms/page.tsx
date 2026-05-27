import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "이용약관",
  description:
    "mal.kr 이용약관입니다. 서비스 이용 규칙, 데이터 출처, 모의배팅 면책 사항을 확인하세요.",
  alternates: { canonical: "/terms" },
};

const EFFECTIVE_DATE = "2024년 1월 1일";
const UPDATED_DATE = "2026년 5월 1일";
const CONTACT_EMAIL = "s@typer.kr";

export default function TermsPage() {
  return (
    <div className="max-w-2xl mx-auto px-4 py-10 space-y-8">
      <header>
        <h1 className="text-xl font-bold tracking-tight">이용약관</h1>
        <p className="mt-2 text-xs text-muted-foreground">
          최초 시행: {EFFECTIVE_DATE} · 최종 수정: {UPDATED_DATE}
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-base font-semibold">제1조 (목적)</h2>
        <p className="text-sm leading-relaxed text-foreground/90">
          이 약관은 mal.kr(이하 "서비스")이 제공하는 경마 데이터 아카이빙·분석 및 비현금성
          모의배팅 서비스의 이용 조건과 절차, 운영자와 이용자의 권리·의무를 규정함을 목적으로
          합니다.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold">제2조 (서비스 내용)</h2>
        <p className="text-sm leading-relaxed text-foreground/90">
          서비스는 한국마사회(KRA) 공공데이터를 기반으로 다음을 제공합니다.
        </p>
        <ul className="text-sm leading-relaxed text-foreground/90 space-y-1 list-disc list-inside">
          <li>마필·기수·조교사·마주의 경주 성적 및 통계 데이터 조회</li>
          <li>경주 결과, 배당 정보, 혈통 정보 아카이빙</li>
          <li>랭킹, 코스 레코드, 마필 비교 등 분석 도구</li>
          <li>카카오 로그인 기반 비현금성 모의배팅 시뮬레이션</li>
          <li>경마 관련 뉴스·영상 피드</li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold">제3조 (회원가입 및 자격)</h2>
        <p className="text-sm leading-relaxed text-foreground/90">
          회원가입은 카카오 계정을 통한 소셜 로그인으로 이루어집니다. 만 14세 미만은 서비스
          이용이 제한될 수 있습니다. 이용자는 타인의 정보를 도용하거나 허위 정보를 제공해서는
          안 됩니다.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold">제4조 (모의배팅 면책)</h2>
        <p className="text-sm leading-relaxed text-foreground/90">
          서비스의 모의배팅 기능은 순수 시뮬레이션으로, 실제 현금·포인트·경품 등 어떠한 실물
          가치 거래도 수반하지 않습니다. 서비스 내 적립·차감되는 포인트는 현금으로 환전하거나
          외부에서 사용할 수 없습니다. 모의배팅 결과는 실제 경마 결과를 보장하거나 예측하지
          않습니다. 실제 경마 베팅은 한국마사회 공식 채널을 이용하시기 바랍니다.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold">제5조 (데이터 출처 및 정확성)</h2>
        <p className="text-sm leading-relaxed text-foreground/90">
          서비스가 제공하는 경마 데이터는 한국마사회(KRA) OpenAPI 및 공공데이터포털을 통해
          수집됩니다. 서비스는 데이터의 정확성을 위해 최선을 다하나, 데이터 수집 지연·오류·
          누락에 대한 책임을 지지 않습니다. 경주 결과의 공식 기록은 한국마사회 공식 발표를
          우선합니다. 본 서비스는 한국마사회와 공식 제휴 관계에 있지 않습니다.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold">제6조 (이용자 의무)</h2>
        <ul className="text-sm leading-relaxed text-foreground/90 space-y-1 list-disc list-inside">
          <li>서비스를 상업적 목적으로 크롤링하거나 대량 수집하는 행위 금지</li>
          <li>타 이용자를 비방하거나 욕설을 포함한 댓글 작성 금지</li>
          <li>허위 정보 유포 또는 서비스 운영을 방해하는 행위 금지</li>
          <li>관련 법령을 준수하여 서비스를 이용</li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold">제7조 (서비스 변경 및 중단)</h2>
        <p className="text-sm leading-relaxed text-foreground/90">
          운영자는 서비스 내용을 변경하거나 중단할 수 있으며, 이로 인한 손해에 대해 책임지지
          않습니다. 중요한 변경 사항은 서비스 내 공지를 통해 안내합니다.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold">제8조 (면책 조항)</h2>
        <p className="text-sm leading-relaxed text-foreground/90">
          서비스는 천재지변, 통신 장애, 제3자의 귀책 사유 등 불가항력으로 인한 서비스 장애에
          대해 책임을 지지 않습니다. 이용자가 서비스를 통해 얻은 정보를 이용하여 발생한 손해에
          대해 운영자는 책임을 지지 않습니다.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold">제9조 (준거법 및 분쟁 해결)</h2>
        <p className="text-sm leading-relaxed text-foreground/90">
          이 약관은 대한민국 법률에 따르며, 분쟁 발생 시 운영자 소재지를 관할하는 법원을
          전속 관할 법원으로 합니다. 문의:{" "}
          <a
            href={`mailto:${CONTACT_EMAIL}`}
            className="text-primary underline underline-offset-2 hover:opacity-80"
          >
            {CONTACT_EMAIL}
          </a>
        </p>
      </section>
    </div>
  );
}
