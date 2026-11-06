#!/usr/bin/env bash
# 백업 복구 리허설 — 최신(또는 지정) 덤프를 임시 DB 에 복원해 핵심 테이블 행 수를 확인 후 삭제.
# 운영 DB 는 건드리지 않는다 (별도 DB 를 만들고 끝나면 DROP). 분기 1회 권장.
#
#   DATABASE_URL 미지정 → docker exec $PG_CONTAINER (기본 stack-db, superuser $PG_ADMIN=postgres)
#   DUMP=/srv/backups/mal/mal-mal-YYYYmmdd-HHMMSS.dump   (미지정 시 BACKUP_DIR 의 최신 파일)
#   REHEARSAL_DB (기본 mal_restore_rehearsal) — 이미 있으면 실패 (실수 덮어쓰기 방지)
#
# DATABASE_URL 모드에서는 URL 이 가리키는 서버에 접속해 REHEARSAL_DB 를 만들 권한이 필요하다.

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/srv/backups/mal}"
SCHEMA="${SCHEMA:-mal}"
REHEARSAL_DB="${REHEARSAL_DB:-mal_restore_rehearsal}"
DUMP="${DUMP:-$(ls -1t "$BACKUP_DIR"/mal-"$SCHEMA"-*.dump 2>/dev/null | head -1 || true)}"
if [ -z "$DUMP" ] || [ ! -f "$DUMP" ]; then
    echo "[rehearsal] dump not found (BACKUP_DIR=$BACKUP_DIR, DUMP=$DUMP)" >&2
    exit 1
fi
echo "[rehearsal] dump: $DUMP"

if [ -n "${DATABASE_URL:-}" ]; then
    psql_admin() { psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -qtA "$@"; }
    target_url="$(python3 -c 'import sys,urllib.parse as u;p=u.urlsplit(sys.argv[1]);print(u.urlunsplit(p._replace(path="/"+sys.argv[2])))' "$DATABASE_URL" "$REHEARSAL_DB")"
    psql_rehearsal() { psql "$target_url" -v ON_ERROR_STOP=1 -qtA "$@"; }
    restore() { pg_restore --no-owner --no-privileges -d "$target_url" < "$DUMP"; }
else
    PG_CONTAINER="${PG_CONTAINER:-stack-db}"
    PG_ADMIN="${PG_ADMIN:-postgres}"
    psql_admin() { docker exec -i "$PG_CONTAINER" psql -U "$PG_ADMIN" -d postgres -v ON_ERROR_STOP=1 -qtA "$@"; }
    psql_rehearsal() { docker exec -i "$PG_CONTAINER" psql -U "$PG_ADMIN" -d "$REHEARSAL_DB" -v ON_ERROR_STOP=1 -qtA "$@"; }
    restore() { docker exec -i "$PG_CONTAINER" pg_restore -U "$PG_ADMIN" --no-owner --no-privileges -d "$REHEARSAL_DB" < "$DUMP"; }
fi

if [ "$(psql_admin -c "SELECT 1 FROM pg_database WHERE datname = '$REHEARSAL_DB'")" = "1" ]; then
    echo "[rehearsal] database $REHEARSAL_DB already exists — drop it manually first" >&2
    exit 1
fi
psql_admin -c "CREATE DATABASE $REHEARSAL_DB" >/dev/null
trap 'psql_admin -c "DROP DATABASE IF EXISTS $REHEARSAL_DB" >/dev/null && echo "[rehearsal] dropped $REHEARSAL_DB"' EXIT

started=$(date +%s)
if [ -f "$DUMP.deps.sql" ]; then
    echo "[rehearsal] applying external trigger functions ($DUMP.deps.sql)"
    psql_rehearsal < "$DUMP.deps.sql" >/dev/null
fi
restore
echo "[rehearsal] restored in $(( $(date +%s) - started ))s"

fail=0
for t in races race_results horses jockeys race_entries race_dividends; do
    n="$(psql_rehearsal -c "SELECT count(*) FROM $SCHEMA.$t" 2>/dev/null || echo ERR)"
    printf '[rehearsal] %-16s %s\n' "$t" "$n"
    case "$n" in ERR|0) [ "$t" = races ] || [ "$t" = race_results ] || [ "$t" = horses ] && fail=1 ;; esac
done
latest="$(psql_rehearsal -c "SELECT max(race_date) FROM $SCHEMA.race_results" 2>/dev/null || echo ERR)"
echo "[rehearsal] latest race_results.race_date = $latest"
if [ "$fail" -ne 0 ]; then
    echo "[rehearsal] FAILED — core tables empty or unreadable" >&2
    exit 1
fi
echo "[rehearsal] ok"
