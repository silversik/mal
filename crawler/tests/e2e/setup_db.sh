#!/usr/bin/env bash
# E2E 용 빈 DB 를 만들고 db/migrations/0*.sql 을 번호 순으로 적용한다.
#
# prod 와 같은 레이아웃: 테이블은 `mal` 스키마, DB 기본 search_path = mal, public
# (prod 컨테이너는 mal_app role 의 search_path = mal, public).
#
# 사용 (libpq 환경변수로 서버 지정):
#   PGHOST=localhost PGPORT=5432 PGUSER=mal PGPASSWORD=mal_dev_pw \
#     bash crawler/tests/e2e/setup_db.sh mal_e2e
#
# ⚠ 대상 DB 를 DROP 후 재생성한다 — 이름에 e2e/test 가 없거나 운영 호스트면 거부
#   (conftest._assert_safe_target 과 같은 규칙).
# 011_move_scraper_to_crawler_schema.sql 은 통합 서버 전용(crawler 스키마 의존)이라
# 실패해도 무시한다 (크롤러 잡은 scraper_* 테이블을 쓰지 않음 — 대시보드 HTTP 리포트).
set -euo pipefail

DB="${1:?usage: setup_db.sh <dbname>}"
case "$DB" in
  *e2e*|*test*) ;;
  *)
    echo "[e2e] refusing to drop '$DB' — DB 이름에 e2e 또는 test 가 있어야 합니다" >&2
    exit 1
    ;;
esac
case "${PGHOST:-}" in
  49.50.138.*|*mal.kr*)
    echo "[e2e] refusing to touch production host '$PGHOST'" >&2
    exit 1
    ;;
esac

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
MIG_DIR="$SCRIPT_DIR/../../../db/migrations"
ERR_FILE="$(mktemp)"
trap 'rm -f "$ERR_FILE"' EXIT

dropdb --if-exists "$DB"
createdb "$DB"
psql -q -v ON_ERROR_STOP=1 -d "$DB" \
  -c "CREATE SCHEMA mal" \
  -c "ALTER DATABASE \"$DB\" SET search_path = mal, public" \
  -c "CREATE TABLE public._migrations_applied (filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())"

for f in "$MIG_DIR"/0*.sql; do
  name="$(basename "$f")"
  if psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$f" >/dev/null 2>"$ERR_FILE"; then
    # db/run-migrations.sh 와 같은 트래킹 테이블 (healthcheck 가 최신 마이그레이션을 본다)
    psql -q -v ON_ERROR_STOP=1 -d "$DB" \
      -c "INSERT INTO public._migrations_applied (filename) VALUES ('$name')"
    echo "[e2e] applied $name"
  else
    echo "[e2e] FAILED  $name (ignored): $(head -c 300 "$ERR_FILE" | tr '\n' ' ')"
  fi
done
echo "[e2e] done — export E2E_DATABASE_URL=postgresql+psycopg://<user>@<host>:<port>/$DB"
