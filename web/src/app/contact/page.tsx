import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "문의",
  description: "mal.kr 서비스 관련 문의는 이메일로 연락해 주세요.",
  alternates: { canonical: "/contact" },
};

const CONTACT_EMAIL = "s@typer.kr";

export default function ContactPage() {
  return (
    <div className="max-w-2xl mx-auto px-4 py-10 space-y-8">
      <header>
        <h1 className="text-xl font-bold tracking-tight">문의</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          서비스 관련 문의, 데이터 오류 신고, 제안 사항을 보내주세요.
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-base font-semibold">이메일 문의</h2>
        <p className="text-sm leading-relaxed text-foreground/90">
          아래 이메일로 문의해 주시면 영업일 기준 3일 이내 답변 드립니다.
        </p>
        <a
          href={`mailto:${CONTACT_EMAIL}`}
          className="inline-flex items-center gap-2 rounded-[10px] border border-border bg-card px-4 py-3 text-sm font-semibold transition hover:border-primary/40 hover:text-primary"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            aria-hidden="true"
          >
            <rect x="2" y="4" width="20" height="16" rx="2" />
            <polyline points="2,4 12,14 22,4" />
          </svg>
          {CONTACT_EMAIL}
        </a>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold">문의 유형별 안내</h2>
        <ul className="text-sm leading-relaxed text-foreground/90 space-y-2 list-disc list-inside">
          <li>
            <strong>데이터 오류 신고</strong>: 경주 결과, 마필·기수·조교사 정보의 오류를 발견하신
            경우 페이지 URL과 함께 알려주세요.
          </li>
          <li>
            <strong>기능 제안</strong>: 새로운 기능이나 분석 지표에 대한 제안을 환영합니다.
          </li>
          <li>
            <strong>개인정보 관련</strong>: 개인정보 열람·삭제 요청은{" "}
            <a href="/privacy" className="text-primary underline underline-offset-2 hover:opacity-80">
              개인정보처리방침
            </a>
            을 참고해 주세요.
          </li>
          <li>
            <strong>광고·제휴 문의</strong>: 서비스 관련 제휴·광고 문의도 이메일로 해주세요.
          </li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold">답변이 늦어질 경우</h2>
        <p className="text-sm leading-relaxed text-foreground/90">
          문의량이 많거나 공휴일 연휴 기간에는 답변이 늦어질 수 있습니다. 스팸 필터로 인해
          메일이 차단될 수 있으니, 제목에 "mal.kr 문의"를 포함해 보내주시면 빠르게 확인
          가능합니다.
        </p>
      </section>
    </div>
  );
}
