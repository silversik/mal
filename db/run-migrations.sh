#!/usr/bin/env bash
# mal.kr 마이그레이션 일괄 적용 스크립트.
#
# Jenkinsfile 코멘트상 "마이그레이션은 별도 수동 트리거" 정책 — 본 스크립트가 그 도구.
#
# 트래킹: `_migrations_applied(filename)` 테이블에 적용 이력을 기록.
# 이미 적용된 파일은 skip — 환경별로 한 번만 의미있는 마이그레이션 (e.g. 011 schema move)
# 이 재실행돼서 깨지는 것을 방지.
#
# 처음 도입 시: 이미 적용된 파일이 있을 수 있으므로 INIT_FROM=NNN 으로 N번 미만은
# "이미 적용됨" 으로 표시 후 시작 가능.
#   예: INIT_FROM=012 bash db/run-migrations.sh   # 011 까지는 적용 완료로 가정
#
# 사용:
#   환경변수 DATABASE_URL 로 직접 실행:
#     DATABASE_URL='postgres://mal:***@host:5432/mal' bash db/run-migrations.sh
#
#   또는 docker exec 모드 (PG_CONTAINER 미지정 시 'mal_postgres'):
#     bash db/run-migrations.sh
#
# 종료코드: 첫 실패 시 1.

set -euo pipefail

SCRIPT_DIR="$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
MIG_DIR="$SCRIPT_DIR/migrations"

if [ ! -d "$MIG_DIR" ]; then
    echo "[migrate] migrations dir not found: $MIG_DIR" >&2
    exit 1
fi

# 적용 모드 결정: DATABASE_URL > docker exec.
if [ -n "${DATABASE_URL:-}" ]; then
    PSQL_CMD=(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q)
    echo "[migrate] using psql with DATABASE_URL"
else
    PG_CONTAINER="${PG_CONTAINER:-mal_postgres}"
    PG_USER="${PG_USER:-mal}"
    PG_DB="${PG_DB:-mal}"
    if ! docker ps --format '{{.Names}}' | grep -qx "$PG_CONTAINER"; then
        echo "[migrate] postgres container '$PG_CONTAINER' not running." >&2
        echo "[migrate] set DATABASE_URL or PG_CONTAINER explicitly." >&2
        exit 1
    fi
    PSQL_CMD=(docker exec -i "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -v ON_ERROR_STOP=1 -q)
    echo "[migrate] using docker exec → $PG_CONTAINER ($PG_USER/$PG_DB)"
fi

# 1. 트래킹 테이블 보장
"${PSQL_CMD[@]}" -c "CREATE TABLE IF NOT EXISTS _migrations_applied (filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW());" >/dev/null

# 2. INIT_FROM 으로 누락 백필 (선택)
if [ -n "${INIT_FROM:-}" ]; then
    echo "[migrate] INIT_FROM=$INIT_FROM — marking < $INIT_FROM as already applied"
    for f in "$MIG_DIR"/*.sql; do
        name="$(basename "$f")"
        prefix="${name%%_*}"  # "012_community_posts.sql" -> "012"
        if [[ "$prefix" < "$INIT_FROM" ]]; then
            "${PSQL_CMD[@]}" -c "INSERT INTO _migrations_applied (filename) VALUES ('$name') ON CONFLICT DO NOTHING;" >/dev/null
        fi
    done
fi

# 3. 적용 대상 결정 — 트래킹 테이블에 없는 파일만.
shopt -s nullglob
files=("$MIG_DIR"/*.sql)
if [ ${#files[@]} -eq 0 ]; then
    echo "[migrate] no .sql files found"
    exit 0
fi

SORTED=()
while IFS= read -r line; do
    SORTED+=("$line")
done < <(printf '%s\n' "${files[@]}" | sort -V)

applied_count=0
skipped_count=0
failed=0
for f in "${SORTED[@]}"; do
    name="$(basename "$f")"
    # 이미 적용?
    exists=$("${PSQL_CMD[@]}" -tAc "SELECT 1 FROM _migrations_applied WHERE filename = '$name'")
    if [ "$exists" = "1" ]; then
        echo "[migrate] skip   $name (already applied)"
        skipped_count=$((skipped_count + 1))
        continue
    fi

    printf '[migrate] apply  %s ... ' "$name"
    if "${PSQL_CMD[@]}" < "$f" >/dev/null; then
        "${PSQL_CMD[@]}" -c "INSERT INTO _migrations_applied (filename) VALUES ('$name');" >/dev/null
        echo "ok"
        applied_count=$((applied_count + 1))
    else
        echo "FAILED"
        failed=1
        break
    fi
done

if [ "$failed" -ne 0 ]; then
    echo "[migrate] aborted on first failure" >&2
    exit 1
fi

echo "[migrate] done — applied=$applied_count skipped=$skipped_count"
