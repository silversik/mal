import type { Metadata } from "next";
import { Geist_Mono, Playfair_Display, Noto_Serif_KR } from "next/font/google";
import Script from "next/script";
import { GoogleAnalytics } from "@next/third-parties/google";
import { Toaster } from "sonner";
import { Navbar } from "@/components/navbar";
import { FloatingChat } from "@/components/floating-chat";
import { MobileBottomNav } from "@/components/mobile-bottom-nav";
import { HorseMarkSymbolDefs } from "@/components/brand/logo";
import { SiteJsonLd } from "@/components/seo/site-jsonld";
import "./globals.css";

const geistMono = Geist_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
});

const playfair = Playfair_Display({
  variable: "--font-serif",
  subsets: ["latin"],
});

const notoSerif = Noto_Serif_KR({
  variable: "--font-serif-kr",
  subsets: ["latin"],
  weight: ["400", "700"],
});

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
      className={`${geistMono.variable} ${playfair.variable} ${notoSerif.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <SiteJsonLd />
        <HorseMarkSymbolDefs />
        <Navbar />
        <main className="flex-1 pb-16 md:pb-0">
          {children}
        </main>
        <MobileBottomNav />
        <FloatingChat />
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

