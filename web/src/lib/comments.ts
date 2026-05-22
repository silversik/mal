import { query } from "./db";

export const CONTENT_MAX = 500;

export type EntityType = "horse" | "jockey" | "trainer" | "owner" | "race";

export const ENTITY_TYPES: EntityType[] = [
  "horse",
  "jockey",
  "trainer",
  "owner",
  "race",
];

// 런타임 허용집합 검증 — 액션 레이어에서 잘못된 타입을 raw 500 대신 명시 거부.
export function isEntityType(v: unknown): v is EntityType {
  return typeof v === "string" && (ENTITY_TYPES as string[]).includes(v);
}

export type Comment = {
  id: number;
  entity_type: EntityType;
  entity_id: string;
  entity_name: string;
  user_id: string;
  content: string;
  author_name: string | null;
  created_at: string;
};

export type RecentComment = Comment & {
  entity_href: string;
};

const COMMENT_COLUMNS = `
  c.id::int         AS id,
  c.entity_type,
  c.entity_id,
  c.entity_name,
  c.user_id::text   AS user_id,
  c.content,
  COALESCE(u.nickname, u.name) AS author_name,
  to_char(c.created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at
`;

function entityHref(type: EntityType, id: string): string {
  switch (type) {
    case "horse":   return `/horse/${id}`;
    case "jockey":  return `/jockey/${id}`;
    case "trainer": return `/trainer/${id}`;
    case "owner":   return `/owner/${id}`;
    case "race": {
      // id format: "YYYY-MM-DD_meet_raceno"
      const parts = id.split("_");
      if (parts.length >= 3) {
        const raceno = parts[parts.length - 1];
        const meet = parts[parts.length - 2];
        const date = parts.slice(0, parts.length - 2).join("-");
        return `/races?date=${date}&venue=${encodeURIComponent(meet)}&race=${raceno}`;
      }
      return "/races";
    }
  }
}

export async function listComments(
  entityType: EntityType,
  entityId: string,
  limit = 50,
): Promise<Comment[]> {
  return query<Comment>(
    `SELECT ${COMMENT_COLUMNS}
       FROM entity_comments c
       LEFT JOIN users u ON u.id = c.user_id
      WHERE c.entity_type = $1 AND c.entity_id = $2
      ORDER BY c.id DESC
      LIMIT $3`,
    [entityType, entityId, limit],
  );
}

export async function getRecentComments(limit = 10): Promise<RecentComment[]> {
  const rows = await query<Comment>(
    `SELECT ${COMMENT_COLUMNS}
       FROM entity_comments c
       LEFT JOIN users u ON u.id = c.user_id
      ORDER BY c.created_at DESC
      LIMIT $1`,
    [limit],
  );
  return rows.map((r) => ({
    ...r,
    entity_href: entityHref(r.entity_type, r.entity_id),
  }));
}

// 비-race 엔티티의 (테이블, id컬럼, 이름컬럼). 키는 entityType(검증된 리터럴)이라
// 테이블/컬럼 식별자 보간은 안전 — entityId 만 파라미터 바인딩.
const ENTITY_LOOKUP: Record<
  Exclude<EntityType, "race">,
  { table: string; idCol: string; nameCol: string }
> = {
  horse:   { table: "horses",   idCol: "horse_no", nameCol: "horse_name" },
  jockey:  { table: "jockeys",  idCol: "jk_no",    nameCol: "jk_name" },
  trainer: { table: "trainers", idCol: "tr_no",    nameCol: "tr_name" },
  owner:   { table: "owners",   idCol: "ow_no",    nameCol: "ow_name" },
};

// race entityId 형식: 'YYYY-MM-DD_meet_raceno' (entityHref 와 동일 계약).
const RACE_ID_RE = /^(\d{4}-\d{2}-\d{2})_([^_]+)_(\d+)$/;

// entityId 로 서버에서 표시명을 결정(클라 entityName 불신뢰) + 엔티티 실재 검증.
// 존재하지 않으면 null → 호출자가 거부. 홈 피드 스푸핑/피싱·유령 엔티티 차단.
export async function resolveEntityName(
  entityType: EntityType,
  entityId: string,
): Promise<string | null> {
  if (entityType === "race") {
    const m = RACE_ID_RE.exec(entityId);
    if (!m) return null;
    const [, date, meet, raceNo] = m;
    const rows = await query<{ ok: boolean }>(
      `SELECT TRUE AS ok FROM races
        WHERE race_date = $1::date AND meet = $2 AND race_no = $3::int
        LIMIT 1`,
      [date, meet, Number(raceNo)],
    );
    return rows.length > 0 ? `${date} ${meet} ${raceNo}R` : null;
  }
  const cfg = ENTITY_LOOKUP[entityType];
  const rows = await query<{ name: string }>(
    `SELECT ${cfg.nameCol} AS name FROM ${cfg.table}
      WHERE ${cfg.idCol} = $1 LIMIT 1`,
    [entityId],
  );
  return rows[0]?.name ?? null;
}

export async function createComment(opts: {
  entityType: EntityType;
  entityId: string;
  entityName: string;
  userId: string;
  content: string;
}): Promise<void> {
  await query(
    `INSERT INTO entity_comments (entity_type, entity_id, entity_name, user_id, content)
     VALUES ($1, $2, $3, $4::bigint, $5)`,
    [opts.entityType, opts.entityId, opts.entityName, opts.userId, opts.content],
  );
}

// 삭제 + 재검증 대상 엔티티 반환(없거나 타인 댓글이면 null → IDOR 안전).
export async function deleteComment(
  id: number,
  userId: string,
): Promise<{ entity_type: EntityType; entity_id: string } | null> {
  const rows = await query<{ entity_type: EntityType; entity_id: string }>(
    `DELETE FROM entity_comments WHERE id = $1 AND user_id = $2::bigint
       RETURNING entity_type, entity_id`,
    [id, userId],
  );
  return rows[0] ?? null;
}
