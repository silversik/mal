import type { Metadata } from "next";
import { Geist_Mono, Playfair_Display, Noto_Serif_KR } from "next/font/google";
import Script from "next/script";
import { GoogleAnalytics } from "@next/third-parties/google";
import { Toaster } from "sonner";
import { Navbar } from "@/components/navbar";
import { FloatingChat } from "@/components/floating-chat";
import { MobileBottomNav } from "@/components/mobile-bottom-nav";
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
  title: "mal.kr — 경마 데이터 아카이브",
  description: "한국마사회 공공데이터 기반 경마 데이터 시각화 서비스",
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

