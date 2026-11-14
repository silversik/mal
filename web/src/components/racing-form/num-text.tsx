import { Fragment } from "react";

/** 숫자 토큰 — 정수 · 분수(3/12) · 소수(52.5) · 시각(14:30) · 끝의 % */
const NUM_TOKEN = /(\d+(?:[./:]\d+)*%?)/;

/**
 * 문장 안 숫자만 Geist Mono + tabular-nums 로 (DESIGN.md "Data/Numbers — 기록·순위·퍼센트 전부").
 * 결산 한 줄·출전마 카드 문장처럼 글자와 숫자가 섞인 평문에 쓴다 — 글자는 본문 글꼴 그대로.
 * "주목마 9경주 중 1착 3/9" → 9 · 3/9 만 mono.
 */
export function NumText({ text }: { text: string }) {
  return (
    <>
      {text.split(NUM_TOKEN).map((part, i) =>
        i % 2 === 1 ? (
          <span key={i} className="font-mono tabular-nums">
            {part}
          </span>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  );
}
