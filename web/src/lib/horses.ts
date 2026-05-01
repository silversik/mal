import { query } from "./db";

export type Horse = {
  horse_no: string;
  horse_name: string;
  country: string | null;
  sex: string | null;
  birth_date: string | null;
  sire_name: string | null;
  dam_name: string | null;
  total_race_count: number;
  first_place_count: number;
  coat_color: string | null;
  characteristics: string[] | null;
  ow_no: string | null;       // 마주번호 (horses.ow_no 또는 raw->>'owNo' 폴백)
  owner_name: string | null;  // owners.ow_name (LEFT JOIN, 미등록 마주는 NULL)
};

export type RaceResult = {
  id: number;
  horse_no: string;
  race_date: string;
  meet: string | null;
  race_no: number;
  track_condition: string | null;
  rank: number | null;
  record_time: string | null;
  weight: string | null;
  jockey_name: string | null;
  trainer_name: string | null;
  trainer_no: string | null;  // trainers JOIN by name
};

const HORSE_COLUMNS = `
  h.horse_no, h.horse_name, h.country, h.sex,
  to_char(h.birth_date, 'YYYY-MM-DD') AS birth_date,
  h.sire_name, h.dam_name, h.total_race_count, h.first_place_count,
  h.coat_color, h.characteristics,
  COALESCE(h.ow_no, h.raw->>'owNo') AS ow_no,
  o.ow_name AS owner_name
`;

// horses 와 owners 의 LEFT JOIN — ow_no 가 채워져 있거나 raw 에 owNo 가 있을 때만 매칭.
const HORSE_FROM = `
  horses h
    LEFT JOIN owners o ON o.ow_no = COALESCE(h.ow_no, h.raw->>'owNo')
`;

export async function searchHorsesByName(name: string, limit = 30): Promise<Horse[]> {
  if (!name.trim()) return [];
  return query<Horse>(
    `SELECT ${HORSE_COLUMNS}
       FROM ${HORSE_FROM}
      WHERE h.horse_name ILIKE $1
      ORDER BY h.horse_name
      LIMIT $2`,
    [`%${name.trim()}%`, limit],
  );
}

export async function getHorseByNo(horseNo: string): Promise<Horse | null> {
  const rows = await query<Horse>(
    `SELECT ${HORSE_COLUMNS} FROM ${HORSE_FROM} WHERE h.horse_no = $1`,
    [horseNo],
  );
  return rows[0] ?? null;
}

export async function getRecentHorses(limit = 20): Promise<Horse[]> {
  return query<Horse>(
    `SELECT ${HORSE_COLUMNS}
       FROM ${HORSE_FROM}
      ORDER BY h.created_at DESC
      LIMIT $1`,
    [limit],
  );
}

export type RecentWinner = Horse & {
  last_win_date: string;
  last_win_meet: string | null;
  win_count: number;
};

/** 가장 최근 1착 기록 기준으로 마필을 내림차순 반환. win_count는 race_results 집계값. */
export async function getRecentWinners(limit = 6): Promise<RecentWinner[]> {
  return query<RecentWinner>(
    `SELECT ${HORSE_COLUMNS},
            lw.last_win_date,
            lw.last_win_meet,
            lw.win_count
       FROM (
         SELECT DISTINCT ON (rr.horse_no)
                rr.horse_no,
                to_char(rr.race_date, 'YYYY-MM-DD') AS last_win_date,
                rr.meet                              AS last_win_meet,
                cnt.win_count
           FROM race_results rr
           JOIN (
                 SELECT horse_no, COUNT(*) AS win_count
                   FROM race_results
                  WHERE rank = 1
                  GROUP BY horse_no
                ) cnt ON cnt.horse_no = rr.horse_no
          WHERE rr.rank = 1
          ORDER BY rr.horse_no, rr.race_date DESC
       ) lw
       JOIN horses h ON h.horse_no = lw.horse_no
       LEFT JOIN owners o ON o.ow_no = COALESCE(h.ow_no, h.raw->>'owNo')
      ORDER BY lw.last_win_date DESC
      LIMIT $1`,
    [limit],
  );
}

