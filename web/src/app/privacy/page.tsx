import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "개인정보처리방침",
  description:
    "mal.kr의 개인정보처리방침입니다. 수집하는 정보, 이용 목적, 제3자 제공 현황을 안내합니다.",
  alternates: { canonical: "/privacy" },
};

const EFFECTIVE_DATE = "2024년 1월 1일";
const UPDATED_DATE = "2026년 5월 1일";
const CONTACT_EMAIL = "s@typer.kr";

export default function PrivacyPage() {
  return (
    <div className="max-w-2xl mx-auto px-4 py-10 space-y-8">
      <header>
        <h1 className="text-xl font-bold tracking-tight">개인정보처리방침</h1>
        <p className="mt-2 text-xs text-muted-foreground">
          최초 시행: {EFFECTIVE_DATE} · 최종 수정: {UPDATED_DATE}
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-base font-semibold">1. 수집하는 개인정보</h2>
        <p className="text-sm leading-relaxed text-foreground/90">
          mal.kr은 다음과 같은 정보를 수집할 수 있습니다.
        </p>
        <ul className="text-sm leading-relaxed text-foreground/90 space-y-2 list-disc list-inside">
          <li>
            <strong>카카오 로그인 시</strong>: 카카오 계정에서 제공하는 식별자(ID), 닉네임, 프로필
            이미지. 이메일 주소는 수집하지 않습니다.
          </li>
          <li>
            <strong>서비스 이용 시</strong>: 접속 일시, IP 주소, 브라우저 종류, 방문 페이지 등
            서버 로그 정보 (Google Analytics를 통해 익명 집계).
          </li>
          <li>
            <strong>모의배팅 이용 시</strong>: 베팅 선택 기록, 누적 포인트 등 서비스 내
            시뮬레이션 데이터.
          </li>
          <li>
            <strong>댓글 작성 시</strong>: 카카오 계정 닉네임, 작성 내용, 작성 일시.
          </li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold">2. 수집 목적</h2>
        <ul className="text-sm leading-relaxed text-foreground/90 space-y-1 list-disc list-inside">
          <li>로그인 인증 및 회원 식별</li>
          <li>모의배팅 기록 저장 및 통계 제공</li>
          <li>댓글 서비스 운영</li>
          <li>서비스 품질 개선 및 이용 통계 분석</li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold">3. 보유 및 이용 기간</h2>
        <p className="text-sm leading-relaxed text-foreground/90">
          개인정보는 회원 탈퇴 시 또는 수집·이용 목적이 달성된 후 지체 없이 파기합니다. 단,
          관련 법령에 따라 보관이 필요한 경우 해당 기간 동안 보관 후 파기합니다.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold">4. 제3자 제공 및 위탁</h2>
        <p className="text-sm leading-relaxed text-foreground/90">
          mal.kr은 원칙적으로 수집한 개인정보를 제3자에게 제공하지 않습니다. 다만, 서비스 운영을
          위해 아래 제3자 도구를 사용합니다.
        </p>
        <ul className="text-sm leading-relaxed text-foreground/90 space-y-2 list-disc list-inside">
          <li>
            <strong>Google Analytics</strong>: 익명화된 이용 통계 수집. Google LLC에 데이터가
            전송됩니다.{" "}
            <a
              href="https://policies.google.com/privacy"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline underline-offset-2 hover:opacity-80"
            >
              Google 개인정보처리방침
            </a>
          </li>
          <li>
            <strong>Google AdSense</strong>: 맞춤형 광고 제공을 위해 쿠키를 사용합니다. 광고
            맞춤화를 원하지 않을 경우{" "}
            <a
              href="https://www.google.com/settings/ads"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline underline-offset-2 hover:opacity-80"
            >
              Google 광고 설정
            </a>
            에서 조정할 수 있습니다.
          </li>
          <li>
            <strong>Kakao OAuth</strong>: 소셜 로그인을 위해 카카오 서버와 통신합니다.{" "}
            <a
              href="https://www.kakao.com/policy/privacy"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline underline-offset-2 hover:opacity-80"
            >
              카카오 개인정보처리방침
            </a>
          </li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold">5. 쿠키 및 유사 기술</h2>
        <p className="text-sm leading-relaxed text-foreground/90">
          mal.kr은 로그인 세션 유지, 서비스 이용 통계 수집, 맞춤형 광고 제공을 위해 쿠키를
          사용합니다. 브라우저 설정에서 쿠키를 비활성화할 수 있으나, 일부 서비스 기능이 제한될 수
          있습니다.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold">6. 정보주체의 권리</h2>
        <p className="text-sm leading-relaxed text-foreground/90">
          이용자는 언제든지 자신의 개인정보에 대한 열람, 수정, 삭제, 처리 정지를 요청할 수
          있습니다. 요청은 아래 연락처로 문의해 주세요.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold">7. 개인정보 보호 책임자</h2>
        <p className="text-sm leading-relaxed text-foreground/90">
          개인정보 관련 문의는{" "}
          <a
            href={`mailto:${CONTACT_EMAIL}`}
            className="text-primary underline underline-offset-2 hover:opacity-80"
          >
            {CONTACT_EMAIL}
          </a>
          으로 연락 주시기 바랍니다.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold">8. 방침 변경</h2>
        <p className="text-sm leading-relaxed text-foreground/90">
          본 방침은 법령·서비스 변경에 따라 수정될 수 있습니다. 변경 시 이 페이지에
          게시합니다.
        </p>
      </section>
    </div>
  );
}
