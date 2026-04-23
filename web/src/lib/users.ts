import { query } from "./db";

export const NICKNAME_MIN = 2;
export const NICKNAME_MAX = 20;
// 닉네임 허용 문자: 한글/영문/숫자/_-. (공백 불가). 커뮤니티에서 멘션/식별에 자연스러운 범위.
const NICKNAME_RE = /^[0-9A-Za-z_\-.\uAC00-\uD7A3]+$/;

export type UserProfile = {
  id: string;
  email: string | null;
  name: string | null;
  nickname: string | null;
  image: string | null;
  display_name: string; // nickname ?? name ?? '회원'
};

const PROFILE_COLUMNS = `
  id::text AS id,
  email,
  name,
  nickname,
  image,
  COALESCE(nickname, name, '회원') AS display_name
`;

export async function getUserById(id: string): Promise<UserProfile | null> {
  const rows = await query<UserProfile>(
    `SELECT ${PROFILE_COLUMNS} FROM users WHERE id = $1::bigint`,
    [id],
  );
  return rows[0] ?? null;
}

export type NicknameValidationError =
  | "required"
  | "too_short"
  | "too_long"
  | "invalid_chars"
  | "taken";

export function validateNicknameShape(
  raw: string,
): { ok: true; value: string } | { ok: false; error: NicknameValidationError } {
  const value = raw.trim();
  if (!value) return { ok: false, error: "required" };
  if (value.length < NICKNAME_MIN) return { ok: false, error: "too_short" };
  if (value.length > NICKNAME_MAX) return { ok: false, error: "too_long" };
  if (!NICKNAME_RE.test(value)) return { ok: false, error: "invalid_chars" };
  return { ok: true, value };
}

/** UNIQUE 제약 위반(23505) 은 "taken" 으로 반환. 그 외는 throw. */
export async function updateNickname(
  userId: string,
  nickname: string,
): Promise<{ ok: true } | { ok: false; error: "taken" }> {
  try {
    await query(
      `UPDATE users SET nickname = $2 WHERE id = $1::bigint`,
      [userId, nickname],
    );
    return { ok: true };
  } catch (err) {
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code?: string }).code === "23505"
    ) {
      return { ok: false, error: "taken" };
    }
    throw err;
  }
}

/** users CASCADE → user_accounts, community_posts 동시 삭제. */
export async function deleteUser(userId: string): Promise<void> {
  await query(`DELETE FROM users WHERE id = $1::bigint`, [userId]);
}