export type HorseSort = "latest" | "wins";

/** /horses 페이지용 정렬 지원 쿼리. */
export async function getHorsesSorted(sort: HorseSort = "latest", limit = 60): Promise<Horse[]> {
  const order =
    sort === "wins"
      ? "h.first_place_count DESC, h.total_race_count DESC, h.created_at DESC"
      : "h.created_at DESC";
  return query<Horse>(
    `SELECT ${HORSE_COLUMNS}
       FROM ${HORSE_FROM}
      ORDER BY ${order}
      LIMIT $1`,
    [limit],
  );
}

export async function getRaceResultsForHorse(
  horseNo: string,
  limit = 10,
): Promise<RaceResult[]> {
  return query<RaceResult>(
    `SELECT rr.id, rr.horse_no,
            to_char(rr.race_date, 'YYYY-MM-DD') AS race_date,
            rr.meet, rr.race_no, rr.track_condition, rr.rank,
            rr.record_time::text, rr.weight::text,
            rr.jockey_name, rr.trainer_name,
            t.tr_no AS trainer_no
       FROM race_results rr
       LEFT JOIN trainers t ON t.tr_name = rr.trainer_name
      WHERE rr.horse_no = $1
      ORDER BY rr.race_date DESC, rr.race_no DESC
      LIMIT $2`,
    [horseNo, limit],
  );
}

export async function getSiblings(sireName: string | null, excludeHorseNo: string): Promise<Horse[]> {
  if (!sireName) return [];
  return query<Horse>(
    `SELECT ${HORSE_COLUMNS}
       FROM ${HORSE_FROM}
      WHERE h.sire_name = $1 AND h.horse_no <> $2
      ORDER BY h.birth_date DESC NULLS LAST
      LIMIT 12`,
    [sireName, excludeHorseNo],
  );
}

/* ── Pedigree (ancestors) ─────────────────────────────── */

export type PedigreeNode = {
  id: string;                    // horse_no, 또는 `__stub_...` (DB 미등록 조상)
  horse_no: string | null;       // DB에 있는 경우만 값, 없으면 null
  name: string;
  gender: "Male" | "Female" | "Unknown";
  country: string | null;
  birthYear: string | null;
  gradeWinner: boolean;
  stats?: Record<string, string | number>;
  sire?: PedigreeNode | null;
  dam?: PedigreeNode | null;
};

type AncestryRow = {
  horse_no: string;
  horse_name: string;
  sex: string | null;
  birth_date: string | null;
  country: string | null;
  sire_name: string | null;
  sire_no: string | null;
  dam_name: string | null;
  dam_no: string | null;
  total_race_count: number;
  first_place_count: number;
  gen: number;
  parent_horse_no: string | null;
  side: "sire" | "dam" | null;
};

function mapGender(side: "sire" | "dam" | null, sex: string | null): "Male" | "Female" | "Unknown" {
  if (side === "sire") return "Male";
  if (side === "dam") return "Female";
  if (!sex) return "Unknown";
  if (sex.startsWith("수") || sex.startsWith("거")) return "Male";
  if (sex.startsWith("암")) return "Female";
  return "Unknown";
}

