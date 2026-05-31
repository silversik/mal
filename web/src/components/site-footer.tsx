import Link from "next/link";

const LINKS = [
  { href: "/about", label: "서비스 소개" },
  { href: "/privacy", label: "개인정보처리방침" },
  { href: "/terms", label: "이용약관" },
  { href: "/contact", label: "문의" },
];

export function SiteFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="border-t border-border bg-background py-6 px-4 text-xs text-muted-foreground">
      <div className="mx-auto max-w-[1080px] flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <nav className="flex flex-wrap gap-x-4 gap-y-1" aria-label="푸터 내비게이션">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="hover:text-foreground transition-colors"
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="flex flex-col gap-0.5 sm:text-right">
          <span>© 2024–{year} mal.kr</span>
          <span>경마 데이터: 한국마사회(KRA) 공공데이터포털</span>
        </div>
      </div>
      <div className="mx-auto mt-4 max-w-[1080px] border-t border-border pt-3 text-[11px] leading-relaxed text-muted-foreground">
        본 서비스의 베팅 기능은 실제 현금이 오가지 않는 <strong className="font-semibold text-foreground">비현금성 모의 시뮬레이션</strong>입니다.
        실제 마권 구매·환급과 무관하며, 어떠한 금전적 수익도 발생하지 않습니다.
      </div>
    </footer>
  );
}
