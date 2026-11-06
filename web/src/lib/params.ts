// URL 파라미터(path segment · searchParams) → 숫자 검증.
// 원본 문자열을 그대로 SQL 파라미터로 넘기면 int/bigint 캐스팅 실패로 500 이 난다.

type RawParam = string | string[] | undefined;

/**
 * 양의 정수(1 이상, max 이하)만 통과, 아니면 null.
 * 0 패딩("007")·부호·소수·지수·공백은 거부 — canonical URL 을 하나로 유지.
 * 배열(?id=1&id=2)이면 첫 값만 본다.
 */
export function parsePositiveInt(
  raw: RawParam,
  max: number = Number.MAX_SAFE_INTEGER,
): number | null {
  const s = Array.isArray(raw) ? raw[0] : raw;
  if (typeof s !== "string" || !/^[1-9]\d{0,15}$/.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) && n <= max ? n : null;
}
