"use client";

import { useEffect, useRef } from "react";

const ADSENSE_CLIENT = "ca-pub-7113131922880460";

type AdSenseSlotProps = {
  slot: string;
  format?: string;
  responsive?: boolean;
  className?: string;
  style?: React.CSSProperties;
};

declare global {
  interface Window {
    adsbygoogle?: unknown[];
  }
}

// AdSense 광고 단위. SPA 라우팅 후에도 채워지도록 useEffect 에서 adsbygoogle.push.
export function AdSenseSlot({
  slot,
  format = "auto",
  responsive = true,
  className,
  style,
}: AdSenseSlotProps) {
  const pushed = useRef(false);

  useEffect(() => {
    if (pushed.current) return;
    try {
      (window.adsbygoogle = window.adsbygoogle ?? []).push({});
      pushed.current = true;
    } catch {
      // adsbygoogle.js 가 아직 로드되지 않았거나 차단된 경우 — 다음 렌더에 재시도
    }
  }, []);

  return (
    <ins
      className={`adsbygoogle ${className ?? ""}`}
      style={{ display: "block", ...style }}
      data-ad-client={ADSENSE_CLIENT}
      data-ad-slot={slot}
      data-ad-format={format}
      data-full-width-responsive={responsive ? "true" : "false"}
    />
  );
}
