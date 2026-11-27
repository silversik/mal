"use client";

import { useEffect } from "react";

/**
 * 주소의 #앵커가 접힌 <details> 를 가리키면 펼친다 (경주면 출전마 아코디언).
 * 1면의 "새로운 소식"·주목마 상자에서 #chul-3 으로 들어오면 그 말의 카드가 열린 채로 보이게.
 * 그리는 것은 없다.
 */
export function OpenOnHash() {
  useEffect(() => {
    const open = () => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      if (!id) return;
      const el = document.getElementById(id);
      if (el instanceof HTMLDetailsElement && !el.open) {
        el.open = true;
        el.scrollIntoView({ block: "start" });
      }
    };
    open();
    window.addEventListener("hashchange", open);
    return () => window.removeEventListener("hashchange", open);
  }, []);
  return null;
}
