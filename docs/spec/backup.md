# DB 백업 · 복구 리허설

`mal` 스키마(공용 `app` DB 안)를 매일 덤프하고, 분기마다 실제로 복원되는지 리허설한다.
스크립트는 `db/run-migrations.sh` 와 같은 접속 규칙을 따른다 — `DATABASE_URL` 이 있으면 호스트
`pg_dump`/`psql`, 없으면 `docker exec stack-db` (기본 `mal_app` / `app`).

## 매일 백업 — `db/backup-mal.sh`

```bash
# prod 호스트 cron (KST 04:40 — 새벽 잡 사이). OFFSITE 는 호스트 밖 사본 — 디스크 장애 대비 필수 권장.
40 4 * * * cd /srv/services/mal && OFFSITE=user@backup-host:/backups/mal bash db/backup-mal.sh >> /var/log/mal-backup.log 2>&1
```

- 출력: `$BACKUP_DIR/mal-mal-YYYYmmdd-HHMMSS.dump` (pg_dump `-Fc`, `--no-owner --no-privileges`).
- **사이드카 `*.dump.deps.sql`**: `mal` 테이블 트리거가 다른 스키마 함수(예: `public.set_updated_at()`)를
  부르면 `-n mal` 덤프에 정의가 빠져 복원이 실패한다. 그 함수 정의를 따로 저장한다 (없으면 파일 없음).
- 검증: 덤프 크기 ≥ `MIN_BYTES`(기본 1MiB) + 목차에 `races`·`race_results`·`horses` 데이터 존재. 실패 시
  부분 파일 삭제 후 exit 1 — cron 로그/모니터로 감지.
- 보관: 로컬 `KEEP_DAYS`(기본 14)일. 오프사이트 보관 정책은 대상 호스트에서 관리.
- 환경변수: `SCHEMA`(mal) · `BACKUP_DIR`(/srv/backups/mal) · `KEEP_DAYS` · `OFFSITE` · `MIN_BYTES` ·
  `PG_CONTAINER`/`PG_USER`/`PG_DB`.

## 분기 복구 리허설 — `db/restore-rehearsal.sh`

```bash
cd /srv/services/mal && bash db/restore-rehearsal.sh            # 최신 덤프
DUMP=/srv/backups/mal/mal-mal-20261106-044000.dump bash db/restore-rehearsal.sh
```

- 임시 DB `mal_restore_rehearsal` 을 만들어 (이미 있으면 중단) 사이드카 → 덤프 순으로 복원하고,
  핵심 테이블 행 수와 최신 `race_results.race_date` 를 출력한 뒤 **항상 DROP** 한다. 운영 DB 는 건드리지 않는다.
- docker 모드는 superuser(`PG_ADMIN`, 기본 postgres)로 접속한다 — `mal_app` 은 DB 생성 권한이 없다.
- 복원 소요 시간이 곧 RTO 의 하한 — 결과를 기록해 둔다.

## 실제 복구 (사고 시)

1. 웹·크롤러 정지: `cd /srv/stack && docker compose stop mal-web mal-crawler`
2. 리허설 DB 로 먼저 복원해 데이터 확인 (위 스크립트, DROP 전 확인하려면 스크립트의 `trap` 줄을 주석).
3. 운영 스키마 교체는 수동·신중히: `ALTER SCHEMA mal RENAME TO mal_broken_YYYYMMDD` 후 사이드카 → 덤프 복원,
   `mal_app` 권한·`search_path` 재확인 (`ALTER ROLE mal_app SET search_path = mal, public`).
4. `docker compose start mal-web mal-crawler` → `docker exec mal-crawler python -m src.main healthcheck`.

> 로컬 검증 (2026-11): Postgres 16 에 전체 마이그레이션 적용 → `mal` 스키마 복사본 백업 → 리허설 복원
> 성공 (사이드카 없이는 `set_updated_at()` 부재로 트리거 생성 실패하는 것을 재현·수정).
