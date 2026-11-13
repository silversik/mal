import type { Metadata } from "next";
import { Geist_Mono } from "next/font/google";
import Script from "next/script";
import { GoogleAnalytics } from "@next/third-parties/google";
import { Toaster } from "sonner";
import { Navbar } from "@/components/navbar";
import { MobileBottomNav } from "@/components/mobile-bottom-nav";
import { SiteFooter } from "@/components/site-footer";
import { HorseMarkSymbolDefs } from "@/components/brand/logo";
import { SiteJsonLd } from "@/components/seo/site-jsonld";
import "./globals.css";

const geistMono = Geist_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
});

// Playfair Display · Noto Serif KR 은 다운로드만 되고 어디서도 쓰이지 않아 제거(2026-11) —
// 디스플레이·본문 모두 Wanted Sans(globals.css @theme --font-sans/--font-serif).

export const metadata: Metadata = {
  metadataBase: new URL("https://mal.kr"),
  title: {
    default: "mal.kr — 경마 데이터 아카이브",
    template: "%s · mal.kr",
  },
  description:
    "한국마사회(KRA) 공공데이터 기반 경마 데이터 아카이브 — 마필·기수·조교사 통계, 경주 결과, 혈통 검색을 한 곳에서.",
  keywords: [
    "경마",
    "한국마사회",
    "KRA",
    "마필",
    "기수",
    "조교사",
    "경주 결과",
    "혈통",
    "mal.kr",
  ],
  applicationName: "mal.kr",
  authors: [{ name: "mal.kr" }],
  creator: "mal.kr",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    locale: "ko_KR",
    url: "https://mal.kr",
    siteName: "mal.kr",
    title: "mal.kr — 경마 데이터 아카이브",
    description: "한국마사회 공공데이터 기반 경마 데이터 시각화 서비스",
  },
  twitter: {
    card: "summary_large_image",
    title: "mal.kr — 경마 데이터 아카이브",
    description: "한국마사회 공공데이터 기반 경마 데이터 시각화 서비스",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  other: { "google-adsense-account": "ca-pub-7113131922880460" },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ko"
      suppressHydrationWarning
      className={`${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        {/* Synchronous inline script (NOT next/script) so it runs before first
            paint — sets theme/scale from cookie to avoid FOUC. beforeInteractive
            only guarantees pre-hydration, not pre-paint. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var c=document.cookie;function g(k){var m=c.match(new RegExp('(?:^|; )'+k+'=([^;]*)'));return m?decodeURIComponent(m[1]):null;}var t=g('mal-theme')||'auto';var s=g('mal-scale')||'md';if(['auto','light','dark'].indexOf(t)<0)t='auto';if(['md','lg'].indexOf(s)<0)s='md';var d=document.documentElement;d.setAttribute('data-theme',t);d.setAttribute('data-scale',s);var mq=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)');function res(){var ct=d.getAttribute('data-theme');return ct==='dark'||(ct==='auto'&&mq&&mq.matches);}function ap(){d.classList.toggle('dark',res());}ap();if(mq){(mq.addEventListener?mq.addEventListener('change',ap):mq.addListener(ap));}}catch(e){}})();`,
          }}
        />
        <SiteJsonLd />
        <HorseMarkSymbolDefs />
        <Navbar />
        <main className="flex-1">
          {children}
        </main>
        <SiteFooter />
        {/* 모바일 하단 고정 네비(h-16) 높이만큼 문서 끝에 여백 — main 이 아니라 footer 뒤에 둬야
            footer(저작권·출처)가 네비에 가리지 않는다. 홈 인디케이터 safe-area 포함. */}
        <div aria-hidden="true" className="h-[calc(4rem+env(safe-area-inset-bottom))] md:hidden" />
        <MobileBottomNav />
        <Toaster position="top-center" richColors />
      </body>
      <GoogleAnalytics gaId="G-N9EQPNFPR7" />
      <Script
        id="google-adsense"
        async
        strategy="afterInteractive"
        src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-7113131922880460"
        crossOrigin="anonymous"
      />
    </html>
  );
}

