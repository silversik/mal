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
};

const HORSE_COLUMNS = `
  horse_no, horse_name, country, sex,
  to_char(birth_date, 'YYYY-MM-DD') AS birth_date,
  sire_name, dam_name, total_race_count, first_place_count,
  coat_color, characteristics
`;

export async function searchHorsesByName(name: string, limit = 30): Promise<Horse[]> {
  if (!name.trim()) return [];
  return query<Horse>(
    `SELECT ${HORSE_COLUMNS}
       FROM horses
      WHERE horse_name ILIKE $1
      ORDER BY horse_name
      LIMIT $2`,
    [`%${name.trim()}%`, limit],
  );
}

export async function getHorseByNo(horseNo: string): Promise<Horse | null> {
  const rows = await query<Horse>(
    `SELECT ${HORSE_COLUMNS} FROM horses WHERE horse_no = $1`,
    [horseNo],
  );
  return rows[0] ?? null;
}

export async function getRecentHorses(limit = 20): Promise<Horse[]> {
  return query<Horse>(
    `SELECT ${HORSE_COLUMNS}
       FROM horses
      ORDER BY created_at DESC
      LIMIT $1`,
    [limit],
  );
}

export async function getRaceResultsForHorse(
  horseNo: string,
  limit = 10,
): Promise<RaceResult[]> {
  return query<RaceResult>(
    `SELECT id, horse_no,
            to_char(race_date, 'YYYY-MM-DD') AS race_date,
            meet, race_no, track_condition, rank,
            record_time::text, weight::text,
            jockey_name, trainer_name
       FROM race_results
      WHERE horse_no = $1
      ORDER BY race_date DESC, race_no DESC
      LIMIT $2`,
    [horseNo, limit],
  );
}

export async function getSiblings(sireName: string | null, excludeHorseNo: string): Promise<Horse[]> {
  if (!sireName) return [];
  return query<Horse>(
    `SELECT ${HORSE_COLUMNS}
       FROM horses
      WHERE sire_name = $1 AND horse_no <> $2
      ORDER BY birth_date DESC NULLS LAST
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
  dam_name: string | null;
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
  const rows = await query<AncestryRow>(
    `
    WITH RECURSIVE ancestry AS (
      SELECT horse_no, horse_name, sex,
             to_char(birth_date, 'YYYY-MM-DD') AS birth_date,
             country, sire_name, dam_name,
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
             h.country, h.sire_name, h.dam_name,
             h.total_race_count, h.first_place_count,
             a.gen + 1,
             a.path || h.horse_no,
             a.horse_no,
             s.side
        FROM ancestry a
        CROSS JOIN LATERAL (
          VALUES ('sire'::text, a.sire_name),
                 ('dam'::text,  a.dam_name)
        ) AS s(side, ancestor_name)
        JOIN LATERAL (
          SELECT * FROM horses h2
           WHERE h2.horse_name = s.ancestor_name
           ORDER BY h2.birth_date ASC NULLS LAST
           LIMIT 1
        ) h ON TRUE
       WHERE a.gen < $2
         AND s.ancestor_name IS NOT NULL
         AND NOT (h.horse_no = ANY(a.path))
    )
    SELECT horse_no, horse_name, sex, birth_date, country,
           sire_name, dam_name, total_race_count, first_place_count,
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

  let stubCounter = 0;
  const stub = (name: string, side: "sire" | "dam"): PedigreeNode => ({
    id: `__stub_${stubCounter++}`,
    horse_no: null,
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
          ? stub(row.sire_name, "sire")
          : null,
      dam: kids?.dam
        ? build(kids.dam, "dam")
        : row.dam_name
          ? stub(row.dam_name, "dam")
          : null,
    };
  };

  const rootRow = rows.find((r) => r.gen === 0);
  return rootRow ? build(rootRow, null) : null;
}