export async function getPedigree(
  rootHorseNo: string,
  maxGenerations = 4,
): Promise<PedigreeNode | null> {
  // 마이그레이션 019 이후: horses.sire_no/dam_no 가 채워져 있어 ID-기반 traversal.
  // 폴백: sire_no 가 NULL 이면 sire_name 으로 fuzzy match (구버전 데이터).
  const rows = await query<AncestryRow>(
    `
    WITH RECURSIVE ancestry AS (
      SELECT horse_no, horse_name, sex,
             to_char(birth_date, 'YYYY-MM-DD') AS birth_date,
             country, sire_name, sire_no, dam_name, dam_no,
             total_race_count, first_place_count,
             0 AS gen,
             ARRAY[horse_no]::text[] AS path,
             NULL::text AS parent_horse_no,
             NULL::text AS side
        FROM horses
       WHERE horse_no = $1
      UNION ALL
      SELECT h.horse_no, h.horse_name, h.sex,
             to_char(h.birth_date, 'YYYY-MM-DD') AS birth_date,
             h.country, h.sire_name, h.sire_no, h.dam_name, h.dam_no,
             h.total_race_count, h.first_place_count,
             a.gen + 1,
             a.path || h.horse_no,
             a.horse_no,
             s.side
        FROM ancestry a
        CROSS JOIN LATERAL (
          VALUES ('sire'::text, a.sire_no, a.sire_name),
                 ('dam'::text,  a.dam_no,  a.dam_name)
        ) AS s(side, ancestor_no, ancestor_name)
        JOIN LATERAL (
          SELECT * FROM (
            -- 1순위: ID 매칭 (정확)
            SELECT h2.*, 0 AS prio FROM horses h2
             WHERE s.ancestor_no IS NOT NULL AND h2.horse_no = s.ancestor_no
            UNION ALL
            -- 2순위: ID 가 없을 때만 이름 매칭 (구버전 fallback)
            SELECT h2.*, 1 AS prio FROM horses h2
             WHERE s.ancestor_no IS NULL
               AND s.ancestor_name IS NOT NULL
               AND h2.horse_name = s.ancestor_name
          ) cands
          ORDER BY prio ASC, cands.birth_date ASC NULLS LAST
          LIMIT 1
        ) h ON TRUE
       WHERE a.gen < $2
         AND (s.ancestor_no IS NOT NULL OR s.ancestor_name IS NOT NULL)
         AND NOT (h.horse_no = ANY(a.path))
    )
    SELECT horse_no, horse_name, sex, birth_date, country,
           sire_name, sire_no, dam_name, dam_no,
           total_race_count, first_place_count,
           gen, parent_horse_no, side
      FROM ancestry
    `,
    [rootHorseNo, maxGenerations],
  );

  if (rows.length === 0) return null;

  const childrenMap = new Map<string, { sire?: AncestryRow; dam?: AncestryRow }>();
  for (const r of rows) {
    if (!r.parent_horse_no || !r.side) continue;
    const slot = childrenMap.get(r.parent_horse_no) ?? {};
    slot[r.side] = r;
    childrenMap.set(r.parent_horse_no, slot);
  }

  const stub = (name: string, side: "sire" | "dam", no?: string | null): PedigreeNode => ({
    id: no ?? `__stub_${name}`,
    horse_no: no ?? null,
    name,
    gender: side === "sire" ? "Male" : "Female",
    country: null,
    birthYear: null,
    gradeWinner: false,
  });

  const build = (row: AncestryRow, side: "sire" | "dam" | null): PedigreeNode => {
    const kids = childrenMap.get(row.horse_no);
    const gradeWinner = row.first_place_count > 0;
    return {
      id: row.horse_no,
      horse_no: row.horse_no,
      name: row.horse_name,
      gender: mapGender(side, row.sex),
      country: row.country,
      birthYear: row.birth_date ? row.birth_date.slice(0, 4) : null,
      gradeWinner,
      stats: {
        출전: row.total_race_count,
        "1착": row.first_place_count,
      },
      sire: kids?.sire
        ? build(kids.sire, "sire")
        : row.sire_name
          ? stub(row.sire_name, "sire", row.sire_no)
          : null,
      dam: kids?.dam
        ? build(kids.dam, "dam")
        : row.dam_name
          ? stub(row.dam_name, "dam", row.dam_no)
          : null,
    };
  };

  const rootRow = rows.find((r) => r.gen === 0);
  return rootRow ? build(rootRow, null) : null;
}
