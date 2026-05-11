import { query } from "./db";

export type Owner = {
  ow_no: string;
  ow_name: string;
  ow_name_en: string | null;
  meet: string | null;
  reg_date: string | null;
  total_race_count: number;
  first_place_count: number;
  second_place_count: number;
  third_place_count: number;
  win_rate: string | null;
};

export type OwnerHorse = {
  horse_no: string;
  horse_name: string;
  sex: string | null;
  birth_date: string | null;
  total_race_count: number;
  first_place_count: number;
};

const OWNER_COLUMNS = `
  ow_no, ow_name, ow_name_en, meet,
  to_char(reg_date, 'YYYY-MM-DD') AS reg_date,
  total_race_count, first_place_count, second_place_count,
  third_place_count, win_rate::text
`;

export async function getOwnerByNo(owNo: string): Promise<Owner | null> {
  const rows = await query<Owner>(
    `SELECT ${OWNER_COLUMNS} FROM owners WHERE ow_no = $1`,
    [owNo],
  );
  return rows[0] ?? null;
}

export async function getAllOwners(limit = 100): Promise<Owner[]> {
  return query<Owner>(
    `SELECT ${OWNER_COLUMNS}
       FROM owners
      ORDER BY first_place_count DESC, total_race_count DESC
      LIMIT $1`,
    [limit],
  );
}

export async function getOwnerCount(): Promise<number> {
  const rows = await query<{ c: string }>(`SELECT count(*)::text AS c FROM owners`);
  return Number(rows[0]?.c ?? 0);
}

export async function searchOwnersByName(name: string, limit = 20): Promise<Owner[]> {
  if (!name.trim()) return [];
  return query<Owner>(
    `SELECT ${OWNER_COLUMNS}
       FROM owners
      WHERE ow_name ILIKE $1
      ORDER BY total_race_count DESC
      LIMIT $2`,
    [`%${name.trim()}%`, limit],
  );
}

/**
 * 마주의 보유마 목록.
 * horses.ow_no 가 채워져 있으면 그것을 우선, 없으면 horses.raw->>'owNo' 으로 폴백.
 * (018 마이그레이션 직후엔 ow_no 컬럼이 비어 있을 수 있으므로 dual-source.)
 */
export async function getHorsesByOwner(
  owNo: string,
  limit = 50,
): Promise<OwnerHorse[]> {
  return query<OwnerHorse>(
    `SELECT h.horse_no, h.horse_name, h.sex,
            to_char(h.birth_date, 'YYYY-MM-DD') AS birth_date,
            h.total_race_count, h.first_place_count
       FROM horses h
      WHERE h.ow_no = $1 OR h.raw->>'owNo' = $1
      ORDER BY h.total_race_count DESC, h.horse_name
      LIMIT $2`,
    [owNo, limit],
  );
}

/**
 * horses.ow_no / raw->>'owNo' → owners.ow_name 매핑 (horse 페이지 owner 링크용).
 * 1회 호출로 N 개 마필의 owner_name 일괄 조회.
 */
export async function getOwnerNameMap(
  owNos: string[],
): Promise<Record<string, string>> {
  const unique = [...new Set(owNos.filter(Boolean))];
  if (unique.length === 0) return {};
  const placeholders = unique.map((_, i) => `$${i + 1}`).join(", ");
  const rows = await query<{ ow_no: string; ow_name: string }>(
    `SELECT ow_no, ow_name FROM owners WHERE ow_no IN (${placeholders})`,
    unique,
  );
  return Object.fromEntries(rows.map((r) => [r.ow_no, r.ow_name]));
}
