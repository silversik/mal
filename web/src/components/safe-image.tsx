"use client";

import { useState, type ImgHTMLAttributes } from "react";

/**
 * <img> 래퍼 — 로딩 실패시 자체적으로 숨겨진다.
 * wrapper로 감싼 구조가 아니므로, 부모가 `img:only-child` 가정을 하지 않도록 주의.
 */
export function SafeImage(props: ImgHTMLAttributes<HTMLImageElement>) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  // eslint-disable-next-line @next/next/no-img-element
  return <img alt="" {...props} onError={() => setFailed(true)} />;
}
