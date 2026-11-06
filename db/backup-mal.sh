#!/usr/bin/env bash
# mal.kr DB 백업 — `mal` 스키마를 pg_dump custom 포맷(-Fc)으로 떠서 보관 + 무결성 확인.
#
# 운영 권장: 호스트 cron 으로 매일 1회 (KST 04:40 — 크롤러 새벽 잡 사이 한가한 시간).
#   40 4 * * * cd /srv/services/mal && OFFSITE=user@backup-host:/backups/mal bash db/backup-mal.sh >> /var/log/mal-backup.log 2>&1
#
# 접속 모드 (run-migrations.sh 와 동일 규칙):
#   DATABASE_URL 지정 시 → 호스트의 pg_dump 로 직접 접속
#   미지정 시          → docker exec $PG_CONTAINER pg_dump (기본 stack-db / mal_app / app)
#
# 환경변수:
#   SCHEMA      덤프할 스키마 (기본 mal)
#   BACKUP_DIR  보관 디렉터리 (기본 /srv/backups/mal)
#   KEEP_DAYS   로컬 보관 일수 (기본 14) — 그보다 오래된 mal-*.dump 삭제
#   OFFSITE     (선택) rsync 대상 "user@host:/path" — 호스트 밖 사본. 디스크 장애 대비 필수 권장.
#   MIN_BYTES   (선택) 이보다 작은 덤프는 실패로 간주 (기본 1048576 = 1MiB, 빈 덤프 방지)
#
# 종료코드: 0 성공, 1 실패 (덤프·검증·오프사이트 어느 단계든). 실패 시 부분 파일은 지운다.

set -euo pipefail

SCHEMA="${SCHEMA:-mal}"
BACKUP_DIR="${BACKUP_DIR:-/srv/backups/mal}"
KEEP_DAYS="${KEEP_DAYS:-14}"
MIN_BYTES="${MIN_BYTES:-1048576}"
STAMP="$(TZ=Asia/Seoul date +%Y%m%d-%H%M%S)"
OUT="$BACKUP_DIR/mal-$SCHEMA-$STAMP.dump"

mkdir -p "$BACKUP_DIR"
cleanup_partial() { rm -f "$OUT.part" "$OUT.deps.sql.part"; }
trap cleanup_partial ERR

if [ -n "${DATABASE_URL:-}" ]; then
    echo "[backup] pg_dump via DATABASE_URL (schema=$SCHEMA)"
    pg_dump "$DATABASE_URL" -Fc -n "$SCHEMA" --no-owner --no-privileges -f "$OUT.part"
    LIST_CMD=(pg_restore --list)
    PSQL_CMD=(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -qtA)
else
    PG_CONTAINER="${PG_CONTAINER:-stack-db}"
    PG_USER="${PG_USER:-mal_app}"
    PG_DB="${PG_DB:-app}"
    if ! docker ps --format '{{.Names}}' | grep -qx "$PG_CONTAINER"; then
        echo "[backup] postgres container '$PG_CONTAINER' not running — set DATABASE_URL or PG_CONTAINER" >&2
        exit 1
    fi
    echo "[backup] docker exec $PG_CONTAINER pg_dump ($PG_USER/$PG_DB, schema=$SCHEMA)"
    docker exec "$PG_CONTAINER" pg_dump -U "$PG_USER" -d "$PG_DB" -Fc -n "$SCHEMA" \
        --no-owner --no-privileges > "$OUT.part"
    LIST_CMD=(docker exec -i "$PG_CONTAINER" pg_restore --list)
    PSQL_CMD=(docker exec -i "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -v ON_ERROR_STOP=1 -qtA)
fi

# 스키마 밖 의존 함수 — `mal` 테이블 트리거가 public.set_updated_at() 처럼 다른 스키마의 함수를
# 부르면 `-n mal` 덤프에는 정의가 빠져 복원이 실패한다. 정의를 사이드카 SQL 로 같이 보관.
DEPS_SQL="$("${PSQL_CMD[@]}" -c "
  SELECT DISTINCT 'CREATE SCHEMA IF NOT EXISTS ' || quote_ident(pn.nspname) || E';\n'
         || pg_get_functiondef(p.oid) || E';\n'
    FROM pg_trigger t
    JOIN pg_class c      ON c.oid = t.tgrelid
    JOIN pg_namespace n  ON n.oid = c.relnamespace
    JOIN pg_proc p       ON p.oid = t.tgfoid
    JOIN pg_namespace pn ON pn.oid = p.pronamespace
   WHERE n.nspname = '$SCHEMA' AND pn.nspname <> '$SCHEMA' AND NOT t.tgisinternal")"
if [ -n "$DEPS_SQL" ]; then
    printf '%s\n' "$DEPS_SQL" > "$OUT.deps.sql.part"
    echo "[backup] external trigger functions: $(grep -c '^CREATE OR REPLACE FUNCTION' "$OUT.deps.sql.part")"
fi

size=$(wc -c < "$OUT.part")
if [ "$size" -lt "$MIN_BYTES" ]; then
    echo "[backup] FAILED — dump too small ($size bytes < $MIN_BYTES). 빈 스키마/권한 문제 확인." >&2
    rm -f "$OUT.part"
    exit 1
fi

# 무결성: custom 포맷 목차를 읽을 수 있어야 하고, 핵심 테이블 데이터가 들어 있어야 한다.
toc="$("${LIST_CMD[@]}" < "$OUT.part")"
missing=()
for t in races race_results horses; do
    grep -q "TABLE DATA $SCHEMA $t " <<<"$toc" || missing+=("$t")
done
if [ ${#missing[@]} -gt 0 ]; then
    echo "[backup] FAILED — dump TOC missing table data: ${missing[*]}" >&2
    rm -f "$OUT.part"
    exit 1
fi
mv "$OUT.part" "$OUT"
[ -f "$OUT.deps.sql.part" ] && mv "$OUT.deps.sql.part" "$OUT.deps.sql"
echo "[backup] ok $OUT ($(numfmt --to=iec "$size" 2>/dev/null || echo "$size B"))"

if [ -n "${OFFSITE:-}" ]; then
    echo "[backup] offsite rsync → $OFFSITE"
    rsync -a "$OUT" ${DEPS_SQL:+"$OUT.deps.sql"} "$OFFSITE/"
fi

# 로컬 보관 기간 정리 (오프사이트 쪽 보관 정책은 대상 호스트에서 관리)
find "$BACKUP_DIR" -maxdepth 1 \( -name "mal-$SCHEMA-*.dump" -o -name "mal-$SCHEMA-*.dump.deps.sql" \) \
    -mtime +"$KEEP_DAYS" -print -delete \
    | sed 's/^/[backup] pruned /'
echo "[backup] done"
