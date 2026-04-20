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

// Reuse a single pool across hot-reloads in dev.
export const pool: Pool = global.__mal_pgPool ?? makePool();
if (process.env.NODE_ENV !== "production") {
  global.__mal_pgPool = pool;
}

export async function query<T = unknown>(
  text: string,
  params?: unknown[],
): Promise<T[]> {
  const res = await pool.query(text, params as never[]);
  return res.rows as T[];
}
