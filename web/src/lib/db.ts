import { Pool } from "pg";

declare global {
  // eslint-disable-next-line no-var
  var __mal_pgPool: Pool | undefined;
}

function makePool(): Pool {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set (see web/.env.local)");
  }
  return new Pool({
    connectionString: url,
    max: 5,
    idleTimeoutMillis: 30_000,
  });
}

// Lazy 초기화 — 모듈 import 만으로 pool 을 만들지 않아 단위테스트에서 DB
// 의존성을 회피한다. 첫 query() 호출 시점에 비로소 connection 시도.
export function getPool(): Pool {
  if (!global.__mal_pgPool) global.__mal_pgPool = makePool();
  return global.__mal_pgPool;
}

// 호환용 — 기존 코드가 `import { pool }` 으로 직접 참조. getPool() 로 단순 위임.
export const pool: Pool = new Proxy({} as Pool, {
  get(_t, prop) {
    const target = getPool() as unknown as Record<PropertyKey, unknown>;
    const v = target[prop];
    return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(target) : v;
  },
});

export async function query<T = unknown>(
  text: string,
  params?: unknown[],
): Promise<T[]> {
  const res = await getPool().query(text, params as never[]);
  return res.rows as T[];
}
