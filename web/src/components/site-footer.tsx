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
    </footer>
  );
}
